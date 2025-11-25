// server/src/routes/routeStops.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// Helper: verificar si es admin
function isAdmin(req) {
    const role = String(req.user?.role || '').toLowerCase();
    return role === 'admin';
}

// Helper: verificar permisos sobre el recorrido
async function canEditRoute(req, routeId) {
    const userId = Number(req.user?.id);
    const admin = isAdmin(req);

    if (admin) return true;

    const [[route]] = await pool.query(
        'SELECT user_id FROM routes WHERE id = ? LIMIT 1',
        [routeId]
    );

    return route && Number(route.user_id) === userId;
}

// =================== ROUTE STOPS ENDPOINTS ===================

// GET /api/routes/:routeId/stops - Paradas de un recorrido
router.get('/:routeId/stops', requireAuth, async (req, res) => {
    try {
        const { routeId } = req.params;

        // Verificar permisos
        if (!(await canEditRoute(req, routeId))) {
            return res.status(403).json({ error: 'No tienes permiso para ver este recorrido' });
        }

        const [stops] = await pool.query(
            `SELECT 
        rs.*,
        o.name as organization_name,
        o.city,
        o.department,
        o.address,
        o.latitude,
        o.longitude,
        v.id as visit_id,
        v.status as visit_status,
        v.scheduled_at as visit_scheduled_at
       FROM route_stops rs
       LEFT JOIN organizations o ON o.id = rs.organization_id
       LEFT JOIN followup_visits v ON v.id = rs.visit_id
       WHERE rs.route_id = ?
       ORDER BY rs.stop_order ASC`,
            [routeId]
        );

        res.json(stops);
    } catch (e) {
        console.error('[route-stops] Error al listar paradas:', e);
        res.status(500).json({ error: 'Error al listar paradas' });
    }
});

// POST /api/routes/:routeId/stops - Agregar parada
router.post('/:routeId/stops', requireAuth, async (req, res) => {
    try {
        const { routeId } = req.params;

        // Verificar permisos
        if (!(await canEditRoute(req, routeId))) {
            return res.status(403).json({ error: 'No tienes permiso para modificar este recorrido' });
        }

        const {
            organization_id,
            planned_date,
            planned_time,
            duration_minutes = 60,
            notes,
        } = req.body;

        if (!organization_id) {
            return res.status(400).json({ error: 'organization_id es requerido' });
        }

        // Obtener el siguiente stop_order
        const [[maxOrder]] = await pool.query(
            'SELECT COALESCE(MAX(stop_order), 0) as max_order FROM route_stops WHERE route_id = ?',
            [routeId]
        );

        const stopOrder = (maxOrder?.max_order || 0) + 1;

        const [result] = await pool.query(
            `INSERT INTO route_stops 
       (route_id, organization_id, stop_order, planned_date, planned_time, duration_minutes, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [routeId, organization_id, stopOrder, planned_date || null, planned_time || null, duration_minutes, notes || null]
        );

        // Obtener la parada creada
        const [[stop]] = await pool.query(
            `SELECT 
        rs.*,
        o.name as organization_name,
        o.city,
        o.latitude,
        o.longitude
       FROM route_stops rs
       LEFT JOIN organizations o ON o.id = rs.organization_id
       WHERE rs.id = ?
       LIMIT 1`,
            [result.insertId]
        );

        res.status(201).json(stop);
    } catch (e) {
        console.error('[route-stops] Error al crear parada:', e);
        res.status(500).json({ error: 'Error al crear parada' });
    }
});

// PUT /api/route-stops/:id - Actualizar parada
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener parada y verificar permisos
        const [[stop]] = await pool.query(
            'SELECT route_id FROM route_stops WHERE id = ? LIMIT 1',
            [id]
        );

        if (!stop) {
            return res.status(404).json({ error: 'Parada no encontrada' });
        }

        if (!(await canEditRoute(req, stop.route_id))) {
            return res.status(403).json({ error: 'No tienes permiso para modificar esta parada' });
        }

        const {
            planned_date,
            planned_time,
            duration_minutes,
            status,
            notes,
        } = req.body;

        const sets = [];
        const params = [];

        if (planned_date !== undefined) {
            sets.push('planned_date = ?');
            params.push(planned_date);
        }
        if (planned_time !== undefined) {
            sets.push('planned_time = ?');
            params.push(planned_time);
        }
        if (duration_minutes !== undefined) {
            sets.push('duration_minutes = ?');
            params.push(duration_minutes);
        }
        if (status !== undefined) {
            sets.push('status = ?');
            params.push(status);
        }
        if (notes !== undefined) {
            sets.push('notes = ?');
            params.push(notes);
        }

        if (sets.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        params.push(id);

        await pool.query(
            `UPDATE route_stops SET ${sets.join(', ')} WHERE id = ?`,
            params
        );

        // Obtener parada actualizada
        const [[updated]] = await pool.query(
            `SELECT 
        rs.*,
        o.name as organization_name,
        o.city,
        o.latitude,
        o.longitude
       FROM route_stops rs
       LEFT JOIN organizations o ON o.id = rs.organization_id
       WHERE rs.id = ?
       LIMIT 1`,
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[route-stops] Error al actualizar parada:', e);
        res.status(500).json({ error: 'Error al actualizar parada' });
    }
});

// PATCH /api/route-stops/:id/order - Reordenar parada
router.patch('/:id/order', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { new_order } = req.body;

        if (new_order === undefined || new_order < 1) {
            return res.status(400).json({ error: 'new_order debe ser mayor a 0' });
        }

        // Obtener parada y verificar permisos
        const [[stop]] = await pool.query(
            'SELECT route_id, stop_order FROM route_stops WHERE id = ? LIMIT 1',
            [id]
        );

        if (!stop) {
            return res.status(404).json({ error: 'Parada no encontrada' });
        }

        if (!(await canEditRoute(req, stop.route_id))) {
            return res.status(403).json({ error: 'No tienes permiso para modificar esta parada' });
        }

        const oldOrder = stop.stop_order;
        const newOrder = Number(new_order);

        if (oldOrder === newOrder) {
            return res.json({ message: 'Sin cambios' });
        }

        // Reordenar paradas
        if (newOrder > oldOrder) {
            // Mover hacia abajo: decrementar las que están en el medio
            await pool.query(
                `UPDATE route_stops 
         SET stop_order = stop_order - 1 
         WHERE route_id = ? AND stop_order > ? AND stop_order <= ?`,
                [stop.route_id, oldOrder, newOrder]
            );
        } else {
            // Mover hacia arriba: incrementar las que están en el medio
            await pool.query(
                `UPDATE route_stops 
         SET stop_order = stop_order + 1 
         WHERE route_id = ? AND stop_order >= ? AND stop_order < ?`,
                [stop.route_id, newOrder, oldOrder]
            );
        }

        // Actualizar la parada movida
        await pool.query(
            'UPDATE route_stops SET stop_order = ? WHERE id = ?',
            [newOrder, id]
        );

        // Obtener todas las paradas reordenadas
        const [stops] = await pool.query(
            `SELECT 
        rs.*,
        o.name as organization_name
       FROM route_stops rs
       LEFT JOIN organizations o ON o.id = rs.organization_id
       WHERE rs.route_id = ?
       ORDER BY rs.stop_order ASC`,
            [stop.route_id]
        );

        res.json(stops);
    } catch (e) {
        console.error('[route-stops] Error al reordenar parada:', e);
        res.status(500).json({ error: 'Error al reordenar parada' });
    }
});

// PATCH /api/route-stops/:id/complete - Marcar parada como completada
router.patch('/:id/complete', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { visit_id } = req.body;

        // Obtener parada y verificar permisos
        const [[stop]] = await pool.query(
            'SELECT route_id, organization_id FROM route_stops WHERE id = ? LIMIT 1',
            [id]
        );

        if (!stop) {
            return res.status(404).json({ error: 'Parada no encontrada' });
        }

        if (!(await canEditRoute(req, stop.route_id))) {
            return res.status(403).json({ error: 'No tienes permiso para modificar esta parada' });
        }

        // Actualizar parada
        await pool.query(
            `UPDATE route_stops 
       SET status = 'completada', visit_id = ?
       WHERE id = ?`,
            [visit_id || null, id]
        );

        // Obtener parada actualizada
        const [[updated]] = await pool.query(
            `SELECT 
        rs.*,
        o.name as organization_name,
        v.status as visit_status
       FROM route_stops rs
       LEFT JOIN organizations o ON o.id = rs.organization_id
       LEFT JOIN followup_visits v ON v.id = rs.visit_id
       WHERE rs.id = ?
       LIMIT 1`,
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[route-stops] Error al completar parada:', e);
        res.status(500).json({ error: 'Error al completar parada' });
    }
});

// DELETE /api/route-stops/:id - Eliminar parada
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener parada y verificar permisos
        const [[stop]] = await pool.query(
            'SELECT route_id, stop_order FROM route_stops WHERE id = ? LIMIT 1',
            [id]
        );

        if (!stop) {
            return res.status(404).json({ error: 'Parada no encontrada' });
        }

        if (!(await canEditRoute(req, stop.route_id))) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar esta parada' });
        }

        // Eliminar parada
        await pool.query('DELETE FROM route_stops WHERE id = ?', [id]);

        // Reordenar las paradas restantes
        await pool.query(
            `UPDATE route_stops 
       SET stop_order = stop_order - 1 
       WHERE route_id = ? AND stop_order > ?`,
            [stop.route_id, stop.stop_order]
        );

        res.json({ message: 'Parada eliminada correctamente' });
    } catch (e) {
        console.error('[route-stops] Error al eliminar parada:', e);
        res.status(500).json({ error: 'Error al eliminar parada' });
    }
});

export default router;
