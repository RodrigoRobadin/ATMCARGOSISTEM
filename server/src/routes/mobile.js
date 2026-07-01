import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import db from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';
import { buildFormalQuotePdfBuffer } from '../services/formalQuotePdf.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

const allowedAttachmentTargets = new Set(['contact', 'organization', 'deal', 'quote', 'quick_quote']);
const quickQuoteModalities = new Set(['aereo', 'maritimo', 'terrestre', 'multimodal', 'industrial', 'service']);
const cargoLoadTypes = {
  AEREO: ['LCL'],
  MARITIMO: ['FCL', 'LCL'],
  TERRESTRE: ['FTL', 'LTL', 'FCL'],
  MULTIMODAL: ['FCL', 'N/A'],
};
const cargoContainerTypes = ['40 ST', '20 ST', 'Reefer 40', 'Reefer 20', 'HC'];
const cargoUnitOptions = ['Bultos', 'Cajas', 'Pallets', 'Contenedores'];
const fallbackOperationTypes = [
  { value: 'IMPORT', label: 'Importacion' },
  { value: 'EXPORT', label: 'Exportacion' },
  { value: 'EXTERIOR', label: 'Exterior' },
];
const logisticsCountries = [
  { iso2: 'PY', iso3: 'PRY', iso_num: '600', name: 'Paraguay' },
  { iso2: 'AR', iso3: 'ARG', iso_num: '032', name: 'Argentina' },
  { iso2: 'BR', iso3: 'BRA', iso_num: '076', name: 'Brazil' },
  { iso2: 'UY', iso3: 'URY', iso_num: '858', name: 'Uruguay' },
  { iso2: 'CL', iso3: 'CHL', iso_num: '152', name: 'Chile' },
  { iso2: 'BO', iso3: 'BOL', iso_num: '068', name: 'Bolivia' },
  { iso2: 'PE', iso3: 'PER', iso_num: '604', name: 'Peru' },
  { iso2: 'US', iso3: 'USA', iso_num: '840', name: 'United States' },
  { iso2: 'ES', iso3: 'ESP', iso_num: '724', name: 'Spain' },
  { iso2: 'CN', iso3: 'CHN', iso_num: '156', name: 'China' },
  { iso2: 'PA', iso3: 'PAN', iso_num: '591', name: 'Panama' },
  { iso2: 'DE', iso3: 'DEU', iso_num: '276', name: 'Germany' },
  { iso2: 'NL', iso3: 'NLD', iso_num: '528', name: 'Netherlands' },
  { iso2: 'BE', iso3: 'BEL', iso_num: '056', name: 'Belgium' },
  { iso2: 'IT', iso3: 'ITA', iso_num: '380', name: 'Italy' },
  { iso2: 'MX', iso3: 'MEX', iso_num: '484', name: 'Mexico' },
  { iso2: 'CO', iso3: 'COL', iso_num: '170', name: 'Colombia' },
];
const logisticsLocations = [
  { country_iso2: 'PY', code: 'ASU', name: 'Asuncion', type: 'city' },
  { country_iso2: 'PY', code: 'ASU', name: 'Aeropuerto Silvio Pettirossi', type: 'airport' },
  { country_iso2: 'PY', code: 'AGT', name: 'Ciudad del Este', type: 'city' },
  { country_iso2: 'PY', code: 'VLL', name: 'Villeta', type: 'port' },
  { country_iso2: 'AR', code: 'BUE', name: 'Buenos Aires', type: 'city' },
  { country_iso2: 'AR', code: 'EZE', name: 'Ezeiza', type: 'airport' },
  { country_iso2: 'AR', code: 'COR', name: 'Cordoba', type: 'city' },
  { country_iso2: 'BR', code: 'SSZ', name: 'Santos', type: 'port' },
  { country_iso2: 'BR', code: 'GRU', name: 'Sao Paulo Guarulhos', type: 'airport' },
  { country_iso2: 'BR', code: 'SAO', name: 'Sao Paulo', type: 'city' },
  { country_iso2: 'BR', code: 'RIO', name: 'Rio de Janeiro', type: 'city' },
  { country_iso2: 'UY', code: 'MVD', name: 'Montevideo', type: 'port' },
  { country_iso2: 'CL', code: 'SCL', name: 'Santiago', type: 'city' },
  { country_iso2: 'CL', code: 'SAI', name: 'San Antonio', type: 'port' },
  { country_iso2: 'BO', code: 'VVI', name: 'Santa Cruz Viru Viru', type: 'airport' },
  { country_iso2: 'PE', code: 'LIM', name: 'Lima', type: 'city' },
  { country_iso2: 'PE', code: 'CLL', name: 'Callao', type: 'port' },
  { country_iso2: 'US', code: 'MIA', name: 'Miami', type: 'airport' },
  { country_iso2: 'US', code: 'LAX', name: 'Los Angeles', type: 'airport' },
  { country_iso2: 'US', code: 'NYC', name: 'New York', type: 'city' },
  { country_iso2: 'US', code: 'JFK', name: 'John F. Kennedy', type: 'airport' },
  { country_iso2: 'ES', code: 'MAD', name: 'Madrid', type: 'airport' },
  { country_iso2: 'ES', code: 'BCN', name: 'Barcelona', type: 'port' },
  { country_iso2: 'CN', code: 'SHA', name: 'Shanghai', type: 'port' },
  { country_iso2: 'CN', code: 'PVG', name: 'Shanghai Pudong', type: 'airport' },
  { country_iso2: 'CN', code: 'NGB', name: 'Ningbo', type: 'port' },
  { country_iso2: 'CN', code: 'SZX', name: 'Shenzhen', type: 'port' },
  { country_iso2: 'PA', code: 'PTY', name: 'Panama City', type: 'airport' },
  { country_iso2: 'PA', code: 'PAM', name: 'Panama Canal', type: 'port' },
  { country_iso2: 'DE', code: 'HAM', name: 'Hamburg', type: 'port' },
  { country_iso2: 'DE', code: 'FRA', name: 'Frankfurt', type: 'airport' },
  { country_iso2: 'NL', code: 'RTM', name: 'Rotterdam', type: 'port' },
  { country_iso2: 'NL', code: 'AMS', name: 'Amsterdam Schiphol', type: 'airport' },
  { country_iso2: 'BE', code: 'ANR', name: 'Antwerp', type: 'port' },
  { country_iso2: 'IT', code: 'GOA', name: 'Genoa', type: 'port' },
  { country_iso2: 'MX', code: 'MEX', name: 'Mexico City', type: 'airport' },
  { country_iso2: 'MX', code: 'VER', name: 'Veracruz', type: 'port' },
  { country_iso2: 'CO', code: 'BOG', name: 'Bogota', type: 'airport' },
  { country_iso2: 'CO', code: 'CTG', name: 'Cartagena', type: 'port' },
];
const countryNameByIso2 = new Map(logisticsCountries.map((country) => [country.iso2, country.name]));
const logisticsLocationOptions = logisticsLocations.map((location) => ({
  ...location,
  value: `${location.country_iso2} - ${location.code}`,
  label: `${location.name}, ${countryNameByIso2.get(location.country_iso2) || location.country_iso2}`,
}));

function requireMobileDownloadAuth(req, res, next) {
  const token = String(req.query.access_token || '');
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      return next();
    } catch (_) {}
  }
  return requireAuth(req, res, next);
}

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

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractQuoteSummary(computed = {}, inputs = {}) {
  const opCurrency = String(
    computed?.meta?.operation_currency || inputs?.operation_currency || 'USD'
  ).toUpperCase();
  const rate = numberOrNull(
    computed?.meta?.exchange_rate_atm_gs_per_usd ||
    computed?.meta?.exchange_rate_operation_sell_usd ||
    inputs?.exchange_rate_atm_gs_per_usd ||
    inputs?.exchange_rate_operation_sell_usd ||
    1
  ) || 1;
  const isPyg = opCurrency === 'PYG' || opCurrency === 'GS';
  const opTotals = computed?.operacion?.totals || {};
  const ofertaTotals = computed?.oferta?.totals || {};
  const totalSalesUsd = numberOrNull(
    opTotals?.total_sell_usd ??
    ofertaTotals?.total_sales_usd ??
    computed?.oferta?.totals?.totalSalesUsd ??
    opTotals?.total_sales_usd
  );
  let totalCostUsd = numberOrNull(
    opTotals?.total_buy_usd ??
    opTotals?.cost_total_usd ??
    opTotals?.total_cost_usd ??
    opTotals?.totalCostUsd ??
    computed?.costos?.totals?.total_cost_usd
  );
  const profitUsd = numberOrNull(
    opTotals?.profit_total_usd ??
    opTotals?.profitGeneral ??
    opTotals?.profit_general
  );
  if (totalCostUsd == null && totalSalesUsd != null && profitUsd != null) {
    totalCostUsd = totalSalesUsd - profitUsd;
  }
  const grossSalesUsd = numberOrNull(opTotals?.gross_total_sell_usd ?? ofertaTotals?.gross_total_sales_usd);
  const discountUsd = numberOrNull(opTotals?.discount_amount_usd ?? ofertaTotals?.discount_amount_usd);
  const grossPurchaseUsd = numberOrNull(opTotals?.gross_product_purchase_usd);
  const supplierDiscountUsd = numberOrNull(opTotals?.supplier_discount_amount_usd);
  const vendorProfitUsd = numberOrNull(computed?.operacion?.distribution?.vendor_profit_usd);
  const finalProfitUsd = numberOrNull(computed?.operacion?.distribution?.final_profit_usd);
  const toDisplay = (value) => value == null ? null : (isPyg ? value * rate : value);
  const rubros = Object.entries(computed?.operacion?.rubros || {}).map(([key, value]) => ({
    key,
    compra_usd: numberOrNull(value?.compra),
    venta_usd: numberOrNull(value?.venta),
    profit_usd: numberOrNull(value?.profit),
    compra_display: toDisplay(numberOrNull(value?.compra)),
    venta_display: toDisplay(numberOrNull(value?.venta)),
    profit_display: toDisplay(numberOrNull(value?.profit)),
  }));
  return {
    currency: opCurrency,
    exchange_rate: rate,
    total_sales_usd: totalSalesUsd,
    total_cost_usd: totalCostUsd,
    profit_total_usd: profitUsd,
    gross_sales_usd: grossSalesUsd,
    discount_usd: discountUsd,
    gross_purchase_usd: grossPurchaseUsd,
    supplier_discount_usd: supplierDiscountUsd,
    vendor_profit_usd: vendorProfitUsd,
    final_profit_usd: finalProfitUsd,
    total_sales_display: toDisplay(totalSalesUsd),
    total_cost_display: toDisplay(totalCostUsd),
    profit_total_display: toDisplay(profitUsd),
    gross_sales_display: toDisplay(grossSalesUsd),
    discount_display: toDisplay(discountUsd),
    gross_purchase_display: toDisplay(grossPurchaseUsd),
    supplier_discount_display: toDisplay(supplierDiscountUsd),
    vendor_profit_display: toDisplay(vendorProfitUsd),
    final_profit_display: toDisplay(finalProfitUsd),
    margin_percent: totalSalesUsd && profitUsd != null ? (profitUsd / totalSalesUsd) * 100 : null,
    rubros,
  };
}

async function getMobileQuoteForDeal(dealId) {
  try {
    const [[row]] = await db.query(
      `SELECT id, deal_id, ref_code, revision, client_name, status, inputs_json, document_snapshot_json, computed_json, updated_at
         FROM quotes
        WHERE deal_id = ?
        LIMIT 1`,
      [dealId]
    );
    if (!row) return null;
    const inputs = safeJson(row.inputs_json, {}) || {};
    const computed = safeJson(row.computed_json, {}) || {};
    const documentSnapshot = safeJson(row.document_snapshot_json, null);
    const [revisions] = await db.query(
      'SELECT id, name, created_at FROM quote_revisions WHERE quote_id = ? ORDER BY id DESC LIMIT 8',
      [row.id]
    ).catch(() => [[]]);
    return {
      id: row.id,
      deal_id: row.deal_id,
      ref_code: row.ref_code,
      revision: row.revision,
      client_name: row.client_name,
      status: row.status,
      updated_at: row.updated_at,
      summary: extractQuoteSummary(computed, inputs),
      has_document_snapshot: !!documentSnapshot,
      revisions: revisions || [],
      links: {
        pdf_url: `/mobile/operations/${dealId}/quote-pdf.pdf`,
        xlsx_url: `/quotes/${row.id}/export-xlsx`,
      },
    };
  } catch (_) {
    return null;
  }
}

function customFieldsMap(rows = []) {
  return new Map((rows || []).map((row) => [row.key, row.value ?? '']));
}

function resolveMobileDetailKind(deal, fieldMap) {
  const key = String(deal?.business_unit_key || '').toLowerCase();
  if (key === 'atm-industrial') return 'industrial';
  if (key === 'atm-container') return 'container';
  if (fieldMap.get('industrial_brand') || fieldMap.get('industrial_mobile_services')) return 'industrial';
  return 'cargo';
}

function mysqlNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizeDateTime(value) {
  const raw = cleanText(value, 32);
  if (!raw) return null;
  return raw.length === 16 ? `${raw}:00` : raw.replace('T', ' ');
}

async function getMobileFollowupContext({ orgId = null, contactId = null, limit = 20 }) {
  const params = [];
  const filters = [];
  if (orgId) {
    filters.push('org_id = ?');
    params.push(orgId);
  }
  if (contactId) {
    filters.push('contact_id = ?');
    params.push(contactId);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : 'WHERE 1=0';
  const safeLimit = Math.min(Number(limit) || 20, 80);

  const [calls] = await db.query(
    `SELECT id, user_id, org_id, contact_id, deal_id, subject, notes, happened_at, duration_min, outcome, created_at
       FROM followup_calls
      ${where}
      ORDER BY happened_at DESC, id DESC
      LIMIT ?`,
    [...params, safeLimit]
  ).catch(() => [[]]);
  const [notes] = await db.query(
    `SELECT id, user_id, org_id, contact_id, deal_id, content, created_at
       FROM followup_notes
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [...params, safeLimit]
  ).catch(() => [[]]);
  const [tasks] = await db.query(
    `SELECT id, user_id, org_id, contact_id, deal_id, title, priority, status, due_at, completed_at, created_at
       FROM followup_tasks
      ${where}
      ORDER BY FIELD(status, 'pending', 'done', 'canceled'), due_at ASC, id DESC
      LIMIT ?`,
    [...params, safeLimit]
  ).catch(() => [[]]);
  return { calls: calls || [], notes: notes || [], tasks: tasks || [] };
}

async function getIndustrialDoorsForDeal(dealId) {
  try {
    const [rows] = await db.query(
      `
      SELECT id,
             deal_id,
             product_id,
             product_name,
             brand,
             identifier,
             width_available,
             height_available,
             side_install,
             overheight_available,
             frame_type,
             canvas_type,
             frame_material,
             finish,
             clearance_right,
             clearance_left,
             motor_side,
             actuators,
             visor_lines,
             right_leg,
             quantity,
             place,
             canvas_color,
             notes,
             created_at,
             updated_at
        FROM industrial_doors
       WHERE deal_id = ?
       ORDER BY id ASC
      `,
      [dealId]
    );
    for (const door of rows || []) {
      const [images] = await db.query(
        `SELECT id, filename, url, created_at
           FROM industrial_door_images
          WHERE door_id = ?
          ORDER BY created_at ASC`,
        [door.id]
      ).catch(() => [[]]);
      door.images = images || [];
    }
    return rows || [];
  } catch (_) {
    return [];
  }
}

async function getMobileCatalogItems() {
  try {
    const [items] = await db.query(
      `SELECT id,
              type,
              sku,
              name,
              brand,
              category,
              description,
              unit,
              currency,
              price,
              active
         FROM catalog_items
        WHERE COALESCE(active, 1) = 1
        ORDER BY type ASC, name ASC
        LIMIT 1000`
    );
    return items || [];
  } catch (_) {
    return [];
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

  const [stages] = await db.query(
    'SELECT id, name, order_index FROM stages WHERE pipeline_id = ? ORDER BY order_index ASC, id ASC',
    [pipelineId]
  );
  const stage = stages?.[0];
  if (!stage?.id) return null;

  const operationTypes = await getOperationTypeOptions();
  const industrialBrands = await getIndustrialBrands();

  return {
    business_unit: bu,
    pipeline_id: pipelineId,
    stage_id: stage.id,
    stage_name: stage.name,
    stages,
    options: {
      cargo: {
        modalities: Object.keys(cargoLoadTypes),
        load_types: cargoLoadTypes,
        container_types: cargoContainerTypes,
        unit_options: cargoUnitOptions,
        operation_types: operationTypes,
        countries: logisticsCountries,
        locations: logisticsLocationOptions,
      },
      industrial: {
        brands: industrialBrands,
      },
    },
  };
}

async function getOperationTypeOptions() {
  try {
    const [rows] = await db.query(
      `SELECT value
         FROM param_values
        WHERE \`key\` = 'operation_type' AND COALESCE(active, 1) = 1
        ORDER BY ord, value`
    );
    if (rows?.length) {
      return rows.map((row) => ({
        value: cleanText(row.value, 80),
        label: cleanText(row.value, 120),
      })).filter((row) => row.value);
    }
  } catch (_) {}
  return fallbackOperationTypes;
}

async function getIndustrialBrands() {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT TRIM(brand) AS brand
         FROM catalog_items
        WHERE COALESCE(active, 1) = 1
          AND UPPER(type) IN ('PRODUCTO', 'SERVICIO')
          AND brand IS NOT NULL
          AND TRIM(brand) <> ''
        ORDER BY brand ASC
        LIMIT 100`
    );
    return [...new Set((rows || []).map((row) => cleanText(row.brand, 120)).filter(Boolean))];
  } catch (_) {
    return [];
  }
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

async function getVisibleDealWhere(req, alias = 'd') {
  const where = [];
  const params = [];
  if (String(req.user?.role || '').toLowerCase() !== 'admin') {
    where.push(`${alias}.advisor_user_id = ?`);
    params.push(req.user?.id || 0);
  }
  return { where, params };
}

router.get('/operations', requireAuth, async (req, res) => {
  try {
    const q = cleanText(req.query.q, 120);
    const limit = Math.min(Number(req.query.limit || 30) || 30, 80);
    const { where, params } = await getVisibleDealWhere(req, 'd');
    if (q) {
      where.push('(d.reference LIKE ? OR d.title LIKE ? OR o.name LIKE ? OR c.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await db.query(
      `SELECT d.id, d.reference, d.title, d.status, d.stage_id, d.pipeline_id, d.business_unit_id,
              d.contact_id, d.org_id, d.created_at,
              o.name AS org_name, o.ruc AS org_ruc,
              c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email,
              s.name AS stage_name, p.name AS pipeline_name,
              bu.name AS business_unit_name, bu.key_slug AS business_unit_key,
              COALESCE(files.total_files, 0) AS file_count,
              COALESCE(fields.total_fields, 0) AS custom_field_count
         FROM deals d
         LEFT JOIN organizations o ON o.id = d.org_id
         LEFT JOIN contacts c ON c.id = d.contact_id
         LEFT JOIN stages s ON s.id = d.stage_id
         LEFT JOIN pipelines p ON p.id = d.pipeline_id
         LEFT JOIN business_units bu ON bu.id = d.business_unit_id
         LEFT JOIN (SELECT deal_id, COUNT(*) AS total_files FROM deal_files GROUP BY deal_id) files ON files.deal_id = d.id
         LEFT JOIN (SELECT deal_id, COUNT(*) AS total_fields FROM deal_custom_fields GROUP BY deal_id) fields ON fields.deal_id = d.id
        ${whereSql}
        ORDER BY d.created_at DESC
        LIMIT ?`,
      [...params, limit]
    );
    res.json(rows);
  } catch (e) {
    console.error('[mobile/operations:list]', e);
    res.status(500).json({ error: 'No se pudieron listar operaciones' });
  }
});

router.get('/operations/:id', requireAuth, async (req, res) => {
  try {
    const id = toNumberOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID de operacion requerido' });
    const { where, params } = await getVisibleDealWhere(req, 'd');
    where.push('d.id = ?');
    params.push(id);

    const [[deal]] = await db.query(
      `SELECT d.id, d.reference, d.title, d.value, d.status, d.stage_id, d.pipeline_id, d.business_unit_id,
              d.contact_id, d.org_id, d.created_at,
              o.name AS org_name, o.ruc AS org_ruc, o.email AS org_email, o.phone AS org_phone, o.city AS org_city,
              c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email,
              s.name AS stage_name, p.name AS pipeline_name,
              bu.name AS business_unit_name, bu.key_slug AS business_unit_key
         FROM deals d
         LEFT JOIN organizations o ON o.id = d.org_id
         LEFT JOIN contacts c ON c.id = d.contact_id
         LEFT JOIN stages s ON s.id = d.stage_id
         LEFT JOIN pipelines p ON p.id = d.pipeline_id
         LEFT JOIN business_units bu ON bu.id = d.business_unit_id
        WHERE ${where.join(' AND ')}
        LIMIT 1`,
      params
    );
    if (!deal) return res.status(404).json({ error: 'Operacion no encontrada' });

    const [customFields] = await db.query(
      `SELECT id, \`key\`, label, \`type\`, \`value\`, updated_at
         FROM deal_custom_fields
        WHERE deal_id = ?
        ORDER BY label, \`key\``,
      [id]
    ).catch(() => [[]]);
    const [files] = await db.query(
      'SELECT id, type, filename, url, created_at FROM deal_files WHERE deal_id = ? ORDER BY created_at DESC',
      [id]
    ).catch(() => [[]]);
    const [stages] = await db.query(
      'SELECT id, name, order_index FROM stages WHERE pipeline_id = ? ORDER BY order_index ASC, id ASC',
      [deal.pipeline_id]
    ).catch(() => [[]]);

    const fieldMap = customFieldsMap(customFields);
    const detailKind = resolveMobileDetailKind(deal, fieldMap);
    const cargoDetail = {
      modalidad_carga: fieldMap.get('modalidad_carga') || '',
      tipo_carga: fieldMap.get('tipo_carga') || '',
      tipo_operacion: fieldMap.get('tipo_operacion') || '',
      origen_pto: fieldMap.get('origen_pto') || '',
      destino_pto: fieldMap.get('destino_pto') || '',
      mercaderia: fieldMap.get('mercaderia') || '',
      cant_bultos: fieldMap.get('cant_bultos') || '',
      unidad_bultos: fieldMap.get('unidad_bultos') || '',
      peso_bruto: fieldMap.get('peso_bruto') || '',
      vol_m3: fieldMap.get('vol_m3') || '',
      mobile_notes: fieldMap.get('mobile_notes') || '',
    };
    const catalogItems = detailKind === 'industrial' ? await getMobileCatalogItems() : [];
    const catalogProducts = catalogItems.filter((item) => String(item.type || '').toUpperCase() === 'PRODUCTO');
    const catalogServices = catalogItems.filter((item) => String(item.type || '').toUpperCase() === 'SERVICIO');
    const industrialDoors = detailKind === 'industrial' ? await getIndustrialDoorsForDeal(id) : [];
    const quote = await getMobileQuoteForDeal(id);

    res.json({
      deal,
      custom_fields: customFields || [],
      files: files || [],
      stages: stages || [],
      detail_kind: detailKind,
      cargo_detail: cargoDetail,
      industrial_doors: industrialDoors,
      catalog_products: catalogProducts,
      catalog_services: catalogServices,
      quote,
    });
  } catch (e) {
    console.error('[mobile/operations:detail]', e);
    res.status(500).json({ error: 'No se pudo cargar la operacion' });
  }
});

function safeDownloadName(value, fallback = 'presupuesto') {
  return String(value || fallback)
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || fallback;
}

function quoteNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const text = String(value).trim();
  if (!text) return 0;
  if (text.includes('.') && text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.')) || 0;
  if (text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.')) || 0;
  return Number(text.replace(/,/g, '')) || 0;
}

function pickFilled(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}

function parseSnapshotItems(snapshot) {
  const parsed = safeJson(snapshot?.industrial_items_json, []);
  return Array.isArray(parsed) ? parsed : [];
}

function buildFormalMobilePdfPayload({ quote, inputs, computed, documentSnapshot }) {
  const snapshot = documentSnapshot && typeof documentSnapshot === 'object' && !Array.isArray(documentSnapshot)
    ? documentSnapshot
    : {};
  const currencyCode = String(
    computed?.meta?.operation_currency ||
    inputs?.operation_currency ||
    snapshot?.moneda_operacion ||
    'USD'
  ).toUpperCase();
  const itemsFromSnapshot = parseSnapshotItems(snapshot);
  const computedItems = Array.isArray(computed?.oferta?.items)
    ? computed.oferta.items
    : Array.isArray(computed?.resultado?.items)
      ? computed.resultado.items
      : [];
  const inputItems = Array.isArray(inputs?.items) ? inputs.items : [];
  const sourceItems = itemsFromSnapshot.length ? itemsFromSnapshot : (inputItems.length ? inputItems : computedItems);
  const items = sourceItems
    .map((item, index) => {
      const pricing = computedItems[index] || {};
      const quantity = pickFilled(item?.cantidad, item?.quantity, item?.qty, pricing?.qty, pricing?.quantity, 1);
      const qty = quoteNumber(quantity) || 1;
      const totalSales = quoteNumber(pickFilled(
        item?.total_sales,
        item?.total_ventas,
        item?.total_sales_usd,
        pricing?.total_sales,
        pricing?.total_ventas,
        pricing?.total_sales_usd,
        0
      ));
      const unitPrice = quoteNumber(pickFilled(
        item?.precio,
        item?.unit_price,
        item?.pv_unit,
        pricing?.pv_unit,
        pricing?.pv_unit_usd,
        pricing?.unit_price,
        totalSales && qty ? totalSales / qty : 0
      ));
      return {
        product: pickFilled(item?.servicio, item?.product, item?.name, item?.description, pricing?.description, `Item ${index + 1}`),
        quantity,
        unit: pickFilled(item?.unidad, item?.unit, 'UNIDAD'),
        description: pickFilled(item?.observacion, item?.observation, item?.observations, item?.descripcion, item?.description, ''),
        observacion_html: pickFilled(item?.observacion_html, item?.observation_html, item?.description_html, ''),
        currency: pickFilled(item?.moneda, item?.currency, currencyCode),
        unit_price: unitPrice,
        total: quoteNumber(pickFilled(item?.total, item?.valor, totalSales, qty * unitPrice)),
      };
    })
    .filter((item) => item.product || item.description || item.total);
  const totalAmount = items.reduce((sum, item) => sum + quoteNumber(item.total), 0);
  const destination = [snapshot.ciudad_destino, snapshot.pais_destino].filter(Boolean).join(', ');
  return {
    ...snapshot,
    reference: pickFilled(snapshot.reference, snapshot.referencia, quote?.ref_code, quote?.deal_reference),
    date: pickFilled(snapshot.fecha, new Date().toLocaleDateString('es-PY')),
    customer_name: pickFilled(snapshot.customer_name, snapshot.cliente, quote?.client_name, quote?.org_name),
    contact_name: pickFilled(snapshot.contact_name, snapshot.contacto, quote?.contact_name),
    subject: pickFilled(snapshot.subject, snapshot.asunto),
    sale_condition: pickFilled(snapshot.sale_condition, snapshot.condicion_venta),
    credit_term: pickFilled(snapshot.credit_term, snapshot.plazo_credito),
    payment_method: pickFilled(snapshot.payment_method, snapshot.forma_pago),
    offer_validity: pickFilled(snapshot.offer_validity, snapshot.validez_oferta),
    comment: pickFilled(snapshot.comment, snapshot.observaciones_producto),
    observations: pickFilled(snapshot.observations, snapshot.observaciones),
    installation_type: pickFilled(snapshot.installation_type, snapshot.tipo_instalacion),
    payment_condition: pickFilled(snapshot.payment_condition, snapshot.condicion_pago),
    delivery_type: pickFilled(snapshot.delivery_type, snapshot.incoterms),
    delivery_address: pickFilled(snapshot.delivery_address, destination),
    delivery_term: pickFilled(snapshot.delivery_term, snapshot.plazos_entrega),
    warranty_text: pickFilled(snapshot.warranty_text, snapshot.garantia),
    customer_responsibility: pickFilled(snapshot.customer_responsibility, snapshot.responsabilidad_cliente),
    includes_text: pickFilled(snapshot.includes_text, snapshot.que_incluye),
    excludes_text: pickFilled(snapshot.excludes_text, snapshot.que_no_incluye),
    currency_code: currencyCode,
    total_currency: currencyCode === 'PYG' || currencyCode === 'GS' ? 'GS' : currencyCode,
    total_amount: totalAmount,
    items,
  };
}

async function sendMobileQuotePdf(req, res) {
  try {
    const id = toNumberOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID de operacion requerido' });
    const [[quote]] = await db.query(
      `SELECT q.id,
              q.ref_code,
              q.client_name,
              q.created_by,
              q.inputs_json,
              q.document_snapshot_json,
              q.computed_json,
              d.reference AS deal_reference,
              o.name AS org_name,
              c.name AS contact_name,
              u.name AS created_by_name
         FROM quotes q
         LEFT JOIN deals d ON d.id = q.deal_id
         LEFT JOIN organizations o ON o.id = d.org_id
         LEFT JOIN contacts c ON c.id = d.contact_id
         LEFT JOIN users u ON u.id = q.created_by
        WHERE q.deal_id = ?
        LIMIT 1`,
      [id]
    );
    if (!quote) return res.status(404).json({ error: 'La operacion no tiene presupuesto' });
    const inputs = safeJson(quote.inputs_json, {}) || {};
    const documentSnapshot = safeJson(quote.document_snapshot_json, null);
    const computed = safeJson(quote.computed_json, {}) || {};
    const pdfPayload = buildFormalMobilePdfPayload({
      quote,
      inputs,
      computed,
      documentSnapshot,
    });
    const pdf = await buildFormalQuotePdfBuffer(pdfPayload);
    const pdfBuffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    const filename = `${safeDownloadName(quote.ref_code || id)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.end(pdfBuffer);
  } catch (e) {
    console.error('[mobile/operations:quote-pdf]', e);
    res.status(500).json({ error: e?.message || 'No se pudo generar el PDF' });
  }
}

router.get('/operations/:id/quote-pdf.pdf', requireMobileDownloadAuth, sendMobileQuotePdf);
router.get('/operations/:id/quote-pdf', requireMobileDownloadAuth, sendMobileQuotePdf);

router.patch('/operations/:id', requireAuth, async (req, res) => {
  try {
    const id = toNumberOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID de operacion requerido' });
    const { where, params } = await getVisibleDealWhere(req, 'd');
    where.push('d.id = ?');
    params.push(id);
    const [[deal]] = await db.query(`SELECT id FROM deals d WHERE ${where.join(' AND ')} LIMIT 1`, params);
    if (!deal) return res.status(404).json({ error: 'Operacion no encontrada' });

    const stageId = toNumberOrNull(req.body?.stage_id);
    const title = cleanText(req.body?.title, 255);
    const fields = [];
    const values = [];
    if (stageId) {
      fields.push('stage_id = ?');
      values.push(stageId);
    }
    if (title) {
      fields.push('title = ?');
      values.push(title);
    }
    const customFields = Array.isArray(req.body?.custom_fields) ? req.body.custom_fields : [];
    if (!fields.length && !customFields.length) return res.json({ ok: true });
    if (fields.length) {
      await db.query(`UPDATE deals SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }

    for (const field of customFields) {
      const key = cleanText(field?.key, 120);
      if (!key) continue;
      const label = cleanText(field?.label, 255) || key;
      const requestedType = cleanText(field?.type, 40) || 'text';
      const type = requestedType === 'json' ? 'text' : requestedType;
      const value = field?.value == null ? '' : String(field.value);
      const [existing] = await db.query(
        'SELECT id FROM deal_custom_fields WHERE deal_id = ? AND `key` = ? LIMIT 1',
        [id, key]
      );
      if (existing?.[0]?.id) {
        await db.query(
          'UPDATE deal_custom_fields SET label = ?, `type` = ?, `value` = ? WHERE id = ?',
          [label, type, value, existing[0].id]
        );
      } else {
        await db.query(
          'INSERT INTO deal_custom_fields (deal_id, `key`, label, `type`, `value`) VALUES (?,?,?,?,?)',
          [id, key, label, type, value]
        );
      }
    }

    await logAudit({
      req,
      action: 'update',
      entity: 'deal',
      entityId: id,
      description: `Actualizo operacion movil ${id}`,
      meta: { stage_id: stageId, title, custom_fields: customFields.map((field) => field?.key).filter(Boolean) },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[mobile/operations:update]', e);
    res.status(500).json({ error: 'No se pudo actualizar la operacion' });
  }
});

router.get('/contacts/:id', requireAuth, async (req, res) => {
  try {
    const id = toNumberOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID de contacto requerido' });
    const [[contact]] = await db.query(
      `SELECT c.id, c.name, c.email, c.phone, c.title, c.org_id, c.label, c.notes, c.created_at,
              o.name AS org_name, o.razon_social AS org_razon_social, o.ruc AS org_ruc, o.phone AS org_phone
         FROM contacts c
         LEFT JOIN organizations o ON o.id = c.org_id
        WHERE c.id = ? AND c.deleted_at IS NULL
        LIMIT 1`,
      [id]
    );
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });
    const followup = await getMobileFollowupContext({ contactId: id, orgId: contact.org_id || null });
    res.json({ contact, followup });
  } catch (e) {
    console.error('[mobile/contacts:detail]', e);
    res.status(500).json({ error: 'No se pudo cargar el contacto' });
  }
});

router.get('/organizations/:id', requireAuth, async (req, res) => {
  try {
    const id = toNumberOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID de organizacion requerido' });
    const [[organization]] = await db.query(
      `SELECT id, name, razon_social, ruc, email, phone, website, address, city, country, notes, tipo_org, created_at
         FROM organizations
        WHERE id = ?
        LIMIT 1`,
      [id]
    );
    if (!organization) return res.status(404).json({ error: 'Organizacion no encontrada' });
    const [contacts] = await db.query(
      `SELECT id, name, email, phone, title, org_id, notes
         FROM contacts
        WHERE org_id = ? AND deleted_at IS NULL
        ORDER BY name ASC
        LIMIT 80`,
      [id]
    ).catch(() => [[]]);
    const followup = await getMobileFollowupContext({ orgId: id });
    res.json({ organization, contacts: contacts || [], followup });
  } catch (e) {
    console.error('[mobile/organizations:detail]', e);
    res.status(500).json({ error: 'No se pudo cargar la organizacion' });
  }
});

router.get('/followup', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    const limit = Math.min(Number(req.query.limit || 80) || 80, 150);
    const [tasks] = await db.query(
      `SELECT t.id, t.org_id, o.name AS org_name, o.phone AS org_phone,
              t.contact_id, c.name AS contact_name, c.phone AS contact_phone,
              t.title, t.priority, t.status, t.due_at, t.completed_at, t.created_at
         FROM followup_tasks t
         LEFT JOIN organizations o ON o.id = t.org_id
         LEFT JOIN contacts c ON c.id = t.contact_id
        WHERE t.user_id = ? AND t.status = 'pending'
        ORDER BY t.due_at ASC, t.id ASC
        LIMIT ?`,
      [userId, limit]
    ).catch(() => [[]]);
    const [recentCalls] = await db.query(
      `SELECT c.id, c.org_id, o.name AS org_name, o.phone AS org_phone,
              c.contact_id, ct.name AS contact_name, ct.phone AS contact_phone,
              c.subject, c.notes, c.outcome, c.happened_at, c.created_at
         FROM followup_calls c
         LEFT JOIN organizations o ON o.id = c.org_id
         LEFT JOIN contacts ct ON ct.id = c.contact_id
        WHERE c.user_id = ?
        ORDER BY c.happened_at DESC, c.id DESC
        LIMIT 80`,
      [userId]
    ).catch(() => [[]]);
    const [notRecent] = await db.query(
      `SELECT o.id AS org_id, o.name AS org_name, o.phone AS org_phone,
              NULL AS contact_id, NULL AS contact_name, NULL AS contact_phone,
              MAX(fc.happened_at) AS last_call_at
         FROM organizations o
         LEFT JOIN followup_calls fc ON fc.org_id = o.id AND fc.user_id = ?
        WHERE o.phone IS NOT NULL AND TRIM(o.phone) <> ''
        GROUP BY o.id, o.name, o.phone
       HAVING last_call_at IS NULL OR last_call_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
        ORDER BY last_call_at ASC, o.name ASC
        LIMIT 40`,
      [userId]
    ).catch(() => [[]]);

    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const overdue = [];
    const today = [];
    const upcoming = [];
    for (const task of tasks || []) {
      const due = task.due_at ? new Date(task.due_at) : null;
      const dueKey = due && !Number.isNaN(due.getTime()) ? due.toISOString().slice(0, 10) : '';
      if (due && due < now && dueKey !== todayKey) overdue.push(task);
      else if (dueKey === todayKey) today.push(task);
      else upcoming.push(task);
    }
    res.json({
      overdue,
      today,
      upcoming,
      no_recent_followup: notRecent || [],
      recent_calls: recentCalls || [],
    });
  } catch (e) {
    console.error('[mobile/followup:list]', e);
    res.status(500).json({ error: 'No se pudo cargar seguimiento' });
  }
});

router.post('/followup/calls', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    const orgId = toNumberOrNull(req.body?.org_id);
    const contactId = toNumberOrNull(req.body?.contact_id);
    const dealId = toNumberOrNull(req.body?.deal_id);
    const subject = cleanText(req.body?.subject, 255) || 'Llamada';
    const notes = cleanText(req.body?.notes, 5000) || '';
    const outcome = ['no_contesta', 'interesado', 'no_interesado', 'volver_a_llamar', 'en_negociacion'].includes(req.body?.outcome)
      ? req.body.outcome
      : null;
    const happenedAt = normalizeDateTime(req.body?.happened_at) || mysqlNow();
    const durationMin = toNumberOrNull(req.body?.duration_min) || 0;
    const [ins] = await db.query(
      `INSERT INTO followup_calls (user_id, org_id, contact_id, deal_id, subject, notes, happened_at, duration_min, outcome)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [userId, orgId, contactId, dealId, subject, notes, happenedAt, durationMin, outcome]
    );
    res.status(201).json({ id: ins.insertId });
  } catch (e) {
    console.error('[mobile/followup:calls]', e);
    res.status(500).json({ error: 'No se pudo registrar la llamada' });
  }
});

router.post('/followup/notes', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    const content = cleanText(req.body?.content, 5000);
    if (!content) return res.status(400).json({ error: 'Nota requerida' });
    const [ins] = await db.query(
      `INSERT INTO followup_notes (user_id, org_id, contact_id, deal_id, content)
       VALUES (?,?,?,?,?)`,
      [userId, toNumberOrNull(req.body?.org_id), toNumberOrNull(req.body?.contact_id), toNumberOrNull(req.body?.deal_id), content]
    );
    res.status(201).json({ id: ins.insertId });
  } catch (e) {
    console.error('[mobile/followup:notes]', e);
    res.status(500).json({ error: 'No se pudo guardar la nota' });
  }
});

router.post('/followup/tasks', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    const title = cleanText(req.body?.title, 255);
    const dueAt = normalizeDateTime(req.body?.due_at);
    if (!title) return res.status(400).json({ error: 'Titulo requerido' });
    if (!dueAt) return res.status(400).json({ error: 'Fecha requerida' });
    const priority = ['low', 'medium', 'high'].includes(req.body?.priority) ? req.body.priority : 'medium';
    const [ins] = await db.query(
      `INSERT INTO followup_tasks (user_id, org_id, contact_id, deal_id, title, priority, status, due_at)
       VALUES (?,?,?,?,?,?, 'pending', ?)`,
      [userId, toNumberOrNull(req.body?.org_id), toNumberOrNull(req.body?.contact_id), toNumberOrNull(req.body?.deal_id), title, priority, dueAt]
    );
    res.status(201).json({ id: ins.insertId });
  } catch (e) {
    console.error('[mobile/followup:tasks]', e);
    res.status(500).json({ error: 'No se pudo crear la tarea' });
  }
});

router.patch('/followup/tasks/:id', requireAuth, async (req, res) => {
  try {
    const id = toNumberOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID requerido' });
    const status = ['pending', 'done', 'canceled'].includes(req.body?.status) ? req.body.status : null;
    const fields = [];
    const params = [];
    if (status) {
      fields.push('status = ?');
      params.push(status);
      if (status === 'done') fields.push('completed_at = NOW()');
    }
    if (req.body?.title !== undefined) {
      fields.push('title = ?');
      params.push(cleanText(req.body.title, 255));
    }
    if (req.body?.due_at !== undefined) {
      fields.push('due_at = ?');
      params.push(normalizeDateTime(req.body.due_at));
    }
    if (!fields.length) return res.json({ ok: true });
    params.push(id, Number(req.user?.id || 0));
    await db.query(`UPDATE followup_tasks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, params);
    res.json({ ok: true });
  } catch (e) {
    console.error('[mobile/followup:task-update]', e);
    res.status(500).json({ error: 'No se pudo actualizar la tarea' });
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
