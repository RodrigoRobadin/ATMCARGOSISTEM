import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import db from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();

const allowedAttachmentTargets = new Set(['contact', 'organization', 'deal', 'quote', 'quick_quote']);
const quickQuoteModalities = new Set(['aereo', 'maritimo', 'terrestre', 'multimodal', 'industrial', 'service']);

function cleanText(value, max = 255) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function safeJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function ensureMobileTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mobile_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      entity_type VARCHAR(40) NOT NULL,
      entity_id INT NOT NULL,
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NULL,
      mime_type VARCHAR(120) NULL,
      size_bytes BIGINT NULL,
      url VARCHAR(255) NOT NULL,
      uploaded_by_user_id BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_mobile_attachments_entity (entity_type, entity_id),
      INDEX idx_mobile_attachments_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quotes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_id INT NULL,
      ref_code VARCHAR(100),
      revision VARCHAR(50),
      client_name VARCHAR(255),
      status VARCHAR(50) DEFAULT 'draft',
      inputs_json JSON,
      document_snapshot_json JSON,
      computed_json JSON,
      created_by VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_quotes_deal (deal_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  try {
    await db.query('ALTER TABLE quotes ADD COLUMN document_snapshot_json JSON NULL AFTER inputs_json');
  } catch (_) {}
}

ensureMobileTables().catch((e) => {
  console.error('[mobile] No se pudieron asegurar tablas:', e?.message || e);
});

async function getParamValue(key) {
  try {
    const [[row]] = await db.query(
      'SELECT value FROM param_values WHERE `key` = ? AND COALESCE(active, 1) = 1 ORDER BY ord, id DESC LIMIT 1',
      [key]
    );
    return row?.value || null;
  } catch (_) {
    return null;
  }
}

async function resolveOperationDefaults(businessUnitKey) {
  const key = String(businessUnitKey || 'atm-cargo').toLowerCase();
  const [[bu]] = await db.query(
    'SELECT id, key_slug, name FROM business_units WHERE key_slug = ? LIMIT 1',
    [key]
  );
  if (!bu) return null;

  const configuredPipeline =
    (await getParamValue(`kanban_pipeline_id__${key}`)) ||
    (await getParamValue('kanban_pipeline_id'));

  let pipelineId = Number(configuredPipeline || 0) || null;
  if (!pipelineId && key === 'atm-industrial') pipelineId = 1;
  if (!pipelineId) {
    const [[firstPipeline]] = await db.query('SELECT id FROM pipelines ORDER BY id ASC LIMIT 1');
    pipelineId = Number(firstPipeline?.id || 0) || null;
  }
  if (!pipelineId) return null;

  const [[stage]] = await db.query(
    'SELECT id, name FROM stages WHERE pipeline_id = ? ORDER BY order_index ASC, id ASC LIMIT 1',
    [pipelineId]
  );
  if (!stage?.id) return null;

  return {
    business_unit: bu,
    pipeline_id: pipelineId,
    stage_id: stage.id,
    stage_name: stage.name,
  };
}

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const entityType = String(req.body?.entity_type || req.params?.entityType || 'general')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    const entityId = String(req.body?.entity_id || req.params?.entityId || 'pending')
      .replace(/[^0-9a-zA-Z_-]/g, '');
    const dir = path.resolve('uploads', 'mobile', entityType || 'general', entityId || 'pending');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '');
    const base = path
      .basename(file.originalname || 'archivo', ext)
      .replace(/\s+/g, '_')
      .replace(/[^\w.-]/g, '')
      .slice(0, 80) || 'archivo';
    cb(null, `${base}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get('/', requireAuth, (_req, res) => {
  res.json({ ok: true, module: 'mobile' });
});

router.get('/bootstrap', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0) || null;
    const [contacts] = await db.query(
      `SELECT c.id, c.name, c.email, c.phone, c.org_id, o.name AS org_name, c.created_at
         FROM contacts c
         LEFT JOIN organizations o ON o.id = c.org_id
        WHERE c.deleted_at IS NULL
        ORDER BY c.created_at DESC
        LIMIT 8`
    );
    const [organizations] = await db.query(
      `SELECT id, name, razon_social, phone, email, ruc, created_at
         FROM organizations
        ORDER BY created_at DESC
        LIMIT 8`
    );
    const [quotes] = await db.query(
      `SELECT id, deal_id, ref_code, client_name, status, inputs_json, computed_json, updated_at
         FROM quotes
        ORDER BY updated_at DESC
        LIMIT 8`
    ).catch(() => [[]]);

    res.json({
      user: req.user,
      permissions: {
        can_create_contacts: true,
        can_create_organizations: true,
        can_create_quick_quotes: true,
        can_upload_attachments: true,
      },
      defaults: {
        currency: 'USD',
        modalities: Array.from(quickQuoteModalities),
        business_units: [
          { key: 'atm-cargo', label: 'ATM CARGO' },
          { key: 'atm-industrial', label: 'ATM INDUSTRIAL' },
        ],
      },
      recent: {
        contacts,
        organizations,
        quotes: (quotes || []).map((row) => ({
          ...row,
          inputs: safeJson(row.inputs_json, {}),
          computed: safeJson(row.computed_json, null),
          inputs_json: undefined,
          computed_json: undefined,
        })),
      },
      session: { user_id: userId },
    });
  } catch (e) {
    console.error('[mobile/bootstrap]', e);
    res.status(500).json({ error: 'No se pudo cargar la app movil' });
  }
});

router.get('/operation-defaults', requireAuth, async (req, res) => {
  try {
    const key = cleanText(req.query.business_unit_key || 'atm-cargo', 80) || 'atm-cargo';
    const defaults = await resolveOperationDefaults(key);
    if (!defaults) {
      return res.status(404).json({ error: 'No se encontro configuracion para crear operaciones' });
    }
    res.json(defaults);
  } catch (e) {
    console.error('[mobile/operation-defaults]', e);
    res.status(500).json({ error: 'No se pudo resolver la configuracion de operacion' });
  }
});

router.get('/quick-quotes', requireAuth, async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, deal_id, ref_code, client_name, status, inputs_json, computed_json, created_at, updated_at
         FROM quotes
        ORDER BY updated_at DESC
        LIMIT 50`
    );
    res.json(
      rows.map((row) => ({
        ...row,
        inputs: safeJson(row.inputs_json, {}),
        computed: safeJson(row.computed_json, null),
        inputs_json: undefined,
        computed_json: undefined,
      }))
    );
  } catch (e) {
    console.error('[mobile/quick-quotes:list]', e);
    res.status(500).json({ error: 'No se pudieron listar cotizaciones rapidas' });
  }
});

router.post('/quick-quotes', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const clientName = cleanText(body.client_name || body.clientName || body.customer_name);
    const orgId = toNumberOrNull(body.org_id);
    const contactId = toNumberOrNull(body.contact_id);
    const dealId = toNumberOrNull(body.deal_id);
    const modality = cleanText(body.modality || body.modalidad, 40);
    const origin = cleanText(body.origin || body.origen, 180);
    const destination = cleanText(body.destination || body.destino, 180);
    const currency = cleanText(body.currency || body.moneda || 'USD', 8)?.toUpperCase() || 'USD';
    const costAmount = toNumberOrNull(body.cost_amount || body.costo);
    const saleAmount = toNumberOrNull(body.sale_amount || body.precio || body.value);
    const notes = cleanText(body.notes || body.notas, 2000);

    if (!clientName && !orgId && !contactId) {
      return res.status(400).json({ error: 'Cliente, organizacion o contacto requerido' });
    }
    if (!modality || !quickQuoteModalities.has(modality.toLowerCase())) {
      return res.status(400).json({ error: 'Modalidad invalida' });
    }

    let resolvedClientName = clientName;
    if (!resolvedClientName && orgId) {
      const [[org]] = await db.query('SELECT name, razon_social FROM organizations WHERE id = ? LIMIT 1', [orgId]);
      resolvedClientName = cleanText(org?.name || org?.razon_social);
    }
    if (!resolvedClientName && contactId) {
      const [[contact]] = await db.query('SELECT name FROM contacts WHERE id = ? LIMIT 1', [contactId]);
      resolvedClientName = cleanText(contact?.name);
    }

    const profitAmount =
      saleAmount != null && costAmount != null ? Number((saleAmount - costAmount).toFixed(2)) : null;
    let quoteDealId = dealId;
    if (dealId) {
      const [[existingQuote]] = await db.query(
        'SELECT id FROM quotes WHERE deal_id = ? LIMIT 1',
        [dealId]
      ).catch(() => [[null]]);
      if (existingQuote?.id) quoteDealId = null;
    }

    const inputs = {
      source: 'mobile_quick_quote',
      deal_id: quoteDealId,
      linked_deal_id: dealId,
      org_id: orgId,
      contact_id: contactId,
      client_name: resolvedClientName,
      modality: modality.toLowerCase(),
      origin,
      destination,
      currency,
      cost_amount: costAmount,
      sale_amount: saleAmount,
      notes,
      status: 'draft',
      created_by_user_id: req.user?.id || null,
    };
    const computed = {
      mobile_summary: {
        currency,
        cost_amount: costAmount,
        sale_amount: saleAmount,
        profit_amount: profitAmount,
      },
    };

    const refCode = `MOB-${Date.now().toString(36).toUpperCase()}`;
    const [result] = await db.query(
      `INSERT INTO quotes
        (deal_id, ref_code, revision, client_name, status, created_by, inputs_json, document_snapshot_json, computed_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quoteDealId,
        refCode,
        'MOBILE',
        resolvedClientName,
        'draft',
        req.user?.email || req.user?.name || null,
        JSON.stringify(inputs),
        null,
        JSON.stringify(computed),
      ]
    );

    await logAudit({
      req,
      action: 'create',
      entity: 'mobile_quick_quote',
      entityId: result.insertId,
      description: `Creo cotizacion rapida movil ${refCode}`,
      meta: { inputs },
    });

    res.status(201).json({
      id: result.insertId,
      ref_code: refCode,
      client_name: resolvedClientName,
      status: 'draft',
      inputs,
      computed,
    });
  } catch (e) {
    console.error('[mobile/quick-quotes:create]', e);
    res.status(500).json({ error: e?.message || 'No se pudo crear la cotizacion rapida' });
  }
});

router.get('/attachments', requireAuth, async (req, res) => {
  try {
    const entityType = cleanText(req.query.entity_type, 40);
    const entityId = toNumberOrNull(req.query.entity_id);
    if (!entityType || !entityId || !allowedAttachmentTargets.has(entityType)) {
      return res.status(400).json({ error: 'entity_type y entity_id validos son requeridos' });
    }

    if (entityType === 'deal') {
      const [rows] = await db.query(
        'SELECT id, type AS entity_type, filename, url, created_at FROM deal_files WHERE deal_id = ? ORDER BY created_at DESC',
        [entityId]
      );
      return res.json(rows);
    }

    const normalizedType = entityType === 'quick_quote' ? 'quote' : entityType;
    const [rows] = await db.query(
      `SELECT id, entity_type, entity_id, filename, original_name, mime_type, size_bytes, url, created_at
         FROM mobile_attachments
        WHERE entity_type = ? AND entity_id = ?
        ORDER BY created_at DESC`,
      [normalizedType, entityId]
    );
    res.json(rows);
  } catch (e) {
    console.error('[mobile/attachments:list]', e);
    res.status(500).json({ error: 'No se pudieron listar adjuntos' });
  }
});

router.post('/attachments', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const rawEntityType = cleanText(req.body?.entity_type, 40);
    const entityType = rawEntityType === 'quick_quote' ? 'quote' : rawEntityType;
    const entityId = toNumberOrNull(req.body?.entity_id);
    const fileType = cleanText(req.body?.type || 'mobile', 50) || 'mobile';

    if (!rawEntityType || !allowedAttachmentTargets.has(rawEntityType)) {
      return res.status(400).json({ error: 'entity_type invalido' });
    }
    if (!entityId) return res.status(400).json({ error: 'entity_id requerido' });
    if (!req.file) return res.status(400).json({ error: 'file requerido' });

    const relUrl = `/uploads/mobile/${rawEntityType}/${entityId}/${req.file.filename}`;

    if (rawEntityType === 'deal') {
      const [ins] = await db.query(
        `INSERT INTO deal_files (deal_id, type, filename, url) VALUES (?, ?, ?, ?)`,
        [entityId, fileType, req.file.filename, relUrl]
      );
      await logAudit({
        req,
        action: 'upload',
        entity: 'deal_file',
        entityId: ins.insertId,
        description: `Archivo movil subido a OP ${entityId}`,
        meta: { type: fileType, filename: req.file.filename },
      });
      return res.status(201).json({
        ok: true,
        id: ins.insertId,
        entity_type: 'deal',
        entity_id: entityId,
        type: fileType,
        filename: req.file.filename,
        original_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        url: relUrl,
      });
    }

    const [ins] = await db.query(
      `INSERT INTO mobile_attachments
        (entity_type, entity_id, filename, original_name, mime_type, size_bytes, url, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityType,
        entityId,
        req.file.filename,
        req.file.originalname || null,
        req.file.mimetype || null,
        req.file.size || null,
        relUrl,
        req.user?.id || null,
      ]
    );

    await logAudit({
      req,
      action: 'upload',
      entity: 'mobile_attachment',
      entityId: ins.insertId,
      description: `Archivo movil subido a ${entityType} #${entityId}`,
      meta: { filename: req.file.filename, original_name: req.file.originalname },
    });

    res.status(201).json({
      ok: true,
      id: ins.insertId,
      entity_type: entityType,
      entity_id: entityId,
      filename: req.file.filename,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      url: relUrl,
    });
  } catch (e) {
    console.error('[mobile/attachments:create]', e);
    res.status(500).json({ error: e?.message || 'No se pudo subir el archivo' });
  }
});

export default router;
