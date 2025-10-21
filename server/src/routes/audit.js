// server/src/routes/audit.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

/**
 * GET /api/audit
 * Query:
 *  - user_id? number
 *  - action?  string
 *  - entity?  string
 *  - entity_id? number
 *  - from? ISO date
 *  - to?   ISO date
 *  - limit? 1..1000 (default 200)
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { user_id, action, entity, entity_id, from, to } = req.query;
  let { limit } = req.query;

  const where = [];
  const params = [];

  if (user_id)   { where.push('ae.user_id = ?');  params.push(Number(user_id)); }
  if (action)    { where.push('ae.action = ?');   params.push(String(action)); }
  if (entity)    { where.push('ae.entity = ?');   params.push(String(entity)); }
  if (entity_id) { where.push('ae.entity_id = ?');params.push(Number(entity_id)); }
  if (from)      { where.push('ae.created_at >= ?'); params.push(new Date(from)); }
  if (to)        { where.push('ae.created_at <= ?'); params.push(new Date(to)); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Math.max(parseInt(limit || '200', 10), 1), 1000);

  const [rows] = await pool.query(
    `
    SELECT
      ae.id, ae.created_at,
      ae.user_id, u.name AS user_name,
      ae.action, ae.entity, ae.entity_id,
      ae.description,
      ae.meta,
      ae.ip, ae.ua AS user_agent
    FROM audit_events ae
    LEFT JOIN users u ON u.id = ae.user_id
    ${whereSql}
    ORDER BY ae.id DESC
    LIMIT ?
    `,
    [...params, lim]
  );

  res.json(rows);
});

/** Resumen simple por acción */
router.get('/stats', requireAuth, requireRole('admin'), async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT action,
           COUNT(*) AS cnt,
           MIN(created_at) AS first_at,
           MAX(created_at) AS last_at
    FROM audit_events
    GROUP BY action
    ORDER BY cnt DESC
  `);
  res.json(rows);
});

export default router;
