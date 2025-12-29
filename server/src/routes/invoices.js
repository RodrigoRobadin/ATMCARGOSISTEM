// server/src/routes/invoices.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import generateInvoicePDF from '../services/invoiceTemplatePdfkit.js';

const router = Router();

// Ensures (best-effort) for credit tables/columns on startup
ensureCreditNoteTables().catch((err) => console.error('init credit tables', err?.message));
ensureInvoiceCreditColumns().catch((err) => console.error('init credit cols', err?.message));

// =================== HELPERS ===================
async function ensureInvoiceSequence() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_sequence (
      id INT PRIMARY KEY,
      prefix VARCHAR(16) NOT NULL DEFAULT 'FAC',
      year INT NOT NULL,
      last_number INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(
    `INSERT IGNORE INTO invoice_sequence (id, prefix, year, last_number)
     VALUES (1, 'FAC', YEAR(CURDATE()), 0);`
  );
}

async function ensureInvoiceExtraColumns() {
  const alters = [
    "ALTER TABLE invoices ADD COLUMN percentage DECIMAL(5,2) NULL",
    "ALTER TABLE invoices ADD COLUMN base_amount DECIMAL(15,2) NULL",
    "ALTER TABLE invoices ADD COLUMN payment_condition VARCHAR(20) NULL",
    "ALTER TABLE invoices ADD COLUMN timbrado_number VARCHAR(32) NULL",
    "ALTER TABLE invoices ADD COLUMN timbrado_expires_at DATE NULL",
    "ALTER TABLE invoices ADD COLUMN timbrado_start_date DATE NULL",
    "ALTER TABLE invoices ADD COLUMN customer_doc VARCHAR(32) NULL",
    "ALTER TABLE invoices ADD COLUMN customer_doc_type VARCHAR(16) NULL",
    "ALTER TABLE invoices ADD COLUMN customer_email VARCHAR(128) NULL",
    "ALTER TABLE invoices ADD COLUMN customer_address VARCHAR(255) NULL",
    "ALTER TABLE invoices ADD COLUMN currency_code VARCHAR(8) NULL",
    "ALTER TABLE invoices ADD COLUMN exchange_rate DECIMAL(15,6) NULL",
    "ALTER TABLE invoices ADD COLUMN point_of_issue VARCHAR(8) NULL",
    "ALTER TABLE invoices ADD COLUMN establishment VARCHAR(8) NULL",
    "ALTER TABLE invoices ADD COLUMN sales_rep VARCHAR(128) NULL",
    "ALTER TABLE invoices ADD COLUMN sales_rep_id INT NULL",
    "ALTER TABLE invoices ADD COLUMN purchase_order_ref VARCHAR(128) NULL",
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (err) {
      // Ignorar si la columna ya existe
      if (err?.code !== 'ER_DUP_FIELDNAME') {
        throw err;
      }
    }
  }
}

async function ensureInvoiceItemsTaxColumn() {
  try {
    await pool.query("ALTER TABLE invoice_items ADD COLUMN tax_rate DECIMAL(5,2) NULL");
  } catch (err) {
    if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

async function ensureInvoiceCreditColumns() {
  const alters = [
    "ALTER TABLE invoices ADD COLUMN credited_total DECIMAL(15,2) NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN net_total_amount DECIMAL(15,2) NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN net_balance DECIMAL(15,2) NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN canceled_by_credit_note_id INT NULL",
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (err) {
      if (err?.code === 'ER_DUP_FIELDNAME') continue;
      throw err;
    }
  }
}

async function ensureParamsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS params (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\` VARCHAR(100) NOT NULL,
      value TEXT NULL,
      ord INT NULL DEFAULT 0,
      active TINYINT(1) NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_params_key (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureParamValuesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS param_values (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\`   VARCHAR(100) NOT NULL,
      \`value\` TEXT NOT NULL,
      \`ord\`   INT NULL DEFAULT 0,
      \`active\` TINYINT(1) NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_key(\`key\`, \`ord\`),
      INDEX idx_active(\`active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function creditAvailability(invoiceId, { excludeNoteId = null } = {}) {
  // Totales facturados por tasa
  const [invItems] = await pool.query(
    'SELECT subtotal, tax_rate FROM invoice_items WHERE invoice_id = ?',
    [invoiceId]
  );
  const facturado = breakdownByRate(invItems);

  // Totales ya acreditados (notas no anuladas)
  const params = [invoiceId];
  let noteFilter = '';
  if (excludeNoteId) {
    noteFilter = ' AND cn.id <> ?';
    params.push(excludeNoteId);
  }
  const [cnItems] = await pool.query(
    `
    SELECT cni.subtotal, cni.tax_rate
      FROM credit_note_items cni
      JOIN credit_notes cn ON cn.id = cni.credit_note_id
     WHERE cn.invoice_id = ?
       AND cn.status <> 'anulada'
       ${noteFilter}
    `,
    params
  );
  const acreditado = breakdownByRate(cnItems);

  const disponible = {
    base0: Math.max(0, Number((facturado.base0 - acreditado.base0).toFixed(2))),
    base5: Math.max(0, Number((facturado.base5 - acreditado.base5).toFixed(2))),
    base10: Math.max(0, Number((facturado.base10 - acreditado.base10).toFixed(2))),
  };

  return { facturado, acreditado, disponible };
}

async function ensureCreditNoteTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_notes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      credit_note_number VARCHAR(64) NOT NULL,
      invoice_id INT NOT NULL,
      issue_date DATE NULL,
      status ENUM('borrador','emitida','anulada') NOT NULL DEFAULT 'borrador',
      reason VARCHAR(255) NULL,
      subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
      tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      balance DECIMAL(15,2) NOT NULL DEFAULT 0,
      credit_type VARCHAR(20) NULL,
      mode VARCHAR(20) NULL,
      apply_mode VARCHAR(20) NULL,
      observations TEXT NULL,
      created_by INT NULL,
      issued_by INT NULL,
      point_of_issue VARCHAR(8) NULL,
      establishment VARCHAR(8) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Garantiza columnas nuevas si la tabla ya existía
  const alters = [
    "ALTER TABLE credit_notes ADD COLUMN point_of_issue VARCHAR(8) NULL",
    "ALTER TABLE credit_notes ADD COLUMN establishment VARCHAR(8) NULL",
    "ALTER TABLE credit_notes ADD COLUMN credit_type VARCHAR(20) NULL",
    "ALTER TABLE credit_notes ADD COLUMN mode VARCHAR(20) NULL",
    "ALTER TABLE credit_notes ADD COLUMN apply_mode VARCHAR(20) NULL",
    "ALTER TABLE credit_notes ADD COLUMN observations TEXT NULL",
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (err) {
      if (err?.code !== 'ER_DUP_FIELDNAME') {
        // Si es otro error, lo propagamos
        throw err;
      }
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_note_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      credit_note_id INT NOT NULL,
      description VARCHAR(255) NOT NULL,
      quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
      unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
      subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
      tax_rate DECIMAL(5,2) NULL,
      item_order INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_note_sequence (
      id INT PRIMARY KEY,
      prefix VARCHAR(16) NOT NULL DEFAULT 'NC',
      year INT NOT NULL,
      last_number INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(
    `INSERT IGNORE INTO credit_note_sequence (id, prefix, year, last_number)
     VALUES (1, 'NC', YEAR(CURDATE()), 0);`
  );
}

async function generateCreditNoteNumber(forcePoint, forceEst) {
  await ensureCreditNoteTables();
  const defaultExp = '001-004'; // fallback general único
  let expRaw = defaultExp;
  try {
    expRaw =
      (await getParamValue('credit_exp', pool))?.value ||
      (await getParamValue('credit_exp_industrial', pool))?.value ||
      (await getParamValue('credit_exp_cargo', pool))?.value ||
      defaultExp;
  } catch (_) {
    expRaw = defaultExp;
  }
  let { point, establishment } = parseExpedition(expRaw, {
    point: defaultExp.split('-')[0] || '001',
    establishment: defaultExp.split('-')[1] || '004',
  });

  // Forzar punto/establecimiento desde la factura si llega
  if (forcePoint && String(forcePoint).trim()) point = String(forcePoint).padStart(3, '0');
  if (forceEst && String(forceEst).trim()) establishment = String(forceEst).padStart(3, '0');

  // último correlativo registrado
  const lastSeq =
    (await fetchLastSeq(point, establishment, pool, 'credit_note_number', 'credit_notes')) || 0;

  // correlativo desde params
  let next = lastSeq + 1;
  try {
    const paramVal =
      parseInt((await getParamValue('credit_next_number', pool))?.value || 'NaN', 10);
    if (Number.isFinite(paramVal)) next = Math.max(next, paramVal);
  } catch (_) {
    next = lastSeq + 1;
  }
  if (!Number.isFinite(next) || next < lastSeq + 1) next = lastSeq + 1;

  const creditNoteNumber = `${point}-${establishment}-${String(next).padStart(7, '0')}`;
  try {
    await upsertParam('credit_next_number', String(next + 1), pool);
  } catch (_) {}
  return { creditNoteNumber, point, establishment };
}

async function getParamValue(key, conn = pool) {
  try {
    await ensureParamValuesTable();
    const [[rowPV]] = await conn.query(
      `SELECT id, value FROM param_values WHERE \`key\` = ? AND (active IS NULL OR active <> 0) ORDER BY ord LIMIT 1`,
      [key]
    );
    if (rowPV) return { id: rowPV.id, value: rowPV.value, table: 'param_values' };
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
  try {
    await ensureParamsTable();
    const [[row]] = await conn.query(
      `SELECT id, value FROM params WHERE \`key\` = ? AND (active IS NULL OR active <> 0) ORDER BY ord LIMIT 1`,
      [key]
    );
    return row ? { id: row.id, value: row.value, table: 'params' } : null;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return null;
    throw err;
  }
}

async function upsertParam(key, value, conn = pool) {
  try {
    await ensureParamValuesTable();
    const existing = await getParamValue(key, conn);
    if (existing?.id) {
      const table = existing.table === 'params' ? 'params' : 'param_values';
      await conn.query(`UPDATE ${table} SET value = ? WHERE id = ?`, [value, existing.id]);
      return existing.id;
    }
    const [res] = await conn.query(
      `INSERT INTO param_values (\`key\`, value, ord, active) VALUES (?, ?, 0, 1)`,
      [key, value]
    );
    return res.insertId;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      // Si no existe la tabla params, simplemente no persiste
      return null;
    }
    throw err;
  }
}

function extractSeqFromNumber(num = '') {
  const m = String(num).match(/^\d{3}-\d{3}-(\d{1,7})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

async function fetchLastSeq(point, establishment, conn = pool, numberField = 'invoice_number', table = 'invoices') {
  try {
    const [[row]] = await conn.query(
      `SELECT ${numberField} 
       FROM ${table} 
       WHERE point_of_issue = ? AND establishment = ?
       ORDER BY id DESC LIMIT 1`,
      [point, establishment]
    );
    const val = row?.[numberField];
    if (!val) return null;
    return extractSeqFromNumber(val);
  } catch (_) {
    return null;
  }
}

function parseExpedition(raw = '', fallback = { point: '001', establishment: '000' }) {
  const matches = String(raw).match(/\d+/g) || [];
  const point = (matches[0] || fallback.point || '001').padStart(3, '0');
  const establishment = (matches[1] || fallback.establishment || '000').padStart(3, '0');
  return { point, establishment };
}

async function peekInvoiceDefaults({ buKey = '', pipelineName = '' } = {}, conn = pool) {
  const isIndustrial = isIndustrialContext({ buKey, pipelineName });
  const expKey = isIndustrial ? 'invoice_exp_industrial' : 'invoice_exp_cargo';
  const sharedNumKey = 'invoice_next_number';
  const legacyNumKey = isIndustrial
    ? 'invoice_next_number_industrial'
    : 'invoice_next_number_cargo';

  const timbKey = 'invoice_timbre_number';
  const vigFromKey = 'invoice_timbre_valid_from';
  const vigToKey = 'invoice_timbre_valid_to';

  const defaultExp = isIndustrial ? '001-005' : '001-004';
  let expRaw = defaultExp;
  try {
    expRaw = (await getParamValue(expKey, conn))?.value || defaultExp;
  } catch (_) {
    expRaw = defaultExp;
  }
  const { point, establishment } = parseExpedition(expRaw, {
    point: defaultExp.split('-')[0] || '001',
    establishment: defaultExp.split('-')[1] || '000',
  });
  const lastSeq = (await fetchLastSeq(point, establishment, conn)) || 0;
  let next = lastSeq + 1;
  try {
    const paramVal =
      parseInt((await getParamValue(sharedNumKey, conn))?.value || 'NaN', 10);
    const legacyVal =
      parseInt((await getParamValue(legacyNumKey, conn))?.value || 'NaN', 10);
    const chosen =
      Number.isFinite(paramVal) ? paramVal : Number.isFinite(legacyVal) ? legacyVal : NaN;
    if (Number.isFinite(chosen)) next = Math.max(next, chosen);
  } catch (_) {
    next = lastSeq + 1;
  }
  if (!Number.isFinite(next) || next < lastSeq + 1) next = lastSeq + 1;

  const invoice_number = `${point}-${establishment}-${String(next).padStart(7, '0')}`;

  return {
    invoice_number,
    point_of_issue: point,
    establishment,
    timbrado_number: (await getParamValue(timbKey, conn))?.value || '',
    timbrado_start_date: (await getParamValue(vigFromKey, conn))?.value || '',
    timbrado_expires_at: (await getParamValue(vigToKey, conn))?.value || '',
  };
}

async function nextInvoiceNumber(buKey = '', conn) {
  const isIndustrial = isIndustrialContext({ buKey });
  const expKey = isIndustrial ? 'invoice_exp_industrial' : 'invoice_exp_cargo';
  const sharedNumKey = 'invoice_next_number';
  const legacyNumKey = isIndustrial
    ? 'invoice_next_number_industrial'
    : 'invoice_next_number_cargo';

  const defaultExp = isIndustrial ? '001-005' : '001-004';
  const expRaw = (await getParamValue(expKey, conn))?.value || defaultExp;
  const { point, establishment } = parseExpedition(expRaw, {
    point: defaultExp.split('-')[0] || '001',
    establishment: defaultExp.split('-')[1] || '000',
  });

  const lastSeq = (await fetchLastSeq(point, establishment, conn)) || 0;
  let next = lastSeq + 1;
  try {
    const paramVal =
      parseInt((await getParamValue(sharedNumKey, conn))?.value || 'NaN', 10);
    const legacyVal =
      parseInt((await getParamValue(legacyNumKey, conn))?.value || 'NaN', 10);
    const chosen =
      Number.isFinite(paramVal) ? paramVal : Number.isFinite(legacyVal) ? legacyVal : NaN;
    if (Number.isFinite(chosen)) next = Math.max(next, chosen);
  } catch (_) {
    next = lastSeq + 1;
  }
  if (!Number.isFinite(next) || next < lastSeq + 1) next = lastSeq + 1;

  const invoice_number = `${point}-${establishment}-${String(next).padStart(7, '0')}`;
  try {
    await upsertParam(sharedNumKey, String(next + 1), conn);
  } catch (_) {}

  return { invoice_number, point_of_issue: point, establishment };
}

async function recomputeInvoiceCredits(invoiceId) {
  await ensureInvoiceCreditColumns();
  const [[invoice]] = await pool.query('SELECT id, total_amount, balance FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) return;
  const [[agg]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) AS credited
     FROM credit_notes
     WHERE invoice_id = ? AND status != 'anulada'`,
    [invoiceId]
  );
  const credited = parseFloat(agg.credited || 0);
  const netTotal = Math.max(0, parseFloat(invoice.total_amount || 0) - credited);
  const netBalance = Math.max(0, parseFloat(invoice.balance || 0) - credited);
  await pool.query(
    `UPDATE invoices 
     SET credited_total = ?, net_total_amount = ?, net_balance = ?
     WHERE id = ?`,
    [credited.toFixed(2), netTotal.toFixed(2), netBalance.toFixed(2), invoiceId]
  );
}

async function generateInvoiceNumber() {
  await ensureInvoiceSequence();
  const [[seq]] = await pool.query(
    'SELECT last_number, prefix, year FROM invoice_sequence WHERE id = 1'
  );

  const currentYear = new Date().getFullYear();
  let nextNumber = seq.last_number + 1;

  if (currentYear !== seq.year) {
    nextNumber = 1;
    await pool.query(
      'UPDATE invoice_sequence SET year = ?, last_number = 0 WHERE id = 1',
      [currentYear]
    );
  }

  await pool.query(
    'UPDATE invoice_sequence SET last_number = ? WHERE id = 1',
    [nextNumber]
  );

  return `${seq.prefix}-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
}

function calculateTotals(items) {
  const subtotal = items.reduce((sum, item) => sum + parseFloat(item.subtotal || 0), 0);
  const taxAmount = items.reduce((sum, item) => {
    const rate = parseFloat(item.tax_rate ?? 10) || 0;
    return sum + (parseFloat(item.subtotal || 0) * rate) / 100;
  }, 0);
  const total = subtotal + taxAmount;
  return {
    subtotal: subtotal.toFixed(2),
    tax_amount: taxAmount.toFixed(2),
    total_amount: total.toFixed(2),
  };
}

function breakdownByRate(items) {
  const acc = {
    base0: 0,
    base5: 0,
    base10: 0,
    iva5: 0,
    iva10: 0,
  };
  (items || []).forEach((it) => {
    const rate = parseFloat(it.tax_rate ?? 10) || 0;
    const base = parseFloat(it.subtotal || 0) || 0;
    if (rate < 1) {
      acc.base0 += base;
    } else if (rate < 9) {
      acc.base5 += base;
      acc.iva5 += (base * rate) / 100;
    } else {
      acc.base10 += base;
      acc.iva10 += (base * rate) / 100;
    }
  });
  return {
    base0: Number(acc.base0.toFixed(2)),
    base5: Number(acc.base5.toFixed(2)),
    base10: Number(acc.base10.toFixed(2)),
    iva5: Number(acc.iva5.toFixed(2)),
    iva10: Number(acc.iva10.toFixed(2)),
    total: Number((acc.base0 + acc.base5 + acc.base10 + acc.iva5 + acc.iva10).toFixed(2)),
  };
}

function formatCurrency(value) {
  const num = Number(value || 0);
  return `USD ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  if (!date) return '';
  try {
    const d = new Date(date);
    const day = `${d.getDate()}`.padStart(2, '0');
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (_e) {
    return '';
  }
}

async function getDealInfo(dealId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT bu.key_slug AS business_unit_key, d.pipeline_id, p.name AS pipeline_name
     FROM deals d
     LEFT JOIN business_units bu ON bu.id = d.business_unit_id
     LEFT JOIN pipelines p ON p.id = d.pipeline_id
     WHERE d.id = ? LIMIT 1`,
    [dealId]
  );
  return {
    business_unit_key: row?.business_unit_key || '',
    pipeline_id: row?.pipeline_id || null,
    pipeline_name: row?.pipeline_name || '',
  };
}

function isIndustrialContext({ buKey = '', pipelineName = '' } = {}) {
  const bu = String(buKey || '').toLowerCase();
  const pipe = String(pipelineName || '').toLowerCase();
  return (
    bu === 'atm-industrial' ||
    bu === 'industrial-rayflex' ||
    bu === 'industrial-boplan' ||
    bu.includes('industrial') ||
    pipe.includes('industrial')
  );
}

function canManageInvoice(user, invoice) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin') return true;
  if (role === 'finanzas') return true;
  if (role === 'ejecutivo' && invoice.status === 'borrador') {
    return Number(user.id) === Number(invoice.created_by);
  }
  return false;
}

function extractCostItems(rawData = {}) {
  if (!rawData) return [];
  if (Array.isArray(rawData)) return rawData;
  if (Array.isArray(rawData.items)) return rawData.items;

  if (rawData.data) {
    const nested = extractCostItems(rawData.data);
    if (nested.length) return nested;
  }

  const header = rawData.header || {};
  const collected = [];
  const addRows = (rows = [], fallbackDesc) => {
    rows.forEach((r) => {
      const desc = r.concepto || r.service || r.servicio || fallbackDesc;
      const qty = parseFloat(r.cantidad ?? r.quantity ?? 1) || 1;
      let price =
        parseFloat(r.total ?? r.usd ?? r.usdXKg ?? r.unit_price ?? r.price ?? r.unitPrice ?? 0) || 0;
      if (!price && r.gs && header.gsRate) {
        price = parseFloat(r.gs) / (parseFloat(header.gsRate) || 1);
      }
      collected.push({ description: desc || 'Servicio', quantity: qty, unit_price: price });
    });
  };
  if (Array.isArray(rawData.ventaRows)) addRows(rawData.ventaRows, 'Servicio');
  if (Array.isArray(rawData.locCliRows)) addRows(rawData.locCliRows, 'Gasto local');
  if (Array.isArray(rawData.segVentaRows)) addRows(rawData.segVentaRows, 'Seguro');
  if (collected.length) return collected;

  if (Array.isArray(rawData.sections)) {
    const items = rawData.sections.flatMap((sec) =>
      Array.isArray(sec.items) ? sec.items : []
    );
    if (items.length) return items;
  }

  for (const key of ['lines', 'rows', 'concepts']) {
    if (Array.isArray(rawData[key])) return rawData[key];
  }

  if (rawData.items && typeof rawData.items === 'object') {
    const values = Object.values(rawData.items).filter(Boolean);
    if (values.length) return values;
  }

  const deepItems = [];
  const visit = (val) => {
    if (!val) return;
    if (Array.isArray(val)) {
      const candidates = val.filter(
        (it) =>
          it &&
          typeof it === 'object' &&
          (it.description || it.name) &&
          (it.unit_price != null || it.price != null || it.unitPrice != null)
      );
      if (candidates.length) {
        deepItems.push(...candidates);
        return;
      }
      val.forEach(visit);
      return;
    }
    if (typeof val === 'object') {
      Object.values(val).forEach(visit);
    }
  };
  visit(rawData);
  if (deepItems.length) return deepItems;

  return [];
}

// =================== ENDPOINTS ===================

// GET /api/invoices/defaults?deal_id=#
router.get('/defaults', requireAuth, async (req, res) => {
  try {
    const { deal_id } = req.query;
    let buKey = '';
    let pipelineId = null;
    let pipelineName = '';
    if (deal_id) {
      const info = await getDealInfo(deal_id);
      buKey = info.business_unit_key || '';
      pipelineId = info.pipeline_id || null;
      pipelineName = info.pipeline_name || '';
    }
    const isIndustrial = isIndustrialContext({ buKey, pipelineName }) || pipelineId === 1;
    const defaults = await peekInvoiceDefaults({ buKey: isIndustrial ? (buKey || 'atm-industrial') : buKey, pipelineName });
    res.json({ ...defaults, business_unit_key: buKey || null, pipeline_id: pipelineId, is_industrial: isIndustrial });
  } catch (e) {
    console.error('[invoices] Error getting defaults:', e);
    res.status(500).json({ error: 'No se pudieron obtener los valores por defecto' });
  }
});

// GET /api/invoices
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, organization_id, from_date, to_date, search } = req.query;
    const userId = req.user.id;
    const userRole = String(req.user.role || '').toLowerCase();

    let query = `
      SELECT 
        i.*, 
        o.name as organization_name,
        d.title as deal_title,
        d.reference as deal_reference,
        u.name as created_by_name
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN users u ON u.id = i.created_by
      WHERE 1=1
    `;
    const params = [];

    if (userRole === 'ejecutivo') {
      query += ' AND i.created_by = ?';
      params.push(userId);
    }
    if (status) { query += ' AND i.status = ?'; params.push(status); }
    if (organization_id) { query += ' AND i.organization_id = ?'; params.push(organization_id); }
    if (from_date) { query += ' AND i.issue_date >= ?'; params.push(from_date); }
    if (to_date) { query += ' AND i.issue_date <= ?'; params.push(to_date); }
    if (search) {
      query += ' AND (i.invoice_number LIKE ? OR o.name LIKE ? OR d.reference LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY i.created_at DESC';
    const [invoices] = await pool.query(query, params);
    res.json(invoices);
  } catch (e) {
    console.error('[invoices] Error listing:', e);
    res.status(500).json({ error: 'Error al listar facturas' });
  }
});

// GET /api/invoices/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[invoice]] = await pool.query(
      `SELECT 
        i.*, 
        o.name as organization_name,
        o.ruc as organization_ruc,
        o.address as organization_address,
        o.city as organization_city,
        d.id as deal_id,
        d.title as deal_title,
        d.reference as deal_reference,
        u.name as created_by_name,
        u2.name as issued_by_name
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN users u ON u.id = i.created_by
      LEFT JOIN users u2 ON u2.id = i.issued_by
      WHERE i.id = ?`,
      [id]
    );

    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (!canManageInvoice(req.user, invoice)) {
      return res.status(403).json({ error: 'No tienes permiso para ver esta factura' });
    }

    const [items] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY item_order, id',
      [id]
    );

    res.json({ ...invoice, items });
  } catch (e) {
    console.error('[invoices] Error fetching invoice:', e);
    res.status(500).json({ error: 'Error al obtener factura' });
  }
});

// GET /api/invoices/:id/pdf - Generar PDF usando plantilla PDFKit
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[invoice]] = await pool.query(
      `SELECT 
        i.*, 
        o.name as organization_name,
        o.ruc as organization_ruc,
        o.address as organization_address,
        o.city as organization_city,
        d.reference as deal_reference,
        d.title as deal_title
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      WHERE i.id = ?`,
      [id]
    );
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (!canManageInvoice(req.user, invoice)) {
      return res.status(403).json({ error: 'No tienes permiso para ver esta factura' });
    }

    const [items] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY item_order, id',
      [id]
    );

    const issuer = {
      name: process.env.INVOICE_ISSUER_NAME || 'ATM CARGO S.R.L.',
      ruc: process.env.INVOICE_ISSUER_RUC || '80056841-6',
      phone: process.env.INVOICE_ISSUER_PHONE || '+595 21 493082',
      address:
        process.env.INVOICE_ISSUER_ADDRESS || 'Cap. Milciades Urbieta 175 e/ Rio de Janeiro y Mcal. Lopez',
      city: process.env.INVOICE_ISSUER_CITY || 'Asuncion - Paraguay',
      timbrado: invoice.timbrado_number || process.env.INVOICE_TIMBRADO_NUMBER || '',
      timbrado_start: formatDate(invoice.timbrado_start_date || process.env.INVOICE_TIMBRADO_START),
      timbrado_end: formatDate(invoice.timbrado_expires_at || process.env.INVOICE_TIMBRADO_END),
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="invoice-${invoice.invoice_number || id}.pdf"`
    );

    const issueDate = invoice.issue_date ? new Date(invoice.issue_date) : new Date();
    const data = {
      issuer: {
        name: issuer.name,
        address: issuer.address,
        phone: issuer.phone,
        city: issuer.city,
        activities:
          process.env.INVOICE_ISSUER_ACTIVITIES ||
          'Transporte terrestre / aereo / acuatico y actividades auxiliares',
        ruc: issuer.ruc,
        timbrado: issuer.timbrado,
        timbrado_start: issuer.timbrado_start,
        timbrado_end: issuer.timbrado_end,
      },
      invoiceNumber: invoice.invoice_number || '',
      fechaEmision: formatDate(issueDate),
      hora: new Date().toLocaleTimeString('es-PY', { hour12: false }),
      client: {
        name: invoice.customer_name || invoice.organization_name || '',
        address: invoice.customer_address || invoice.organization_address || '',
        phone: invoice.customer_phone || invoice.organization_phone || '',
        email: invoice.customer_email || '',
        ruc: invoice.customer_doc || invoice.organization_ruc || '',
      },
      condicionVenta: invoice.payment_condition || 'credito',
      moneda: invoice.currency_code || 'USD',
      refNumero: invoice.deal_reference || invoice.deal_id || '',
      refDetalle: invoice.deal_title || '',
      items: items.map((it) => ({
        description: it.description || 'Item',
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0),
        tax_rate: Number(it.tax_rate ?? 0),
      })),
      totalEnLetras: invoice.total_in_words || '',
      notes: invoice.notes || '',
    };

    await generateInvoicePDF(data, res);
  } catch (e) {
    console.error('[invoices] Error generating PDF:', e);
    res.status(500).json({ error: 'Error al generar PDF' });
  }
});
// =================== CREDIT NOTES ===================
async function loadInvoiceWithPerms(req, invoiceId) {
  const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) return { invoice: null, error: { code: 404, msg: 'Factura no encontrada' } };
  if (!canManageInvoice(req.user, invoice)) {
    return { invoice: null, error: { code: 403, msg: 'No tienes permiso sobre esta factura' } };
  }
  return { invoice };
}

router.get('/:id/credit-notes', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureCreditNoteTables();
    await ensureInvoiceCreditColumns();
    const { invoice, error } = await loadInvoiceWithPerms(req, id);
    if (error) return res.status(error.code).json({ error: error.msg });

    const [notes] = await pool.query(
      `SELECT cn.*, u.name as created_by_name, u2.name as issued_by_name
       FROM credit_notes cn
       LEFT JOIN users u ON u.id = cn.created_by
       LEFT JOIN users u2 ON u2.id = cn.issued_by
       WHERE cn.invoice_id = ?
       ORDER BY cn.created_at DESC`,
      [id]
    );
    res.json(notes);
  } catch (e) {
    console.error('[credit-notes] Error listing:', e);
    res.status(500).json({ error: 'Error al listar notas de crédito' });
  }
});

router.get('/credit-notes/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureCreditNoteTables();
    await ensureInvoiceCreditColumns();
    const [[note]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Nota de crédito no encontrada' });

    const { invoice, error } = await loadInvoiceWithPerms(req, note.invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });

    const [items] = await pool.query(
      'SELECT * FROM credit_note_items WHERE credit_note_id = ? ORDER BY item_order, id',
      [id]
    );
    res.json({ ...note, items, invoice });
  } catch (e) {
    console.error('[credit-notes] Error getting detail:', e);
    res.status(500).json({ error: 'Error al obtener nota de crédito' });
  }
});

router.post('/credit-notes', requireAuth, async (req, res) => {
  try {
    const {
      invoice_id,
      reason,
      items: payloadItems,
      mode: payloadMode,
      global_amounts,
      credit_type,
      apply_mode,
      observations,
    } = req.body;
    if (!invoice_id) return res.status(400).json({ error: 'invoice_id es requerido' });

    await ensureCreditNoteTables();
    await ensureInvoiceItemsTaxColumn();
    await ensureInvoiceCreditColumns();

    const { invoice, error } = await loadInvoiceWithPerms(req, invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });
    if (['borrador', 'anulada'].includes(invoice.status)) {
      return res.status(400).json({ error: 'Solo se puede crear nota de crédito sobre facturas emitidas' });
    }

    const items = Array.isArray(payloadItems) ? payloadItems : null;
    const mode = ['items', 'global'].includes(String(payloadMode || '').toLowerCase())
      ? String(payloadMode).toLowerCase()
      : items && items.length > 0
      ? 'items'
      : 'global';

    let creditItems = [];
    if (mode === 'global') {
      const ga = global_amounts || {};
      const rows = [
        { rate: 0, base: parseFloat(ga.exentas || ga.base0 || 0) || 0, label: 'Exentas' },
        { rate: 5, base: parseFloat(ga.base5 || ga.gravado5 || 0) || 0, label: 'IVA 5%' },
        { rate: 10, base: parseFloat(ga.base10 || ga.gravado10 || 0) || 0, label: 'IVA 10%' },
      ];
      creditItems = rows
        .filter((r) => r.base > 0)
        .map((r, idx) => ({
          description: r.label,
          quantity: 1,
          unit_price: Number(r.base.toFixed(2)),
          subtotal: Number(r.base.toFixed(2)),
          tax_rate: r.rate,
          item_order: idx,
        }));
    } else if (items && items.length > 0) {
      creditItems = items.map((it, idx) => {
        const qty = parseFloat(it.quantity || it.qty || 1) || 1;
        const price = parseFloat(it.unit_price || it.price || 0) || 0;
        const subtotal = parseFloat((qty * price).toFixed(2));
        const rate = parseFloat(it.tax_rate ?? it.rate ?? 10) || 0;
        return {
          description: it.description || 'Item',
          quantity: qty,
          unit_price: price,
          subtotal,
          tax_rate: rate,
          item_order: it.item_order ?? idx,
        };
      });
    } else {
      const [invItems] = await pool.query(
        'SELECT description, quantity, unit_price, subtotal, tax_rate, item_order FROM invoice_items WHERE invoice_id = ? ORDER BY item_order, id',
        [invoice_id]
      );
      creditItems = invItems.map((it, idx) => ({
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        subtotal: it.subtotal,
        tax_rate: it.tax_rate ?? 10,
        item_order: it.item_order ?? idx,
      }));
    }

    if (creditItems.length === 0) {
      return res.status(400).json({ error: 'La nota de crédito debe tener al menos un ítem' });
    }

    const totals = calculateTotals(creditItems);
    const breakdown = breakdownByRate(creditItems);
    const availability = await creditAvailability(invoice.id);
    if (breakdown.base10 > availability.disponible.base10 + 0.01) {
      return res
        .status(400)
        .json({ error: `Excede lo disponible en 10% (disp: ${availability.disponible.base10})` });
    }
    if (breakdown.base5 > availability.disponible.base5 + 0.01) {
      return res
        .status(400)
        .json({ error: `Excede lo disponible en 5% (disp: ${availability.disponible.base5})` });
    }
    if (breakdown.base0 > availability.disponible.base0 + 0.01) {
      return res
        .status(400)
        .json({ error: `Excede lo disponible exentas (disp: ${availability.disponible.base0})` });
    }

    const { creditNoteNumber, point, establishment } = await generateCreditNoteNumber(
      invoice.point_of_issue,
      invoice.establishment
    );
    const [result] = await pool.query(
      `INSERT INTO credit_notes 
       (credit_note_number, invoice_id, issue_date, status, reason, subtotal, tax_amount, total_amount, balance, created_by, point_of_issue, establishment, credit_type, mode, apply_mode, observations)
       VALUES (?, ?, NULL, 'borrador', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        creditNoteNumber,
        invoice_id,
        reason || null,
        totals.subtotal,
        totals.tax_amount,
        totals.total_amount,
        totals.total_amount,
        req.user.id,
        point,
        establishment,
        credit_type || null,
        mode,
        apply_mode || null,
        observations || null,
      ]
    );
    const creditId = result.insertId;
    for (let i = 0; i < creditItems.length; i++) {
      const it = creditItems[i];
      await pool.query(
        `INSERT INTO credit_note_items 
         (credit_note_id, description, quantity, unit_price, subtotal, tax_rate, item_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [creditId, it.description, it.quantity, it.unit_price, it.subtotal, it.tax_rate ?? 10, it.item_order]
      );
    }

    res.status(201).json({ id: creditId, credit_note_number: creditNoteNumber, status: 'borrador' });
  } catch (e) {
    console.error('[credit-notes] Error creating:', e);
    res.status(500).json({ error: 'Error al crear nota de crédito' });
  }
});

router.post('/credit-notes/:id/issue', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureCreditNoteTables();
    await ensureInvoiceCreditColumns();
    const [[note]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Nota de crédito no encontrada' });
    if (note.status !== 'borrador') return res.status(400).json({ error: 'Solo se puede emitir desde borrador' });

    const { invoice, error } = await loadInvoiceWithPerms(req, note.invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });

    await pool.query(
      `UPDATE credit_notes 
       SET status = 'emitida', issue_date = CURDATE(), issued_by = ?
       WHERE id = ?`,
      [req.user.id, id]
    );

    // Recalcular crédito aplicado y estado de la factura (ajustada/anulada)
    await recomputeInvoiceCredits(invoice.id);
    const [[invAfter]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoice.id]);

    if (parseFloat(invAfter.net_total_amount || 0) <= 0.01) {
      await pool.query(
        `UPDATE invoices 
         SET status = 'anulada',
             cancellation_reason = ?,
             canceled_by_credit_note_id = ?
         WHERE id = ?`,
        [`Anulada por nota de crédito ${note.credit_note_number}`, id, invoice.id]
      );
    } else {
      await pool.query(
        `UPDATE invoices 
         SET status = 'ajustada'
         WHERE id = ?`,
        [invoice.id]
      );
    }
    await recomputeInvoiceCredits(invoice.id);
    const [[updated]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[credit-notes] Error issuing:', e);
    res.status(500).json({ error: 'Error al emitir nota de crédito' });
  }
});

router.post('/credit-notes/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureCreditNoteTables();
    await ensureInvoiceCreditColumns();
    const [[note]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Nota de crédito no encontrada' });
    if (note.status === 'anulada') return res.status(400).json({ error: 'Ya está anulada' });

    const { invoice, error } = await loadInvoiceWithPerms(req, note.invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });

    await pool.query(`UPDATE credit_notes SET status = 'anulada' WHERE id = ?`, [id]);
    await recomputeInvoiceCredits(invoice.id);
    const [[updated]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[credit-notes] Error canceling:', e);
    res.status(500).json({ error: 'Error al anular nota de crédito' });
  }
});

export default router;







