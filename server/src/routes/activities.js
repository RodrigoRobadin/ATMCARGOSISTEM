// server/src/routes/activities.js
import { Router } from 'express';
import { pool } from '../services/db.js';

const router = Router();

/** Utils pequeñas */
const toNullIfEmpty = (v) => (v === '' || typeof v === 'undefined' ? null : v);
const toIntOrNull   = (v) => (v === '' || v === null || typeof v === 'undefined' ? null : Number(v));
const toDoneFlag    = (v) => (v === 1 || v === '1' || v === true || v === 'true' ? 1 : 0);

/**
 * GET /api/activities
 * Filtros:
 *   org_id, person_id, deal_id, type, done, q
 * Orden/paginación:
 *   sort=created_at|due_date, order=asc|desc, limit, offset
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
         a.notes, a.created_at
       FROM activities a
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
 * Crea una actividad
 * Campos: type, subject, due_date (YYYY-MM-DD), done (0/1),
 *         org_id, person_id, deal_id, notes
 */
router.post('/', async (req, res) => {
  try {
    let {
      type = 'task',
      subject = '',
      due_date = null,
      done = 0,
      org_id = null,
      person_id = null,
      deal_id = null,
      notes = null,
    } = req.body;

    org_id    = toIntOrNull(org_id);
    person_id = toIntOrNull(person_id);
    deal_id   = toIntOrNull(deal_id);
    done      = toDoneFlag(done);
    subject   = subject || '';
    notes     = toNullIfEmpty(notes);
    type      = type || 'task';
    due_date  = toNullIfEmpty(due_date);

    if (!org_id && !person_id && !deal_id) {
      return res.status(400).json({ error: 'Debe vincularse a org_id o person_id o deal_id' });
    }

    const [ins] = await pool.query(
      `INSERT INTO activities(type, subject, due_date, done, org_id, person_id, deal_id, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [type, subject, due_date, done, org_id, person_id, deal_id, notes]
    );

    const [[row]] = await pool.query(
      `SELECT id, type, subject, due_date, done, org_id, person_id, deal_id, notes, created_at
       FROM activities WHERE id = ?`,
      [ins.insertId]
    );

    res.status(201).json(row);
  } catch (err) {
    console.error('POST /activities error', err);
    res.status(500).json({ error: 'Error al crear la actividad' });
  }
});

/**
 * PATCH /api/activities/:id
 * Actualiza campos permitidos
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['type','subject','due_date','done','org_id','person_id','deal_id','notes'];

    // normalizar
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
 * (Hard delete. Si querés soft delete, lo cambio a deleted_at = NOW())
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
