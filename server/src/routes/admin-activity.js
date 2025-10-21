// server/src/routes/admin-activity.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

/**
 * GET /api/admin/activity
 * Filtros: user_id, action, entity, date_from, date_to, q (texto), limit, offset
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const {
    user_id, action, entity, date_from, date_to, q = '',
    limit = 50, offset = 0,
  } = req.query;

  const where = [];
  const params = [];

  if (user_id)   { where.push('ae.user_id = ?');  params.push(Number(user_id)); }
  if (action)    { where.push('ae.action = ?');   params.push(action); }
  if (entity)    { where.push('ae.entity = ?');   params.push(entity); }
  if (date_from) { where.push('ae.created_at >= ?'); params.push(new Date(date_from)); }
  if (date_to)   { where.push('ae.created_at <= ?'); params.push(new Date(date_to)); }
  if (q) {
    where.push('(ae.description LIKE ? OR ae.action LIKE ? OR ae.entity LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT
        ae.id,
        ae.user_id, COALESCE(u.name,'(sin nombre)') AS username,
        ae.action, ae.entity, ae.entity_id,
        ae.description AS message,
        ae.meta, ae.ip, ae.ua AS user_agent,
        ae.created_at
     FROM audit_events ae
     LEFT JOIN users u ON u.id = ae.user_id
     ${whereSQL}
     ORDER BY ae.created_at DESC, ae.id DESC
     LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );

  res.json({ items: rows, limit: lim, offset: off });
});

/**
 * GET /api/admin/activity/summary
 * Devuelve conteos por usuario/acción (últimos 30 días por default)
 */
router.get('/summary', requireAuth, requireRole('admin'), async (req, res) => {
  const { date_from, date_to } = req.query;
  const where = [];
  const params = [];

  if (date_from) { where.push('ae.created_at >= ?'); params.push(new Date(date_from)); }
  if (date_to)   { where.push('ae.created_at <= ?'); params.push(new Date(date_to)); }

  const whereSQL = where.length
    ? `WHERE ${where.join(' AND ')}`
    : `WHERE ae.created_at >= (NOW() - INTERVAL 30 DAY)`;

  const [rows] = await pool.query(
    `SELECT
        ae.user_id,
        COALESCE(u.name,'(sin nombre)') AS username,
        SUM(ae.action='create') AS creates,
        SUM(ae.action='update') AS updates,
        SUM(ae.action='delete') AS deletes,
        SUM(ae.action='login')  AS logins,
        COUNT(*) AS total
     FROM audit_events ae
     LEFT JOIN users u ON u.id = ae.user_id
     ${whereSQL}
     GROUP BY ae.user_id, username
     ORDER BY total DESC`
  );

  res.json({ items: rows });
});

/**
 * GET /api/admin/activity/overview
 * Resumen que puede usar el dashboard (total users + eventos + deals básicos)
 */
router.get('/overview', requireAuth, requireRole('admin'), async (req, res) => {
  const days = Math.max(1, Number(req.query.days || 30));
  const since = new Date(Date.now() - days * 86400000);

  const [[{ totalUsers }]] = await pool.query(`SELECT COUNT(*) AS totalUsers FROM users`);
  const [users] = await pool.query(`SELECT id, name, email, role FROM users ORDER BY name`);

  const [events] = await pool.query(
    `SELECT id, user_id, action, entity, entity_id, description, meta, created_at
       FROM audit_events
      WHERE created_at >= ?
      ORDER BY created_at DESC`,
    [since]
  );

  // Deals + nombres vinculados (org, asesor del deal, creador)
  const [deals] = await pool.query(
    `SELECT
        d.id,
        d.reference,
        d.org_id,
        o.name AS org_name,
        o.advisor_user_id AS org_advisor_user_id,
        d.advisor_user_id AS deal_advisor_user_id,
        ua.name AS deal_advisor_name,
        d.created_by_user_id,
        uc.name AS created_by_name,
        d.created_at
      FROM deals d
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN users ua ON ua.id = d.advisor_user_id
      LEFT JOIN users uc ON uc.id = d.created_by_user_id
      ORDER BY d.created_at DESC
      LIMIT 1000`
  );

  const activities = events.map(ev => ({
    id: ev.id,
    user_id: ev.user_id,
    deal_id: ev.entity === 'deal' ? ev.entity_id : null,
    date: ev.created_at,
    is_done: ev.action === 'update' || ev.action === 'create' ? 1 : 0,
    meta: ev.meta,
  }));

  res.json({ totalUsers, users, activities, deals });
});

export default router;
