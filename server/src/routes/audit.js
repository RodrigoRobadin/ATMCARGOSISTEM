// server/src/routes/audit.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

const ROOT_TABLES = { deal: 'deals', service_case: 'service_cases', organization: 'organizations', contact: 'contacts' };

function historySelect(whereSql) {
  return `
    SELECT ae.id, ae.created_at, ae.user_id,
           COALESCE(NULLIF(ae.actor_name, CONCAT('Usuario #', ae.user_id)), u.name, ae.actor_name, 'Sistema') AS actor_name,
           ae.action, ae.entity, ae.entity_id, ae.root_entity, ae.root_entity_id,
           ae.description, ae.meta,
           CASE COALESCE(ae.root_entity, ae.entity)
             WHEN 'deal' THEN COALESCE(d.reference, CONCAT('Operación #', COALESCE(ae.root_entity_id, ae.entity_id)))
             WHEN 'prospect' THEN COALESCE(d.reference, CONCAT('Prospecto #', COALESCE(ae.root_entity_id, ae.entity_id)))
             WHEN 'service_case' THEN COALESCE(sc.reference, CONCAT('Servicio #', COALESCE(ae.root_entity_id, ae.entity_id)))
             WHEN 'organization' THEN COALESCE(o.name, CONCAT('Organización #', COALESCE(ae.root_entity_id, ae.entity_id)))
             WHEN 'contact' THEN COALESCE(c.name, CONCAT('Contacto #', COALESCE(ae.root_entity_id, ae.entity_id)))
           END AS record_name
      FROM audit_events ae
      LEFT JOIN users u ON u.id = ae.user_id
      LEFT JOIN deals d ON COALESCE(ae.root_entity, ae.entity) IN ('deal', 'prospect')
                       AND d.id = COALESCE(ae.root_entity_id, ae.entity_id)
      LEFT JOIN service_cases sc ON COALESCE(ae.root_entity, ae.entity) = 'service_case'
                                AND sc.id = COALESCE(ae.root_entity_id, ae.entity_id)
      LEFT JOIN organizations o ON COALESCE(ae.root_entity, ae.entity) = 'organization'
                               AND o.id = COALESCE(ae.root_entity_id, ae.entity_id)
      LEFT JOIN contacts c ON COALESCE(ae.root_entity, ae.entity) = 'contact'
                          AND c.id = COALESCE(ae.root_entity_id, ae.entity_id)
      ${whereSql}
    ORDER BY ae.id DESC LIMIT ?`;
}

const USER_FIELDS = new Set([
  'assigned_to', 'lead_technician_id', 'technician_id',
  'created_by', 'updated_by', 'deleted_by', 'validated_by', 'reviewed_by', 'approved_by',
]);
const isUserField = (field) => field.endsWith('_user_id') || USER_FIELDS.has(field);

async function publicHistory(rows) {
  const normalized = rows.map((row) => {
    let meta = row.meta;
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch { meta = null; }
    }
    return { ...row, meta: meta?.changes ? { changes: meta.changes, details: meta.details || null } : null };
  });
  const ids = new Set();
  for (const row of normalized) {
    for (const [field, change] of Object.entries(row.meta?.changes || {})) {
      if (!isUserField(field)) continue;
      for (const value of [change?.before, change?.after]) {
        const id = Number(value);
        if (Number.isInteger(id) && id > 0) ids.add(id);
      }
    }
  }
  if (!ids.size) return normalized;
  const [users] = await pool.query(
    `SELECT id, name FROM users WHERE id IN (${[...ids].map(() => '?').join(',')})`,
    [...ids]
  );
  const userNames = Object.fromEntries(users.map((user) => [user.id, user.name]));
  return normalized.map((row) => ({ ...row, user_names: userNames }));
}

router.get('/history', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const where = ['1 = 1'];
    const params = [];
    const { entity, action, user_id: userId, from, to, q, before_id: beforeId } = req.query;
    if (entity && ROOT_TABLES[entity]) {
      if (entity === 'deal') where.push(`COALESCE(ae.root_entity, ae.entity) IN ('deal','prospect')`);
      else { where.push('COALESCE(ae.root_entity, ae.entity) = ?'); params.push(entity); }
    }
    if (action) { where.push('ae.action = ?'); params.push(String(action)); }
    if (userId) { where.push('ae.user_id = ?'); params.push(Number(userId)); }
    if (from) { where.push('ae.created_at >= ?'); params.push(String(from)); }
    if (to) { where.push('ae.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(String(to)); }
    if (beforeId) { where.push('ae.id < ?'); params.push(Number(beforeId)); }
    if (q?.trim()) {
      where.push(`(d.reference LIKE ? OR d.title LIKE ? OR sc.reference LIKE ? OR o.name LIKE ? OR c.name LIKE ?
        OR CAST(COALESCE(ae.root_entity_id, ae.entity_id) AS CHAR) = ?)`);
      const like = `%${q.trim()}%`;
      params.push(like, like, like, like, like, q.trim());
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const [rows] = await pool.query(historySelect(`WHERE ${where.join(' AND ')}`), [...params, limit + 1]);
    res.json({ rows: await publicHistory(rows.slice(0, limit)), nextCursor: rows.length > limit ? rows[limit - 1].id : null });
  } catch (error) {
    console.error('[audit:history]', error);
    res.status(500).json({ error: 'No se pudo cargar la auditoría.' });
  }
});

router.get('/record/:entity/:id', requireAuth, async (req, res) => {
  try {
    const table = ROOT_TABLES[req.params.entity];
    const id = Number(req.params.id);
    if (!table || !Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Registro inválido.' });
    const [[record]] = await pool.query(`SELECT id FROM \`${table}\` WHERE id = ? LIMIT 1`, [id]);
    if (!record && req.user?.role !== 'admin') return res.status(404).json({ error: 'Registro no encontrado.' });
    if (req.params.entity === 'service_case' && !['admin', 'service'].includes(String(req.user?.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'Permiso denegado.' });
    }
    const [rows] = await pool.query(
      historySelect(`WHERE (ae.root_entity = ? AND ae.root_entity_id = ?)
        OR (ae.root_entity IS NULL AND ae.entity IN (?, ?) AND ae.entity_id = ?)`),
      [req.params.entity, id, req.params.entity, req.params.entity === 'deal' ? 'prospect' : req.params.entity, id, 100]
    );
    res.json(await publicHistory(rows));
  } catch (error) {
    console.error('[audit:record]', error);
    res.status(500).json({ error: 'No se pudo cargar el historial.' });
  }
});

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
