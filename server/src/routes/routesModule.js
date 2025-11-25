// server/src/routes/routes.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// Helper: verificar si es admin
function isAdmin(req) {
    const role = String(req.user?.role || '').toLowerCase();
    return role === 'admin';
}

// Helper: verificar permisos
function canViewRoute(req, route) {
    if (isAdmin(req)) return true;
    return Number(req.user?.id) === Number(route.user_id);
}

// =================== ROUTES ENDPOINTS ===================

// GET /api/routes - Listar recorridos
router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = Number(req.user?.id);
        const admin = isAdmin(req);
        const { zone_id, status, user_id, start_date, end_date, limit = 100 } = req.query;

        let query = `
      SELECT 
        r.*,
        z.name as zone_name,
        z.color as zone_color,
        u.name as user_name,
        (SELECT COUNT(*) FROM route_stops WHERE route_id = r.id) as stops_count,
        (SELECT COUNT(*) FROM route_stops WHERE route_id = r.id AND status = 'completada') as completed_stops
      FROM routes r
      LEFT JOIN zones z ON z.id = r.zone_id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE 1=1
    `;

        const params = [];

        // Filtro de permisos: admin ve todo, usuario solo sus recorridos
        if (!admin) {
            query += ' AND r.user_id = ?';
            params.push(userId);
        }

        // Filtros opcionales
        if (zone_id) {
            query += ' AND r.zone_id = ?';
            params.push(zone_id);
        }

        if (status) {
            query += ' AND r.status = ?';
            params.push(status);
        }

        if (user_id && admin) {
            query += ' AND r.user_id = ?';
            params.push(user_id);
        }

        if (start_date) {
            query += ' AND r.start_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND r.end_date <= ?';
            params.push(end_date);
        }

        query += ' ORDER BY r.start_date DESC, r.created_at DESC LIMIT ?';
        params.push(Math.min(Number(limit) || 100, 500));

        const [routes] = await pool.query(query, params);

        res.json(routes);
    } catch (e) {
        console.error('[routes] Error al listar recorridos:', e);
        res.status(500).json({ error: 'Error al listar recorridos' });
    }
});

// GET /api/routes/:id - Detalle de recorrido con paradas
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener recorrido
        const [[route]] = await pool.query(
            `SELECT 
        r.*,
        z.name as zone_name,
        z.color as zone_color,
        z.departments as zone_departments,
        u.name as user_name,
        u.email as user_email
       FROM routes r
       LEFT JOIN zones z ON z.id = r.zone_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = ?
       LIMIT 1`,
            [id]
        );

        if (!route) {
            return res.status(404).json({ error: 'Recorrido no encontrado' });
        }

        // Verificar permisos
        if (!canViewRoute(req, route)) {
            return res.status(403).json({ error: 'No tienes permiso para ver este recorrido' });
        }

        // Parsear JSON
        if (route.zone_departments && typeof route.zone_departments === 'string') {
            route.zone_departments = JSON.parse(route.zone_departments);
        }

        // Obtener paradas
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
        v.status as visit_status
       FROM route_stops rs
       LEFT JOIN organizations o ON o.id = rs.organization_id
       LEFT JOIN followup_visits v ON v.id = rs.visit_id
       WHERE rs.route_id = ?
       ORDER BY rs.stop_order ASC`,
            [id]
        );

        route.stops = stops;

        res.json(route);
    } catch (e) {
        console.error('[routes] Error al obtener recorrido:', e);
        res.status(500).json({ error: 'Error al obtener recorrido' });
    }
});

// POST /api/routes - Crear recorrido
router.post('/', requireAuth, async (req, res) => {
    try {
        const userId = Number(req.user?.id);
        const admin = isAdmin(req);
        const {
            name,
            zone_id,
            user_id,
            start_date,
            end_date,
            notes,
            stops = [],
        } = req.body;

        // Validaciones
        if (!name || !zone_id || !start_date || !end_date) {
            return res.status(400).json({
                error: 'Nombre, zona, fecha de inicio y fin son requeridos'
            });
        }

        // Solo admin puede asignar a otro usuario
        const assignedUserId = (admin && user_id) ? user_id : userId;

        // Crear recorrido
        const [result] = await pool.query(
            `INSERT INTO routes 
       (name, zone_id, user_id, start_date, end_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, zone_id, assignedUserId, start_date, end_date, notes || null, userId]
        );

        const routeId = result.insertId;

        // Agregar paradas si se proporcionaron
        if (stops.length > 0) {
            const stopValues = stops.map((stop, index) => [
                routeId,
                stop.organization_id,
                index + 1, // stop_order
                stop.planned_date || null,
                stop.planned_time || null,
                stop.duration_minutes || 60,
                stop.notes || null,
            ]);

            await pool.query(
                `INSERT INTO route_stops 
         (route_id, organization_id, stop_order, planned_date, planned_time, duration_minutes, notes)
         VALUES ?`,
                [stopValues]
            );
        }

        // Obtener recorrido creado con todos sus datos
        const [[route]] = await pool.query(
            `SELECT 
        r.*,
        z.name as zone_name,
        z.color as zone_color,
        u.name as user_name
       FROM routes r
       LEFT JOIN zones z ON z.id = r.zone_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = ?
       LIMIT 1`,
            [routeId]
        );

        // Obtener paradas
        const [routeStops] = await pool.query(
            `SELECT 
        rs.*,
        o.name as organization_name,
        o.city,
        o.latitude,
        o.longitude
       FROM route_stops rs
       LEFT JOIN organizations o ON o.id = rs.organization_id
       WHERE rs.route_id = ?
       ORDER BY rs.stop_order ASC`,
            [routeId]
        );

        route.stops = routeStops;

        res.status(201).json(route);
    } catch (e) {
        console.error('[routes] Error al crear recorrido:', e);
        res.status(500).json({ error: 'Error al crear recorrido' });
    }
});

// PUT /api/routes/:id - Actualizar recorrido
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = Number(req.user?.id);
        const admin = isAdmin(req);

        // Verificar que existe y permisos
        const [[route]] = await pool.query(
            'SELECT * FROM routes WHERE id = ? LIMIT 1',
            [id]
        );

        if (!route) {
            return res.status(404).json({ error: 'Recorrido no encontrado' });
        }

        if (!canViewRoute(req, route)) {
            return res.status(403).json({ error: 'No tienes permiso para editar este recorrido' });
        }

        const { name, zone_id, user_id, start_date, end_date, status, notes } = req.body;

        const sets = [];
        const params = [];

        if (name !== undefined) {
            sets.push('name = ?');
            params.push(name);
        }
        if (zone_id !== undefined) {
            sets.push('zone_id = ?');
            params.push(zone_id);
        }
        if (user_id !== undefined && admin) {
            sets.push('user_id = ?');
            params.push(user_id);
        }
        if (start_date !== undefined) {
            sets.push('start_date = ?');
            params.push(start_date);
        }
        if (end_date !== undefined) {
            sets.push('end_date = ?');
            params.push(end_date);
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
            `UPDATE routes SET ${sets.join(', ')} WHERE id = ?`,
            params
        );

        // Obtener recorrido actualizado
        const [[updated]] = await pool.query(
            `SELECT 
        r.*,
        z.name as zone_name,
        z.color as zone_color,
        u.name as user_name
       FROM routes r
       LEFT JOIN zones z ON z.id = r.zone_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = ?
       LIMIT 1`,
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[routes] Error al actualizar recorrido:', e);
        res.status(500).json({ error: 'Error al actualizar recorrido' });
    }
});

// PATCH /api/routes/:id/status - Cambiar estado del recorrido
router.patch('/:id/status', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !['planificado', 'en_curso', 'completado', 'cancelado'].includes(status)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }

        // Verificar permisos
        const [[route]] = await pool.query(
            'SELECT * FROM routes WHERE id = ? LIMIT 1',
            [id]
        );

        if (!route) {
            return res.status(404).json({ error: 'Recorrido no encontrado' });
        }

        if (!canViewRoute(req, route)) {
            return res.status(403).json({ error: 'No tienes permiso para modificar este recorrido' });
        }

        await pool.query(
            'UPDATE routes SET status = ? WHERE id = ?',
            [status, id]
        );

        res.json({ message: 'Estado actualizado correctamente', status });
    } catch (e) {
        console.error('[routes] Error al cambiar estado:', e);
        res.status(500).json({ error: 'Error al cambiar estado' });
    }
});

// DELETE /api/routes/:id - Eliminar recorrido
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar permisos
        const [[route]] = await pool.query(
            'SELECT * FROM routes WHERE id = ? LIMIT 1',
            [id]
        );

        if (!route) {
            return res.status(404).json({ error: 'Recorrido no encontrado' });
        }

        if (!canViewRoute(req, route)) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar este recorrido' });
        }

        // Las paradas se eliminan automáticamente por CASCADE
        await pool.query('DELETE FROM routes WHERE id = ?', [id]);

        res.json({ message: 'Recorrido eliminado correctamente' });
    } catch (e) {
        console.error('[routes] Error al eliminar recorrido:', e);
        res.status(500).json({ error: 'Error al eliminar recorrido' });
    }
});

// GET /api/routes/user/:userId - Recorridos de un ejecutivo
router.get('/user/:userId', requireAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUserId = Number(req.user?.id);
        const admin = isAdmin(req);

        // Solo admin o el mismo usuario pueden ver sus recorridos
        if (!admin && currentUserId !== Number(userId)) {
            return res.status(403).json({ error: 'No tienes permiso para ver estos recorridos' });
        }

        const [routes] = await pool.query(
            `SELECT 
        r.*,
        z.name as zone_name,
        z.color as zone_color,
        (SELECT COUNT(*) FROM route_stops WHERE route_id = r.id) as stops_count
       FROM routes r
       LEFT JOIN zones z ON z.id = r.zone_id
       WHERE r.user_id = ?
       ORDER BY r.start_date DESC`,
            [userId]
        );

        res.json(routes);
    } catch (e) {
        console.error('[routes] Error al listar recorridos del usuario:', e);
        res.status(500).json({ error: 'Error al listar recorridos' });
    }
});

export default router;
