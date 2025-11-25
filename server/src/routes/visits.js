// server/src/routes/visits.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

/* =================== helpers comunes =================== */
function canAdmin(req) {
    return req.user && String(req.user.role || '').toLowerCase() === 'admin';
}

function pickUserFilter(req) {
    // admin puede pasar ?user_id=; usuario normal siempre a su propio id
    if (canAdmin(req) && req.query.user_id) return Number(req.query.user_id);
    return Number(req.user?.id);
}

function toMySQLDateTime(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
        d.getHours()
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* =================== bootstrap de tablas =================== */
(async () => {
    try {
        // Visitas a empresas
        await pool.query(`
      CREATE TABLE IF NOT EXISTS followup_visits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        org_id INT NULL,
        
        scheduled_at DATETIME NOT NULL,
        estimated_duration_min INT DEFAULT 60,
        address TEXT,
        status ENUM('scheduled','confirmed','completed','cancelled','rescheduled') DEFAULT 'scheduled',
        objective VARCHAR(255),
        products_to_present TEXT,
        materials_needed TEXT,
        internal_participants TEXT,
        travel_time_min INT,
        preparation_notes TEXT,
        
        actual_start DATETIME NULL,
        actual_end DATETIME NULL,
        actual_attendees TEXT,
        outcome ENUM('successful','neutral','negative') NULL,
        interest_level INT NULL,
        agreements TEXT,
        next_steps TEXT,
        detailed_notes TEXT,
        
        follow_up_task_id INT NULL,
        next_visit_date DATE NULL,
        needs_quote BOOLEAN DEFAULT FALSE,
        needs_proposal BOOLEAN DEFAULT FALSE,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        INDEX (user_id),
        INDEX (org_id),
        INDEX (scheduled_at),
        INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

        // Tabla de relación muchos-a-muchos para contactos de visitas
        await pool.query(`
      CREATE TABLE IF NOT EXISTS visit_contacts (
        visit_id INT NOT NULL,
        contact_id INT NOT NULL,
        PRIMARY KEY (visit_id, contact_id),
        INDEX (visit_id),
        INDEX (contact_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

        console.log('[visits] Tablas de visitas listas.');
    } catch (e) {
        console.error('[visits] No se pudieron crear tablas de visitas:', e?.message || e);
    }
})();

/* =================== VISITS ENDPOINTS =================== */

// GET /api/visits - Listar visitas
router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = pickUserFilter(req);
        const { status, limit = 500, offset = 0 } = req.query;
        const safeLimit = Math.min(Number(limit) || 500, 1000);
        const safeOffset = Math.max(Number(offset) || 0, 0);

        let where = 'v.user_id = ?';
        const params = [userId];

        if (status) {
            where += ' AND v.status = ?';
            params.push(String(status));
        }

        params.push(safeLimit, safeOffset);

        const [rows] = await pool.query(
            `
      SELECT v.*, o.name AS org_name
      FROM followup_visits v
      LEFT JOIN organizations o ON o.id = v.org_id
      WHERE ${where}
      ORDER BY v.scheduled_at DESC, v.id DESC
      LIMIT ? OFFSET ?
    `,
            params
        );

        // Para cada visita, obtener los contactos asociados
        for (const visit of rows) {
            const [contacts] = await pool.query(
                `
        SELECT c.id, c.name, c.email
        FROM visit_contacts vc
        JOIN contacts c ON c.id = vc.contact_id
        WHERE vc.visit_id = ?
      `,
                [visit.id]
            );
            visit.contacts = contacts;
        }

        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'No se pudo listar visitas' });
    }
});

// GET /api/visits/:id - Obtener visita específica
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = Number(req.user?.id);
        const isAdmin = canAdmin(req);

        const [[visit]] = await pool.query(
            `
      SELECT v.*, o.name AS org_name, o.address AS org_address
      FROM followup_visits v
      LEFT JOIN organizations o ON o.id = v.org_id
      WHERE v.id = ?
    `,
            [id]
        );

        if (!visit) {
            return res.status(404).json({ error: 'Visita no encontrada' });
        }

        // Seguridad: solo dueño o admin
        if (!isAdmin && Number(visit.user_id) !== userId) {
            return res.status(403).json({ error: 'Permiso denegado' });
        }

        // Obtener contactos asociados
        const [contacts] = await pool.query(
            `
      SELECT c.id, c.name, c.email, c.phone
      FROM visit_contacts vc
      JOIN contacts c ON c.id = vc.contact_id
      WHERE vc.visit_id = ?
    `,
            [id]
        );
        visit.contacts = contacts;

        res.json(visit);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'No se pudo obtener la visita' });
    }
});

// POST /api/visits - Crear nueva visita
router.post('/', requireAuth, async (req, res) => {
    try {
        const userId = Number(req.user?.id);
        const {
            org_id,
            contact_ids = [],
            scheduled_at,
            estimated_duration_min = 60,
            address,
            objective,
            products_to_present,
            materials_needed,
            internal_participants,
            travel_time_min,
            preparation_notes,
        } = req.body || {};

        if (!org_id) {
            return res.status(400).json({ error: 'org_id es requerido' });
        }
        if (!scheduled_at) {
            return res.status(400).json({ error: 'scheduled_at es requerido' });
        }

        const scheduledSql =
            scheduled_at.length === 16 ? `${scheduled_at}:00` : scheduled_at;

        const [ins] = await pool.query(
            `INSERT INTO followup_visits
       (user_id, org_id, scheduled_at, estimated_duration_min, address, objective,
        products_to_present, materials_needed, internal_participants, travel_time_min, preparation_notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
                userId,
                Number(org_id),
                scheduledSql,
                Number(estimated_duration_min) || 60,
                address || null,
                objective || null,
                products_to_present || null,
                materials_needed || null,
                internal_participants || null,
                Number(travel_time_min) || null,
                preparation_notes || null,
            ]
        );

        const visitId = ins.insertId;

        // Insertar contactos asociados
        if (Array.isArray(contact_ids) && contact_ids.length > 0) {
            const values = contact_ids.map((cid) => [visitId, Number(cid)]);
            await pool.query(
                'INSERT INTO visit_contacts (visit_id, contact_id) VALUES ?',
                [values]
            );
        }

        // Obtener la visita creada con todos sus datos
        const [[visit]] = await pool.query(
            `
      SELECT v.*, o.name AS org_name
      FROM followup_visits v
      LEFT JOIN organizations o ON o.id = v.org_id
      WHERE v.id = ?
    `,
            [visitId]
        );

        // Obtener contactos
        const [contacts] = await pool.query(
            `
      SELECT c.id, c.name, c.email
      FROM visit_contacts vc
      JOIN contacts c ON c.id = vc.contact_id
      WHERE vc.visit_id = ?
    `,
            [visitId]
        );
        visit.contacts = contacts;

        res.status(201).json(visit);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'No se pudo crear la visita' });
    }
});

// PATCH /api/visits/:id - Actualizar visita
router.patch('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = Number(req.user?.id);
        const isAdmin = canAdmin(req);

        const [[visit]] = await pool.query(
            'SELECT * FROM followup_visits WHERE id = ? LIMIT 1',
            [id]
        );

        if (!visit) {
            return res.status(404).json({ error: 'Visita no encontrada' });
        }

        // Seguridad: solo dueño o admin
        if (!isAdmin && Number(visit.user_id) !== userId) {
            return res.status(403).json({ error: 'Permiso denegado' });
        }

        const {
            scheduled_at,
            estimated_duration_min,
            address,
            status,
            objective,
            products_to_present,
            materials_needed,
            internal_participants,
            travel_time_min,
            preparation_notes,
            actual_start,
            actual_end,
            actual_attendees,
            outcome,
            interest_level,
            agreements,
            next_steps,
            detailed_notes,
            next_visit_date,
            needs_quote,
            needs_proposal,
            contact_ids,
        } = req.body || {};

        const sets = [];
        const params = [];

        if (scheduled_at !== undefined) {
            const scheduledSql =
                scheduled_at.length === 16 ? `${scheduled_at}:00` : scheduled_at;
            sets.push('scheduled_at = ?');
            params.push(scheduledSql);
        }
        if (estimated_duration_min !== undefined) {
            sets.push('estimated_duration_min = ?');
            params.push(Number(estimated_duration_min));
        }
        if (address !== undefined) {
            sets.push('address = ?');
            params.push(address);
        }
        if (status !== undefined) {
            const validStatuses = [
                'scheduled',
                'confirmed',
                'completed',
                'cancelled',
                'rescheduled',
            ];
            sets.push('status = ?');
            params.push(validStatuses.includes(status) ? status : 'scheduled');
        }
        if (objective !== undefined) {
            sets.push('objective = ?');
            params.push(objective);
        }
        if (products_to_present !== undefined) {
            sets.push('products_to_present = ?');
            params.push(products_to_present);
        }
        if (materials_needed !== undefined) {
            sets.push('materials_needed = ?');
            params.push(materials_needed);
        }
        if (internal_participants !== undefined) {
            sets.push('internal_participants = ?');
            params.push(internal_participants);
        }
        if (travel_time_min !== undefined) {
            sets.push('travel_time_min = ?');
            params.push(Number(travel_time_min) || null);
        }
        if (preparation_notes !== undefined) {
            sets.push('preparation_notes = ?');
            params.push(preparation_notes);
        }
        if (actual_start !== undefined) {
            sets.push('actual_start = ?');
            params.push(actual_start || null);
        }
        if (actual_end !== undefined) {
            sets.push('actual_end = ?');
            params.push(actual_end || null);
        }
        if (actual_attendees !== undefined) {
            sets.push('actual_attendees = ?');
            params.push(actual_attendees);
        }
        if (outcome !== undefined) {
            const validOutcomes = ['successful', 'neutral', 'negative'];
            sets.push('outcome = ?');
            params.push(validOutcomes.includes(outcome) ? outcome : null);
        }
        if (interest_level !== undefined) {
            sets.push('interest_level = ?');
            params.push(Number(interest_level) || null);
        }
        if (agreements !== undefined) {
            sets.push('agreements = ?');
            params.push(agreements);
        }
        if (next_steps !== undefined) {
            sets.push('next_steps = ?');
            params.push(next_steps);
        }
        if (detailed_notes !== undefined) {
            sets.push('detailed_notes = ?');
            params.push(detailed_notes);
        }
        if (next_visit_date !== undefined) {
            sets.push('next_visit_date = ?');
            params.push(next_visit_date || null);
        }
        if (needs_quote !== undefined) {
            sets.push('needs_quote = ?');
            params.push(Boolean(needs_quote));
        }
        if (needs_proposal !== undefined) {
            sets.push('needs_proposal = ?');
            params.push(Boolean(needs_proposal));
        }

        if (sets.length > 0) {
            params.push(id);
            await pool.query(
                `UPDATE followup_visits SET ${sets.join(', ')} WHERE id = ?`,
                params
            );
        }

        // Actualizar contactos si se proporcionaron
        if (Array.isArray(contact_ids)) {
            // Eliminar contactos existentes
            await pool.query('DELETE FROM visit_contacts WHERE visit_id = ?', [id]);

            // Insertar nuevos contactos
            if (contact_ids.length > 0) {
                const values = contact_ids.map((cid) => [id, Number(cid)]);
                await pool.query(
                    'INSERT INTO visit_contacts (visit_id, contact_id) VALUES ?',
                    [values]
                );
            }
        }

        // Si se completó la visita con éxito, crear tarea de seguimiento
        if (outcome === 'successful' && status === 'completed') {
            try {
                let dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + 3); // +3 días para seguimiento

                const [[org]] = await pool.query(
                    'SELECT name FROM organizations WHERE id = ?',
                    [visit.org_id]
                );
                const orgName = org?.name || 'cliente';

                await pool.query(
                    `INSERT INTO followup_tasks
           (user_id, org_id, title, priority, status, due_at)
           VALUES (?,?,?,?, 'pending', ?)`,
                    [
                        userId,
                        visit.org_id,
                        `Seguimiento post-visita - ${orgName}`,
                        'high',
                        toMySQLDateTime(dueDate),
                    ]
                );
            } catch (taskErr) {
                console.error(
                    '[visits] No se pudo crear tarea automática de seguimiento:',
                    taskErr?.message || taskErr
                );
            }
        }

        // Obtener la visita actualizada
        const [[updatedVisit]] = await pool.query(
            `
      SELECT v.*, o.name AS org_name
      FROM followup_visits v
      LEFT JOIN organizations o ON o.id = v.org_id
      WHERE v.id = ?
    `,
            [id]
        );

        // Obtener contactos
        const [contacts] = await pool.query(
            `
      SELECT c.id, c.name, c.email
      FROM visit_contacts vc
      JOIN contacts c ON c.id = vc.contact_id
      WHERE vc.visit_id = ?
    `,
            [id]
        );
        updatedVisit.contacts = contacts;

        res.json(updatedVisit);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'No se pudo actualizar la visita' });
    }
});

export default router;
