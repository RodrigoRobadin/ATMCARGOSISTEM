// server/src/routes/followups.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

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

    // Vistas rápidas para joins (no es una VIEW, sólo índices ya creados)
    console.log('[followups] Tablas listas.');
  } catch (e) {
    console.error('[followups] No se pudieron crear tablas:', e?.message || e);
  }
})();

/* =================== helpers =================== */
function canAdmin(req) {
  return req.user && String(req.user.role || '').toLowerCase() === 'admin';
}
function pickUserFilter(req) {
  // admin puede pasar ?user_id=; usuario normal siempre a su propio id
  if (canAdmin(req) && req.query.user_id) return Number(req.query.user_id);
  return Number(req.user?.id);
}

/* =================== ENDPOINTS =================== */

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
             c.deal_id, c.subject, c.notes, c.happened_at, c.duration_min, c.created_at
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
    } = req.body || {};

    if (!happened_at) {
      return res.status(400).json({ error: 'happened_at es requerido' });
    }

    const [ins] = await pool.query(
      `INSERT INTO followup_calls
       (user_id, org_id, contact_id, deal_id, subject, notes, happened_at, duration_min)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        userId,
        org_id ? Number(org_id) : null,
        contact_id ? Number(contact_id) : null,
        deal_id ? Number(deal_id) : null,
        subject,
        notes,
        happened_at.length === 16 ? `${happened_at}:00` : happened_at,
        Number(duration_min) || 0,
      ]
    );

    const [[row]] = await pool.query(
      `SELECT c.id, c.user_id, c.org_id, o.name AS org_name,
              c.contact_id, ct.name AS contact_name,
              c.deal_id, c.subject, c.notes, c.happened_at, c.duration_min, c.created_at
       FROM followup_calls c
       LEFT JOIN organizations o ON o.id = c.org_id
       LEFT JOIN contacts ct     ON ct.id = c.contact_id
       WHERE c.id = ?`,
      [ins.insertId]
    );

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo registrar la llamada' });
  }
});

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

export default router;
