// server/src/routes/audit.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../../../client/src/middlewares/auth.js';

const router = Router();

/**
 * GET /api/audit
 * Query:
 *  - limit?: number = 50
 *  - user_id?: number
 *  - action?: string
 *  - entity?: string
 *  - since?: ISO date (YYYY-MM-DD)  -> filtra por fecha
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
  const { user_id, action, entity, since } = req.query || {};

  const where = [];
  const params = [];

  if (user_id) { where.push('a.user_id = ?'); params.push(Number(user_id)); }
  if (action)  { where.push('a.action = ?');  params.push(String(action)); }
  if (entity)  { where.push('a.entity = ?');  params.push(String(entity)); }
  if (since)   { where.push('a.created_at >= ?'); params.push(new Date(since)); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `
    SELECT
      a.id, a.user_id, u.name AS user_name,
      a.action, a.entity, a.entity_id,
      a.message, a.payload, a.ip, a.ua,
      a.created_at
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    ${whereSql}
    ORDER BY a.id DESC
    LIMIT ?
    `,
    [...params, limit]
  );

  res.json(rows);
});

/**
 * (Opcional) estadísticas rápidas
 * GET /api/audit/stats
 */
router.get('/stats', requireAuth, requireRole('admin'), async (req, res) => {
  const [byUser] = await pool.query(`
    SELECT a.user_id, COALESCE(u.name,'(sin usuario)') as user_name, COUNT(*) as cnt
    FROM audit_log a
    LEFT JOIN users u ON u.id=a.user_id
    GROUP BY a.user_id, u.name
    ORDER BY cnt DESC
    LIMIT 20
  `);
  const [byAction] = await pool.query(`
    SELECT action, COUNT(*) as cnt
    FROM audit_log
    GROUP BY action
    ORDER BY cnt DESC;
  `);
  const [byEntity] = await pool.query(`
    SELECT entity, COUNT(*) as cnt
    FROM audit_log
    GROUP BY entity
    ORDER BY cnt DESC;
  `);

  res.json({ byUser, byAction, byEntity });
});

export default router;
