// server/src/routes/deals.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';

/* ====== SOPORTE DE ARCHIVOS ====== */
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const router = Router();

/** Util: arma la referencia con un prefijo y un número */
function formatReference(n) {
  return `OP-${String(n).padStart(6, '0')}`;
}

/* ========= Asegurar columnas nuevas en deals ========= */
(async () => {
  try {
    const q = `
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'deals'
        AND COLUMN_NAME IN ('advisor_user_id','created_by_user_id')
    `;
    const [cols] = await pool.query(q);
    const names = new Set(cols.map(c => c.COLUMN_NAME));

    if (!names.has('advisor_user_id')) {
      await pool.query(`ALTER TABLE deals ADD COLUMN advisor_user_id BIGINT NULL AFTER org_id`);
    }
    if (!names.has('created_by_user_id')) {
      await pool.query(`ALTER TABLE deals ADD COLUMN created_by_user_id BIGINT NULL AFTER advisor_user_id`);
    }
  } catch (e) {
    console.error('No se pudieron asegurar columnas en deals:', e?.message || e);
  }
})();

/* ========= Storage de archivos (multer) ========= */
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dealId = String(req.params.id);
    const dir = path.resolve('uploads', 'deals', dealId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '');
    const base = path
      .basename(file.originalname || 'file', ext)
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${base}-${unique}${ext}`);
  }
});
const upload = multer({ storage });

/* ========= Asegurar tabla deal_files ========= */
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deal_files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deal_id INT NOT NULL,
        type VARCHAR(50) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX(deal_id),
        CONSTRAINT fk_deal_files_deal
          FOREIGN KEY (deal_id) REFERENCES deals(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error('No se pudo asegurar la tabla deal_files:', e);
  }
})();

/* ========= Asegurar tabla deal_custom_fields + columnas/índices ========= */
(async () => {
  try {
    // Crea tabla base si no existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deal_custom_fields (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deal_id INT NOT NULL,
        \`key\`   VARCHAR(100) NOT NULL,
        label    VARCHAR(255) NULL,
        \`type\`  VARCHAR(50)  NULL,
        \`value\` TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Leer columnas actuales
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deal_custom_fields'
    `);
    const cset = new Set(cols.map(c => c.COLUMN_NAME));

    // Agregar/asegurar updated_at con ON UPDATE
    if (!cset.has('updated_at')) {
      await pool.query(`
        ALTER TABLE deal_custom_fields
        ADD COLUMN updated_at TIMESTAMP NOT NULL
          DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP
        AFTER created_at
      `);
    } else {
      try {
        await pool.query(`
          ALTER TABLE deal_custom_fields
          MODIFY COLUMN updated_at TIMESTAMP NOT NULL
            DEFAULT CURRENT_TIMESTAMP
            ON UPDATE CURRENT_TIMESTAMP
        `);
      } catch (_) {}
    }

    // Índices y FK
    try { await pool.query(`ALTER TABLE deal_custom_fields ADD INDEX idx_dcf_deal (deal_id)`); } catch (_) {}
    try {
      await pool.query(`
        ALTER TABLE deal_custom_fields
        ADD CONSTRAINT fk_dcf_deal
          FOREIGN KEY (deal_id) REFERENCES deals(id)
          ON DELETE CASCADE
      `);
    } catch (_) {}

    // Único por (deal_id, key)
    const [idxs] = await pool.query(`
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'deal_custom_fields'
        AND NON_UNIQUE = 0
    `);
    const hasUqDealKey = idxs.some(i => i.INDEX_NAME === 'uq_deal_key');
    if (!hasUqDealKey) {
      try {
        await pool.query(`ALTER TABLE deal_custom_fields ADD UNIQUE KEY uq_deal_key (deal_id, \`key\`)`);
      } catch (_) {}
    }
  } catch (e) {
    console.error('[deals] No se pudo asegurar deal_custom_fields:', e?.message || e);
  }
})();

/** Preview no vinculante de referencia */
router.get('/next-reference', async (_req, res) => {
  const [rows] = await pool.query(`SHOW TABLE STATUS LIKE 'deals'`);
  const nextId = rows?.[0]?.Auto_increment || 1;
  res.json({ preview: formatReference(nextId) });
});

/**
 * GET /api/deals
 */
router.get('/', async (req, res) => {
  const {
    org_id,
    contact_id,
    pipeline_id,
    stage_id,
    business_unit_id,
    status,
    q,
    org_budget_status,
    advisor_user_id,
    deal_advisor_user_id,
    created_by_user_id,
    sort = 'created_at',
    order = 'desc',
    limit = 200,
    offset = 0,
  } = req.query;

  const where = [];
  const params = [];

  if (org_id)           { where.push('d.org_id = ?');              params.push(org_id); }
  if (contact_id)       { where.push('d.contact_id = ?');          params.push(contact_id); }
  if (pipeline_id)      { where.push('d.pipeline_id = ?');         params.push(pipeline_id); }
  if (stage_id)         { where.push('d.stage_id = ?');            params.push(stage_id); }
  if (business_unit_id) { where.push('d.business_unit_id = ?');    params.push(business_unit_id); }
  if (status)           { where.push('d.status = ?');              params.push(status); }
  if (q)                { where.push('d.title LIKE ?');            params.push(`%${q}%`); }

  if (org_budget_status) { where.push('o.budget_status = ?');      params.push(org_budget_status); }
  if (advisor_user_id)   { where.push('o.advisor_user_id = ?');    params.push(advisor_user_id); }

  if (deal_advisor_user_id) { where.push('d.advisor_user_id = ?');    params.push(deal_advisor_user_id); }
  if (created_by_user_id)   { where.push('d.created_by_user_id = ?'); params.push(created_by_user_id); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sortCol = ['created_at','value','title'].includes(String(sort)) ? sort : 'created_at';
  const sortDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const safeLimit  = Math.min(Number(limit)  || 200, 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT
       d.id, d.reference, d.title, d.value, d.status, d.stage_id, d.pipeline_id, d.business_unit_id,
       d.contact_id, d.org_id, d.created_at,
       d.advisor_user_id          AS deal_advisor_user_id,
       du.name                    AS deal_advisor_name,
       d.created_by_user_id,
       cu.name                    AS created_by_name,

       c.name  AS contact_name, c.email AS contact_email,
       o.name  AS org_name,

       bu.name AS business_unit_name, bu.key_slug AS business_unit_key,

       o.budget_status  AS org_budget_status,
       o.budget_profit  AS org_budget_profit_value,
       u.name           AS org_advisor_name

     FROM deals d
     LEFT JOIN contacts       c  ON c.id  = d.contact_id
     LEFT JOIN organizations  o  ON o.id  = d.org_id
     LEFT JOIN users          u  ON u.id  = o.advisor_user_id
     LEFT JOIN users          du ON du.id = d.advisor_user_id
     LEFT JOIN users          cu ON cu.id = d.created_by_user_id
     LEFT JOIN business_units bu ON bu.id = d.business_unit_id
     ${whereSql}
     ORDER BY d.${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset]
  );

  res.json(rows);
});

/** ========= DETALLE DE UN DEAL ========= */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const [[row]] = await pool.query(
    `SELECT 
       d.id, d.reference, d.title, d.value, d.status, d.stage_id, d.pipeline_id, d.business_unit_id,
       d.contact_id, d.org_id, d.created_at,
       d.advisor_user_id          AS deal_advisor_user_id,
       du.name                    AS deal_advisor_name,
       d.created_by_user_id,
       cu.name                    AS created_by_name,

       o.name  AS org_name,
       c.name  AS contact_name, c.email AS contact_email, c.phone AS contact_phone,
       bu.name AS business_unit_name, bu.key_slug AS business_unit_key
     FROM deals d
     LEFT JOIN organizations  o  ON o.id  = d.org_id
     LEFT JOIN contacts       c  ON c.id  = d.contact_id
     LEFT JOIN users          du ON du.id = d.advisor_user_id
     LEFT JOIN users          cu ON cu.id = d.created_by_user_id
     LEFT JOIN business_units bu ON bu.id = d.business_unit_id
     WHERE d.id = ?`,
    [id]
  );

  if (!row) return res.status(404).json({ error: 'No encontrado' });

  let activities = [];
  try {
    const [acts] = await pool.query(
      `SELECT id, type, subject, due_date, done, notes, created_at
       FROM activities
       WHERE deal_id = ?
       ORDER BY created_at DESC`,
      [id]
    );
    activities = acts;
  } catch { /* si no hay tabla, ignoramos */ }

  res.json({ deal: row, activities });
});

/* ========= CUSTOM FIELDS POR DEAL ========= */

// GET /api/deals/:id/custom-fields
router.get('/:id/custom-fields', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      'SELECT id, deal_id, `key`, label, `type`, `value`, created_at, updated_at FROM deal_custom_fields WHERE deal_id = ? ORDER BY `key` ASC',
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error('[custom-fields][GET]', e?.message || e);
    res.status(500).json({ error: 'No se pudieron obtener los custom fields' });
  }
});

// POST /api/deals/:id/custom-fields  (upsert por (deal_id, key))
router.post('/:id/custom-fields', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { key, label, type, value } = req.body;

  if (!key) return res.status(400).json({ error: 'key requerido' });

  try {
    const [exists] = await pool.query(
      'SELECT id FROM deal_custom_fields WHERE deal_id = ? AND `key` = ? LIMIT 1',
      [id, key]
    );

    if (exists.length) {
      await pool.query(
        'UPDATE deal_custom_fields SET label = COALESCE(?, label), `type` = COALESCE(?, `type`), `value` = ? WHERE id = ?',
        [label ?? null, type ?? null, value ?? null, exists[0].id]
      );
      const [row] = await pool.query('SELECT * FROM deal_custom_fields WHERE id = ?', [exists[0].id]);

      await logAudit({
        req, action: 'update', entity: 'deal_custom_field', entityId: exists[0].id,
        description: `Actualizó custom field (${key}) en OP ${id}`,
        meta: { deal_id: Number(id), key, value, label, type }
      });

      return res.status(200).json(row[0]);
    } else {
      const [ins] = await pool.query(
        'INSERT INTO deal_custom_fields (deal_id, `key`, label, `type`, `value`) VALUES (?,?,?,?,?)',
        [id, key, label ?? null, type ?? null, value ?? null]
      );
      const [row] = await pool.query('SELECT * FROM deal_custom_fields WHERE id = ?', [ins.insertId]);

      await logAudit({
        req, action: 'create', entity: 'deal_custom_field', entityId: ins.insertId,
        description: `Creó custom field (${key}) en OP ${id}`,
        meta: { deal_id: Number(id), key, value, label, type }
      });

      return res.status(201).json(row[0]);
    }
  } catch (e) {
    console.error('[custom-fields][POST]', e?.message || e);
    res.status(500).json({ error: 'No se pudo guardar el custom field' });
  }
});

// PUT /api/deals/:id/custom-fields/:cfId
router.put('/:id/custom-fields/:cfId', requireAuth, async (req, res) => {
  const { id, cfId } = req.params;
  const { label = undefined, type = undefined, value = undefined } = req.body;

  try {
    const [[exists]] = await pool.query(
      'SELECT id, `key` FROM deal_custom_fields WHERE id = ? AND deal_id = ? LIMIT 1',
      [cfId, id]
    );
    if (!exists) return res.status(404).json({ error: 'Custom field no encontrado' });

    const sets = [];
    const params = [];

    if (label !== undefined) { sets.push('label = ?'); params.push(label); }
    if (type  !== undefined) { sets.push('`type` = ?'); params.push(type); }
    if (value !== undefined) { sets.push('`value` = ?'); params.push(value); }

    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

    await pool.query(`UPDATE deal_custom_fields SET ${sets.join(', ')} WHERE id = ?`, [...params, cfId]);

    const [[row]] = await pool.query('SELECT * FROM deal_custom_fields WHERE id = ?', [cfId]);

    await logAudit({
      req, action: 'update', entity: 'deal_custom_field', entityId: Number(cfId),
      description: `Actualizó custom field (${exists.key}) en OP ${id}`,
      meta: { deal_id: Number(id), ...req.body }
    });

    res.json(row);
  } catch (e) {
    console.error('[custom-fields][PUT]', e?.message || e);
    res.status(500).json({ error: 'No se pudo actualizar el custom field' });
  }
});

/* ========= FILES POR DEAL ========= */

// POST /api/deals/:id/files (subir archivo)
router.post('/:id/files', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;
    if (!type) return res.status(400).json({ error: 'Falta type' });
    if (!req.file) return res.status(400).json({ error: 'Falta file' });

    const relUrl = `/uploads/deals/${id}/${req.file.filename}`;
    const [ins] = await pool.query(
      `INSERT INTO deal_files (deal_id, type, filename, url) VALUES (?,?,?,?)`,
      [id, type, req.file.filename, relUrl]
    );

    await logAudit({
      req, action: 'upload', entity: 'deal_file', entityId: ins.insertId,
      description: `Archivo subido a OP ${id}`, meta: { type, filename: req.file.filename }
    });

    res.json({
      ok: true,
      id: ins.insertId,
      type,
      url: relUrl,
      filename: req.file.filename,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo subir el archivo' });
  }
});

// GET /api/deals/:id/files (listar archivos)
router.get('/:id/files', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT id, type, filename, url, created_at FROM deal_files WHERE deal_id = ? ORDER BY created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo listar archivos' });
  }
});

// GET /api/deals/:id/files/:fileId/download
router.get('/:id/files/:fileId/download', async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const [[row]] = await pool.query(
      `SELECT filename, url FROM deal_files WHERE id = ? AND deal_id = ? LIMIT 1`,
      [fileId, id]
    );
    if (!row) return res.status(404).json({ error: 'Archivo no encontrado' });

    const absPath = path.resolve('.', row.url.replace(/^\//, ''));
    return res.download(absPath, row.filename);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo descargar el archivo' });
  }
});

// DELETE /api/deals/:id/files/:fileId
router.delete('/:id/files/:fileId', requireAuth, async (req, res) => {
  try {
    const { id, fileId } = req.params;

    const [rows] = await pool.query(
      'SELECT id, filename FROM deal_files WHERE id = ? AND deal_id = ? LIMIT 1',
      [fileId, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Archivo no encontrado' });

    const filename = rows[0].filename;

    const abs = path.resolve('uploads', 'deals', String(id), filename);
    try { fs.unlinkSync(abs); } catch (_) { /* ignorar si no existe */ }

    await pool.query('DELETE FROM deal_files WHERE id = ?', [fileId]);

    await logAudit({
      req, action: 'delete', entity: 'deal_file', entityId: fileId,
      description: `Archivo eliminado de OP ${id}`, meta: { filename }
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar el archivo' });
  }
});

/**
 * POST /api/deals
 * Acepta dos shapes:
 *  - Legacy: { description, value, pipeline_id, stage_id, business_unit_id, contact, organization }
 *  - Plano:  { title, value, pipeline_id, stage_id, business_unit_id, org_name, contact_name, contact_email, contact_phone, ...hints }
 */
router.post('/', requireAuth, async (req, res) => {
  const body = req.body || {};

  // Campos core
  const pipeline_id      = body.pipeline_id;
  const stage_id         = body.stage_id;
  const business_unit_id = body.business_unit_id || null;
  const value            = Number(body.value || 0) || 0;

  if (!pipeline_id || !stage_id) {
    return res.status(400).json({ error: 'pipeline_id y stage_id son requeridos' });
  }

  // Organización / contacto: soportar ambos formatos
  const organization = body.organization || null;
  const contact      = body.contact || null;

  const org_name     = body.org_name || organization?.name || null;
  const org_id_body  = organization?.id || null;

  const contact_name  = body.contact_name  || contact?.name  || null;
  const contact_email = body.contact_email || contact?.email || null;
  const contact_phone = body.contact_phone || contact?.phone || null;
  const contact_id_body = contact?.id || null;

  // Hints -> CF
  const hints = {
    modalidad_carga : body.transport_type_hint || "",   // select
    tipo_carga      : body.cargo_class_hint    || "",   // select
    origen_pto      : body.origin_hint         || "",   // text
    destino_pto     : body.destination_hint    || "",   // text
    mercaderia      : body.commodity_hint      || "",   // text
    cant_bultos     : body.quantity_hint       || "",   // number/text
    unidad_bultos   : body.unit_hint           || "",   // text
    peso_bruto      : body.weight_hint         || "",   // text
    vol_m3          : body.volume_hint         || "",   // text
    tipo_operacion  : body.operation_type_hint || "",   // select (IMPORT/EXPORT)
  };

  // title seguro
  const trim = (s) => (typeof s === 'string' ? s.trim() : '');
  const title =
    trim(body.title) ||
    [trim(hints.modalidad_carga), trim(hints.tipo_carga), trim(hints.mercaderia)].filter(Boolean).join(' • ') ||
    'Operación';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Organización
    let orgId = null;
    if (org_id_body) {
      orgId = org_id_body;
    } else if (org_name) {
      const [orgRows] = await conn.query('SELECT id FROM organizations WHERE name = ? LIMIT 1', [org_name]);
      if (orgRows.length) orgId = orgRows[0].id;
      else {
        const [ins] = await conn.query('INSERT INTO organizations(name) VALUES(?)', [org_name]);
        orgId = ins.insertId;
      }
    }

    // Contacto
    let contactId = null;
    if (contact_id_body) {
      contactId = contact_id_body;
    } else if (contact_name) {
      const [cRows] = await conn.query('SELECT id FROM contacts WHERE name = ? LIMIT 1', [contact_name]);
      if (cRows.length) {
        contactId = cRows[0].id;
      } else {
        const [ins] = await conn.query(
          'INSERT INTO contacts(name, email, phone, org_id) VALUES(?,?,?,?)',
          [contact_name, contact_email || null, contact_phone || null, orgId]
        );
        contactId = ins.insertId;
      }
    }

    // Asesores (operación y creador)
    const createdById = req.user?.id || null;
    let dealAdvisorId = createdById;
    if (orgId) {
      const [[oAdv]] = await conn.query('SELECT advisor_user_id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
      if (oAdv?.advisor_user_id) dealAdvisorId = oAdv.advisor_user_id;
    }

    // Placeholder temporal para reference
    const tmpRef = `TMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`.slice(0, 32);

    // Insert principal (title blindeado)
    const [dealIns] = await conn.query(
      `INSERT INTO deals(reference, title, value, status, pipeline_id, business_unit_id, stage_id, contact_id, org_id, advisor_user_id, created_by_user_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        tmpRef,
        title,
        value,
        'open',
        pipeline_id,
        business_unit_id || null,
        stage_id,
        contactId,
        orgId,
        dealAdvisorId,
        createdById
      ]
    );

    const newId = dealIns.insertId;
    const reference = formatReference(newId);

    // Referencia definitiva
    await conn.query(`UPDATE deals SET reference = ? WHERE id = ?`, [reference, newId]);

    // Siembra de custom fields a partir de hints
    const upsertCF = async (key, label, type, val) => {
      const v = val != null ? String(val).trim() : '';
      if (!v) return;
      await conn.query(
        `INSERT INTO deal_custom_fields (deal_id, \`key\`, label, \`type\`, \`value\`)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), label = VALUES(label), \`type\` = VALUES(\`type\`)`,
        [newId, key, label, type, v]
      );
    };

    await upsertCF('modalidad_carga', 'Tipo de embarque', 'select', hints.modalidad_carga);
    await upsertCF('tipo_carga',      'Tipo de carga',    'select', hints.tipo_carga);
    await upsertCF('origen_pto',      'Origen',           'text',   hints.origen_pto);
    await upsertCF('destino_pto',     'Destino',          'text',   hints.destino_pto);
    await upsertCF('mercaderia',      'Mercadería',       'text',   hints.mercaderia);
    await upsertCF('cant_bultos',     'Cant bultos',      'number', hints.cant_bultos);
    await upsertCF('unidad_bultos',   'Unidad bultos',    'text',   hints.unidad_bultos);
    await upsertCF('peso_bruto',      'Peso',             'text',   hints.peso_bruto);
    await upsertCF('vol_m3',          'Vol m³',           'text',   hints.vol_m3);
    await upsertCF('tipo_operacion',  'Tipo de operación','select', hints.tipo_operacion);

    await conn.commit();

    // Auditoría
    await logAudit({
      req, action: 'create', entity: 'deal', entityId: newId,
      description: `Creó la operación ${reference}`,
      meta: {
        pipeline_id, stage_id,
        business_unit_id,
        org_id: orgId, contact_id: contactId,
        seeded_cf: Object.keys(hints).filter(k => (hints[k] ?? '').toString().trim() !== '')
      }
    });

    res.status(201).json({
      id: newId,
      reference,
      title,
      advisor_user_id: dealAdvisorId,
      created_by_user_id: createdById
    });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear el deal' });
  } finally {
    conn.release();
  }
});

/** PATCH /api/deals/:id */
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const {
    description,
    title,
    value, status, stage_id, contact_id, org_id, business_unit_id,
    advisor_user_id,
  } = req.body;

  const fields = [];
  const params = [];

  // Compat: si viene description usarlo para title; si viene title, respetar
  const nextTitle = (title !== undefined ? title : description);

  if (nextTitle !== undefined)       { fields.push('title = ?');            params.push(nextTitle); }
  if (value !== undefined)           { fields.push('value = ?');            params.push(value); }
  if (status !== undefined)          { fields.push('status = ?');           params.push(status); }
  if (stage_id !== undefined)        { fields.push('stage_id = ?');         params.push(stage_id); }
  if (contact_id !== undefined)      { fields.push('contact_id = ?');       params.push(contact_id); }
  if (org_id !== undefined)          { fields.push('org_id = ?');           params.push(org_id); }
  if (business_unit_id !== undefined){ fields.push('business_unit_id = ?'); params.push(business_unit_id); }
  if (advisor_user_id !== undefined) { fields.push('advisor_user_id = ?');  params.push(advisor_user_id || null); }

  if (!fields.length) return res.status(400).json({ error: 'Sin cambios' });

  params.push(id);
  await pool.query(`UPDATE deals SET ${fields.join(', ')} WHERE id = ?`, params);

  await logAudit({
    req, action: 'update', entity: 'deal', entityId: Number(id),
    description: `Actualizó operación ${id}`,
    meta: req.body
  });

  res.json({ ok: true });
});

export default router;
