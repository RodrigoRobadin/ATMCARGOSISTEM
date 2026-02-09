// server/src/routes/salesGoals.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

const isAdmin = (req) =>
  String(req.user?.role || '').toLowerCase() === 'admin';

const toInt = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const clampMonth = (m) => {
  const mm = toInt(m, null);
  if (!mm || mm < 1 || mm > 12) return null;
  return mm;
};

const clampYear = (y) => {
  const yy = toInt(y, null);
  if (!yy || yy < 2000 || yy > 2100) return null;
  return yy;
};

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_goals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        year INT NOT NULL,
        month INT NOT NULL,
        target_prospects INT DEFAULT 0,
        target_contacts INT DEFAULT 0,
        target_pipeline_amount DECIMAL(18,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_sales_goal (user_id, year, month),
        INDEX (user_id),
        INDEX (year, month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[sales_goals] Tabla lista.');
  } catch (e) {
    console.error('[sales_goals] No se pudo crear la tabla:', e?.message || e);
  }
})();

// GET /api/sales-goals?year=YYYY&month=MM&user_id=#
router.get('/', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const year = clampYear(req.query.year) ?? now.getFullYear();
    const month = clampMonth(req.query.month) ?? now.getMonth() + 1;

    let userId = toInt(req.query.user_id, null);
    if (!isAdmin(req)) {
      userId = Number(req.user?.id || 0);
    }

    const params = [year, month];
    let where = 'g.year = ? AND g.month = ?';
    if (userId) {
      where += ' AND g.user_id = ?';
      params.push(userId);
    }

    const [rows] = await pool.query(
      `
      SELECT g.id, g.user_id, u.name AS user_name,
             g.year, g.month,
             g.target_prospects, g.target_contacts, g.target_pipeline_amount
      FROM sales_goals g
      LEFT JOIN users u ON u.id = g.user_id
      WHERE ${where}
      ORDER BY u.name ASC
      `,
      params
    );

    res.json(rows);
  } catch (e) {
    console.error('[sales_goals] list error:', e?.message || e);
    res.status(500).json({ error: 'No se pudo listar objetivos' });
  }
});

// POST /api/sales-goals (upsert)
router.post('/', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const year = clampYear(req.body?.year) ?? now.getFullYear();
    const month = clampMonth(req.body?.month) ?? now.getMonth() + 1;
    let userId = toInt(req.body?.user_id, null) ?? Number(req.user?.id || 0);

    if (!isAdmin(req) && userId !== Number(req.user?.id || 0)) {
      return res.status(403).json({ error: 'Permiso denegado' });
    }

    const target_prospects = toInt(req.body?.target_prospects, 0) || 0;
    const target_contacts = toInt(req.body?.target_contacts, 0) || 0;
    const target_pipeline_amount = Number(req.body?.target_pipeline_amount || 0) || 0;

    await pool.query(
      `
      INSERT INTO sales_goals
        (user_id, year, month, target_prospects, target_contacts, target_pipeline_amount)
      VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        target_prospects = VALUES(target_prospects),
        target_contacts = VALUES(target_contacts),
        target_pipeline_amount = VALUES(target_pipeline_amount)
      `,
      [
        userId,
        year,
        month,
        target_prospects,
        target_contacts,
        target_pipeline_amount,
      ]
    );

    const [[row]] = await pool.query(
      `
      SELECT g.id, g.user_id, u.name AS user_name,
             g.year, g.month,
             g.target_prospects, g.target_contacts, g.target_pipeline_amount
      FROM sales_goals g
      LEFT JOIN users u ON u.id = g.user_id
      WHERE g.user_id = ? AND g.year = ? AND g.month = ?
      LIMIT 1
      `,
      [userId, year, month]
    );

    res.json(row || null);
  } catch (e) {
    console.error('[sales_goals] upsert error:', e?.message || e);
    res.status(500).json({ error: 'No se pudo guardar objetivos' });
  }
});

export default router;
