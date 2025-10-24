// server/src/routes/activities.js
import { Router } from 'express';
import { pool } from '../services/db.js';

const router = Router();

/** Utils pequeñas */
const toNullIfEmpty = (v) => (v === '' || typeof v === 'undefined' ? null : v);
const toIntOrNull   = (v) => (v === '' || v === null || typeof v === 'undefined' ? null : Number(v));
const toDoneFlag    = (v) => (v === 1 || v === '1' || v === true || v === 'true' ? 1 : 0);

function getUserId(req) {
  // Ajustá según tu middleware de auth si ya seteás req.user
  return req?.user?.id || req?.auth?.user?.id || req?.session?.user?.id || null;
}

/**
 * GET /api/activities
 * Filtros: org_id, person_id, deal_id, type, done, q
 * Orden/paginación: sort=created_at|due_date, order=asc|desc, limit, offset
 */
router.get('/', async (req, res) => {
  try {
    const {
      org_id, person_id, deal_id,
      type, done, q,
      sort = 'created_at', order = 'desc',
      limit = 200, offset = 0,
    } = req.query;

    const where = [];
    const params = [];

    if (org_id)    { where.push('a.org_id = ?');    params.push(org_id); }
    if (person_id) { where.push('a.person_id = ?'); params.push(person_id); }
    if (deal_id)   { where.push('a.deal_id = ?');   params.push(deal_id); }
    if (type)      { where.push('a.type = ?');      params.push(type); }
    if (typeof done !== 'undefined') {
      where.push('a.done = ?');
      params.push(toDoneFlag(done));
    }
    if (q) {
      where.push('(a.subject LIKE ? OR a.notes LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    const whereSql   = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const safeLimit  = Math.min(Number(limit) || 200, 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const sortCol    = ['created_at', 'due_date'].includes(String(sort)) ? sort : 'created_at';
    const sortDir    = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const [rows] = await pool.query(
      `SELECT
         a.id, a.type, a.subject, a.due_date, a.done,
         a.person_id, a.org_id, a.deal_id,
         a.notes, a.created_at, a.created_by,
         u.name  AS created_by_name,
         u.email AS created_by_email
       FROM activities a
       LEFT JOIN users u ON u.id = a.created_by
       ${whereSql}
       ORDER BY a.${sortCol} ${sortDir}
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, safeOffset]
    );

    res.json(rows);
  } catch (err) {
    console.error('GET /activities error', err);
    res.status(500).json({ error: 'Error al listar actividades' });
  }
});

/**
 * POST /api/activities
 * Campos: type, subject, due_date (YYYY-MM-DD), done (0/1),
 *         org_id, person_id, deal_id, notes, (opcional) created_at
 */
router.post('/', async (req, res) => {
  try {
    const ALLOWED_TYPES = new Set(['task', 'call', 'meeting', 'email', 'note']);
    const rawType = String(req.body.type || '').trim().toLowerCase();
    const type = ALLOWED_TYPES.has(rawType) ? rawType : 'task';

    const subject    = (req.body.subject ?? '').trim();
    const due_date   = toNullIfEmpty(req.body.due_date);
    const done       = toDoneFlag(req.body.done);
    const org_id     = toIntOrNull(req.body.org_id);
    const person_id  = toIntOrNull(req.body.person_id);
    const deal_id    = toIntOrNull(req.body.deal_id);
    const notes      = toNullIfEmpty(req.body.notes);
    const created_at = toNullIfEmpty(req.body.created_at); // opcional
    const created_by = getUserId(req); // puede venir null si no hay auth

    const cols = ['type','subject','due_date','done','org_id','person_id','deal_id','notes'];
    const vals = [ type,   subject,  due_date,  done,  org_id,  person_id,  deal_id,  notes ];

    if (created_at) { cols.push('created_at'); vals.push(created_at); }
    cols.push('created_by'); vals.push(created_by);

    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO activities (${cols.join(', ')}) VALUES (${placeholders})`;

    const [result] = await pool.query(sql, vals);
    return res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error('POST /activities error', err);
    return res.status(500).json({ error: 'Failed to create activity' });
  }
});

/**
 * PATCH /api/activities/:id
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['type','subject','due_date','done','org_id','person_id','deal_id','notes'];

    const body = { ...req.body };
    if ('done' in body)      body.done = toDoneFlag(body.done);
    if ('org_id' in body)    body.org_id = toIntOrNull(body.org_id);
    if ('person_id' in body) body.person_id = toIntOrNull(body.person_id);
    if ('deal_id' in body)   body.deal_id = toIntOrNull(body.deal_id);
    if ('notes' in body)     body.notes = toNullIfEmpty(body.notes);
    if ('due_date' in body)  body.due_date = toNullIfEmpty(body.due_date);

    const fields = [];
    const params = [];
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        fields.push(`${k} = ?`);
        params.push(body[k]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Nada para actualizar' });

    params.push(id);
    await pool.query(`UPDATE activities SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /activities/:id error', err);
    res.status(500).json({ error: 'Error al actualizar la actividad' });
  }
});

/**
 * DELETE /api/activities/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM activities WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /activities/:id error', err);
    res.status(500).json({ error: 'Error al borrar la actividad' });
  }
});

export default router;
