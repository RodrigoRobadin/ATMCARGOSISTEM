// server/src/routes/invoices.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import PDFDocument from 'pdfkit';
import generateInvoicePDF from '../services/invoiceTemplatePdfkit.js';
import generateReceiptPDF from '../services/receiptTemplatePdfkit.js';
import { getBrandLogoPath } from '../services/brandingAssets.js';

const router = Router();

// Ensures (best-effort) for credit tables/columns on startup
ensureCreditNoteTables().catch((err) => console.error('init credit tables', err?.message));
ensureInvoiceCreditColumns().catch((err) => console.error('init credit cols', err?.message));
ensureReceiptTables().catch((err) => console.error('init receipts', err?.message));
ensureInvoiceMoneyColumns().catch((err) => console.error('init money cols', err?.message));
ensureInvoiceItemSourceColumns().catch((err) => console.error('init invoice item source cols', err?.message));

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
    "ALTER TABLE invoices ADD COLUMN service_case_id INT NULL",
    "ALTER TABLE invoices ADD COLUMN container_billing_cycle_id INT NULL",
    "ALTER TABLE invoices ADD COLUMN container_contract_id INT NULL",
    "ALTER TABLE invoices ADD COLUMN cost_sheet_version_number INT NULL",
    "ALTER TABLE invoices ADD COLUMN quote_revision_id INT NULL",
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

let invoiceItemSourceColumnsReady = false;
let invoiceItemSourceColumnsPromise = null;

async function ensureInvoiceItemSourceColumns() {
  if (invoiceItemSourceColumnsReady) return;
  if (invoiceItemSourceColumnsPromise) return invoiceItemSourceColumnsPromise;

  invoiceItemSourceColumnsPromise = (async () => {
    const columns = [
      { name: 'source_type', ddl: "ALTER TABLE invoice_items ADD COLUMN source_type VARCHAR(32) NULL" },
      { name: 'source_parent_id', ddl: "ALTER TABLE invoice_items ADD COLUMN source_parent_id INT NULL" },
      { name: 'source_item_key', ddl: "ALTER TABLE invoice_items ADD COLUMN source_item_key VARCHAR(64) NULL" },
    ];

    const [existingRows] = await pool.query(
      `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'invoice_items'
          AND COLUMN_NAME IN ('source_type','source_parent_id','source_item_key')`
    );
    const existing = new Set((existingRows || []).map((row) => String(row.COLUMN_NAME || '').toLowerCase()));

    for (const col of columns) {
      if (existing.has(col.name)) continue;
      try {
        await pool.query(col.ddl);
      } catch (err) {
        if (err?.code === 'ER_DUP_FIELDNAME') continue;
        if (err?.code === 'ER_LOCK_DEADLOCK' || err?.code === 'ER_LOCK_WAIT_TIMEOUT') {
          const [checkRows] = await pool.query(
            `SELECT COLUMN_NAME
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'invoice_items'
                AND COLUMN_NAME = ?
              LIMIT 1`,
            [col.name]
          );
          if (checkRows?.length) continue;
        }
        throw err;
      }
    }
    invoiceItemSourceColumnsReady = true;
  })();

  try {
    await invoiceItemSourceColumnsPromise;
  } finally {
    invoiceItemSourceColumnsPromise = null;
  }
}

function asJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function toSheetNumber(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}
function normalizeTaxRate(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['exento', 'exenta', 'exentas', 'exempt', 'sin iva'].includes(normalized)) return 0;
    if (normalized.includes('10')) return 10;
    if (normalized.includes('5')) return 5;
    const parsed = Number(normalized.replace('%', '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readTaxRate(row = {}, fallback = 0) {
  return normalizeTaxRate(
    row.tax_rate ?? row.taxRate ?? row.iva_rate ?? row.ivaRate ?? row.iva ?? row.tax ?? row.vat_rate ?? row.vatRate,
    fallback
  );
}

function firstPositiveSheetNumber(...values) {
  for (const value of values) {
    const num = toSheetNumber(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function readQuoteSellUnitPrice(item = {}, match = {}, qty = 1) {
  const quantity = Number(qty || 0) || 1;
  const direct = firstPositiveSheetNumber(
    item.unit_price,
    item.unitPrice,
    item.sale_unit_price,
    item.sale_unit_price_input,
    item.sale_price,
    item.sale_price_input,
    item.price,
    item.precio,
    match.unit_price,
    match.unitPrice,
    match.sale_unit_price,
    match.sale_unit_price_input,
    match.sale_price,
    match.sale_price_input,
    match.price,
    match.precio
  );
  if (direct > 0) return direct;

  const total = firstPositiveSheetNumber(
    item.total_sales,
    item.total_sales_gross,
    item.sale_total_input,
    item.total_sale,
    item.total_sell,
    item.total,
    match.total_sales,
    match.total_sales_gross,
    match.sale_total_input,
    match.total_sale,
    match.total_sell,
    match.total
  );
  return total > 0 ? total / quantity : 0;
}

async function fetchCostSheetInvoiceSnapshot(dealId, conn, versionNumber = null) {
  const requestedVersion = Number(versionNumber || 0) || null;
  let row = null;

  if (requestedVersion) {
    const [[versionRow]] = await conn.query(
      `SELECT id, version_number, revision_name, data
         FROM deal_cost_sheet_versions
        WHERE deal_id = ? AND version_number = ?
        LIMIT 1`,
      [dealId, requestedVersion]
    );
    row = versionRow || null;
  } else {
    const [[versionRow]] = await conn.query(
      `SELECT v.id, v.version_number, v.revision_name, v.data
         FROM deal_cost_sheets s
         INNER JOIN deal_cost_sheet_versions v ON v.id = s.current_version_id
        WHERE s.deal_id = ?
        LIMIT 1`,
      [dealId]
    );
    row = versionRow || null;
  }

  const data = asJson(row?.data);
  if (!data) return null;

  const header = data.header || {};
  const operationCurrency = String(header.operationCurrency || header.currency || 'USD').toUpperCase();
  const isPyg = operationCurrency === 'PYG' || operationCurrency === 'GS';
  const exchangeRate = isPyg ? (toSheetNumber(header.gsRate) || 1) : 1;
  const weightKg = toSheetNumber(header.pesoKg);
  const allInEnabled = !!header.allInEnabled;
  const allInServiceName = String(header.allInServiceName || '').trim();

  const saleRows = Array.isArray(data.ventaRows) ? data.ventaRows : [];
  const localClientRows = Array.isArray(data.locCliRows) ? data.locCliRows : [];
  const insuranceRows = Array.isArray(data.segVentaRows) ? data.segVentaRows : [];

  const valueToUsd = (amount) => {
    const value = Number(amount || 0) || 0;
    return isPyg && exchangeRate > 0 ? value / exchangeRate : value;
  };
  const rowSaleAmount = (row) => {
    const manualSale =
      row?.ventaInt !== '' && row?.ventaInt !== undefined && row?.ventaInt !== null
        ? toSheetNumber(row.ventaInt)
        : null;
    if (allInEnabled && manualSale !== null) return manualSale;
    if (row?.total !== '' && !row?.lockPerKg) return toSheetNumber(row.total);
    return toSheetNumber(row?.usdXKg) * weightKg;
  };

  const saleBaseTotal = saleRows.reduce((sum, row) => sum + rowSaleAmount(row), 0);
  let saleItems = [];
  if (allInEnabled && allInServiceName) {
    const target = allInServiceName.toLowerCase();
    const zeroItems = saleRows.map((row) => ({
      description: row?.concepto || 'Servicio',
      unit_price: 0,
      tax_rate: readTaxRate(row, 0),
    }));
    const hasTarget = zeroItems.some((item) => String(item.description || '').trim().toLowerCase() === target);
    saleItems = hasTarget
      ? zeroItems.map((item) =>
          String(item.description || '').trim().toLowerCase() === target
            ? { ...item, unit_price: valueToUsd(saleBaseTotal) }
            : item
        )
      : [
          ...zeroItems,
          { description: allInServiceName, unit_price: valueToUsd(saleBaseTotal), tax_rate: 10 },
        ];
  } else {
    saleItems = saleRows.map((row) => ({
      description: row?.concepto || 'Servicio',
      unit_price: valueToUsd(rowSaleAmount(row)),
      tax_rate: readTaxRate(row, 0),
    }));
  }

  const localItems = localClientRows.map((row) => ({
    description: row?.concepto || 'Gasto local',
    unit_price: valueToUsd(toSheetNumber(row?.gs)),
    tax_rate: readTaxRate(row, 0),
  }));

  const insuranceItems = insuranceRows.map((row) => ({
    description: row?.concepto || 'Seguro',
    unit_price: valueToUsd(toSheetNumber(row?.usd ?? row?.monto ?? 0)),
    tax_rate: readTaxRate(row, 10),
  }));

  const items = [...saleItems, ...localItems, ...insuranceItems]
    .filter((item) => String(item.description || '').trim() !== '')
    .map((item, idx) => ({
      description: item.description || 'Item',
      quantity: 1,
      unit_price: round2(item.unit_price),
      tax_rate: readTaxRate(item, 0),
      item_order: idx + 1,
      source_item_key: `deal_quote:${idx + 1}`,
      cost_sheet_version_number: row.version_number || null,
      cost_sheet_revision_name: row.revision_name || null,
    }));

  if (!items.length) return null;
  return {
    version_number: row.version_number || null,
    revision_name: row.revision_name || null,
    currency: operationCurrency || 'USD',
    exchange_rate: exchangeRate || 1,
    items,
    total_usd: round2(items.reduce((sum, item) => sum + Number(item.unit_price || 0), 0)),
  };
}
async function fetchDealQuoteJsonForInvoice(dealId, conn, quoteRevisionId = null) {
  const [[quote]] = await conn.query(
    'SELECT id, inputs_json, computed_json FROM quotes WHERE deal_id = ? LIMIT 1',
    [dealId]
  );
  if (!quote) return null;

  const revisionId = Number(quoteRevisionId || 0) || null;
  if (revisionId) {
    const [[rev]] = await conn.query(
      'SELECT inputs_json, computed_json FROM quote_revisions WHERE id = ? AND quote_id = ? LIMIT 1',
      [revisionId, quote.id]
    );
    if (rev) {
      return {
        inputs_json: rev.inputs_json,
        computed_json: rev.computed_json,
        quote_id: quote.id,
        quote_revision_id: revisionId,
      };
    }
  }

  return {
    inputs_json: quote.inputs_json,
    computed_json: quote.computed_json,
    quote_id: quote.id,
    quote_revision_id: null,
  };
}
async function fetchQuoteTotalUsd(dealId, conn, costSheetVersionNumber = null, quoteRevisionId = null) {
  const snapshot = quoteRevisionId ? null : await fetchCostSheetInvoiceSnapshot(dealId, conn, costSheetVersionNumber);
  if (snapshot) return snapshot.total_usd;
  const row = await fetchDealQuoteJsonForInvoice(dealId, conn, quoteRevisionId);
  if (!row?.computed_json) return null;
  const inputs = asJson(row.inputs_json) || {};
  const computed = asJson(row.computed_json);
  const rawTotal = (
    computed?.oferta?.totals?.total_sales_usd ??
    computed?.operacion?.totals?.total_sell_usd ??
    null
  );
  const currency = String(inputs.operation_currency || computed?.meta?.operation_currency || 'USD').toUpperCase();
  const exchangeRate = Number(
    inputs.exchange_rate_atm_gs_per_usd ||
    computed?.meta?.exchange_rate_atm_gs_per_usd ||
    inputs.exchange_rate_operation_sell_usd ||
    1
  ) || 1;
  return rawTotal == null ? null : normalizeAmountToUsd(rawTotal, currency, exchangeRate);
}

async function fetchServiceQuoteJsonForInvoice(serviceCaseId, conn, quoteRevisionId = null) {
  const [[quote]] = await conn.query(
    'SELECT id, inputs_json, computed_json FROM service_quotes WHERE service_case_id = ? ORDER BY id DESC LIMIT 1',
    [serviceCaseId]
  );
  if (!quote) return null;

  const revisionId = Number(quoteRevisionId || 0) || null;
  if (revisionId) {
    const [[rev]] = await conn.query(
      'SELECT inputs_json, computed_json FROM service_quote_revisions WHERE id = ? AND quote_id = ? LIMIT 1',
      [revisionId, quote.id]
    );
    if (rev) {
      return {
        inputs_json: rev.inputs_json,
        computed_json: rev.computed_json,
        quote_id: quote.id,
        quote_revision_id: revisionId,
      };
    }
  }

  return {
    inputs_json: quote.inputs_json,
    computed_json: quote.computed_json,
    quote_id: quote.id,
    quote_revision_id: null,
  };
}

async function fetchInvoiceLockStatus({ deal_id, service_case_id, cost_sheet_version_number, quote_revision_id }) {
  if (!deal_id && !service_case_id) return { locked: false, count: 0 };
  try {
    const where = ["status <> 'anulada'", 'COALESCE(net_total_amount, total_amount, 0) > 0.01'];
    const params = [];
    if (deal_id) {
      where.push('deal_id = ?');
      params.push(deal_id);
    } else {
      where.push('service_case_id = ?');
      params.push(service_case_id);
    }
    if (cost_sheet_version_number) {
      where.push('cost_sheet_version_number = ?');
      params.push(cost_sheet_version_number);
    }
    if (quote_revision_id) {
      where.push('quote_revision_id = ?');
      params.push(quote_revision_id);
    }
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS cnt
         FROM invoices
        WHERE ${where.join(' AND ')}`,
      params
    );
    const count = Number(row?.cnt || 0);
    return { locked: count > 0, count };
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      return { locked: false, count: 0 };
    }
    throw err;
  }
}
async function fetchServiceQuoteTotalUsd(serviceCaseId, conn, quoteRevisionId = null) {
  const row = await fetchServiceQuoteJsonForInvoice(serviceCaseId, conn, quoteRevisionId);
  if (!row?.computed_json) return null;
  const inputs = asJson(row.inputs_json) || {};
  const computed = asJson(row.computed_json);
  const rawTotal = (
    computed?.oferta?.totals?.total_sales_usd ??
    computed?.operacion?.totals?.total_sell_usd ??
    null
  );
  const currency = String(inputs.operation_currency || computed?.meta?.operation_currency || 'USD').toUpperCase();
  const exchangeRate = Number(
    inputs.exchange_rate_atm_gs_per_usd ||
    computed?.meta?.exchange_rate_atm_gs_per_usd ||
    inputs.exchange_rate_operation_sell_usd ||
    1
  ) || 1;
  return rawTotal == null ? null : normalizeAmountToUsd(rawTotal, currency, exchangeRate);
}

async function fetchServiceQuoteAdditionTotalUsd(additionId, conn) {
  const [[row]] = await conn.query(
    'SELECT inputs_json, computed_json FROM service_quote_additions WHERE id = ? LIMIT 1',
    [additionId]
  );
  if (!row?.computed_json) return null;
  const inputs = asJson(row.inputs_json) || {};
  const computed = asJson(row.computed_json);
  const rawTotal = (
    computed?.oferta?.totals?.total_sales_usd ??
    computed?.operacion?.totals?.total_sell_usd ??
    null
  );
  const currency = String(inputs.operation_currency || computed?.meta?.operation_currency || 'USD').toUpperCase();
  const exchangeRate = Number(
    inputs.exchange_rate_atm_gs_per_usd ||
    computed?.meta?.exchange_rate_atm_gs_per_usd ||
    inputs.exchange_rate_operation_sell_usd ||
    1
  ) || 1;
  return rawTotal == null ? null : normalizeAmountToUsd(rawTotal, currency, exchangeRate);
}

async function ensureInvoiceMoneyColumns() {
  const alters = [
    "ALTER TABLE invoices MODIFY COLUMN subtotal DECIMAL(18,2) NULL",
    "ALTER TABLE invoices MODIFY COLUMN tax_amount DECIMAL(18,2) NULL",
    "ALTER TABLE invoices MODIFY COLUMN total_amount DECIMAL(18,2) NULL",
    "ALTER TABLE invoices MODIFY COLUMN balance DECIMAL(18,2) NULL",
    "ALTER TABLE invoices MODIFY COLUMN paid_amount DECIMAL(18,2) NULL",
    "ALTER TABLE invoices MODIFY COLUMN base_amount DECIMAL(18,2) NULL",
    "ALTER TABLE invoices MODIFY COLUMN credited_total DECIMAL(18,2) NOT NULL DEFAULT 0",
    "ALTER TABLE invoices MODIFY COLUMN net_total_amount DECIMAL(18,2) NOT NULL DEFAULT 0",
    "ALTER TABLE invoices MODIFY COLUMN net_balance DECIMAL(18,2) NOT NULL DEFAULT 0",
    "ALTER TABLE invoice_items MODIFY COLUMN unit_price DECIMAL(18,2) NULL",
    "ALTER TABLE invoice_items MODIFY COLUMN subtotal DECIMAL(18,2) NULL",
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR' || err?.code === 'ER_PARSE_ERROR') continue;
      throw err;
    }
  }
}

async function fetchQuoteCurrencyInfo(dealId, conn, costSheetVersionNumber = null, quoteRevisionId = null) {
  const snapshot = quoteRevisionId ? null : await fetchCostSheetInvoiceSnapshot(dealId, conn, costSheetVersionNumber);
  if (snapshot) {
    return {
      currency: snapshot.currency || 'USD',
      exchange_rate: snapshot.exchange_rate || 1,
      cost_sheet_version_number: snapshot.version_number || null,
      cost_sheet_revision_name: snapshot.revision_name || null,
    };
  }

  const row = await fetchDealQuoteJsonForInvoice(dealId, conn, quoteRevisionId);
  if (!row?.inputs_json) return { currency: 'USD', exchange_rate: 1 };
  const inputs = asJson(row.inputs_json) || {};
  const currency = String(inputs.operation_currency || 'USD').toUpperCase();
  const exchange_rate = Number(inputs.exchange_rate_atm_gs_per_usd || inputs.exchange_rate_customs_internal_gs_per_usd || inputs.exchange_rate_install_gs_per_usd || inputs.exchange_rate_operation_sell_usd || 1) || 1;
  return { currency, exchange_rate };
}

async function fetchServiceQuoteCurrencyInfo(serviceCaseId, conn, quoteRevisionId = null) {
  const row = await fetchServiceQuoteJsonForInvoice(serviceCaseId, conn, quoteRevisionId);
  if (!row?.inputs_json) return { currency: 'USD', exchange_rate: 1 };
  const inputs = asJson(row.inputs_json) || {};
  const currency = String(inputs.operation_currency || 'USD').toUpperCase();
  const exchange_rate = Number(inputs.exchange_rate_atm_gs_per_usd || inputs.exchange_rate_customs_internal_gs_per_usd || inputs.exchange_rate_install_gs_per_usd || inputs.exchange_rate_operation_sell_usd || 1) || 1;
  return { currency, exchange_rate };
}

async function fetchServiceQuoteAdditionCurrencyInfo(additionId, conn) {
  const [[row]] = await conn.query(
    'SELECT inputs_json, service_case_id FROM service_quote_additions WHERE id = ? LIMIT 1',
    [additionId]
  );
  if (!row?.inputs_json) {
    if (row?.service_case_id) return fetchServiceQuoteCurrencyInfo(row.service_case_id, conn);
    return { currency: 'USD', exchange_rate: 1 };
  }
  const inputs = asJson(row.inputs_json) || {};
  const currencyRaw = inputs.operation_currency || '';
  const currency = String(currencyRaw || '').toUpperCase();
  const exchange_rate = Number(inputs.exchange_rate_atm_gs_per_usd || inputs.exchange_rate_customs_internal_gs_per_usd || inputs.exchange_rate_install_gs_per_usd || inputs.exchange_rate_operation_sell_usd || 0) || 0;
  if (!currency || exchange_rate === 0) {
    if (row?.service_case_id) return fetchServiceQuoteCurrencyInfo(row.service_case_id, conn);
  }
  return { currency: currency || 'USD', exchange_rate: exchange_rate || 1 };
}

async function fetchDealBranchInfo(dealId, conn) {
  try {
    const [[row]] = await conn.query(
      `
      SELECT d.org_branch_id, ob.name, ob.address, ob.city, ob.country
        FROM deals d
        LEFT JOIN org_branches ob ON ob.id = d.org_branch_id
       WHERE d.id = ?
       LIMIT 1
      `,
      [dealId]
    );
    if (!row?.org_branch_id) return null;
    return row;
  } catch {
    return null;
  }
}

async function fetchServiceCaseBranchInfo(serviceCaseId, conn) {
  try {
    const [[row]] = await conn.query(
      `
      SELECT sc.org_branch_id, ob.name, ob.address, ob.city, ob.country
        FROM service_cases sc
        LEFT JOIN org_branches ob ON ob.id = sc.org_branch_id
       WHERE sc.id = ?
       LIMIT 1
      `,
      [serviceCaseId]
    );
    if (!row?.org_branch_id) return null;
    return row;
  } catch {
    return null;
  }
}

async function fetchContainerBillingInfo(billingCycleId, conn) {
  const [[row]] = await conn.query(
    `
      SELECT
        bc.*,
        c.contract_no,
        c.id AS contract_id,
        d.id AS deal_id,
        d.org_id AS organization_id,
        d.reference,
        d.title,
        bu.key_slug AS business_unit_key,
        cu.container_no,
        cu.container_type
      FROM container_billing_cycles bc
      INNER JOIN container_contracts c ON c.id = bc.contract_id
      INNER JOIN deals d ON d.id = bc.deal_id
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN container_units cu ON cu.id = bc.container_unit_id
      WHERE bc.id = ?
      LIMIT 1
    `,
    [billingCycleId]
  );
  return row || null;
}

function round2(n) {
  return Number((Number(n || 0)).toFixed(2));
}

const PARAGUAY_TIME_ZONE = 'America/Asuncion';

function formatParaguayTime(value = new Date()) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toLocaleTimeString('es-PY', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: PARAGUAY_TIME_ZONE,
  });
}
function parsePercentageList(value) {
  return String(value || '')
    .split(',')
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function hasPercentage(list, percentage) {
  const pct = Number(percentage);
  return (list || []).some((item) => Math.abs(Number(item) - pct) < 0.0001);
}

function normalizeAmountToUsd(amount, currency, exchangeRate) {
  const value = Number(amount || 0) || 0;
  const code = String(currency || 'USD').toUpperCase();
  const rate = Number(exchangeRate || 0) || 0;
  if (code === 'PYG' || code === 'GS') {
    return rate > 0 ? value / rate : value;
  }
  return value;
}

function convertUsdToCurrency(amountUsd, currency, exchangeRate) {
  const value = Number(amountUsd || 0) || 0;
  const code = String(currency || 'USD').toUpperCase();
  const rate = Number(exchangeRate || 0) || 0;
  if (code === 'PYG' || code === 'GS') {
    return rate > 0 ? value * rate : value;
  }
  return value;
}

function startOfDay(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(dateLike, days) {
  const date = startOfDay(dateLike);
  if (!date) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

function addMonthsSafe(dateLike, months) {
  const date = startOfDay(dateLike);
  if (!date) return null;
  const target = new Date(date);
  const originalDay = target.getDate();
  target.setDate(1);
  target.setMonth(target.getMonth() + Number(months || 0));
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(originalDay, maxDay));
  return target;
}

function datesOverlap(startA, endA, startB, endB) {
  const a1 = startOfDay(startA);
  const a2 = startOfDay(endA);
  const b1 = startOfDay(startB);
  const b2 = startOfDay(endB);
  if (!a1 || !a2 || !b1 || !b2) return false;
  return a1 <= b2 && b1 <= a2;
}

function resolveSourceExchangeRate(currency, sourceExchangeRate, requestedExchangeRate) {
  const code = String(currency || 'USD').toUpperCase();
  if (code === 'PYG' || code === 'GS') {
    const sourceRate = Number(sourceExchangeRate || 0) || 0;
    const requestedRate = Number(requestedExchangeRate || 0) || 0;
    if (sourceRate > 1) return sourceRate;
    if (requestedRate > 1) return requestedRate;
  }
  return 1;
}

async function fetchContainerInitialInvoiceCoverage(contractId, dealId, conn) {
  const [[initialInvoice]] = await conn.query(
    `
      SELECT id, invoice_number, issue_date
      FROM invoices
      WHERE deal_id = ?
        AND container_billing_cycle_id IS NULL
        AND status <> 'anulada'
      ORDER BY issue_date ASC, id ASC
      LIMIT 1
    `,
    [dealId]
  );
  if (!initialInvoice?.id) return null;

  const [[contractRow]] = await conn.query(
    `
      SELECT c.effective_from, MIN(cu.delivered_at) AS first_delivered_at
      FROM container_contracts c
      LEFT JOIN container_contract_units ccu ON ccu.contract_id = c.id
      LEFT JOIN container_units cu ON cu.id = ccu.container_unit_id
      WHERE c.id = ?
      GROUP BY c.id, c.effective_from
      LIMIT 1
    `,
    [contractId]
  );

  const firstStart = startOfDay(contractRow?.first_delivered_at || contractRow?.effective_from);
  if (!firstStart) return null;
  const firstEnd = addDays(addMonthsSafe(firstStart, 1), -1);
  if (!firstEnd) return null;

  return {
    initial_invoice_id: Number(initialInvoice.id),
    initial_invoice_number: initialInvoice.invoice_number || null,
    period_start: firstStart,
    period_end: firstEnd,
  };
}

async function fetchQuoteItemsForInvoice(dealId, conn, costSheetVersionNumber = null, quoteRevisionId = null) {
  const snapshot = quoteRevisionId ? null : await fetchCostSheetInvoiceSnapshot(dealId, conn, costSheetVersionNumber);
  if (snapshot) return snapshot.items;

  const row = await fetchDealQuoteJsonForInvoice(dealId, conn, quoteRevisionId);
  if (!row) return [];
  const sourcePrefix = row.quote_revision_id ? 'deal_quote_revision:' + row.quote_revision_id : 'deal_quote';
  const inputs = asJson(row.inputs_json) || {};
  const computed = asJson(row.computed_json) || {};
  const inputItems = Array.isArray(inputs.items) ? inputs.items : [];
  const computedItems =
    computed?.oferta?.items ||
    computed?.items ||
    [];

  if (!Array.isArray(computedItems) || computedItems.length === 0) {
    // fallback a inputs si no hay computed
    return inputItems.map((it, idx) => {
      const qty = Number(it.qty || 0) || 1;
      const unitPrice = readQuoteSellUnitPrice(it, {}, qty) ||
        Number(it.door_value_usd || 0) + Number(it.additional_usd || 0);
      const rate = readTaxRate(it, 10);
      const itemOrder = it.item_order ?? it.line_no ?? idx;
      return {
        description: it.description || 'Item',
        quantity: qty,
        unit_price: unitPrice,
        tax_rate: rate,
        item_order: itemOrder,
        source_item_key: `${sourcePrefix}:${itemOrder}`,
      };
    });
  }

  return computedItems.map((it, idx) => {
    const match =
      inputItems.find((x) => Number(x.line_no ?? x.item_order ?? 0) === Number(it.line_no ?? it.item_order ?? 0)) ||
      inputItems[idx] ||
      {};
    const qty = Number(it.qty || match.qty || 0) || 1;
    const unitPrice = readQuoteSellUnitPrice(it, match, qty);
    const rate = readTaxRate(match, readTaxRate(it, 10));
    const itemOrder = it.item_order ?? it.line_no ?? idx;
    return {
      description: it.description || match.description || 'Item',
      quantity: qty,
      unit_price: unitPrice,
      tax_rate: rate,
      item_order: itemOrder,
      source_item_key: `${sourcePrefix}:${itemOrder}`,
    };
  });
}

async function fetchServiceQuoteItemsForInvoice(serviceCaseId, conn, quoteRevisionId = null) {
  const row = await fetchServiceQuoteJsonForInvoice(serviceCaseId, conn, quoteRevisionId);
  if (!row) return [];
  const inputs = asJson(row.inputs_json) || {};
  const computed = asJson(row.computed_json) || {};
  const inputItems = Array.isArray(inputs.items) ? inputs.items : [];
  const computedItems =
    computed?.oferta?.items ||
    computed?.items ||
    [];

  if (!Array.isArray(computedItems) || computedItems.length === 0) {
    return inputItems.map((it, idx) => {
      const qty = Number(it.qty || 0) || 1;
      const unitPrice = readQuoteSellUnitPrice(it, {}, qty) ||
        Number(it.door_value_usd || 0) + Number(it.additional_usd || 0);
      const rate = readTaxRate(it, 10);
      const itemOrder = it.item_order ?? it.line_no ?? idx;
      return {
        description: it.description || 'Item',
        quantity: qty,
        unit_price: unitPrice,
        tax_rate: rate,
        item_order: itemOrder,
        source_item_key: 'service_quote:' + itemOrder,
      };
    });
  }

  return computedItems.map((it, idx) => {
    const match =
      inputItems.find((x) => Number(x.line_no ?? x.item_order ?? 0) === Number(it.line_no ?? it.item_order ?? 0)) ||
      inputItems[idx] ||
      {};
    const qty = Number(it.qty || match.qty || 0) || 1;
    const unitPrice = readQuoteSellUnitPrice(it, match, qty);
    const rate = readTaxRate(match, readTaxRate(it, 10));
    const itemOrder = it.item_order ?? it.line_no ?? idx;
    return {
      description: it.description || match.description || 'Item',
      quantity: qty,
      unit_price: unitPrice,
      tax_rate: rate,
      item_order: itemOrder,
      source_item_key: 'service_quote:' + itemOrder,
    };
  });
}

async function fetchServiceQuoteAdditionItemsForInvoice(additionId, conn) {
  const [[row]] = await conn.query(
    'SELECT inputs_json, computed_json FROM service_quote_additions WHERE id = ? LIMIT 1',
    [additionId]
  );
  if (!row) return [];
  const inputs = asJson(row.inputs_json) || {};
  const computed = asJson(row.computed_json) || {};
  const inputItems = Array.isArray(inputs.items) ? inputs.items : [];
  const computedItems = computed?.oferta?.items || computed?.items || [];

  if (!Array.isArray(computedItems) || computedItems.length === 0) {
    return inputItems.map((it, idx) => {
      const qty = Number(it.qty || 0) || 1;
      const unitPrice = readQuoteSellUnitPrice(it, {}, qty) ||
        Number(it.door_value_usd || 0) + Number(it.additional_usd || 0);
      const rate = readTaxRate(it, 10);
      const itemOrder = it.item_order ?? it.line_no ?? idx;
      return {
        description: it.description || 'Item',
        quantity: qty,
        unit_price: unitPrice,
        tax_rate: rate,
        item_order: itemOrder,
        source_item_key: `service_quote:${itemOrder}`,
      };
    });
  }

  return computedItems.map((it, idx) => {
    const match =
      inputItems.find((x) => Number(x.line_no ?? x.item_order ?? 0) === Number(it.line_no ?? it.item_order ?? 0)) ||
      inputItems[idx] ||
      {};
    const qty = Number(it.qty || match.qty || 0) || 1;
    const unitPrice = readQuoteSellUnitPrice(it, match, qty);
    const rate = readTaxRate(match, readTaxRate(it, 10));
    const itemOrder = it.item_order ?? it.line_no ?? idx;
    return {
      description: it.description || match.description || 'Item',
      quantity: qty,
      unit_price: unitPrice,
      tax_rate: rate,
      item_order: itemOrder,
      source_item_key: `service_quote:${itemOrder}`,
    };
  });
}


async function fetchDealQuoteBillableItems(dealId, conn, costSheetVersionNumber = null, quoteRevisionId = null) {
  await ensureInvoiceItemSourceColumns();
  const quoteItems = await fetchQuoteItemsForInvoice(dealId, conn, costSheetVersionNumber, quoteRevisionId);
  if (!quoteItems.length) return [];

  const quoteCurrency = await fetchQuoteCurrencyInfo(dealId, conn, costSheetVersionNumber, quoteRevisionId);
  const billCurrency = String(quoteCurrency?.currency || 'USD').toUpperCase();

  const usageWhere = [
    'i.deal_id = ?',
    "i.status <> 'anulada'",
    "ii.source_type = 'deal_quote'",
    'ii.source_parent_id = ?',
    'ii.source_item_key IS NOT NULL',
  ];
  const usageParams = [dealId, dealId];
  if (costSheetVersionNumber) {
    usageWhere.push('i.cost_sheet_version_number = ?');
    usageParams.push(costSheetVersionNumber);
  }
  if (quoteRevisionId) {
    usageWhere.push('i.quote_revision_id = ?');
    usageParams.push(quoteRevisionId);
  }
  const [rows] = await conn.query(
    `SELECT ii.source_item_key,
            MAX(i.id) AS last_invoice_id,
            MAX(i.invoice_number) AS last_invoice_number,
            MAX(i.status) AS last_invoice_status,
            COUNT(*) AS used_count,
            SUM(COALESCE(i.percentage, 100)) AS used_pct,
            GROUP_CONCAT(COALESCE(i.percentage, 100) ORDER BY i.created_at, i.id) AS used_percentages
       FROM invoice_items ii
       INNER JOIN invoices i ON i.id = ii.invoice_id
      WHERE ${usageWhere.join(' AND ')}
      GROUP BY ii.source_item_key`,
    usageParams
  );  const usedMap = new Map((rows || []).map((row) => [String(row.source_item_key || ''), row]));
  return quoteItems.map((item, idx) => {
    const sourceItemKey = String(item.source_item_key || `deal_quote:${item.item_order ?? idx}`);
    const used = usedMap.get(sourceItemKey) || null;
    const quantity = Number(item.quantity || 0) || 1;
    const unitPrice = Number(item.unit_price || 0) || 0;
    const total = Number((quantity * unitPrice).toFixed(2));
    const usedPercentage = Math.min(100, Number(used?.used_pct || 0));
    const usedPercentages = parsePercentageList(used?.used_percentages);
    const isFullyInvoiced = usedPercentage >= 99.999;
    return {
      source_item_key: sourceItemKey,
      item_order: Number(item.item_order ?? idx) || idx,
      description: item.description || 'Item',
      quantity,
      unit_price: unitPrice,
      total,
      tax_rate: readTaxRate(item, 0),
      currency_code: billCurrency,
      used_percentage: usedPercentage,
      remaining_percentage: Math.max(0, round2(100 - usedPercentage)),
      used_percentages: usedPercentages,
      invoiced: isFullyInvoiced,
      pending: !isFullyInvoiced,
      invoice_id: used?.last_invoice_id || null,
      invoice_number: used?.last_invoice_number || null,
      invoice_status: used?.last_invoice_status || null,
    };
  });
}

async function assertDealQuoteItemsAvailable(dealId, selectedKeys, percentage, conn, costSheetVersionNumber = null, quoteRevisionId = null) {
  const billableItems = await fetchDealQuoteBillableItems(dealId, conn, costSheetVersionNumber, quoteRevisionId);
  const wanted = new Set((selectedKeys || []).map((key) => String(key || '')));
  const pct = Number(percentage || 100);
  const selected = billableItems.filter((item) => wanted.has(String(item.source_item_key)));
  const duplicates = selected.filter((item) => hasPercentage(item.used_percentages, pct));
  if (duplicates.length) {
    const labels = duplicates.map((item) => item.description).join(', ');
    throw new Error(`El ${pct}% ya fue facturado para: ${labels}`);
  }
  const invalid = selected.filter((item) => Number(item.used_percentage || 0) + pct > 100.0001);
  if (invalid.length) {
    const labels = invalid.map((item) => `${item.description} (${Number(item.remaining_percentage || 0).toFixed(2)}% disponible)`).join(', ');
    throw new Error(`El porcentaje supera el saldo pendiente de: ${labels}`);
  }
  return selected.filter((item) => item.pending);
}


async function fetchServiceCaseBillableItems(serviceCaseId, conn, quoteRevisionId = null) {
  await ensureInvoiceItemSourceColumns();
  const quoteItems = await fetchServiceQuoteItemsForInvoice(serviceCaseId, conn, quoteRevisionId);
  if (!quoteItems.length) return [];
  const quoteCurrency = await fetchServiceQuoteCurrencyInfo(serviceCaseId, conn, quoteRevisionId);
  const billCurrency = String(quoteCurrency?.currency || 'USD').toUpperCase();

  const [rows] = await conn.query(
    `SELECT ii.source_item_key,
            MAX(i.id) AS last_invoice_id,
            MAX(i.invoice_number) AS last_invoice_number,
            MAX(i.status) AS last_invoice_status,
            COUNT(*) AS used_count,
            SUM(COALESCE(i.percentage, 100)) AS used_pct,
            GROUP_CONCAT(COALESCE(i.percentage, 100) ORDER BY i.created_at, i.id) AS used_percentages
       FROM invoice_items ii
       INNER JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.service_case_id = ?
        AND i.status <> 'anulada'
        AND (? IS NULL OR i.quote_revision_id = ?)
        AND ii.source_type = 'service_quote'
        AND ii.source_parent_id = ?
        AND ii.source_item_key IS NOT NULL
      GROUP BY ii.source_item_key`,
    [serviceCaseId, quoteRevisionId || null, quoteRevisionId || null, serviceCaseId]
  );
  const usedMap = new Map((rows || []).map((row) => [String(row.source_item_key || ''), row]));
  return quoteItems.map((item, idx) => {
    const sourceItemKey = String(item.source_item_key || `service_quote:${item.item_order ?? idx}`);
    const used = usedMap.get(sourceItemKey) || null;
    const quantity = Number(item.quantity || 0) || 1;
    const unitPrice = Number(item.unit_price || 0) || 0;
    const total = Number((quantity * unitPrice).toFixed(2));
    const usedPercentage = Math.min(100, Number(used?.used_pct || 0));
    const usedPercentages = parsePercentageList(used?.used_percentages);
    const isFullyInvoiced = usedPercentage >= 99.999;
    return {
      source_item_key: sourceItemKey,
      item_order: Number(item.item_order ?? idx) || idx,
      description: item.description || 'Item',
      quantity,
      unit_price: unitPrice,
      total,
      tax_rate: readTaxRate(item, 0),
      currency_code: billCurrency,
      used_percentage: usedPercentage,
      remaining_percentage: Math.max(0, round2(100 - usedPercentage)),
      used_percentages: usedPercentages,
      invoiced: isFullyInvoiced,
      pending: !isFullyInvoiced,
      invoice_id: used?.last_invoice_id || null,
      invoice_number: used?.last_invoice_number || null,
      invoice_status: used?.last_invoice_status || null,
    };
  });
}

async function assertServiceQuoteItemsAvailable(serviceCaseId, selectedKeys, percentage, conn, quoteRevisionId = null) {
  const billableItems = await fetchServiceCaseBillableItems(serviceCaseId, conn, quoteRevisionId);
  const wanted = new Set((selectedKeys || []).map((key) => String(key || '')));
  const pct = Number(percentage || 100);
  const selected = billableItems.filter((item) => wanted.has(String(item.source_item_key)));
  const duplicates = selected.filter((item) => hasPercentage(item.used_percentages, pct));
  if (duplicates.length) {
    const labels = duplicates.map((item) => item.description).join(', ');
    throw new Error(`El ${pct}% ya fue facturado para: ${labels}`);
  }
  const invalid = selected.filter((item) => Number(item.used_percentage || 0) + pct > 100.0001);
  if (invalid.length) {
    const labels = invalid.map((item) => `${item.description} (${Number(item.remaining_percentage || 0).toFixed(2)}% disponible)`).join(', ');
    throw new Error(`El porcentaje supera el saldo pendiente de: ${labels}`);
  }
  return selected.filter((item) => item.pending);
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
    "ALTER TABLE invoices ADD COLUMN service_quote_addition_id INT NULL",
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

async function ensureReceiptTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      receipt_number VARCHAR(64) NOT NULL,
      invoice_id INT NOT NULL,
      issue_date DATE NULL,
      status ENUM('borrador','emitido','anulado') NOT NULL DEFAULT 'emitido',
      currency_code VARCHAR(8) NULL,
      payment_method VARCHAR(32) NULL,
      bank_account VARCHAR(32) NULL,
      reference_number VARCHAR(128) NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      retention_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
      retention_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      net_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      point_of_issue VARCHAR(8) NULL,
      establishment VARCHAR(8) NULL,
      created_by INT NULL,
      issued_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_applications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      receipt_id INT NOT NULL,
      invoice_id INT NOT NULL,
      amount_applied DECIMAL(15,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
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
      if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
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

async function generateReceiptNumber(forcePoint, forceEst) {
  await ensureReceiptTables();
  const defaultExp = '001-004';
  let expRaw = defaultExp;
  try {
    expRaw =
      (await getParamValue('receipt_exp', pool))?.value ||
      (await getParamValue('receipt_exp_industrial', pool))?.value ||
      (await getParamValue('receipt_exp_cargo', pool))?.value ||
      defaultExp;
  } catch (_) {
    expRaw = defaultExp;
  }
  let { point, establishment } = parseExpedition(expRaw, {
    point: defaultExp.split('-')[0] || '001',
    establishment: defaultExp.split('-')[1] || '004',
  });

  if (forcePoint && String(forcePoint).trim()) point = String(forcePoint).padStart(3, '0');
  if (forceEst && String(forceEst).trim()) establishment = String(forceEst).padStart(3, '0');

  const lastSeq =
    (await fetchLastSeq(point, establishment, pool, 'receipt_number', 'receipts')) || 0;

  let next = lastSeq + 1;
  try {
    const paramVal =
      parseInt((await getParamValue('receipt_next_number', pool))?.value || 'NaN', 10);
    if (Number.isFinite(paramVal)) next = Math.max(next, paramVal);
  } catch (_) {
    next = lastSeq + 1;
  }
  if (!Number.isFinite(next) || next < lastSeq + 1) next = lastSeq + 1;

  const receiptNumber = `${point}-${establishment}-${String(next).padStart(7, '0')}`;
  try {
    await upsertParam('receipt_next_number', String(next + 1), pool);
  } catch (_) {}
  return { receiptNumber, point, establishment };
}

function getCreditParamConfig({ buKey = '', pipelineName = '' } = {}) {
  const isIndustrial = isIndustrialContext({ buKey, pipelineName });
  const suffix = isIndustrial ? 'industrial' : 'cargo';
  const defaultExp = isIndustrial ? '001-005' : '001-004';

  return {
    isIndustrial,
    suffix,
    defaultExp,
    expKey: `credit_exp_${suffix}`,
    legacyExpKeys: ['credit_exp', `credit_exp_${suffix}`],
    nextKey: `credit_next_number_${suffix}`,
    legacyNextKeys: ['credit_next_number', `credit_next_number_${suffix}`],
  };
}

async function resolveCreditNoteSequence(
  { buKey = '', pipelineName = '', forcePoint = '', forceEst = '' } = {},
  conn = pool
) {
  const cfg = getCreditParamConfig({ buKey, pipelineName });
  const expRaw =
    (await getFirstParamValue([cfg.expKey, ...cfg.legacyExpKeys], conn))?.value || cfg.defaultExp;
  let { point, establishment } = parseExpedition(expRaw, {
    point: cfg.defaultExp.split('-')[0] || '001',
    establishment: cfg.defaultExp.split('-')[1] || '004',
  });

  if (forcePoint && String(forcePoint).trim()) point = String(forcePoint).padStart(3, '0');
  if (forceEst && String(forceEst).trim()) establishment = String(forceEst).padStart(3, '0');

  const lastSeq =
    (await fetchLastSeq(point, establishment, conn, 'credit_note_number', 'credit_notes')) || 0;
  const configuredRaw = (await getFirstParamValue([cfg.nextKey, ...cfg.legacyNextKeys], conn))?.value;
  const configuredNext = parseInt(configuredRaw || 'NaN', 10);
  let next = lastSeq + 1;
  let sequenceSource = 'database';

  if (lastSeq <= 0 && Number.isFinite(configuredNext) && configuredNext >= 1) {
    next = configuredNext;
    sequenceSource = 'param_seed';
  }

  if (!Number.isFinite(next) || next < 1) next = 1;

  return {
    cfg,
    point,
    establishment,
    lastSeq,
    next,
    configuredNext: Number.isFinite(configuredNext) ? configuredNext : null,
    sequenceSource,
  };
}

async function resolveCreditNoteContext(invoice = {}) {
  if (Number(invoice?.service_case_id || 0) > 0) {
    return { buKey: 'atm-industrial', pipelineName: 'ATM INDUSTRIAL' };
  }
  if (Number(invoice?.deal_id || 0) > 0) {
    try {
      const dealInfo = await getDealInfo(invoice.deal_id);
      return {
        buKey: dealInfo?.business_unit_key || '',
        pipelineName: dealInfo?.pipeline_name || '',
      };
    } catch (_) {
      return { buKey: '', pipelineName: '' };
    }
  }
  return { buKey: '', pipelineName: '' };
}

async function generateCreditNoteNumber(
  forcePoint,
  forceEst,
  { buKey = '', pipelineName = '' } = {},
  conn = pool
) {
  await ensureCreditNoteTables();
  const sequence = await resolveCreditNoteSequence(
    { buKey, pipelineName, forcePoint, forceEst },
    conn
  );
  const creditNoteNumber = `${sequence.point}-${sequence.establishment}-${String(sequence.next).padStart(7, '0')}`;
  return {
    creditNoteNumber,
    point: sequence.point,
    establishment: sequence.establishment,
    sequenceSource: sequence.sequenceSource,
    configuredNextNumber: sequence.configuredNext,
  };
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

async function getFirstParamValue(keys = [], conn = pool) {
  for (const key of keys) {
    if (!key) continue;
    const row = await getParamValue(key, conn);
    if (row?.value !== undefined && row?.value !== null && String(row.value) !== '') {
      return row;
    }
  }
  return null;
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
    if (err?.code === 'ER_NO_SUCH_TABLE') return null;
    throw err;
  }
}

// ✅ FIX regex (antes estaba mal: ^d{3}...)
// Ahora sí matchea 001-004-0000007
function extractSeqFromNumber(num = '') {
  const m = String(num).match(/^\d{3}-\d{3}-(\d{1,7})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function splitTaxFromGross(gross = 0, rate = 0) {
  const total = Number(gross || 0) || 0;
  const r = Number(rate || 0) || 0;
  if (r >= 9) {
    const tax = total / 11;
    return { base: total - tax, tax };
  }
  if (r >= 4) {
    const tax = total / 21;
    return { base: total - tax, tax };
  }
  return { base: total, tax: 0 };
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
  // ? FIX: antes /d+/g (mal). Debe ser /\d+/g
  const matches = String(raw).match(/\d+/g) || [];
  const point = (matches[0] || fallback.point || '001').padStart(3, '0');
  const establishment = (matches[1] || fallback.establishment || '000').padStart(3, '0');
  return { point, establishment };
}

async function getConfiguredInvoiceNextNumber(cfg, conn = pool) {
  try {
    const raw = (await getFirstParamValue([cfg.nextKey, cfg.legacyNextKey], conn))?.value;
    const parsed = parseInt(raw || 'NaN', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function resolveInvoiceSequence({ buKey = '', pipelineName = '' } = {}, conn = pool) {
  const cfg = getInvoiceParamConfig({ buKey, pipelineName });
  const expRaw = (await getParamValue(cfg.expKey, conn))?.value || cfg.defaultExp;
  const { point, establishment } = parseExpedition(expRaw, {
    point: cfg.defaultExp.split('-')[0] || '001',
    establishment: cfg.defaultExp.split('-')[1] || '000',
  });
  const lastSeq = (await fetchLastSeq(point, establishment, conn)) || 0;
  const configuredNext = await getConfiguredInvoiceNextNumber(cfg, conn);
  let next = lastSeq + 1;
  let sequenceSource = 'database';

  if (lastSeq <= 0 && Number.isFinite(configuredNext) && configuredNext >= 1) {
    next = configuredNext;
    sequenceSource = 'param_seed';
  }

  if (!Number.isFinite(next) || next < 1) next = 1;

  return {
    cfg,
    point,
    establishment,
    lastSeq,
    next,
    configuredNext,
    sequenceSource,
  };
}

function getInvoiceParamConfig({ buKey = '', pipelineName = '' } = {}) {
  const isIndustrial = isIndustrialContext({ buKey, pipelineName });
  const suffix = isIndustrial ? 'industrial' : 'cargo';
  const defaultExp = isIndustrial ? '001-005' : '001-004';

  return {
    isIndustrial,
    suffix,
    defaultExp,
    expKey: `invoice_exp_${suffix}`,
    nextKey: `invoice_next_number_${suffix}`,
    legacyNextKey: 'invoice_next_number',
    timbradoKey: `invoice_timbre_number_${suffix}`,
    legacyTimbradoKey: 'invoice_timbre_number',
    validFromKey: `invoice_timbre_valid_from_${suffix}`,
    legacyValidFromKey: 'invoice_timbre_valid_from',
    validToKey: `invoice_timbre_valid_to_${suffix}`,
    legacyValidToKey: 'invoice_timbre_valid_to',
  };
}

async function peekInvoiceDefaults({ buKey = '', pipelineName = '' } = {}, conn = pool) {
  const sequence = await resolveInvoiceSequence({ buKey, pipelineName }, conn);
  const cfg = sequence.cfg;
  const invoice_number = `${sequence.point}-${sequence.establishment}-${String(sequence.next).padStart(7, '0')}`;
  const configured_invoice_number = Number.isFinite(sequence.configuredNext)
    ? `${sequence.point}-${sequence.establishment}-${String(sequence.configuredNext).padStart(7, '0')}`
    : '';

  return {
    invoice_number,
    point_of_issue: sequence.point,
    establishment: sequence.establishment,
    next_number: sequence.next,
    configured_next_number: sequence.configuredNext,
    configured_invoice_number,
    last_issued_seq: sequence.lastSeq,
    sequence_source: sequence.sequenceSource,
    timbrado_number:
      (await getFirstParamValue([cfg.timbradoKey, cfg.legacyTimbradoKey], conn))?.value || '',
    timbrado_start_date:
      (await getFirstParamValue([cfg.validFromKey, cfg.legacyValidFromKey], conn))?.value || '',
    timbrado_expires_at:
      (await getFirstParamValue([cfg.validToKey, cfg.legacyValidToKey], conn))?.value || '',
  };
}

async function fetchInvoiceNumberingStatus({ buKey = '', pipelineName = '' } = {}, conn = pool) {
  const cfg = getInvoiceParamConfig({ buKey, pipelineName });
  const defaults = await peekInvoiceDefaults({ buKey, pipelineName }, conn);
  const [[lastIssued]] = await conn.query(
    `SELECT id, invoice_number, issue_date, created_at
       FROM invoices
      WHERE point_of_issue = ? AND establishment = ?
      ORDER BY id DESC
      LIMIT 1`,
    [defaults.point_of_issue, defaults.establishment]
  );
  const nextSeq = Number(defaults.next_number || 0) || 0;
  const configuredSeq = Number(defaults.configured_next_number || 0) || 0;
  return {
    business_unit: cfg.suffix,
    point_of_issue: defaults.point_of_issue,
    establishment: defaults.establishment,
    expedition_code: `${defaults.point_of_issue}-${defaults.establishment}`,
    next_number: nextSeq,
    next_number_padded: String(nextSeq).padStart(7, '0'),
    next_invoice_number: defaults.invoice_number,
    configured_next_number: configuredSeq || null,
    configured_next_number_padded: configuredSeq ? String(configuredSeq).padStart(7, '0') : '',
    configured_invoice_number: defaults.configured_invoice_number || '',
    sequence_source: defaults.sequence_source || 'database',
    last_issued_seq: Number(defaults.last_issued_seq || 0) || 0,
    timbrado_number: defaults.timbrado_number || '',
    timbrado_start_date: defaults.timbrado_start_date || '',
    timbrado_expires_at: defaults.timbrado_expires_at || '',
    last_issued_invoice_id: lastIssued?.id || null,
    last_issued_invoice_number: lastIssued?.invoice_number || null,
    last_issued_invoice_date: lastIssued?.issue_date || lastIssued?.created_at || null,
  };
}

async function fetchCreditNoteNumberingStatus({ buKey = '', pipelineName = '' } = {}, conn = pool) {
  const cfg = getCreditParamConfig({ buKey, pipelineName });
  const sequence = await resolveCreditNoteSequence({ buKey, pipelineName }, conn);
  const credit_note_number = `${sequence.point}-${sequence.establishment}-${String(sequence.next).padStart(7, '0')}`;
  const configured_number = Number.isFinite(sequence.configuredNext)
    ? `${sequence.point}-${sequence.establishment}-${String(sequence.configuredNext).padStart(7, '0')}`
    : '';
  const [[lastIssued]] = await conn.query(
    `SELECT id, credit_note_number, issue_date, created_at
       FROM credit_notes
      WHERE point_of_issue = ? AND establishment = ?
      ORDER BY id DESC
      LIMIT 1`,
    [sequence.point, sequence.establishment]
  );

  return {
    business_unit: cfg.suffix,
    point_of_issue: sequence.point,
    establishment: sequence.establishment,
    expedition_code: `${sequence.point}-${sequence.establishment}`,
    next_number: sequence.next,
    next_number_padded: String(sequence.next).padStart(7, '0'),
    next_credit_note_number: credit_note_number,
    configured_next_number: sequence.configuredNext,
    configured_next_number_padded: Number.isFinite(sequence.configuredNext)
      ? String(sequence.configuredNext).padStart(7, '0')
      : '',
    configured_credit_note_number: configured_number,
    sequence_source: sequence.sequenceSource,
    last_issued_seq: sequence.lastSeq,
    last_issued_credit_note_id: lastIssued?.id || null,
    last_issued_credit_note_number: lastIssued?.credit_note_number || null,
    last_issued_credit_note_date: lastIssued?.issue_date || lastIssued?.created_at || null,
  };
}

function normalizeDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function validateInvoiceFiscalConfig(defaults, issueDate = new Date()) {
  const problems = [];
  const point = String(defaults?.point_of_issue || '').trim();
  const establishment = String(defaults?.establishment || '').trim();
  const timbrado = String(defaults?.timbrado_number || '').trim();
  const validFrom = normalizeDateOnly(defaults?.timbrado_start_date);
  const validTo = normalizeDateOnly(defaults?.timbrado_expires_at);
  const issue = normalizeDateOnly(issueDate);

  if (!/^\d{3}$/.test(point)) problems.push('Punto de expedici?n inv?lido o incompleto.');
  if (!/^\d{3}$/.test(establishment)) problems.push('Establecimiento inv?lido o incompleto.');
  if (!timbrado) problems.push('Timbrado no configurado.');
  if (!validFrom) problems.push('Vigencia desde no configurada.');
  if (!validTo) problems.push('Vigencia hasta no configurada.');
  if (validFrom && validTo && validFrom > validTo) {
    problems.push('La vigencia del timbrado es inconsistente.');
  }
  if (issue && validFrom && issue < validFrom) {
    problems.push('La fecha de emisi?n es anterior al inicio de vigencia del timbrado.');
  }
  if (issue && validTo && issue > validTo) {
    problems.push('El timbrado est? vencido para la fecha de emisi?n.');
  }

  return {
    ok: problems.length === 0,
    problems,
  };
}

async function nextInvoiceNumber(buKey = '', conn) {
  const sequence = await resolveInvoiceSequence({ buKey }, conn);
  const invoice_number = `${sequence.point}-${sequence.establishment}-${String(sequence.next).padStart(7, '0')}`;

  return {
    invoice_number,
    point_of_issue: sequence.point,
    establishment: sequence.establishment,
  };
}

async function recomputeInvoicePayments(invoiceId) {
  const [[inv]] = await pool.query('SELECT id, net_total_amount FROM invoices WHERE id = ?', [invoiceId]);
  if (!inv) return;
  const [[agg]] = await pool.query(
    `SELECT COALESCE(SUM(net_amount),0) AS paid
       FROM receipts
      WHERE invoice_id = ? AND status = 'emitido'`,
    [invoiceId]
  );
  const paid = parseFloat(agg.paid || 0);
  const netTotal = parseFloat(inv.net_total_amount || 0);
  const netBalance = Math.max(0, netTotal - paid);
  let newStatus = 'emitida';
  if (netTotal <= 0.01) {
    newStatus = 'anulada';
  } else if (netBalance <= 0.01) {
    newStatus = 'pagada';
  } else if (paid > 0) {
    newStatus = 'pago_parcial';
  }
  await pool.query(
    `UPDATE invoices 
     SET paid_amount = ?, net_balance = ?, status = ?
     WHERE id = ?`,
    [paid.toFixed(2), netBalance.toFixed(2), newStatus, invoiceId]
  );
  await syncContainerBillingCycleFromInvoice(invoiceId);
}

async function syncContainerBillingCycleFromInvoice(invoiceId) {
  try {
    const [[invoice]] = await pool.query(
      `SELECT id, status, container_billing_cycle_id, canceled_by_credit_note_id
         FROM invoices
        WHERE id = ?
        LIMIT 1`,
      [invoiceId]
    );
    if (!invoice?.container_billing_cycle_id) return;

    let billingStatus = 'facturado';
    if (String(invoice.status || '').toLowerCase() === 'pagada') {
      billingStatus = 'cobrado';
    } else if (String(invoice.status || '').toLowerCase() === 'anulada') {
      if (invoice.canceled_by_credit_note_id) {
        await pool.query(
          `UPDATE container_billing_cycles
              SET status = 'pendiente',
                  invoice_id = NULL,
                  invoiced_at = NULL,
                  invoiced_by = NULL
            WHERE id = ?`,
          [invoice.container_billing_cycle_id]
        );
      } else {
        await pool.query(
          `UPDATE container_billing_cycles
              SET status = 'anulado',
                  invoice_id = ?
            WHERE id = ?`,
          [invoice.id, invoice.container_billing_cycle_id]
        );
      }
      return;
    }

    await pool.query(
      `UPDATE container_billing_cycles
          SET status = ?,
              invoice_id = ?
        WHERE id = ?`,
      [billingStatus, invoice.id, invoice.container_billing_cycle_id]
    );
  } catch (err) {
    console.error('[invoices] Error syncing container billing cycle', err?.message || err);
  }
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
  const subtotal = items.reduce((sum, item) => {
    const { base } = splitTaxFromGross(parseFloat(item.subtotal || 0), item.tax_rate ?? 0);
    return sum + base;
  }, 0);
  const taxAmount = items.reduce((sum, item) => {
    const { tax } = splitTaxFromGross(parseFloat(item.subtotal || 0), item.tax_rate ?? 0);
    return sum + tax;
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
    const { base, tax } = splitTaxFromGross(parseFloat(it.subtotal || 0), rate);
    if (rate < 1) {
      acc.base0 += base;
    } else if (rate < 9) {
      acc.base5 += base;
      acc.iva5 += tax;
    } else {
      acc.base10 += base;
      acc.iva10 += tax;
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

function formatDateLong(date) {
  if (!date) return '';
  const d = new Date(date);
  const months = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
  ];
  const day = d.getDate();
  const month = months[d.getMonth()] || '';
  const year = d.getFullYear();
  return `${day} de ${month} de ${year}`;
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

function canCreateInvoice(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'finanzas';
}

function canViewInvoicePdf(user, invoice) {
  return Boolean(user?.id);
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

// GET /api/invoices/lock-status?deal_id=#&service_case_id=#
router.get('/lock-status', requireAuth, async (req, res) => {
  try {
    const deal_id = Number(req.query?.deal_id || 0) || null;
    const service_case_id = Number(req.query?.service_case_id || 0) || null;
    const cost_sheet_version_number = Number(req.query?.cost_sheet_version_number || req.query?.cost_sheet_version || 0) || null;
    const quote_revision_id = Number(req.query?.quote_revision_id || req.query?.revision_id || 0) || null;
    if (!deal_id && !service_case_id) {
      return res.status(400).json({ error: 'deal_id o service_case_id es requerido' });
    }
    const status = await fetchInvoiceLockStatus({ deal_id, service_case_id, cost_sheet_version_number, quote_revision_id });
    res.json({
      locked: status.locked,
      count: status.count,
      reason: status.locked ? 'facturada' : null,
    });
  } catch (e) {
    console.error('[invoices] lock-status error:', e);
    res.status(500).json({ error: 'No se pudo obtener el estado de bloqueo' });
  }
});

// GET /api/invoices/numbering-status
router.get('/numbering-status', requireAuth, async (req, res) => {
  try {
    const cargo = await fetchInvoiceNumberingStatus({ buKey: 'atm-cargo', pipelineName: 'ATM CARGO' });
    const industrial = await fetchInvoiceNumberingStatus({ buKey: 'atm-industrial', pipelineName: 'ATM INDUSTRIAL' });
    res.json({ cargo, industrial });
  } catch (e) {
    console.error('[invoices] Error getting numbering status:', e);
    res.status(500).json({ error: 'No se pudo obtener el estado de numeracion' });
  }
});

router.get('/credit-numbering-status', requireAuth, async (req, res) => {
  try {
    const cargo = await fetchCreditNoteNumberingStatus({ buKey: 'atm-cargo', pipelineName: 'ATM CARGO' });
    const industrial = await fetchCreditNoteNumberingStatus({ buKey: 'atm-industrial', pipelineName: 'ATM INDUSTRIAL' });
    res.json({ cargo, industrial });
  } catch (e) {
    console.error('[invoices] Error getting credit numbering status:', e);
    res.status(500).json({ error: 'No se pudo obtener el estado de numeracion de notas de credito' });
  }
});

// GET /api/invoices/defaults?deal_id=#&service_case_id=#
router.get('/defaults', requireAuth, async (req, res) => {
  try {
    const { deal_id, service_case_id } = req.query;
    let buKey = '';
    let pipelineId = null;
    let pipelineName = '';
    if (deal_id) {
      const info = await getDealInfo(deal_id);
      buKey = info.business_unit_key || '';
      pipelineId = info.pipeline_id || null;
      pipelineName = info.pipeline_name || '';
    } else if (service_case_id) {
      buKey = 'atm-industrial';
      pipelineId = 1;
      pipelineName = 'ATM INDUSTRIAL';
    }
    const isIndustrial = isIndustrialContext({ buKey, pipelineName }) || pipelineId === 1;
    const defaults = await peekInvoiceDefaults({ buKey: isIndustrial ? (buKey || 'atm-industrial') : buKey, pipelineName });
    res.json({ ...defaults, business_unit_key: buKey || null, pipeline_id: pipelineId, is_industrial: isIndustrial });
  } catch (e) {
    console.error('[invoices] Error getting defaults:', e);
    res.status(500).json({ error: 'No se pudieron obtener los valores por defecto' });
  }
});

// Rutas financieras: solo admin y finanzas desde aqui.
router.use(requireAuth, (req, res, next) => {
  if (canCreateInvoice(req.user)) return next();
  return res.status(403).json({ error: 'No tienes permiso para acceder a facturacion' });
});

// GET /api/invoices
function todayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeStatementCurrency(value) {
  return String(value || 'USD').trim().toUpperCase() || 'USD';
}

function normalizeCustomerKey(row) {
  if (row.organization_id) return `org:${row.organization_id}`;
  const doc = String(row.customer_doc || row.organization_ruc || '').trim();
  if (doc) return `doc:${doc}`;
  const name = String(row.customer_name || row.organization_name || '').trim();
  return name ? `name:${name.toLowerCase()}` : 'unknown';
}

function normalizeCustomerName(row) {
  return row.customer_name || row.organization_name || (row.organization_id ? `Cliente #${row.organization_id}` : 'Sin cliente');
}

function customerStatementStatus(row) {
  const raw = String(row.status || '').toLowerCase();
  const balance = Number(row.balance || 0);
  const paid = Number(row.paid_amount || 0);
  const due = parseDateOnly(row.due_date);
  const today = todayDateOnly();
  if (raw === 'anulada' || raw === 'anulado') return 'anulado';
  if (balance <= 0.009) return 'pagado';
  if (paid > 0) return 'parcial';
  if (due && due < today) return 'vencido';
  if (due && due.getTime() === today.getTime()) return 'vence_hoy';
  return 'pendiente';
}

function customerStatementStatusLabel(status) {
  const labels = {
    por_cobrar: 'Por cobrar',
    pendiente: 'Pendiente',
    parcial: 'Pago parcial',
    vencido: 'Vencido',
    vence_hoy: 'Vence hoy',
    pagado: 'Pagado',
    anulado: 'Anulado',
    todos: 'Todos',
  };
  return labels[status] || status || '-';
}

function addCurrencyAmount(target, currency, amount) {
  const key = normalizeStatementCurrency(currency);
  target[key] = Number(((target[key] || 0) + Number(amount || 0)).toFixed(2));
}

function filterCustomerStatementDocument(row, filters = {}) {
  const status = String(filters.status || 'por_cobrar').toLowerCase();
  const currency = String(filters.currency_code || 'todas').toUpperCase();
  const query = String(filters.search || '').trim().toLowerCase();
  const clientQuery = String(filters.client_q || '').trim().toLowerCase();
  if (currency && currency !== 'TODAS' && normalizeStatementCurrency(row.currency_code) !== currency) return false;
  if (clientQuery) {
    const haystack = [row.customer_name, row.organization_name, row.customer_doc, row.organization_ruc].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(clientQuery)) return false;
  }
  if (query) {
    const haystack = [row.invoice_number, row.operation_reference, row.customer_name, row.organization_name, row.customer_doc, row.organization_ruc, row.description, row.status].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (status === 'todos') return true;
  if (status === 'por_cobrar') return Number(row.balance || 0) > 0.009 && row.normalized_status !== 'anulado';
  if (status === 'due_7d') {
    if (Number(row.balance || 0) <= 0.009 || row.normalized_status === 'anulado') return false;
    const due = parseDateOnly(row.due_date);
    if (!due) return false;
    const today = todayDateOnly();
    const max = new Date(today);
    max.setDate(max.getDate() + 7);
    return due >= today && due <= max;
  }
  return row.normalized_status === status;
}

async function fetchCustomerStatementInvoices(query = {}) {
  await ensureReceiptTables();
  await ensureInvoiceCreditColumns();
  await ensureCreditNoteTables();
  const params = [];
  const buildQuery = (withService) => {
    let sql = `
      SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.created_at, i.status,
             i.payment_condition, i.organization_id, i.customer_doc, i.customer_doc_type,
             i.customer_email, i.customer_address, NULL AS customer_name, i.deal_id, i.service_case_id,
             i.container_billing_cycle_id, i.total_amount, i.subtotal, i.tax_amount,
             i.paid_amount AS paid_amount_db, i.credited_total AS credited_total_db,
             i.net_total_amount AS net_total_amount_db, i.net_balance AS net_balance_db,
             i.balance AS balance_db, COALESCE(i.currency_code, 'USD') AS currency_code,
             o.name AS organization_name, o.ruc AS organization_ruc, o.email AS organization_email,
             o.phone AS organization_phone,
             COALESCE(d.reference, ${withService ? 'sc.reference' : "''"}, '') AS operation_reference,
             it.first_item_desc AS description,
             COALESCE(rc.paid_amount, 0) AS receipts_paid,
             COALESCE(rc.last_payment_date, NULL) AS last_payment_date,
             COALESCE(cn.credited_total, 0) AS credit_notes_total
        FROM invoices i
        LEFT JOIN organizations o ON o.id = i.organization_id
        LEFT JOIN deals d ON d.id = i.deal_id
        ${withService ? 'LEFT JOIN service_cases sc ON sc.id = i.service_case_id' : ''}
        LEFT JOIN (
          SELECT invoice_id, SUBSTRING_INDEX(GROUP_CONCAT(description ORDER BY item_order, id SEPARATOR '||'), '||', 1) AS first_item_desc
            FROM invoice_items
           GROUP BY invoice_id
        ) it ON it.invoice_id = i.id
        LEFT JOIN (
          SELECT invoice_id, SUM(net_amount) AS paid_amount, MAX(issue_date) AS last_payment_date
            FROM receipts
           WHERE status = 'emitido'
           GROUP BY invoice_id
        ) rc ON rc.invoice_id = i.id
        LEFT JOIN (
          SELECT invoice_id, SUM(total_amount) AS credited_total
            FROM credit_notes
           WHERE status <> 'anulada'
           GROUP BY invoice_id
        ) cn ON cn.invoice_id = i.id
       WHERE 1=1
    `;
    if (query.from_date) { sql += ' AND i.issue_date >= ?'; params.push(query.from_date); }
    if (query.to_date) { sql += ' AND i.issue_date <= ?'; params.push(query.to_date); }
    if (query.due_from) { sql += ' AND i.due_date >= ?'; params.push(query.due_from); }
    if (query.due_to) { sql += ' AND i.due_date <= ?'; params.push(query.due_to); }
    if (query.organization_id) { sql += ' AND i.organization_id = ?'; params.push(query.organization_id); }
    sql += ' ORDER BY COALESCE(o.name, i.organization_id, i.id), i.issue_date ASC, i.id ASC';
    return sql;
  };
  try {
    const [rows] = await pool.query(buildQuery(true), params);
    return rows;
  } catch (err) {
    if (err?.code !== 'ER_BAD_FIELD_ERROR' && err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    params.length = 0;
    const [rows] = await pool.query(buildQuery(false), params);
    return rows;
  }
}

async function fetchCustomerStatementMovements(invoiceIds = []) {
  if (!invoiceIds.length) return { receipts: [], creditNotes: [] };
  const placeholders = invoiceIds.map(() => '?').join(',');
  const [receipts] = await pool.query(`
    SELECT r.id, r.receipt_number, r.invoice_id, r.issue_date, r.currency_code,
           r.payment_method, r.bank_account, r.reference_number,
           r.amount, r.retention_amount, r.net_amount, r.status
      FROM receipts r
     WHERE r.status = 'emitido' AND r.invoice_id IN (${placeholders})
     ORDER BY r.issue_date ASC, r.id ASC
  `, invoiceIds);
  const [creditNotes] = await pool.query(`
    SELECT cn.id, cn.credit_note_number, cn.invoice_id, cn.issue_date,
           cn.total_amount, cn.status, cn.reason
      FROM credit_notes cn
     WHERE cn.status <> 'anulada' AND cn.invoice_id IN (${placeholders})
     ORDER BY cn.issue_date ASC, cn.id ASC
  `, invoiceIds);
  return { receipts, creditNotes };
}

// GET /api/invoices/customer-statement
router.get('/customer-statement', requireAuth, async (req, res) => {
  try {
    const rawInvoices = await fetchCustomerStatementInvoices(req.query || {});
    const documents = rawInvoices.map((row) => {
      const totalFromDb = Number(row.total_amount || 0);
      const total = totalFromDb > 0 ? totalFromDb : Math.max(0, Number(row.subtotal || 0) + Number(row.tax_amount || 0));
      const credited = Number(row.credit_notes_total || row.credited_total_db || 0);
      const netTotal = Number(row.net_total_amount_db || 0) > 0 ? Number(row.net_total_amount_db || 0) : Math.max(0, total - credited);
      const paid = Number(row.receipts_paid || 0) > 0 ? Number(row.receipts_paid || 0) : Number(row.paid_amount_db || 0);
      const rawStatus = String(row.status || '').toLowerCase();
      const isCanceled = rawStatus === 'anulada' || rawStatus === 'anulado';
      const balance = isCanceled ? 0 : Math.max(0, netTotal - paid);
      const normalized = customerStatementStatus({ ...row, balance, paid_amount: paid });
      return {
        ...row,
        customer_key: normalizeCustomerKey(row),
        customer_name: normalizeCustomerName(row),
        customer_ruc: row.customer_doc || row.organization_ruc || '',
        currency_code: normalizeStatementCurrency(row.currency_code),
        total_amount: Number(total.toFixed(2)),
        credited_total: Number(credited.toFixed(2)),
        net_total_amount: Number(netTotal.toFixed(2)),
        paid_amount: Number(paid.toFixed(2)),
        balance: Number(balance.toFixed(2)),
        normalized_status: normalized,
        status_label: customerStatementStatusLabel(normalized),
        days_overdue: normalized === 'vencido' && row.due_date ? Math.max(0, Math.floor((todayDateOnly() - parseDateOnly(row.due_date)) / 86400000)) : 0,
      };
    }).filter((row) => filterCustomerStatementDocument(row, req.query || {}));

    const invoiceIds = documents.map((row) => Number(row.id)).filter(Boolean);
    const { receipts, creditNotes } = await fetchCustomerStatementMovements(invoiceIds);
    const docById = new Map(documents.map((row) => [Number(row.id), row]));
    const movementRows = [];

    for (const doc of documents) {
      if (doc.normalized_status !== 'anulado') {
        movementRows.push({ id: `invoice:${doc.id}`, source_type: 'invoice', source_id: doc.id, invoice_id: doc.id, date: doc.issue_date || doc.created_at, document_number: doc.invoice_number, reference: doc.operation_reference || '', description: doc.description || 'Factura', customer_key: doc.customer_key, customer_name: doc.customer_name, customer_ruc: doc.customer_ruc, currency_code: doc.currency_code, debit: doc.total_amount, credit: 0 });
      }
    }
    for (const note of creditNotes) {
      const doc = docById.get(Number(note.invoice_id));
      if (!doc) continue;
      movementRows.push({ id: `credit-note:${note.id}`, source_type: 'credit_note', source_id: note.id, invoice_id: note.invoice_id, date: note.issue_date, document_number: note.credit_note_number, reference: doc.invoice_number, description: note.reason || 'Nota de credito', customer_key: doc.customer_key, customer_name: doc.customer_name, customer_ruc: doc.customer_ruc, currency_code: doc.currency_code, debit: 0, credit: Number(note.total_amount || 0) });
    }
    for (const receipt of receipts) {
      const doc = docById.get(Number(receipt.invoice_id));
      if (!doc) continue;
      movementRows.push({ id: `receipt:${receipt.id}`, source_type: 'receipt', source_id: receipt.id, invoice_id: receipt.invoice_id, date: receipt.issue_date, document_number: receipt.receipt_number, reference: doc.invoice_number, description: receipt.payment_method || 'Recibo', customer_key: doc.customer_key, customer_name: doc.customer_name, customer_ruc: doc.customer_ruc, currency_code: normalizeStatementCurrency(receipt.currency_code || doc.currency_code), debit: 0, credit: Number(receipt.net_amount || receipt.amount || 0) });
    }

    movementRows.sort((a, b) => {
      const client = String(a.customer_name || '').localeCompare(String(b.customer_name || ''));
      if (client) return client;
      const currency = String(a.currency_code || '').localeCompare(String(b.currency_code || ''));
      if (currency) return currency;
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      if (dateA !== dateB) return dateA - dateB;
      return String(a.id).localeCompare(String(b.id));
    });
    const runningByClientCurrency = new Map();
    const movements = movementRows.map((row) => {
      const key = `${row.customer_key}:${row.currency_code}`;
      const next = Number(((runningByClientCurrency.get(key) || 0) + Number(row.debit || 0) - Number(row.credit || 0)).toFixed(2));
      runningByClientCurrency.set(key, next);
      return { ...row, balance: next };
    });

    const clientMap = new Map();
    const totals = { documents: documents.length, open_documents: 0, overdue_documents: 0, due_today_documents: 0, partial_documents: 0, invoiced_by_currency: {}, credited_by_currency: {}, paid_by_currency: {}, balance_by_currency: {}, overdue_by_currency: {} };
    for (const doc of documents) {
      const client = clientMap.get(doc.customer_key) || { customer_key: doc.customer_key, customer_name: doc.customer_name, customer_ruc: doc.customer_ruc, organization_id: doc.organization_id || null, documents: 0, open_documents: 0, overdue_documents: 0, last_payment_date: null, totals_by_currency: {}, paid_by_currency: {}, credited_by_currency: {}, balance_by_currency: {}, overdue_by_currency: {} };
      client.documents += 1;
      addCurrencyAmount(client.totals_by_currency, doc.currency_code, doc.total_amount);
      addCurrencyAmount(client.paid_by_currency, doc.currency_code, doc.paid_amount);
      addCurrencyAmount(client.credited_by_currency, doc.currency_code, doc.credited_total);
      addCurrencyAmount(client.balance_by_currency, doc.currency_code, doc.balance);
      if (doc.balance > 0.009) client.open_documents += 1;
      if (doc.normalized_status === 'vencido') { client.overdue_documents += 1; addCurrencyAmount(client.overdue_by_currency, doc.currency_code, doc.balance); }
      if (doc.last_payment_date && (!client.last_payment_date || String(doc.last_payment_date) > String(client.last_payment_date))) client.last_payment_date = doc.last_payment_date;
      clientMap.set(doc.customer_key, client);
      addCurrencyAmount(totals.invoiced_by_currency, doc.currency_code, doc.total_amount);
      addCurrencyAmount(totals.credited_by_currency, doc.currency_code, doc.credited_total);
      addCurrencyAmount(totals.paid_by_currency, doc.currency_code, doc.paid_amount);
      addCurrencyAmount(totals.balance_by_currency, doc.currency_code, doc.balance);
      if (doc.balance > 0.009) totals.open_documents += 1;
      if (doc.normalized_status === 'vencido') { totals.overdue_documents += 1; addCurrencyAmount(totals.overdue_by_currency, doc.currency_code, doc.balance); }
      if (doc.normalized_status === 'vence_hoy') totals.due_today_documents += 1;
      if (doc.normalized_status === 'parcial') totals.partial_documents += 1;
    }
    const clients = Array.from(clientMap.values()).sort((a, b) => {
      const aBalance = Object.values(a.balance_by_currency || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      const bBalance = Object.values(b.balance_by_currency || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      return bBalance - aBalance || String(a.customer_name || '').localeCompare(String(b.customer_name || ''));
    });
    res.json({ filters: req.query || {}, totals, clients, documents, movements });
  } catch (e) {
    console.error('[customer-statement] Error:', e);
    res.status(500).json({ error: 'Error al generar estado de cuenta de clientes' });
  }
});
function statementPdfMoney(value, currency = 'USD') {
  const curr = normalizeStatementCurrency(currency);
  const isPyg = curr === 'PYG' || curr === 'GS';
  const amount = Number(value || 0).toLocaleString('es-PY', {
    minimumFractionDigits: isPyg ? 0 : 2,
    maximumFractionDigits: isPyg ? 0 : 2,
  });
  return `${curr === 'GS' ? 'PYG' : curr} ${amount}`;
}

function addStatementPdfPageHeader(doc, title, subtitle) {
  doc.rect(36, 32, 540, 52).fill('#0f172a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(title, 52, 46, { width: 340 });
  doc.font('Helvetica').fontSize(8).text(subtitle || '', 52, 66, { width: 340 });
  doc.font('Helvetica-Bold').fontSize(10).text('ATM CARGO', 444, 46, { width: 112, align: 'right' });
  doc.font('Helvetica').fontSize(8).text(formatDate(new Date()), 444, 62, { width: 112, align: 'right' });
  doc.fillColor('#0f172a');
}

function drawStatementPdfTableHeader(doc, y) {
  doc.rect(36, y, 540, 22).fill('#e2e8f0');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7);
  doc.text('Factura', 42, y + 7, { width: 58 });
  doc.text('Cliente', 100, y + 7, { width: 110 });
  doc.text('Emision', 214, y + 7, { width: 48 });
  doc.text('Vence', 264, y + 7, { width: 48 });
  doc.text('Total', 315, y + 7, { width: 58, align: 'right' });
  doc.text('Cobrado', 378, y + 7, { width: 58, align: 'right' });
  doc.text('NC', 442, y + 7, { width: 48, align: 'right' });
  doc.text('Saldo', 496, y + 7, { width: 70, align: 'right' });
  doc.fillColor('#0f172a');
}

// GET /api/invoices/customer-statement/pdf
router.get('/customer-statement/pdf', requireAuth, async (req, res) => {
  try {
    const rawInvoices = await fetchCustomerStatementInvoices(req.query || {});
    const documents = rawInvoices.map((row) => {
      const totalFromDb = Number(row.total_amount || 0);
      const total = totalFromDb > 0 ? totalFromDb : Math.max(0, Number(row.subtotal || 0) + Number(row.tax_amount || 0));
      const credited = Number(row.credit_notes_total || row.credited_total_db || 0);
      const netTotal = Number(row.net_total_amount_db || 0) > 0 ? Number(row.net_total_amount_db || 0) : Math.max(0, total - credited);
      const paid = Number(row.receipts_paid || 0) > 0 ? Number(row.receipts_paid || 0) : Number(row.paid_amount_db || 0);
      const rawStatus = String(row.status || '').toLowerCase();
      const isCanceled = rawStatus === 'anulada' || rawStatus === 'anulado';
      const balance = isCanceled ? 0 : Math.max(0, netTotal - paid);
      const normalized = customerStatementStatus({ ...row, balance, paid_amount: paid });
      return {
        ...row,
        customer_key: normalizeCustomerKey(row),
        customer_name: normalizeCustomerName(row),
        customer_ruc: row.customer_doc || row.organization_ruc || '',
        currency_code: normalizeStatementCurrency(row.currency_code),
        total_amount: Number(total.toFixed(2)),
        credited_total: Number(credited.toFixed(2)),
        paid_amount: Number(paid.toFixed(2)),
        balance: Number(balance.toFixed(2)),
        normalized_status: normalized,
        status_label: customerStatementStatusLabel(normalized),
      };
    }).filter((row) => filterCustomerStatementDocument(row, req.query || {}));

    const totals = { balance_by_currency: {}, overdue_by_currency: {}, paid_by_currency: {}, credited_by_currency: {}, invoiced_by_currency: {} };
    for (const row of documents) {
      addCurrencyAmount(totals.balance_by_currency, row.currency_code, row.balance);
      addCurrencyAmount(totals.paid_by_currency, row.currency_code, row.paid_amount);
      addCurrencyAmount(totals.credited_by_currency, row.currency_code, row.credited_total);
      addCurrencyAmount(totals.invoiced_by_currency, row.currency_code, row.total_amount);
      if (row.normalized_status === 'vencido') addCurrencyAmount(totals.overdue_by_currency, row.currency_code, row.balance);
    }

    const clientNames = Array.from(new Set(documents.map((row) => row.customer_name).filter(Boolean)));
    const isSingleClient = clientNames.length === 1;
    const primaryClient = isSingleClient ? documents[0] || {} : {};
    const title = isSingleClient ? `Estado de cuenta - ${clientNames[0]}` : 'Estado de cuenta de clientes';
    const subtitle = `Documentos: ${documents.length} | Filtro: ${customerStatementStatusLabel(String(req.query?.status || 'por_cobrar').toLowerCase())}`;
    const fileSuffix = isSingleClient
      ? String(clientNames[0] || 'cliente').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
      : 'clientes';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="estado-cuenta-${fileSuffix || 'clientes'}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    doc.pipe(res);
    addStatementPdfPageHeader(doc, title, subtitle);

    let y = 104;
    if (isSingleClient) {
      doc.roundedRect(36, y, 540, 86, 6).fillAndStroke('#f8fafc', '#dbe4ee');
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10).text('Datos del cliente', 50, y + 12, { width: 180 });
      doc.font('Helvetica').fontSize(8).fillColor('#334155');
      doc.text(`Cliente: ${primaryClient.customer_name || '-'}`, 50, y + 30, { width: 245 });
      doc.text(`RUC: ${primaryClient.customer_ruc || primaryClient.organization_ruc || '-'}`, 50, y + 44, { width: 245 });
      doc.text(`Email: ${primaryClient.customer_email || primaryClient.organization_email || '-'}`, 315, y + 30, { width: 230 });
      doc.text(`Telefono: ${primaryClient.organization_phone || '-'}`, 315, y + 44, { width: 230 });
      doc.text('Este estado de cuenta resume facturas, recibos y notas de credito registrados a la fecha de emision.', 50, y + 64, { width: 495 });
      y += 104;
    }

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155').text('Resumen financiero', 36, y);
    y += 16;
    const summaryRows = [
      ['Saldo por cobrar', totals.balance_by_currency],
      ['Vencido', totals.overdue_by_currency],
      ['Cobrado', totals.paid_by_currency],
      ['Notas de credito', totals.credited_by_currency],
    ];
    doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
    for (const [label, values] of summaryRows) {
      const text = Object.entries(values || {}).map(([currency, amount]) => statementPdfMoney(amount, currency)).join('   ') || statementPdfMoney(0, 'USD');
      doc.text(label, 48, y, { width: 120 });
      doc.font('Helvetica-Bold').text(text, 172, y, { width: 360 });
      doc.font('Helvetica');
      y += 14;
    }

    if (isSingleClient) {
      y += 10;
      const balanceText = Object.entries(totals.balance_by_currency || {})
        .map(([currency, amount]) => statementPdfMoney(amount, currency))
        .join(' / ') || statementPdfMoney(0, 'USD');
      doc.roundedRect(36, y, 540, 44, 6).fillAndStroke('#fff7ed', '#fed7aa');
      doc.fillColor('#9a3412').font('Helvetica-Bold').fontSize(8).text('Solicitud de regularizacion', 50, y + 10, { width: 220 });
      doc.font('Helvetica').fontSize(8).fillColor('#7c2d12').text(
        `Favor verificar el saldo pendiente de ${balanceText}. En caso de contar con pagos no aplicados, remitir el comprobante para su conciliacion.`,
        50,
        y + 24,
        { width: 500 }
      );
      y += 58;
    }

    y += 10;
    drawStatementPdfTableHeader(doc, y);
    y += 24;
    doc.font('Helvetica').fontSize(7).fillColor('#0f172a');

    const maxRows = documents.slice(0, 120);
    for (const row of maxRows) {
      if (y > 760) {
        doc.addPage();
        addStatementPdfPageHeader(doc, title, subtitle);
        y = 104;
        drawStatementPdfTableHeader(doc, y);
        y += 24;
        doc.font('Helvetica').fontSize(7).fillColor('#0f172a');
      }
      const fill = row.normalized_status === 'vencido' ? '#fff1f2' : '#ffffff';
      doc.rect(36, y - 3, 540, 22).fill(fill).strokeColor('#e2e8f0').stroke();
      doc.fillColor('#0f172a');
      doc.text(row.invoice_number || String(row.id || ''), 42, y + 3, { width: 58, ellipsis: true });
      doc.text(row.customer_name || '-', 100, y + 3, { width: 110, ellipsis: true });
      doc.text(formatDate(row.issue_date || row.created_at) || '-', 214, y + 3, { width: 48 });
      doc.text(formatDate(row.due_date) || '-', 264, y + 3, { width: 48 });
      doc.text(statementPdfMoney(row.total_amount, row.currency_code), 315, y + 3, { width: 58, align: 'right' });
      doc.text(statementPdfMoney(row.paid_amount, row.currency_code), 378, y + 3, { width: 58, align: 'right' });
      doc.text(statementPdfMoney(row.credited_total, row.currency_code), 442, y + 3, { width: 48, align: 'right' });
      doc.font('Helvetica-Bold').fillColor(row.normalized_status === 'vencido' ? '#b91c1c' : '#0f172a').text(statementPdfMoney(row.balance, row.currency_code), 496, y + 3, { width: 70, align: 'right' });
      doc.font('Helvetica').fillColor('#0f172a');
      y += 22;
    }

    if (documents.length > maxRows.length) {
      y += 10;
      doc.fontSize(8).fillColor('#64748b').text(`Se muestran ${maxRows.length} de ${documents.length} documentos. Use filtros para un PDF mas especifico.`, 36, y);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(`Pagina ${i + 1} de ${range.count}`, 36, 812, { width: 540, align: 'right' });
    }
    doc.end();
  } catch (e) {
    console.error('[customer-statement-pdf] Error:', e);
    res.status(500).json({ error: 'Error al generar PDF de estado de cuenta' });
  }
});
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, organization_id, from_date, to_date, search } = req.query;
    const userId = req.user.id;
    const userRole = String(req.user.role || '').toLowerCase();

    const params = [];

    const buildQuery = (withService) => {
      let q = `
        SELECT 
          i.*,
          o.name as organization_name,
          COALESCE(d.title, ${withService ? 'sc.reference' : "''"}) as deal_title,
          COALESCE(d.reference, ${withService ? 'sc.reference' : "''"}) as deal_reference,
          u.name as created_by_name,
          it.first_item_desc as first_item_desc,
          COALESCE(
            i.currency_code,
            JSON_UNQUOTE(JSON_EXTRACT(sqa.inputs_json, '$.operation_currency')),
            JSON_UNQUOTE(JSON_EXTRACT(ql.inputs_json, '$.operation_currency'))${withService ? ', JSON_UNQUOTE(JSON_EXTRACT(sq.inputs_json, \'$.operation_currency\'))' : ''},
            'USD'
          ) AS currency_resolved,
          COALESCE(
            i.exchange_rate,
            JSON_EXTRACT(sqa.inputs_json, '$.exchange_rate_atm_gs_per_usd'),
            JSON_EXTRACT(sqa.inputs_json, '$.exchange_rate_operation_sell_usd'),
            JSON_EXTRACT(ql.inputs_json, '$.exchange_rate_atm_gs_per_usd'),
            JSON_EXTRACT(ql.inputs_json, '$.exchange_rate_operation_sell_usd')${withService ? ', JSON_EXTRACT(sq.inputs_json, \'$.exchange_rate_atm_gs_per_usd\'), JSON_EXTRACT(sq.inputs_json, \'$.exchange_rate_operation_sell_usd\')' : ''},
            1
          ) AS exchange_rate_resolved,
          COALESCE(
            i.currency_code,
            JSON_UNQUOTE(JSON_EXTRACT(sqa.inputs_json, '$.operation_currency')),
            JSON_UNQUOTE(JSON_EXTRACT(ql.inputs_json, '$.operation_currency'))${withService ? ', JSON_UNQUOTE(JSON_EXTRACT(sq.inputs_json, \'$.operation_currency\'))' : ''},
            'USD'
          ) AS currency_code,
          COALESCE(
            i.exchange_rate,
            JSON_EXTRACT(sqa.inputs_json, '$.exchange_rate_atm_gs_per_usd'),
            JSON_EXTRACT(sqa.inputs_json, '$.exchange_rate_operation_sell_usd'),
            JSON_EXTRACT(ql.inputs_json, '$.exchange_rate_atm_gs_per_usd'),
            JSON_EXTRACT(ql.inputs_json, '$.exchange_rate_operation_sell_usd')${withService ? ', JSON_EXTRACT(sq.inputs_json, \'$.exchange_rate_atm_gs_per_usd\'), JSON_EXTRACT(sq.inputs_json, \'$.exchange_rate_operation_sell_usd\')' : ''},
            1
          ) AS exchange_rate
        FROM invoices i
        LEFT JOIN organizations o ON o.id = i.organization_id
        LEFT JOIN deals d ON d.id = i.deal_id
        LEFT JOIN service_quote_additions sqa ON sqa.id = i.service_quote_addition_id
        LEFT JOIN (
          SELECT invoice_id,
                 SUBSTRING_INDEX(GROUP_CONCAT(description ORDER BY item_order, id SEPARATOR '||'), '||', 1) AS first_item_desc
            FROM invoice_items
           GROUP BY invoice_id
        ) it ON it.invoice_id = i.id
        LEFT JOIN (
          SELECT q1.deal_id, q1.inputs_json
          FROM quotes q1
          JOIN (SELECT deal_id, MAX(id) AS id FROM quotes GROUP BY deal_id) q2 ON q2.id = q1.id
        ) ql ON ql.deal_id = i.deal_id
        ${withService ? 'LEFT JOIN service_cases sc ON sc.id = i.service_case_id' : ''}
        ${withService ? 'LEFT JOIN service_quotes sq ON sq.service_case_id = i.service_case_id' : ''}
        LEFT JOIN users u ON u.id = i.created_by
        WHERE 1=1
      `;

      if (userRole === 'ejecutivo') {
        q += ' AND i.created_by = ?';
        params.push(userId);
      }
      if (status) { q += ' AND i.status = ?'; params.push(status); }
      if (organization_id) { q += ' AND i.organization_id = ?'; params.push(organization_id); }
      if (from_date) { q += ' AND i.issue_date >= ?'; params.push(from_date); }
      if (to_date) { q += ' AND i.issue_date <= ?'; params.push(to_date); }
      if (search) {
        q += ` AND (i.invoice_number LIKE ? OR o.name LIKE ? OR d.reference LIKE ?${withService ? ' OR sc.reference LIKE ?' : ''})`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        if (withService) params.push(`%${search}%`);
      }

      q += ' ORDER BY i.created_at DESC';
      return q;
    };

    try {
      const query = buildQuery(true);
      const [invoices] = await pool.query(query, params);
      return res.json(invoices);
    } catch (err) {
      if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      params.length = 0;
      const query = buildQuery(false);
      const [invoices] = await pool.query(query, params);
      return res.json(invoices);
    }
  } catch (e) {
    console.error('[invoices] Error listing:', e);
    res.status(500).json({ error: 'Error al listar facturas' });
  }
});

// GET /api/invoices/operation-docs?deal_id=# or service_case_id=#
router.get('/operation-docs', requireAuth, async (req, res) => {
  try {
    await ensureInvoiceExtraColumns();
    const dealId = Number(req.query?.deal_id || 0);
    const serviceCaseId = Number(req.query?.service_case_id || 0);
    if (!dealId && !serviceCaseId) {
      return res.status(400).json({ error: 'deal_id o service_case_id requerido' });
    }

    const [invRows] = await pool.query(
      `SELECT id, invoice_number, issue_date, created_at, status, total_amount, currency_code, percentage, cost_sheet_version_number, quote_revision_id
         FROM invoices
        WHERE ${dealId ? 'deal_id = ?' : 'service_case_id = ?'}
        ORDER BY issue_date ASC, created_at ASC, id ASC`,
      [dealId || serviceCaseId]
    );

    let cnRows = [];
    try {
      const [rows] = await pool.query(
        `SELECT cn.id, cn.credit_note_number, cn.issue_date, cn.created_at, cn.status, cn.total_amount, cn.invoice_id
           FROM credit_notes cn
           JOIN invoices i ON i.id = cn.invoice_id
          WHERE ${dealId ? 'i.deal_id = ?' : 'i.service_case_id = ?'}
          ORDER BY cn.issue_date ASC, cn.created_at ASC, cn.id ASC`,
        [dealId || serviceCaseId]
      );
      cnRows = rows || [];
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
      cnRows = [];
    }

    const docs = [
      ...(invRows || []).map((r) => ({
        kind: 'invoice',
        id: r.id,
        number: r.invoice_number,
        issue_date: r.issue_date,
        created_at: r.created_at,
        status: r.status,
        total_amount: r.total_amount,
        currency_code: r.currency_code,
        percentage: r.percentage,
        cost_sheet_version_number: r.cost_sheet_version_number || null,
        quote_revision_id: r.quote_revision_id || null,
      })),
      ...(cnRows || []).map((r) => ({
        kind: 'credit_note',
        id: r.id,
        number: r.credit_note_number,
        issue_date: r.issue_date,
        created_at: r.created_at,
        status: r.status,
        total_amount: r.total_amount,
        currency_code: null,
        invoice_id: r.invoice_id,
      })),
    ];

    docs.sort((a, b) => {
      const da = a.issue_date ? new Date(a.issue_date) : a.created_at ? new Date(a.created_at) : new Date(0);
      const db = b.issue_date ? new Date(b.issue_date) : b.created_at ? new Date(b.created_at) : new Date(0);
      const diff = da - db;
      if (diff !== 0) return diff;
      if (a.kind !== b.kind) return a.kind === 'invoice' ? -1 : 1;
      return Number(a.id || 0) - Number(b.id || 0);
    });

    res.json(docs);
  } catch (e) {
    console.error('[invoices] operation-docs error:', e);
    res.status(500).json({ error: 'No se pudieron obtener los documentos' });
  }
});

// GET /api/invoices/billable-items?deal_id=#
router.get('/billable-items', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureInvoiceExtraColumns();
    await ensureInvoiceItemSourceColumns();
    const dealId = Number(req.query?.deal_id || 0);
    const serviceCaseId = Number(req.query?.service_case_id || 0);
    const costSheetVersionNumber = Number(req.query?.cost_sheet_version_number || req.query?.cost_sheet_version || 0) || null;
    const quoteRevisionId = Number(req.query?.quote_revision_id || req.query?.revision_id || 0) || null;
    if (!dealId && !serviceCaseId) {
      return res.status(400).json({ error: 'deal_id o service_case_id requerido' });
    }
    const items = dealId
      ? await fetchDealQuoteBillableItems(dealId, conn, costSheetVersionNumber, quoteRevisionId)
      : await fetchServiceCaseBillableItems(serviceCaseId, conn, quoteRevisionId);
    res.json(items);
  } catch (e) {
    console.error('[invoices] billable-items error:', e);
    res.status(500).json({ error: e?.message || 'No se pudieron obtener los items facturables' });
  } finally {
    conn.release();
  }
});

// POST /api/invoices - Crear factura (borrador)
router.post('/', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureInvoiceExtraColumns();
    await ensureInvoiceCreditColumns();
    await ensureInvoiceMoneyColumns();

    const {
      deal_id,
      service_case_id,
      service_quote_addition_id,
      container_billing_cycle_id,
      due_date,
      payment_terms,
      notes,
      payment_condition,
      timbrado_number,
      timbrado_start_date,
      timbrado_expires_at,
      point_of_issue,
      establishment,
      customer_doc_type,
      customer_doc,
      customer_email,
      customer_address,
      currency_code,
      exchange_rate,
      sales_rep,
      purchase_order_ref,
      percentage,
      selected_quote_items,
      cost_sheet_version_number,
      quote_revision_id,
    } = req.body || {};

    const costSheetVersionNumber = Number(cost_sheet_version_number || req.body?.cost_sheet_version || 0) || null;
    const quoteRevisionId = Number(quote_revision_id || req.body?.revision_id || 0) || null;
    const selectedQuoteItems = Array.isArray(selected_quote_items)
      ? selected_quote_items.map((v) => String(v || '').trim()).filter(Boolean)
      : [];
    const hasSelectedQuoteItems = selectedQuoteItems.length > 0;

    if (!deal_id && !service_case_id && !service_quote_addition_id && !container_billing_cycle_id) {
      return res.status(400).json({ error: 'deal_id, service_case_id o container_billing_cycle_id es requerido' });
    }
    if (hasSelectedQuoteItems && !deal_id && !service_case_id) {
      return res.status(400).json({ error: 'La seleccion de items pendientes solo aplica a operaciones o servicios.' });
    }
    if (!canCreateInvoice(req.user)) {
      return res.status(403).json({ error: 'No tienes permiso para crear facturas' });
    }

    await conn.beginTransaction();

    let deal = null;
    let serviceCase = null;
    let addition = null;
    let containerBilling = null;
    let buKey = '';
    if (container_billing_cycle_id) {
      const userRole = String(req.user?.role || '').toLowerCase();
      if (userRole !== 'admin') {
        await conn.rollback();
        return res.status(403).json({ error: 'Solo un usuario admin puede facturar mensualidades de ATM CONTAINER.' });
      }
      containerBilling = await fetchContainerBillingInfo(Number(container_billing_cycle_id), conn);
      if (!containerBilling) {
        await conn.rollback();
        return res.status(400).json({ error: 'Mensualidad container no encontrada' });
      }
      const initialCoverage = await fetchContainerInitialInvoiceCoverage(
        Number(containerBilling.contract_id),
        Number(containerBilling.deal_id),
        conn
      );
      if (
        initialCoverage &&
        datesOverlap(
          containerBilling.period_start,
          containerBilling.period_end,
          initialCoverage.period_start,
          initialCoverage.period_end
        )
      ) {
        await conn.rollback();
        return res.status(400).json({
          error: `El primer periodo ya fue cubierto por la factura inicial ${initialCoverage.initial_invoice_number || `#${initialCoverage.initial_invoice_id}`}.`,
        });
      }
      const [[latestBillingInvoice]] = await conn.query(
        `
          SELECT id, status, canceled_by_credit_note_id, invoice_number
          FROM invoices
          WHERE container_billing_cycle_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
        [Number(container_billing_cycle_id)]
      );
      const latestBillingInvoiceStatus = String(latestBillingInvoice?.status || '').toLowerCase();
      if (latestBillingInvoice && latestBillingInvoiceStatus !== 'anulada') {
        await conn.rollback();
        return res.status(400).json({ error: 'La mensualidad ya fue facturada para ese periodo.' });
      }
      if (
        latestBillingInvoice &&
        latestBillingInvoiceStatus === 'anulada' &&
        !latestBillingInvoice.canceled_by_credit_note_id
      ) {
        await conn.rollback();
        return res.status(400).json({
          error:
            'Ese periodo mensual ya fue facturado. Solo puede refacturarse si la factura anterior fue anulada mediante nota de credito.',
        });
      }
      deal = {
        id: containerBilling.deal_id,
        organization_id: containerBilling.organization_id,
        reference: containerBilling.reference,
        title: containerBilling.title,
        deal_value: containerBilling.amount,
        business_unit_key: containerBilling.business_unit_key || '',
      };
      buKey = deal.business_unit_key || '';
    } else if (deal_id) {
      const [[row]] = await conn.query(
        `SELECT d.id, d.org_id AS organization_id, d.reference, d.title, d.value AS deal_value, bu.key_slug AS business_unit_key
         FROM deals d
         LEFT JOIN business_units bu ON bu.id = d.business_unit_id
         WHERE d.id = ?`,
        [deal_id]
      );
      deal = row || null;
      if (!deal) {
        await conn.rollback();
        return res.status(400).json({ error: 'Operacion no encontrada' });
      }
      buKey = deal.business_unit_key || '';
    } else {
      const [[row]] = await conn.query(
        `SELECT sc.id, sc.org_id AS organization_id, sc.reference, sc.status
           FROM service_cases sc
          WHERE sc.id = ?`,
        [service_case_id]
      );
      serviceCase = row || null;
      if (!serviceCase && service_quote_addition_id) {
        const [[addRow]] = await conn.query(
          `SELECT a.id, a.service_case_id, sc.org_id AS organization_id, sc.reference, sc.status
             FROM service_quote_additions a
             LEFT JOIN service_cases sc ON sc.id = a.service_case_id
            WHERE a.id = ?`,
          [service_quote_addition_id]
        );
        if (addRow?.service_case_id) {
          serviceCase = {
            id: addRow.service_case_id,
            organization_id: addRow.organization_id,
            reference: addRow.reference,
            status: addRow.status,
          };
          addition = { id: addRow.id, service_case_id: addRow.service_case_id };
        }
      }
      if (!serviceCase) {
        await conn.rollback();
        return res.status(400).json({ error: 'Servicio no encontrado' });
      }
      buKey = 'atm-industrial';
    }
    const numberingDefaults = await peekInvoiceDefaults({ buKey }, conn);
    const fiscalValidation = validateInvoiceFiscalConfig(numberingDefaults, new Date());
    if (!fiscalValidation.ok) {
      await conn.rollback();
      return res.status(400).json({
        error: 'La configuraci?n fiscal de facturaci?n est? incompleta o inv?lida.',
        details: fiscalValidation.problems,
      });
    }

    const { invoice_number, point_of_issue: poi, establishment: est } = await nextInvoiceNumber(
      buKey,
      conn
    );

    const issueDate = new Date();
    const dueDate = due_date
      ? new Date(due_date)
      : containerBilling?.due_date
      ? new Date(containerBilling.due_date)
      : null;
    const perc = containerBilling ? null : Number(percentage || 100);
    if (!containerBilling && (!Number.isFinite(perc) || perc <= 0 || perc > 100)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Ingresa un porcentaje valido entre 1 y 100' });
    }
    const useAddition = Number(service_quote_addition_id || 0) > 0;
    const effectiveServiceCaseId = deal_id || containerBilling ? null : (service_case_id || serviceCase?.id || null);
    const quoteCurrency = containerBilling
      ? { currency: String(containerBilling.currency_code || 'PYG').toUpperCase(), exchange_rate: 1 }
      : deal_id
      ? await fetchQuoteCurrencyInfo(deal_id, conn, costSheetVersionNumber, quoteRevisionId)
      : useAddition
      ? await fetchServiceQuoteAdditionCurrencyInfo(Number(service_quote_addition_id), conn)
      : await fetchServiceQuoteCurrencyInfo(effectiveServiceCaseId, conn, quoteRevisionId);
    const quoteTotalUsd = containerBilling
      ? null
      : deal_id
      ? await fetchQuoteTotalUsd(deal_id, conn, costSheetVersionNumber, quoteRevisionId)
      : useAddition
      ? await fetchServiceQuoteAdditionTotalUsd(Number(service_quote_addition_id), conn)
      : await fetchServiceQuoteTotalUsd(effectiveServiceCaseId, conn, quoteRevisionId);
    const fallbackDealValueUsd =
      deal && quoteTotalUsd == null
        ? normalizeAmountToUsd(deal.deal_value, quoteCurrency.currency, quoteCurrency.exchange_rate)
        : 0;
    const baseAmountUsd = Number(
      req.body?.base_amount ??
      containerBilling?.amount ??
      quoteTotalUsd ??
      fallbackDealValueUsd ??
      0
    ) || 0;

    const branchInfo = deal_id || containerBilling
      ? await fetchDealBranchInfo(deal?.id, conn)
      : await fetchServiceCaseBranchInfo(effectiveServiceCaseId, conn);
    const branchAddress = branchInfo
      ? [branchInfo.address, branchInfo.city, branchInfo.country].filter(Boolean).join(' - ')
      : null;
    const resolvedCustomerAddress = customer_address || branchAddress || null;

    const invoiceRevisionWhere = deal_id && costSheetVersionNumber
      ? ' AND cost_sheet_version_number = ?'
      : deal_id && quoteRevisionId
      ? ' AND quote_revision_id = ?'
      : '';
    const invoiceRevisionParams = deal_id && costSheetVersionNumber
      ? [costSheetVersionNumber]
      : deal_id && quoteRevisionId
      ? [quoteRevisionId]
      : [];

    if (containerBilling) {
      // No aplica control porcentual por deal para mensualidades container.
    } else if (useAddition) {
      const [[dup]] = await conn.query(
        `SELECT id, invoice_number
           FROM invoices
          WHERE service_quote_addition_id = ?
            AND status <> 'anulada'
            
            AND percentage IS NOT NULL
            AND ABS(percentage - ?) < 0.0001
          LIMIT 1`,
        [service_quote_addition_id, perc]
      );
      if (dup) {
        await conn.rollback();
        return res.status(400).json({ error: `El ${perc}% ya fue facturado${dup.invoice_number ? ` en la factura ${dup.invoice_number}` : ''}.` });
      }
      const [[agg]] = await conn.query(
        `SELECT COALESCE(SUM(percentage),0) AS used_pct
           FROM invoices
          WHERE service_quote_addition_id = ?
            AND status <> 'anulada'`,
        [service_quote_addition_id]
      );
      const usedPct = Number(agg.used_pct || 0);
      if (usedPct + perc > 100.0001) {
        await conn.rollback();
        return res.status(400).json({ error: `El porcentaje supera el 100% (ya facturado ${usedPct.toFixed(2)}%)` });
      }
    } else if (!hasSelectedQuoteItems) {
      const scopeValue = deal_id ? deal_id : effectiveServiceCaseId;
      const [[dup]] = await conn.query(
        `SELECT id, invoice_number
           FROM invoices
          WHERE ${deal_id ? 'deal_id = ?' : 'service_case_id = ?'}
            AND status <> 'anulada'
            ${invoiceRevisionWhere}
            AND percentage IS NOT NULL
            AND ABS(percentage - ?) < 0.0001
          LIMIT 1`,
        [scopeValue, ...invoiceRevisionParams, perc]
      );
      if (dup) {
        await conn.rollback();
        return res.status(400).json({ error: `El ${perc}% ya fue facturado${dup.invoice_number ? ` en la factura ${dup.invoice_number}` : ''}.` });
      }
      const [[agg]] = await conn.query(
        `SELECT COALESCE(SUM(percentage),0) AS used_pct
           FROM invoices
          WHERE ${deal_id ? 'deal_id = ?' : 'service_case_id = ?'}
            AND status <> 'anulada'
            ${invoiceRevisionWhere}`,
        [scopeValue, ...invoiceRevisionParams]
      );
      const usedPct = Number(agg.used_pct || 0);
      if (usedPct + perc > 100.0001) {
        await conn.rollback();
        return res.status(400).json({ error: `El porcentaje supera el 100% (ya facturado ${usedPct.toFixed(2)}%)` });
      }
    }

    // ✅ Moneda: por defecto desde la cotización
    const curr = String(currency_code || req.body?.currency || quoteCurrency.currency || 'USD').toUpperCase();
    const exRate = Number(exchange_rate || quoteCurrency.exchange_rate || 1) || 1;
    const quoteSourceExchangeRate = resolveSourceExchangeRate(
      quoteCurrency.currency,
      quoteCurrency.exchange_rate,
      exRate
    );
    const isPyg = curr === 'PYG' || curr === 'GS';
    const currencyFactor = isPyg ? exRate : 1;
    const effectiveBaseAmountUsd =
      deal && quoteTotalUsd == null
        ? normalizeAmountToUsd(deal.deal_value, quoteCurrency.currency, quoteSourceExchangeRate)
        : baseAmountUsd;
    const baseAmount = round2(effectiveBaseAmountUsd * currencyFactor);

    let itemsFromQuote = containerBilling
      ? []
      : deal_id
      ? await fetchQuoteItemsForInvoice(deal_id, conn, costSheetVersionNumber, quoteRevisionId)
      : useAddition
      ? await fetchServiceQuoteAdditionItemsForInvoice(Number(service_quote_addition_id), conn)
      : await fetchServiceQuoteItemsForInvoice(effectiveServiceCaseId, conn, quoteRevisionId);
    if (hasSelectedQuoteItems) {
      const selectedPendingItems = deal_id
        ? await assertDealQuoteItemsAvailable(Number(deal_id), selectedQuoteItems, perc, conn, costSheetVersionNumber, quoteRevisionId)
        : await assertServiceQuoteItemsAvailable(Number(effectiveServiceCaseId), selectedQuoteItems, perc, conn, quoteRevisionId);
      if (!selectedPendingItems.length) {
        await conn.rollback();
        return res.status(400).json({ error: 'Los items seleccionados ya no estan pendientes de facturar.' });
      }
      const selectedMap = new Map(selectedPendingItems.map((item) => [String(item.source_item_key), item]));
      itemsFromQuote = itemsFromQuote.filter((item) => selectedMap.has(String(item.source_item_key || '')));
    }
    const factor = containerBilling ? 1 : (perc / 100);
    let invoiceItems = [];
    if (itemsFromQuote.length > 0) {
      invoiceItems = itemsFromQuote.map((it, idx) => {
        const qty = Number(it.quantity || 0) || 1;
        const unitPriceSource = Number(it.unit_price || 0) || 0;
        const unitPriceSourceUsd = normalizeAmountToUsd(
          unitPriceSource,
          quoteCurrency.currency,
          quoteSourceExchangeRate
        );
        const unitPriceAdjUsd = round2(unitPriceSourceUsd * factor);
        const unitPriceAdj = round2(convertUsdToCurrency(unitPriceAdjUsd, curr, exRate));
        const subtotal = round2(qty * unitPriceAdj);
        return {
          description: it.description || 'Item',
          quantity: qty,
          unit_price: unitPriceAdj,
          subtotal,
          tax_rate: readTaxRate(it, 0),
          item_order: Number.isFinite(Number(it.item_order)) ? Number(it.item_order) : idx,
          source_type: deal_id ? 'deal_quote' : effectiveServiceCaseId ? 'service_quote' : null,
          source_parent_id: deal_id ? Number(deal_id) : effectiveServiceCaseId ? Number(effectiveServiceCaseId) : null,
          source_item_key: it.source_item_key || null,
        };
      });
    } else if (containerBilling) {
      const gross = round2(Number(containerBilling.amount || 0));
      invoiceItems = [
        {
          description: `Canon de arrendamiento contrato ${containerBilling.contract_no || "-"}${containerBilling.container_no ? ` � Contenedor ${containerBilling.container_no}${containerBilling.container_type ? ` ${containerBilling.container_type}` : ""}` : ""} � Periodo ${containerBilling.cycle_label || "-"}`,
          quantity: 1,
          unit_price: gross,
          subtotal: gross,
          tax_rate: readTaxRate(containerBilling, 10),
          item_order: 0,
        },
      ];
    } else {
      const baseSubtotal = round2(baseAmount * factor);
      invoiceItems = [
        {
          description: 'Presupuesto de la operacion',
          quantity: 1,
          unit_price: baseSubtotal,
          subtotal: baseSubtotal,
          tax_rate: 0,
          item_order: 0,
        },
      ];
    }

    const subtotal = round2(
      invoiceItems.reduce((sum, it) => {
        const { base } = splitTaxFromGross(Number(it.subtotal || 0), it.tax_rate ?? 0);
        return sum + base;
      }, 0)
    );
    const tax_amount = round2(
      invoiceItems.reduce((sum, it) => {
        const { tax } = splitTaxFromGross(Number(it.subtotal || 0), it.tax_rate ?? 0);
        return sum + tax;
      }, 0)
    );
    const total_amount = round2(
      invoiceItems.reduce((sum, it) => sum + Number(it.subtotal || 0), 0)
    );
    if (total_amount <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'La factura debe tener un total mayor a cero.' });
    }

    const credited_total = 0;
    const net_total_amount = Number((total_amount - credited_total).toFixed(2));
    const net_balance = Number((total_amount - credited_total).toFixed(2));
    const effectiveInvoiceBaseAmount = hasSelectedQuoteItems ? total_amount : baseAmount;

    const [result] = await conn.query(
  `INSERT INTO invoices (
    deal_id, service_case_id, service_quote_addition_id, container_billing_cycle_id, container_contract_id, organization_id, invoice_number, issue_date, due_date, payment_terms, notes,
    payment_condition, timbrado_number, timbrado_start_date, timbrado_expires_at,
    point_of_issue, establishment, customer_doc_type, customer_doc, customer_email, customer_address,
    currency_code, exchange_rate, sales_rep, purchase_order_ref,
    percentage, base_amount, subtotal, tax_amount, total_amount,
    paid_amount, balance,
    credited_total, net_total_amount, net_balance,
    status, created_by, cost_sheet_version_number, quote_revision_id
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?
  )`,
  [
    deal ? deal.id : null,
    serviceCase ? serviceCase.id : null,
    service_quote_addition_id ? Number(service_quote_addition_id) : null,
    container_billing_cycle_id ? Number(container_billing_cycle_id) : null,
    containerBilling?.contract_id || null,
    deal ? deal.organization_id : serviceCase?.organization_id,
    invoice_number,
    issueDate,
    dueDate,
    payment_terms || (containerBilling ? 'mensual' : null),
    notes || (containerBilling ? `Mensualidad ${containerBilling.cycle_label || ""}`.trim() : ''),
    payment_condition || (containerBilling ? 'credito' : 'credito'),
    timbrado_number || null,
    timbrado_start_date || null,
    timbrado_expires_at || null,
    point_of_issue || poi,
    establishment || est,
    customer_doc_type || 'RUC',
    customer_doc || null,
    customer_email || null,
    resolvedCustomerAddress,
    curr,
    exRate,
    sales_rep || null,
    purchase_order_ref || (containerBilling ? containerBilling.contract_no || null : null),
    perc,
    effectiveInvoiceBaseAmount,
    subtotal,
    tax_amount,
    total_amount,
    0,              // paid_amount
    total_amount,   // balance (si arranca sin pagos)
    0,              // credited_total
    total_amount,   // net_total_amount
    total_amount,   // net_balance
    'borrador',     // status
    req.user.id,    // created_by
    costSheetVersionNumber,
    quoteRevisionId,
  ]
);

    const newId = result.insertId;

    // Guardar items
    await ensureInvoiceItemsTaxColumn();
    for (const it of invoiceItems) {
      await conn.query(
        `INSERT INTO invoice_items
         (invoice_id, description, quantity, unit_price, subtotal, tax_rate, item_order, source_type, source_parent_id, source_item_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          it.description,
          it.quantity,
          it.unit_price,
          it.subtotal,
          it.tax_rate ?? 0,
          it.item_order ?? 0,
          it.source_type || null,
          it.source_parent_id || null,
          it.source_item_key || null,
        ]
      );
    }

    if (containerBilling && container_billing_cycle_id) {
      await conn.query(
        `
          UPDATE container_billing_cycles
          SET invoice_id = ?, invoiced_at = NOW(), invoiced_by = ?, status = 'facturado'
          WHERE id = ?
        `,
        [newId, req.user.id, Number(container_billing_cycle_id)]
      );
    }

    await conn.commit();

    const [[created]] = await pool.query(
      `SELECT i.*, o.name as organization_name
       FROM invoices i
       LEFT JOIN organizations o ON o.id = i.organization_id
       WHERE i.id = ?`,
      [newId]
    );
    res.status(201).json(created);
  } catch (e) {
    await conn.rollback();
    console.error('[invoices] Error creating invoice:', e?.message || e, e?.sqlMessage || null);
    res.status(500).json({ error: e?.sqlMessage || e?.message || 'Error al crear factura' });
  } finally {
    conn.release();
  }
});

// DELETE /api/invoices/:id - Anular/eliminar factura
router.delete('/:id', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const [[invoice]] = await conn.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) {
      conn.release();
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    if (!canManageInvoice(req.user, invoice)) {
      conn.release();
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta factura' });
    }
    if (invoice.status === 'anulada') {
      conn.release();
      return res.status(400).json({ error: 'La factura ya está anulada' });
    }

    await conn.beginTransaction();
    await conn.query(
      `UPDATE invoices 
         SET status = 'anulada',
             cancellation_reason = ?,
             canceled_by_credit_note_id = NULL,
             balance = 0,
             net_balance = 0
       WHERE id = ?`,
      ['Eliminada manualmente', id]
    );
    await conn.commit();
    await syncContainerBillingCycleFromInvoice(id);

    const [[updated]] = await pool.query(
      `SELECT i.*, o.name as organization_name
         FROM invoices i
         LEFT JOIN organizations o ON o.id = i.organization_id
        WHERE i.id = ?`,
      [id]
    );
    res.json(updated);
  } catch (e) {
    await conn.rollback();
    console.error('[invoices] Error deleting invoice:', e);
    res.status(500).json({ error: 'Error al eliminar factura' });
  } finally {
    conn.release();
  }
});

// POST /api/invoices/:id/cancel - Anular factura desde el detalle
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim().slice(0, 255);
    if (!reason) return res.status(400).json({ error: 'Debe cargar un motivo de anulacion' });

    const [[invoice]] = await conn.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (!canManageInvoice(req.user, invoice)) {
      return res.status(403).json({ error: 'No tienes permiso para anular esta factura' });
    }
    if (String(invoice.status || '').toLowerCase() === 'anulada') {
      return res.status(400).json({ error: 'La factura ya esta anulada' });
    }

    await conn.beginTransaction();
    await conn.query(
      `UPDATE invoices
          SET status = 'anulada',
              cancellation_reason = ?,
              canceled_by_credit_note_id = NULL,
              balance = 0,
              net_balance = 0
        WHERE id = ?`,
      [reason, id]
    );
    await conn.commit();
    await syncContainerBillingCycleFromInvoice(id);

    const [[updated]] = await pool.query(
      `SELECT i.*, o.name as organization_name
         FROM invoices i
         LEFT JOIN organizations o ON o.id = i.organization_id
        WHERE i.id = ?`,
      [id]
    );
    res.json(updated);
  } catch (e) {
    await conn.rollback();
    console.error('[invoices] Error canceling invoice:', e);
    res.status(500).json({ error: 'Error al anular factura' });
  } finally {
    conn.release();
  }
});
// GET /api/invoices/receipts - Lista de recibos
router.get('/receipts', requireAuth, async (req, res) => {
  try {
    await ensureReceiptTables();
    try {
      const [rows] = await pool.query(
        `SELECT r.*, i.invoice_number, i.organization_id, i.deal_id, i.service_case_id,
                COALESCE(d.reference, sc.reference) as deal_reference, o.name as organization_name
           FROM receipts r
           LEFT JOIN invoices i ON i.id = r.invoice_id
           LEFT JOIN deals d ON d.id = i.deal_id
           LEFT JOIN service_cases sc ON sc.id = i.service_case_id
           LEFT JOIN organizations o ON o.id = i.organization_id
          WHERE r.status = 'emitido'
          ORDER BY r.issue_date DESC, r.id DESC`
      );
      return res.json(rows);
    } catch (err) {
      if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      const [rows] = await pool.query(
        `SELECT r.*, i.invoice_number, i.organization_id, i.deal_id,
                d.reference as deal_reference, o.name as organization_name
           FROM receipts r
           LEFT JOIN invoices i ON i.id = r.invoice_id
           LEFT JOIN deals d ON d.id = i.deal_id
           LEFT JOIN organizations o ON o.id = i.organization_id
          WHERE r.status = 'emitido'
          ORDER BY r.issue_date DESC, r.id DESC`
      );
      return res.json(rows);
    }
  } catch (e) {
    console.error('[receipts] Error listing', e);
    res.status(500).json({ error: 'Error al listar recibos' });
  }
});

// GET /api/invoices/receipts/:id/pdf - PDF de recibo
router.get('/receipts/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureReceiptTables();

    const [[receipt]] = await pool.query(
      `SELECT r.*, i.invoice_number, i.issue_date as invoice_issue_date, i.currency_code as invoice_currency_code,
              i.total_amount as invoice_total_amount, i.organization_id,
              o.name as organization_name, o.ruc as organization_ruc, o.address as organization_address,
              u.name as issued_by_name
         FROM receipts r
         LEFT JOIN invoices i ON i.id = r.invoice_id
         LEFT JOIN organizations o ON o.id = i.organization_id
         LEFT JOIN users u ON u.id = r.issued_by
        WHERE r.id = ?`,
      [id]
    );
    if (!receipt) return res.status(404).json({ error: 'Recibo no encontrado' });

    const { invoice, error } = await loadInvoiceWithPerms(req, receipt.invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });

    const [apps] = await pool.query(
      `SELECT ra.amount_applied, i.invoice_number, i.issue_date, i.currency_code
         FROM receipt_applications ra
         LEFT JOIN invoices i ON i.id = ra.invoice_id
        WHERE ra.receipt_id = ?
        ORDER BY ra.id`,
      [id]
    );

    const issuerActivities =
      process.env.RECEIPT_ISSUER_ACTIVITIES ||
      process.env.INVOICE_ISSUER_ACTIVITIES ||
      'TRANSPORTE TERRESTRE DE CARGA INTERDEPARTAMENTAL E INTERNACIONAL - ' +
      'ACTIVIDADES DE LOS AGENTES DE TRANSPORTE TERRESTRE - ACTIVIDADES AUXILIARES AL ' +
      'TRANSPORTE ACUATICO - TRANSPORTE TERRESTRE LOCAL DE CARGA - TRANSPORTE AEREO DE CARGA - ' +
      'COMERCIO AL POR MENOR DE OTROS PRODUCTOS EN COMERCIOS NO ESPECIALIZADOS.';

    const issuer = {
      name: process.env.INVOICE_ISSUER_NAME || 'ATM CARGO S.R.L.',
      ruc: process.env.INVOICE_ISSUER_RUC || '80056841-6',
      phone: process.env.INVOICE_ISSUER_PHONE || '+595 21 493082',
      address:
        process.env.INVOICE_ISSUER_ADDRESS || 'Cap. Milciades Urbieta 175 e/ Rio de Janeiro y Mcal. Lopez',
      city: process.env.INVOICE_ISSUER_CITY || 'Asuncion - Paraguay',
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="receipt-${receipt.receipt_number || id}.pdf"`
    );

    const issueDate = receipt.issue_date ? new Date(receipt.issue_date) : new Date();
    const cityShort = String(issuer.city || 'Asuncion').split('-')[0].trim();
    const issuePlaceDate = `${cityShort} ${formatDateLong(issueDate)}`;

    const amount = Number(receipt.net_amount ?? receipt.amount ?? 0);
    const currency = receipt.currency_code || receipt.invoice_currency_code || 'USD';
    const paymentType = String(receipt.payment_method || 'PAGO').toUpperCase();

    const fallbackInvoice = {
      amount_applied: amount,
      invoice_number: receipt.invoice_number || invoice.invoice_number || '',
      issue_date: receipt.invoice_issue_date || invoice.issue_date || '',
      currency_code: currency,
    };

    const rows = (apps && apps.length ? apps : [fallbackInvoice]).map((row) => ({
      number: row.invoice_number || '',
      issueDate: formatDate(row.issue_date),
      currency: row.currency_code || currency,
      amount: Number(row.amount_applied || amount),
      paymentType,
      paidAmount: Number(row.amount_applied || amount),
    }));

    const logoPath = await getBrandLogoPath();

    const data = {
      logoPath,
      issuer: {
        name: issuer.name,
        address: issuer.address,
        phone: issuer.phone,
        city: issuer.city,
        activities: issuerActivities,
      },
      receiptNumber: receipt.receipt_number || '',
      issuePlaceDate,
      amount,
      currency,
      receivedFrom: receipt.organization_name || invoice.organization_name || '',
      invoices: rows,
      issuedByName: receipt.issued_by_name || '',
    };

    await generateReceiptPDF(data, res);
  } catch (e) {
    console.error('[receipts] Error generating PDF', e);
    res.status(500).json({ error: 'Error al generar PDF' });
  }
});

// POST /api/invoices/:id/receipts - Registrar recibo/pago
router.post('/:id/receipts', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { amount, payment_method, payment_date, currency, bank_account, reference_number, retention_pct, net_amount } = req.body;
    await ensureReceiptTables();
    await ensureInvoiceCreditColumns();
    const [[invoice]] = await conn.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) {
      conn.release();
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    if (!canManageInvoice(req.user, invoice)) {
      conn.release();
      return res.status(403).json({ error: 'Sin permiso' });
    }

    // Recalcular saldo pendiente por si net_balance/balance están en 0
    const [invItems] = await conn.query("SELECT subtotal, tax_rate FROM invoice_items WHERE invoice_id = ?", [id]);
    const totalsCalc = calculateTotals(invItems || []);
    const creditedInv = Number(invoice.credited_total || 0);
    const totalFromItems = Number(totalsCalc.total_amount || 0);
    const totalFromInvoice = Number(invoice.total_amount || 0) > 0
      ? Number(invoice.total_amount || 0)
      : Math.max(0, Number(invoice.subtotal || 0) + Number(invoice.tax_amount || 0));
    const baseTotal = totalFromItems > 0 ? totalFromItems : totalFromInvoice;
    const netTotalInv = Number(invoice.net_total_amount || 0) > 0
      ? Number(invoice.net_total_amount || 0)
      : Math.max(0, baseTotal - creditedInv);
    const [[paidRow]] = await conn.query(
      "SELECT COALESCE(SUM(net_amount),0) AS paid FROM receipts WHERE invoice_id = ? AND status <> 'anulado'",
      [id]
    );
    const paidInv = Number(paidRow?.paid || 0);
    const effBalance = Math.max(0, netTotalInv - paidInv);

    const amt = parseFloat(amount || 0);
    const retPct = parseFloat(retention_pct || 0);
    const retAmt = Math.max(0, amt * retPct / 100);
    const netAmt = net_amount ? parseFloat(net_amount) : Math.max(0, amt - retAmt);

    if (amt <= 0 || netAmt <= 0) {
      conn.release();
      return res.status(400).json({ error: 'Monto inválido' });
    }
    if (netAmt - effBalance > 0.01) {
      conn.release();
      return res.status(400).json({ error: 'Monto excede saldo' });
    }

    await conn.beginTransaction();
    const { receiptNumber, point, establishment } = await generateReceiptNumber(
      invoice.point_of_issue,
      invoice.establishment
    );
    const issueDate = payment_date || new Date().toISOString().slice(0, 10);
    const [ins] = await conn.query(
      `INSERT INTO receipts 
       (receipt_number, invoice_id, issue_date, status, currency_code, payment_method, bank_account, reference_number, amount, retention_pct, retention_amount, net_amount, point_of_issue, establishment, created_by, issued_by)
       VALUES (?, ?, ?, 'emitido', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptNumber,
        invoice.id,
        issueDate,
        String(currency || invoice.currency_code || invoice.currency || 'USD').toUpperCase(),
        payment_method || 'transferencia',
        bank_account || null,
        reference_number || null,
        amt,
        retPct || 0,
        retAmt,
        netAmt,
        point,
        establishment,
        req.user.id,
        req.user.id,
      ]
    );
    await conn.query(
      `INSERT INTO receipt_applications (receipt_id, invoice_id, amount_applied) VALUES (?, ?, ?)`,
      [ins.insertId, invoice.id, netAmt]
    );

    await conn.commit();
    await recomputeInvoiceCredits(invoice.id);
    await recomputeInvoicePayments(invoice.id);
    const [[receipt]] = await pool.query('SELECT * FROM receipts WHERE id = ?', [ins.insertId]);
    res.status(201).json(receipt);
  } catch (e) {
    if (conn?.rollback) await conn.rollback();
    console.error('[receipts] Error creating', e);
    res.status(500).json({ error: 'Error al registrar recibo' });
  } finally {
    conn.release();
  }
});

// POST /api/invoices/:id/issue - Emitir factura
router.post('/:id/issue', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const [[invoice]] = await conn.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) {
      conn.release();
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    if (!canManageInvoice(req.user, invoice)) {
      conn.release();
      return res.status(403).json({ error: 'No tienes permiso para emitir esta factura' });
    }
    if (invoice.status != 'borrador') {
      conn.release();
      return res.status(400).json({ error: 'Solo se puede emitir desde borrador' });
    }

    await conn.beginTransaction();
    await conn.query(
      `UPDATE invoices 
         SET status = 'emitida',
             issue_date = CURDATE(),
             issued_by = ?
       WHERE id = ?`,
      [req.user.id, id]
    );
    await conn.commit();

    const [[updated]] = await pool.query(
      `SELECT i.*, o.name as organization_name
         FROM invoices i
         LEFT JOIN organizations o ON o.id = i.organization_id
        WHERE i.id = ?`,
      [id]
    );
    res.json(updated);
  } catch (e) {
    await conn.rollback();
    console.error('[invoices] Error issuing invoice:', e);
    res.status(500).json({ error: 'Error al emitir factura' });
  } finally {
    conn.release();
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
        COALESCE(d.reference, sc.reference) as deal_reference,
        u.name as created_by_name,
        u2.name as issued_by_name
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN service_cases sc ON sc.id = i.service_case_id
      LEFT JOIN users u ON u.id = i.created_by
      LEFT JOIN users u2 ON u2.id = i.issued_by
      WHERE i.id = ?`,
      [id]
    );

    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (!canViewInvoicePdf(req.user, invoice)) {
      return res.status(403).json({ error: 'No tienes permiso para ver esta factura' });
    }

    if ((!invoice.currency_code || !invoice.exchange_rate) && invoice.service_quote_addition_id) {
      try {
        const [[addRow]] = await pool.query(
          'SELECT inputs_json FROM service_quote_additions WHERE id = ? LIMIT 1',
          [invoice.service_quote_addition_id]
        );
        const inputs = asJson(addRow?.inputs_json) || {};
        const curr = String(inputs.operation_currency || '').toUpperCase();
        const rate = Number(inputs.exchange_rate_atm_gs_per_usd || inputs.exchange_rate_customs_internal_gs_per_usd || inputs.exchange_rate_install_gs_per_usd || inputs.exchange_rate_operation_sell_usd || 0) || 0;
        if (!invoice.currency_code && curr) invoice.currency_code = curr;
        if (!invoice.exchange_rate && rate) invoice.exchange_rate = rate;
      } catch (_) {}
    }

    const [items] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY item_order, id',
      [id]
    );

    const [receipts] = await pool.query(
      `SELECT r.*, u.name as issued_by_name
         FROM receipts r
         LEFT JOIN users u ON u.id = r.issued_by
        WHERE r.invoice_id = ? AND r.status = 'emitido'
        ORDER BY r.issue_date DESC, r.id DESC`,
      [id]
    );

    res.json({ ...invoice, items, receipts });
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
        COALESCE(d.reference, sc.reference) as deal_reference,
        COALESCE(d.title, sc.reference) as deal_title
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN service_cases sc ON sc.id = i.service_case_id
      WHERE i.id = ?`,
      [id]
    );
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (!canViewInvoicePdf(req.user, invoice)) {
      return res.status(403).json({ error: 'No tienes permiso para ver esta factura' });
    }

    if ((!invoice.currency_code || !invoice.exchange_rate) && invoice.service_quote_addition_id) {
      try {
        const [[addRow]] = await pool.query(
          'SELECT inputs_json FROM service_quote_additions WHERE id = ? LIMIT 1',
          [invoice.service_quote_addition_id]
        );
        const inputs = asJson(addRow?.inputs_json) || {};
        const curr = String(inputs.operation_currency || '').toUpperCase();
        const rate = Number(inputs.exchange_rate_atm_gs_per_usd || inputs.exchange_rate_customs_internal_gs_per_usd || inputs.exchange_rate_install_gs_per_usd || inputs.exchange_rate_operation_sell_usd || 0) || 0;
        if (!invoice.currency_code && curr) invoice.currency_code = curr;
        if (!invoice.exchange_rate && rate) invoice.exchange_rate = rate;
      } catch (_) {}
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
    const logoPath = await getBrandLogoPath();
    const data = {
      logoPath,
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
      hora: formatParaguayTime(new Date()),
      client: {
        name: invoice.customer_name || invoice.organization_name || '',
        address: invoice.customer_address || invoice.organization_address || '',
        phone: invoice.customer_phone || invoice.organization_phone || '',
        email: invoice.customer_email || '',
        ruc: invoice.customer_doc || invoice.organization_ruc || '',
      },
      facturaAfectada: '',
      condicionVenta: invoice.payment_condition || 'credito',
      moneda: (invoice.currency_code || invoice.currency || 'USD').toUpperCase(),
      refNumero: invoice.deal_reference || invoice.deal_id || '',
      refDetalle: invoice.deal_title || '' ,
      items: items.map((it) => ({
        description: it.description || 'Item',
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0),
        tax_rate: readTaxRate(it, 0),
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
    const [[receiptRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt
         FROM receipts
        WHERE invoice_id = ?
          AND status = 'emitido'
          AND COALESCE(net_amount, amount, 0) > 0`,
      [invoice_id]
    );
    if (Number(receiptRow?.cnt || 0) > 0) {
      return res.status(400).json({ error: 'No se puede crear nota de crédito: la factura ya tiene recibos.' });
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
        const rate = readTaxRate(it, 10);
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
        tax_rate: readTaxRate(it, 10),
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
      return res.status(400).json({ error: `Excede lo disponible en 10% (disp: ${availability.disponible.base10})` });
    }
    if (breakdown.base5 > availability.disponible.base5 + 0.01) {
      return res.status(400).json({ error: `Excede lo disponible en 5% (disp: ${availability.disponible.base5})` });
    }
    if (breakdown.base0 > availability.disponible.base0 + 0.01) {
      return res.status(400).json({ error: `Excede lo disponible exentas (disp: ${availability.disponible.base0})` });
    }

    const creditContext = await resolveCreditNoteContext(invoice);
    const { creditNoteNumber, point, establishment } = await generateCreditNoteNumber(
      invoice.point_of_issue,
      invoice.establishment,
      creditContext
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

    await recomputeInvoiceCredits(invoice.id);

    // ✅ MODIFICACIÓN: recalcular pagos luego de recalcular créditos
    await recomputeInvoicePayments(invoice.id);

    const [[invAfter]] = await pool.query(
      'SELECT id, status, total_amount, credited_total, net_total_amount, paid_amount, net_balance FROM invoices WHERE id = ?',
      [invoice.id]
    );

    const netTotal = parseFloat(invAfter?.net_total_amount || 0);
    const netBalance = parseFloat(invAfter?.net_balance || 0);
    const paid = parseFloat(invAfter?.paid_amount || 0);

    if (netTotal <= 0.01) {
      await pool.query(
        `UPDATE invoices 
         SET status = 'anulada',
             cancellation_reason = ?,
             canceled_by_credit_note_id = ?
         WHERE id = ?`,
        [`Anulada por nota de credito ${note.credit_note_number}`, id, invoice.id]
      );
    } else {
      let newStatus = 'emitida';
      if (netBalance <= 0.01) {
        newStatus = 'pagada';
      } else if (paid > 0) {
        newStatus = 'pago_parcial';
      } else if (['emitida', 'pago_parcial', 'pagada', 'vencida'].includes(invAfter.status)) {
        newStatus = invAfter.status;
      }
      await pool.query(
        `UPDATE invoices 
         SET status = ?
         WHERE id = ?`,
        [newStatus, invoice.id]
      );
    }

    await recomputeInvoiceCredits(invoice.id);

    // ✅ MODIFICACIÓN: asegurar pagos/status al final también
    await recomputeInvoicePayments(invoice.id);

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

    // ✅ MODIFICACIÓN: recalcular pagos luego de revertir créditos
    await recomputeInvoicePayments(invoice.id);

    const [[updated]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[credit-notes] Error canceling:', e);
    res.status(500).json({ error: 'Error al anular nota de crédito' });
  }
});

// GET /api/invoices/credit-notes/:id/pdf - PDF de nota de credito
router.get('/credit-notes/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureCreditNoteTables();
    await ensureInvoiceCreditColumns();
    const [[note]] = await pool.query(
      `SELECT cn.*, i.invoice_number, i.organization_id, i.payment_condition, i.currency_code,
              o.name as organization_name, o.ruc as organization_ruc, o.address as organization_address, o.city as organization_city
         FROM credit_notes cn
         LEFT JOIN invoices i ON i.id = cn.invoice_id
         LEFT JOIN organizations o ON o.id = i.organization_id
        WHERE cn.id = ?`,
      [id]
    );
    if (!note) return res.status(404).json({ error: 'Nota de credito no encontrada' });
    const { invoice, error } = await loadInvoiceWithPerms(req, note.invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });

    const [items] = await pool.query(
      'SELECT * FROM credit_note_items WHERE credit_note_id = ? ORDER BY item_order, id',
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
      `inline; filename="credit-note-${note.credit_note_number || id}.pdf"`
    );

    const issueDate = note.issue_date ? new Date(note.issue_date) : new Date();
    const logoPath = await getBrandLogoPath();
    const data = {
      logoPath,
      headerTitle: 'NOTA DE CREDITO',
      invoiceNumber: note.credit_note_number || '',
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
      fechaEmision: formatDate(issueDate),
      hora: formatParaguayTime(new Date()),
      client: {
        name: note.organization_name || '',
        address: note.organization_address || '',
        phone: '',
        email: '',
        ruc: note.organization_ruc || '',
      },
      facturaAfectada: note.invoice_number || invoice.invoice_number || '',
      condicionVenta: note.payment_condition || invoice.payment_condition || 'credito',
      moneda: (note.currency_code || invoice.currency_code || invoice.currency || 'USD').toUpperCase(),
      refNumero: note.invoice_number || invoice.invoice_number || '',
      refDetalle: 'Factura afectada',
      items: items.map((it) => ({
        description: it.description || 'Item',
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0),
        tax_rate: readTaxRate(it, 0),
      })),
      totalEnLetras: '',
      notes: note.reason || note.observations || '',
    };

    await generateInvoicePDF(data, res);
  } catch (e) {
    console.error('[credit-notes] Error generating PDF:', e);
    res.status(500).json({ error: 'Error al generar PDF de nota de credito' });
  }
});

export default router;
















