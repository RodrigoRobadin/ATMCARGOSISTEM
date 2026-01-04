// server/src/routes/contacts.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();

/** LISTAR */
router.get('/', async (req, res) => {
  const {
    q, org_id, label, owner_user_id, visibility,
    has_email, deleted, sort = 'created_at', order = 'desc',
    limit = 10000, offset = 0
  } = req.query;

  const where = [];
  const params = [];

  if (!deleted) where.push('c.deleted_at IS NULL');

  if (q) {
    where.push('(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR o.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (org_id)        { where.push('c.org_id = ?');        params.push(org_id); }
  if (label)         { where.push('c.label = ?');         params.push(label); }
  if (owner_user_id) { where.push('c.owner_user_id = ?'); params.push(owner_user_id); }
  if (visibility)    { where.push('c.visibility = ?');    params.push(visibility); }
  if (has_email === '1') where.push('c.email IS NOT NULL');

  const whereSql   = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol    = ['name','created_at'].includes(String(sort)) ? sort : 'created_at';
  const sortDir    = (order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const safeLimit  = Math.min(Number(limit) || 50, 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT 
       c.id, c.name, c.email, c.phone, c.title,
       c.org_id, o.name AS org_name,
       c.label, c.owner_user_id, c.visibility,
       c.notes, c.created_at, c.deleted_at
     FROM contacts c
     LEFT JOIN organizations o ON o.id = c.org_id
     ${whereSql}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset]
  );

  res.json(rows);
});

/* ====== CUSTOM FIELDS ====== */
router.get('/:id/custom-fields', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT id, person_id, \`key\`, \`label\`, \`type\`, \`value\`, created_at
       FROM person_custom_fields
       WHERE person_id = ?
       ORDER BY id ASC`,
      [id]
    );
    res.json(rows);
  } catch {
    res.status(404).json({ error: 'endpoint no disponible' });
  }
});

router.post('/:id/custom-fields', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { key, label, type = 'text', value = null } = req.body;
  if (!key || !label) return res.status(400).json({ error: 'key y label requeridos' });

  const [ins] = await pool.query(
    `INSERT INTO person_custom_fields(person_id,\`key\`,\`label\`,\`type\`,\`value\`)
     VALUES (?,?,?,?,?)`,
    [id, key, label, type, value]
  );

  await logAudit({
    req, action: 'create', entity: 'contact_cf', entityId: Number(id),
    description: `Creó CF ${key}`, meta: { key, value }
  });

  res.status(201).json({ id: ins.insertId });
});

router.put('/:id/custom-fields/:cfId', requireAuth, async (req, res) => {
  const { id, cfId } = req.params;
  const { value = null } = req.body;
  await pool.query(
    `UPDATE person_custom_fields SET \`value\` = ? WHERE id = ? AND person_id = ?`,
    [value, cfId, id]
  );

  await logAudit({
    req, action: 'update', entity: 'contact_cf', entityId: Number(id),
    description: `Actualizó CF ${cfId}`, meta: { value }
  });

  res.json({ ok: true });
});

/* ====== DETALLE ====== */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const [[contact]] = await pool.query(
    `SELECT 
       c.id, c.name, c.email, c.phone, c.title,
       c.org_id, o.name AS org_name,
       c.label, c.owner_user_id, c.visibility,
       c.notes, c.created_at, c.deleted_at
     FROM contacts c
     LEFT JOIN organizations o ON o.id = c.org_id
     WHERE c.id = ?`,
    [id]
  );

  if (!contact) return res.status(404).json({ error: 'No encontrado' });

  const [activities] = await pool.query(
    `SELECT id, type, subject, due_date, done, notes, created_at
     FROM activities
     WHERE person_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [id]
  );

  const [deals] = await pool.query(
    `SELECT 
       d.id, d.title, d.value, d.status, d.stage_id, d.pipeline_id, d.business_unit_id,
       d.org_id, o.name AS org_name, d.created_at
     FROM deals d
     LEFT JOIN organizations o ON o.id = d.org_id
     WHERE d.contact_id = ?
     ORDER BY d.created_at DESC
     LIMIT 200`,
    [id]
  );

  res.json({ ...contact, activities, deals });
});

/* ====== CREAR ====== */
router.post('/', requireAuth, async (req, res) => {
  const { name, email, phone, title, org_id, label, owner_user_id, visibility, notes } = req.body;

  if (!name && !email) {
    return res.status(400).json({ error: 'name o email requerido' });
  }

  if (email) {
    const [dupe] = await pool.query(
      'SELECT id FROM contacts WHERE email = ? AND deleted_at IS NULL LIMIT 1',
      [email]
    );
    if (dupe.length) {
      return res.status(200).json({ id: dupe[0].id, deduped: true });
    }
  }

  const [ins] = await pool.query(
    `INSERT INTO contacts(name, email, phone, title, org_id, label, owner_user_id, visibility, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name || null, email || null, phone || null, title || null,
      org_id || null, label || null, owner_user_id || null,
      visibility || 'company', notes || null
    ]
  );

  await logAudit({
    req, action: 'create', entity: 'contact', entityId: ins.insertId,
    description: `Creó contacto ${name || email || ins.insertId}`, meta: { payload: req.body }
  });

  res.status(201).json({ id: ins.insertId });
});

/* ====== ACTUALIZAR ====== */
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const allowed = ['name','email','phone','title','org_id','label','owner_user_id','visibility','notes'];

  const toDb = (v) => (v === '' ? null : v);

  const fields = [];
  const params = [];

  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      fields.push(`${k} = ?`);
      params.push(toDb(req.body[k]));
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'Nada para actualizar' });

  params.push(id);
  await pool.query(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`, params);

  await logAudit({
    req, action: 'update', entity: 'contact', entityId: Number(id),
    description: 'Actualizó contacto', meta: { patch: req.body }
  });

  res.json({ ok: true });
});

/* ====== BORRADO SUAVE ====== */
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query('UPDATE contacts SET deleted_at = NOW() WHERE id = ?', [id]);

  await logAudit({
    req, action: 'delete', entity: 'contact', entityId: Number(id),
    description: 'Borró contacto (soft)'
  });

  res.json({ ok: true });
});

/* ====== RESTAURAR ====== */
router.post('/restore/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query('UPDATE contacts SET deleted_at = NULL WHERE id = ?', [id]);

  await logAudit({
    req, action: 'update', entity: 'contact', entityId: Number(id),
    description: 'Restauró contacto'
  });

  res.json({ ok: true });
});

/* ====== MERGE ====== */
router.post('/merge', requireAuth, async (req, res) => {
  const { keep_id, merge_id } = req.body;
  if (!keep_id || !merge_id || Number(keep_id) === Number(merge_id)) {
    return res.status(400).json({ error: 'IDs inválidos' });
  }

  await pool.query('UPDATE activities SET person_id = ? WHERE person_id = ?', [keep_id, merge_id]);
  await pool.query('UPDATE deals SET contact_id = ? WHERE contact_id = ?', [keep_id, merge_id]);

  await pool.query(
    `UPDATE contacts w
     JOIN contacts l ON l.id = ?
     SET 
       w.email = COALESCE(w.email, l.email),
       w.phone = COALESCE(w.phone, l.phone),
       w.title = COALESCE(w.title, l.title),
       w.org_id = COALESCE(w.org_id, l.org_id),
       w.label = COALESCE(w.label, l.label),
       w.owner_user_id = COALESCE(w.owner_user_id, l.owner_user_id),
       w.visibility = COALESCE(w.visibility, l.visibility),
       w.notes = COALESCE(w.notes, l.notes)
     WHERE w.id = ?`,
    [merge_id, keep_id]
  );

  await pool.query('UPDATE contacts SET deleted_at = NOW() WHERE id = ?', [merge_id]);

  await logAudit({
    req, action: 'update', entity: 'contact', entityId: Number(keep_id),
    description: 'Fusionó contactos', meta: { keep_id, merge_id }
  });

  res.json({ ok: true });
});

export default router;
