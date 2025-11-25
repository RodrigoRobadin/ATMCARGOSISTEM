// server/src/routes/zones.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// Helper: verificar si es admin
function isAdmin(req) {
    const role = String(req.user?.role || '').toLowerCase();
    return role === 'admin';
}

// =================== ZONES ENDPOINTS ===================

// GET /api/zones - Listar todas las zonas
router.get('/', requireAuth, async (req, res) => {
    try {
        const { active } = req.query;

        let query = 'SELECT * FROM zones';
        const params = [];

        if (active !== undefined) {
            query += ' WHERE active = ?';
            params.push(active === 'true' ? 1 : 0);
        }

        query += ' ORDER BY id ASC';

        const [zones] = await pool.query(query, params);

        // Parsear JSON de departments y coordinates
        const zonesWithParsedData = zones.map(zone => ({
            ...zone,
            departments: typeof zone.departments === 'string'
                ? JSON.parse(zone.departments)
                : zone.departments,
            coordinates: zone.coordinates && typeof zone.coordinates === 'string'
                ? JSON.parse(zone.coordinates)
                : zone.coordinates,
        }));

        res.json(zonesWithParsedData);
    } catch (e) {
        console.error('[zones] Error al listar zonas:', e);
        res.status(500).json({ error: 'Error al listar zonas' });
    }
});

// GET /api/zones/:id - Obtener zona específica
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [[zone]] = await pool.query(
            'SELECT * FROM zones WHERE id = ? LIMIT 1',
            [id]
        );

        if (!zone) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }

        // Parsear JSON
        zone.departments = typeof zone.departments === 'string'
            ? JSON.parse(zone.departments)
            : zone.departments;
        zone.coordinates = zone.coordinates && typeof zone.coordinates === 'string'
            ? JSON.parse(zone.coordinates)
            : zone.coordinates;

        res.json(zone);
    } catch (e) {
        console.error('[zones] Error al obtener zona:', e);
        res.status(500).json({ error: 'Error al obtener zona' });
    }
});

// GET /api/zones/:id/organizations - Organizaciones de una zona
router.get('/:id/organizations', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [organizations] = await pool.query(
            `SELECT 
        id, name, city, department, address, latitude, longitude
       FROM organizations 
       WHERE zone_id = ? AND deleted_at IS NULL
       ORDER BY name ASC`,
            [id]
        );

        res.json(organizations);
    } catch (e) {
        console.error('[zones] Error al listar organizaciones de zona:', e);
        res.status(500).json({ error: 'Error al listar organizaciones' });
    }
});

// POST /api/zones - Crear zona (solo admin)
router.post('/', requireAuth, async (req, res) => {
    try {
        if (!isAdmin(req)) {
            return res.status(403).json({ error: 'Solo administradores pueden crear zonas' });
        }

        const { name, description, departments, color, coordinates } = req.body;

        if (!name || !departments || !Array.isArray(departments)) {
            return res.status(400).json({ error: 'Nombre y departamentos son requeridos' });
        }

        const [result] = await pool.query(
            `INSERT INTO zones (name, description, departments, color, coordinates)
       VALUES (?, ?, ?, ?, ?)`,
            [
                name,
                description || null,
                JSON.stringify(departments),
                color || '#3B82F6',
                coordinates ? JSON.stringify(coordinates) : null,
            ]
        );

        const [[zone]] = await pool.query(
            'SELECT * FROM zones WHERE id = ? LIMIT 1',
            [result.insertId]
        );

        zone.departments = JSON.parse(zone.departments);
        if (zone.coordinates) {
            zone.coordinates = JSON.parse(zone.coordinates);
        }

        res.status(201).json(zone);
    } catch (e) {
        console.error('[zones] Error al crear zona:', e);
        res.status(500).json({ error: 'Error al crear zona' });
    }
});

// PUT /api/zones/:id - Actualizar zona (solo admin)
router.put('/:id', requireAuth, async (req, res) => {
    try {
        if (!isAdmin(req)) {
            return res.status(403).json({ error: 'Solo administradores pueden actualizar zonas' });
        }

        const { id } = req.params;
        const { name, description, departments, color, coordinates, active } = req.body;

        const sets = [];
        const params = [];

        if (name !== undefined) {
            sets.push('name = ?');
            params.push(name);
        }
        if (description !== undefined) {
            sets.push('description = ?');
            params.push(description);
        }
        if (departments !== undefined) {
            sets.push('departments = ?');
            params.push(JSON.stringify(departments));
        }
        if (color !== undefined) {
            sets.push('color = ?');
            params.push(color);
        }
        if (coordinates !== undefined) {
            sets.push('coordinates = ?');
            params.push(coordinates ? JSON.stringify(coordinates) : null);
        }
        if (active !== undefined) {
            sets.push('active = ?');
            params.push(active ? 1 : 0);
        }

        if (sets.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        params.push(id);

        await pool.query(
            `UPDATE zones SET ${sets.join(', ')} WHERE id = ?`,
            params
        );

        const [[zone]] = await pool.query(
            'SELECT * FROM zones WHERE id = ? LIMIT 1',
            [id]
        );

        if (zone) {
            zone.departments = JSON.parse(zone.departments);
            if (zone.coordinates) {
                zone.coordinates = JSON.parse(zone.coordinates);
            }
        }

        res.json(zone);
    } catch (e) {
        console.error('[zones] Error al actualizar zona:', e);
        res.status(500).json({ error: 'Error al actualizar zona' });
    }
});

// DELETE /api/zones/:id - Eliminar zona (solo admin)
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        if (!isAdmin(req)) {
            return res.status(403).json({ error: 'Solo administradores pueden eliminar zonas' });
        }

        const { id } = req.params;

        // Verificar si hay recorridos asociados
        const [[count]] = await pool.query(
            'SELECT COUNT(*) as count FROM routes WHERE zone_id = ?',
            [id]
        );

        if (count.count > 0) {
            return res.status(400).json({
                error: 'No se puede eliminar la zona porque tiene recorridos asociados'
            });
        }

        await pool.query('DELETE FROM zones WHERE id = ?', [id]);

        res.json({ message: 'Zona eliminada correctamente' });
    } catch (e) {
        console.error('[zones] Error al eliminar zona:', e);
        res.status(500).json({ error: 'Error al eliminar zona' });
    }
});

export default router;
