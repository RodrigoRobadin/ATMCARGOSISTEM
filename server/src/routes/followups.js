// server/src/routes/followups.js
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

const ALLOWED_OUTCOMES = [
  'no_contesta',
  'interesado',
  'no_interesado',
  'volver_a_llamar',
  'en_negociacion',
];

/* =================== bootstrap de tablas =================== */
(async () => {
  try {
    // Llamadas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followup_calls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        org_id INT NULL,
        contact_id INT NULL,
        deal_id INT NULL,
        subject VARCHAR(255),
        notes TEXT,
        happened_at DATETIME NOT NULL,
        duration_min INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), INDEX (org_id), INDEX (contact_id), INDEX (deal_id), INDEX (happened_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Aseguramos columna outcome (por si la tabla ya existía antes)
    try {
      await pool.query(`
        ALTER TABLE followup_calls
        ADD COLUMN outcome ENUM('no_contesta','interesado','no_interesado','volver_a_llamar','en_negociacion')
        NULL DEFAULT NULL AFTER duration_min;
      `);
      console.log('[followups] Columna outcome agregada a followup_calls.');
    } catch (e) {
      // Si ya existe la columna, ignoramos el error
      if (e && e.code !== 'ER_DUP_FIELDNAME') {
        console.error('[followups] Error al agregar outcome:', e.message || e);
      }
    }

    // Notas de seguimiento
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followup_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        org_id INT NULL,
        contact_id INT NULL,
        deal_id INT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), INDEX (org_id), INDEX (contact_id), INDEX (deal_id), INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Tareas de seguimiento (próximas acciones)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followup_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        org_id INT NULL,
        contact_id INT NULL,
        deal_id INT NULL,
        title VARCHAR(255) NOT NULL,
        priority ENUM('low','medium','high') DEFAULT 'medium',
        status ENUM('pending','done','canceled') DEFAULT 'pending',
        due_at DATETIME NOT NULL,
        completed_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (org_id),
        INDEX (contact_id),
        INDEX (deal_id),
        INDEX (status),
        INDEX (due_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[followups] Tablas listas.');
  } catch (e) {
    console.error('[followups] No se pudieron crear tablas:', e?.message || e);
  }
})();

/* =================== CALLS =================== */

// GET /api/followups/calls
router.get('/calls', requireAuth, async (req, res) => {
  try {
    const userId = pickUserFilter(req);
    const { limit = 500, offset = 0 } = req.query;
    const safeLimit = Math.min(Number(limit) || 500, 1000);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const [rows] = await pool.query(
      `
      SELECT c.id, c.user_id, c.org_id, o.name AS org_name,
             c.contact_id, ct.name AS contact_name,
             c.deal_id, c.subject, c.notes, c.happened_at,
             c.duration_min, c.outcome, c.created_at
      FROM followup_calls c
      LEFT JOIN organizations o ON o.id = c.org_id
      LEFT JOIN contacts ct     ON ct.id = c.contact_id
      WHERE c.user_id = ?
      ORDER BY c.happened_at DESC, c.id DESC
      LIMIT ? OFFSET ?
    `,
      [userId, safeLimit, safeOffset]
    );

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo listar llamadas' });
  }
});

// POST /api/followups/calls
router.post('/calls', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const {
      org_id = null,
      contact_id = null,
      deal_id = null,
      subject = 'Llamada',
      notes = '',
      happened_at, // 'YYYY-MM-DD HH:mm:ss' o 'YYYY-MM-DD HH:mm'
      duration_min = 0,
      outcome = null,
    } = req.body || {};

    if (!happened_at) {
      return res.status(400).json({ error: 'happened_at es requerido' });
    }

    const normalizedOutcome = ALLOWED_OUTCOMES.includes(outcome)
      ? outcome
      : null;

    const happenedSql =
      happened_at.length === 16 ? `${happened_at}:00` : happened_at;

    const [ins] = await pool.query(
      `INSERT INTO followup_calls
       (user_id, org_id, contact_id, deal_id, subject, notes, happened_at, duration_min, outcome)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        userId,
        org_id ? Number(org_id) : null,
        contact_id ? Number(contact_id) : null,
        deal_id ? Number(deal_id) : null,
        subject,
        notes,
        happenedSql,
        Number(duration_min) || 0,
        normalizedOutcome,
      ]
    );

    const [[row]] = await pool.query(
      `SELECT c.id, c.user_id, c.org_id, o.name AS org_name,
              c.contact_id, ct.name AS contact_name,
              c.deal_id, c.subject, c.notes, c.happened_at,
              c.duration_min, c.outcome, c.created_at
       FROM followup_calls c
       LEFT JOIN organizations o ON o.id = c.org_id
       LEFT JOIN contacts ct     ON ct.id = c.contact_id
       WHERE c.id = ?`,
      [ins.insertId]
    );

    // ==== Auto-tarea según resultado de la llamada ====
    // Si está interesado / volver a llamar / en negociación
    if (
      normalizedOutcome === 'interesado' ||
      normalizedOutcome === 'volver_a_llamar' ||
      normalizedOutcome === 'en_negociacion'
    ) {
      let dueDate = new Date();
      // si tenemos happened_at, usamos eso como base
      if (happenedSql) {
        // parseo simple, suficiente para este caso
        const iso = happenedSql.replace(' ', 'T');
        const d = new Date(iso);
        if (!isNaN(d.getTime())) {
          dueDate = d;
        }
      }

      // lógica simple de días:
      // - volver_a_llamar: +1 día
      // - interesado / en_negociacion: +2 días
      if (normalizedOutcome === 'volver_a_llamar') {
        dueDate.setDate(dueDate.getDate() + 1);
      } else {
        dueDate.setDate(dueDate.getDate() + 2);
      }

      const autoTitleBase =
        normalizedOutcome === 'volver_a_llamar'
          ? 'Volver a llamar'
          : normalizedOutcome === 'interesado'
            ? 'Dar seguimiento a interesado'
            : 'Seguir negociación';

      const orgName = row?.org_name || 'cliente';
      const autoTitle = `${autoTitleBase} - ${orgName}`;

      try {
        await pool.query(
          `INSERT INTO followup_tasks
           (user_id, org_id, contact_id, deal_id, title, priority, status, due_at)
           VALUES (?,?,?,?,?,?, 'pending', ?)`,
          [
            userId,
            org_id ? Number(org_id) : null,
            contact_id ? Number(contact_id) : null,
            deal_id ? Number(deal_id) : null,
            autoTitle,
            'medium',
            toMySQLDateTime(dueDate),
          ]
        );
      } catch (taskErr) {
        console.error(
          '[followups] No se pudo crear tarea automática de seguimiento:',
          taskErr?.message || taskErr
        );
      }
    }

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo registrar la llamada' });
  }
});

/* =================== NOTES =================== */

// GET /api/followups/notes
router.get('/notes', requireAuth, async (req, res) => {
  try {
    const userId = pickUserFilter(req);
    const { limit = 500, offset = 0 } = req.query;
    const safeLimit = Math.min(Number(limit) || 500, 1000);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const [rows] = await pool.query(
      `
      SELECT n.id, n.user_id, n.org_id, o.name AS org_name,
             n.contact_id, ct.name AS contact_name,
             n.deal_id, n.content, n.created_at
      FROM followup_notes n
      LEFT JOIN organizations o ON o.id = n.org_id
      LEFT JOIN contacts ct     ON ct.id = n.contact_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ? OFFSET ?
    `,
      [userId, safeLimit, safeOffset]
    );

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo listar notas' });
  }
});

// POST /api/followups/notes
router.post('/notes', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const {
      org_id = null,
      contact_id = null,
      deal_id = null,
      content = '',
    } = req.body || {};

    if (!content.trim()) {
      return res.status(400).json({ error: 'content es requerido' });
    }

    const [ins] = await pool.query(
      `INSERT INTO followup_notes
       (user_id, org_id, contact_id, deal_id, content)
       VALUES (?,?,?,?,?)`,
      [
        userId,
        org_id ? Number(org_id) : null,
        contact_id ? Number(contact_id) : null,
        deal_id ? Number(deal_id) : null,
        content,
      ]
    );

    const [[row]] = await pool.query(
      `SELECT n.id, n.user_id, n.org_id, o.name AS org_name,
              n.contact_id, ct.name AS contact_name,
              n.deal_id, n.content, n.created_at
       FROM followup_notes n
       LEFT JOIN organizations o ON o.id = n.org_id
       LEFT JOIN contacts ct     ON ct.id = n.contact_id
       WHERE n.id = ?`,
      [ins.insertId]
    );

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear la nota' });
  }
});

/* =================== TASKS (PRÓXIMAS ACCIONES) =================== */

// GET /api/followups/tasks
router.get('/tasks', requireAuth, async (req, res) => {
  try {
    const userId = pickUserFilter(req);
    const {
      status = 'pending',
      limit = 500,
      offset = 0,
      overdue = '0', // '1' = sólo atrasadas
    } = req.query;

    const safeLimit = Math.min(Number(limit) || 500, 1000);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const params = [userId];
    let where = 't.user_id = ?';

    if (status) {
      where += ' AND t.status = ?';
      params.push(String(status));
    }

    // tareas atrasadas: due_at < NOW() y status pending
    if (String(overdue) === '1') {
      where += ' AND t.due_at < NOW()';
    }

    params.push(safeLimit, safeOffset);

    const [rows] = await pool.query(
      `
      SELECT t.id, t.user_id, t.org_id, o.name AS org_name,
             t.contact_id, ct.name AS contact_name,
             t.deal_id, t.title, t.priority, t.status,
             t.due_at, t.completed_at, t.created_at
      FROM followup_tasks t
      LEFT JOIN organizations o ON o.id = t.org_id
      LEFT JOIN contacts ct     ON ct.id = t.contact_id
      WHERE ${where}
      ORDER BY t.due_at ASC, t.id ASC
      LIMIT ? OFFSET ?
    `,
      params
    );

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo listar tareas' });
  }
});

// POST /api/followups/tasks
router.post('/tasks', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const {
      org_id = null,
      contact_id = null,
      deal_id = null,
      title,
      priority = 'medium',
      due_at,
    } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title es requerido' });
    }
    if (!due_at) {
      return res.status(400).json({ error: 'due_at es requerido' });
    }

    const dueSql = due_at.length === 16 ? `${due_at}:00` : due_at;

    const [ins] = await pool.query(
      `INSERT INTO followup_tasks
       (user_id, org_id, contact_id, deal_id, title, priority, status, due_at)
       VALUES (?,?,?,?,?,?, 'pending', ?)`,
      [
        userId,
        org_id ? Number(org_id) : null,
        contact_id ? Number(contact_id) : null,
        deal_id ? Number(deal_id) : null,
        title.trim(),
        ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
        dueSql,
      ]
    );

    const [[row]] = await pool.query(
      `SELECT t.id, t.user_id, t.org_id, o.name AS org_name,
              t.contact_id, ct.name AS contact_name,
              t.deal_id, t.title, t.priority, t.status,
              t.due_at, t.completed_at, t.created_at
       FROM followup_tasks t
       LEFT JOIN organizations o ON o.id = t.org_id
       LEFT JOIN contacts ct     ON ct.id = t.contact_id
       WHERE t.id = ?`,
      [ins.insertId]
    );

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear la tarea' });
  }
});

// PATCH /api/followups/tasks/:id
router.patch('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = Number(req.user?.id);
    const isAdmin = canAdmin(req);

    const [[task]] = await pool.query(
      'SELECT * FROM followup_tasks WHERE id = ? LIMIT 1',
      [id]
    );
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    // seguridad básica: sólo dueño o admin
    if (!isAdmin && Number(task.user_id) !== userId) {
      return res.status(403).json({ error: 'Permiso denegado' });
    }

    const { title, priority, status, due_at } = req.body || {};
    const sets = [];
    const params = [];

    if (title !== undefined) {
      sets.push('title = ?');
      params.push(title.trim());
    }
    if (priority !== undefined) {
      sets.push('priority = ?');
      params.push(['low', 'medium', 'high'].includes(priority) ? priority : 'medium');
    }
    if (due_at !== undefined) {
      const dueSql = due_at.length === 16 ? `${due_at}:00` : due_at;
      sets.push('due_at = ?');
      params.push(dueSql);
    }
    if (status !== undefined) {
      const safeStatus = ['pending', 'done', 'canceled'].includes(status)
        ? status
        : 'pending';
      sets.push('status = ?');
      params.push(safeStatus);
      // si la pasamos a "done" y no tenía completed_at, lo marcamos ahora
      if (safeStatus === 'done') {
        sets.push('completed_at = NOW()');
      }
    }

    if (!sets.length) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    params.push(id);

    await pool.query(
      `UPDATE followup_tasks SET ${sets.join(', ')} WHERE id = ?`,
      params
    );

    const [[row]] = await pool.query(
      `SELECT t.id, t.user_id, t.org_id, o.name AS org_name,
              t.contact_id, ct.name AS contact_name,
              t.deal_id, t.title, t.priority, t.status,
              t.due_at, t.completed_at, t.created_at
       FROM followup_tasks t
       LEFT JOIN organizations o ON o.id = t.org_id
       LEFT JOIN contacts ct     ON ct.id = t.contact_id
       WHERE t.id = ?`,
      [id]
    );

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar la tarea' });
  }
});

export default router;