// server/src/routes/invoices.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import generateInvoicePDF from '../services/invoiceTemplatePdfkit.js';
import generateReceiptPDF from '../services/receiptTemplatePdfkit.js';

const router = Router();

// Ensures (best-effort) for credit tables/columns on startup
ensureCreditNoteTables().catch((err) => console.error('init credit tables', err?.message));
ensureInvoiceCreditColumns().catch((err) => console.error('init credit cols', err?.message));
ensureReceiptTables().catch((err) => console.error('init receipts', err?.message));
ensureInvoiceMoneyColumns().catch((err) => console.error('init money cols', err?.message));

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

async function fetchQuoteTotalUsd(dealId, conn) {
  const [[row]] = await conn.query(
    'SELECT computed_json FROM quotes WHERE deal_id = ? LIMIT 1',
    [dealId]
  );
  if (!row?.computed_json) return null;
  const computed = asJson(row.computed_json);
  return (
    computed?.oferta?.totals?.total_sales_usd ??
    computed?.operacion?.totals?.total_sell_usd ??
    null
  );
}

async function fetchInvoiceLockStatus({ deal_id, service_case_id }) {
  if (!deal_id && !service_case_id) return { locked: false, count: 0 };
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS cnt
         FROM invoices
        WHERE status <> 'anulada'
          AND COALESCE(net_total_amount, total_amount, 0) > 0.01
          AND ${deal_id ? 'deal_id = ?' : 'service_case_id = ?'}`,
      [deal_id ? deal_id : service_case_id]
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

async function fetchServiceQuoteTotalUsd(serviceCaseId, conn) {
  const [[row]] = await conn.query(
    'SELECT computed_json FROM service_quotes WHERE service_case_id = ? LIMIT 1',
    [serviceCaseId]
  );
  if (!row?.computed_json) return null;
  const computed = asJson(row.computed_json);
  return (
    computed?.oferta?.totals?.total_sales_usd ??
    computed?.operacion?.totals?.total_sell_usd ??
    null
  );
}

async function fetchServiceQuoteAdditionTotalUsd(additionId, conn) {
  const [[row]] = await conn.query(
    'SELECT computed_json FROM service_quote_additions WHERE id = ? LIMIT 1',
    [additionId]
  );
  if (!row?.computed_json) return null;
  const computed = asJson(row.computed_json);
  return (
    computed?.oferta?.totals?.total_sales_usd ??
    computed?.operacion?.totals?.total_sell_usd ??
    null
  );
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

async function fetchQuoteCurrencyInfo(dealId, conn) {
  const [[row]] = await conn.query(
    'SELECT inputs_json FROM quotes WHERE deal_id = ? LIMIT 1',
    [dealId]
  );
  if (!row?.inputs_json) return { currency: 'USD', exchange_rate: 1 };
  const inputs = asJson(row.inputs_json) || {};
  const currency = String(inputs.operation_currency || 'USD').toUpperCase();
  const exchange_rate = Number(inputs.exchange_rate_operation_sell_usd || 1) || 1;
  return { currency, exchange_rate };
}

async function fetchServiceQuoteCurrencyInfo(serviceCaseId, conn) {
  const [[row]] = await conn.query(
    'SELECT inputs_json FROM service_quotes WHERE service_case_id = ? LIMIT 1',
    [serviceCaseId]
  );
  if (!row?.inputs_json) return { currency: 'USD', exchange_rate: 1 };
  const inputs = asJson(row.inputs_json) || {};
  const currency = String(inputs.operation_currency || 'USD').toUpperCase();
  const exchange_rate = Number(inputs.exchange_rate_operation_sell_usd || 1) || 1;
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
  const exchange_rate = Number(inputs.exchange_rate_operation_sell_usd || 0) || 0;
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

function round2(n) {
  return Number((Number(n || 0)).toFixed(2));
}

async function fetchQuoteItemsForInvoice(dealId, conn) {
  const [[row]] = await conn.query(
    'SELECT inputs_json, computed_json FROM quotes WHERE deal_id = ? LIMIT 1',
    [dealId]
  );
  if (!row) return [];
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
      const unitPrice = Number(it.unit_price || it.unitPrice || 0) ||
        Number(it.door_value_usd || 0) + Number(it.additional_usd || 0);
      const rate = Number(it.tax_rate ?? it.taxRate ?? 10) || 0;
      return {
        description: it.description || 'Item',
        quantity: qty,
        unit_price: unitPrice,
        tax_rate: rate,
        item_order: it.item_order ?? it.line_no ?? idx,
      };
    });
  }

  return computedItems.map((it, idx) => {
    const match =
      inputItems.find((x) => Number(x.line_no ?? x.item_order ?? 0) === Number(it.line_no ?? it.item_order ?? 0)) ||
      inputItems[idx] ||
      {};
    const qty = Number(it.qty || match.qty || 0) || 1;
    const unitPrice = Number(it.unit_price ?? match.unit_price ?? match.unitPrice ?? 0) ||
      (Number(it.total_sales || 0) && qty ? Number(it.total_sales || 0) / qty : 0);
    const rate = Number(match.tax_rate ?? match.taxRate ?? 10) || 0;
    return {
      description: it.description || match.description || 'Item',
      quantity: qty,
      unit_price: unitPrice,
      tax_rate: rate,
      item_order: it.item_order ?? it.line_no ?? idx,
    };
  });
}

async function fetchServiceQuoteItemsForInvoice(serviceCaseId, conn) {
  const [[row]] = await conn.query(
    'SELECT inputs_json, computed_json FROM service_quotes WHERE service_case_id = ? LIMIT 1',
    [serviceCaseId]
  );
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
      const unitPrice = Number(it.unit_price || it.unitPrice || 0) ||
        Number(it.door_value_usd || 0) + Number(it.additional_usd || 0);
      const rate = Number(it.tax_rate ?? it.taxRate ?? 10) || 0;
      return {
        description: it.description || 'Item',
        quantity: qty,
        unit_price: unitPrice,
        tax_rate: rate,
        item_order: it.item_order ?? it.line_no ?? idx,
      };
    });
  }

  return computedItems.map((it, idx) => {
    const match =
      inputItems.find((x) => Number(x.line_no ?? x.item_order ?? 0) === Number(it.line_no ?? it.item_order ?? 0)) ||
      inputItems[idx] ||
      {};
    const qty = Number(it.qty || match.qty || 0) || 1;
    const unitPrice = Number(it.unit_price ?? match.unit_price ?? match.unitPrice ?? 0) ||
      (Number(it.total_sales || 0) && qty ? Number(it.total_sales || 0) / qty : 0);
    const rate = Number(match.tax_rate ?? match.taxRate ?? 10) || 0;
    return {
      description: it.description || match.description || 'Item',
      quantity: qty,
      unit_price: unitPrice,
      tax_rate: rate,
      item_order: it.item_order ?? it.line_no ?? idx,
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
      const unitPrice = Number(it.unit_price || it.unitPrice || 0) ||
        Number(it.door_value_usd || 0) + Number(it.additional_usd || 0);
      const rate = Number(it.tax_rate ?? it.taxRate ?? 10) || 0;
      return {
        description: it.description || 'Item',
        quantity: qty,
        unit_price: unitPrice,
        tax_rate: rate,
        item_order: it.item_order ?? it.line_no ?? idx,
      };
    });
  }

  return computedItems.map((it, idx) => {
    const match =
      inputItems.find((x) => Number(x.line_no ?? x.item_order ?? 0) === Number(it.line_no ?? it.item_order ?? 0)) ||
      inputItems[idx] ||
      {};
    const qty = Number(it.qty || match.qty || 0) || 1;
    const unitPrice = Number(it.unit_price ?? match.unit_price ?? match.unitPrice ?? 0) ||
      (Number(it.total_sales || 0) && qty ? Number(it.total_sales || 0) / qty : 0);
    const rate = Number(match.tax_rate ?? match.taxRate ?? 10) || 0;
    return {
      description: it.description || match.description || 'Item',
      quantity: qty,
      unit_price: unitPrice,
      tax_rate: rate,
      item_order: it.item_order ?? it.line_no ?? idx,
    };
  });
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

async function generateCreditNoteNumber(forcePoint, forceEst) {
  await ensureCreditNoteTables();
  const defaultExp = '001-004';
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

  if (forcePoint && String(forcePoint).trim()) point = String(forcePoint).padStart(3, '0');
  if (forceEst && String(forceEst).trim()) establishment = String(forceEst).padStart(3, '0');

  const lastSeq =
    (await fetchLastSeq(point, establishment, pool, 'credit_note_number', 'credit_notes')) || 0;

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
  // ✅ FIX: antes /d+/g (mal). Debe ser /\d+/g
  const matches = String(raw).match(/\d+/g) || [];
  const point = (matches[0] || fallback.point || '001').padStart(3, '0');
  const establishment = (matches[1] || fallback.establishment || '000').padStart(3, '0');
  return { point, establishment };
}

async function peekInvoiceDefaults({ buKey = '', pipelineName = '' } = {}, conn = pool) {
  const isIndustrial = isIndustrialContext({ buKey, pipelineName });
  const expKey = isIndustrial ? 'invoice_exp_industrial' : 'invoice_exp_cargo';
  const sharedNumKey = 'invoice_next_number';
  const unitNumKey = isIndustrial
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
    const unitVal =
      parseInt((await getParamValue(unitNumKey, conn))?.value || 'NaN', 10);
    const sharedVal =
      parseInt((await getParamValue(sharedNumKey, conn))?.value || 'NaN', 10);
    const chosen =
      Number.isFinite(unitVal) ? unitVal : Number.isFinite(sharedVal) ? sharedVal : NaN;
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
  const unitNumKey = isIndustrial
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
    const unitVal =
      parseInt((await getParamValue(unitNumKey, conn))?.value || 'NaN', 10);
    const sharedVal =
      parseInt((await getParamValue(sharedNumKey, conn))?.value || 'NaN', 10);
    const chosen =
      Number.isFinite(unitVal) ? unitVal : Number.isFinite(sharedVal) ? sharedVal : NaN;
    if (Number.isFinite(chosen)) next = Math.max(next, chosen);
  } catch (_) {
    next = lastSeq + 1;
  }
  if (!Number.isFinite(next) || next < lastSeq + 1) next = lastSeq + 1;

  const invoice_number = `${point}-${establishment}-${String(next).padStart(7, '0')}`;
  try {
    await upsertParam(unitNumKey, String(next + 1), conn);
  } catch (_) {}

  return { invoice_number, point_of_issue: point, establishment };
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
    if (!deal_id && !service_case_id) {
      return res.status(400).json({ error: 'deal_id o service_case_id es requerido' });
    }
    const status = await fetchInvoiceLockStatus({ deal_id, service_case_id });
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

// GET /api/invoices
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
            JSON_EXTRACT(sqa.inputs_json, '$.exchange_rate_operation_sell_usd'),
            JSON_EXTRACT(ql.inputs_json, '$.exchange_rate_operation_sell_usd')${withService ? ', JSON_EXTRACT(sq.inputs_json, \'$.exchange_rate_operation_sell_usd\')' : ''},
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
            JSON_EXTRACT(sqa.inputs_json, '$.exchange_rate_operation_sell_usd'),
            JSON_EXTRACT(ql.inputs_json, '$.exchange_rate_operation_sell_usd')${withService ? ', JSON_EXTRACT(sq.inputs_json, \'$.exchange_rate_operation_sell_usd\')' : ''},
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
    const dealId = Number(req.query?.deal_id || 0);
    const serviceCaseId = Number(req.query?.service_case_id || 0);
    if (!dealId && !serviceCaseId) {
      return res.status(400).json({ error: 'deal_id o service_case_id requerido' });
    }

    const [invRows] = await pool.query(
      `SELECT id, invoice_number, issue_date, created_at, status, total_amount, currency_code
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
    } = req.body || {};

    if (!deal_id && !service_case_id && !service_quote_addition_id) {
      return res.status(400).json({ error: 'deal_id o service_case_id es requerido' });
    }

    await conn.beginTransaction();

    let deal = null;
    let serviceCase = null;
    let addition = null;
    let buKey = '';
    if (deal_id) {
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
    const { invoice_number, point_of_issue: poi, establishment: est } = await nextInvoiceNumber(
      buKey,
      conn
    );

    const issueDate = new Date();
    const dueDate = due_date ? new Date(due_date) : null;
    const perc = Number(percentage || 100);
    const useAddition = Number(service_quote_addition_id || 0) > 0;
    const effectiveServiceCaseId = deal_id ? null : (service_case_id || serviceCase?.id || null);
    const quoteTotalUsd = deal_id
      ? await fetchQuoteTotalUsd(deal_id, conn)
      : useAddition
      ? await fetchServiceQuoteAdditionTotalUsd(Number(service_quote_addition_id), conn)
      : await fetchServiceQuoteTotalUsd(effectiveServiceCaseId, conn);
    const baseAmountUsd = Number(
      req.body?.base_amount ??
      quoteTotalUsd ??
      (deal ? deal.deal_value : 0) ??
      0
    ) || 0;

    const branchInfo = deal_id
      ? await fetchDealBranchInfo(deal_id, conn)
      : await fetchServiceCaseBranchInfo(effectiveServiceCaseId, conn);
    const branchAddress = branchInfo
      ? [branchInfo.address, branchInfo.city, branchInfo.country].filter(Boolean).join(' - ')
      : null;
    const resolvedCustomerAddress = customer_address || branchAddress || null;

    if (useAddition) {
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
    } else {
      const [[agg]] = await conn.query(
        `SELECT COALESCE(SUM(percentage),0) AS used_pct
           FROM invoices
          WHERE ${deal_id ? 'deal_id = ?' : 'service_case_id = ?'}
            AND status <> 'anulada'`,
        [deal_id ? deal_id : effectiveServiceCaseId]
      );
      const usedPct = Number(agg.used_pct || 0);
      if (usedPct + perc > 100.0001) {
        await conn.rollback();
        return res.status(400).json({ error: `El porcentaje supera el 100% (ya facturado ${usedPct.toFixed(2)}%)` });
      }
    }

    // ✅ Moneda: por defecto desde la cotización
    const quoteCurrency = deal_id
      ? await fetchQuoteCurrencyInfo(deal_id, conn)
      : useAddition
      ? await fetchServiceQuoteAdditionCurrencyInfo(Number(service_quote_addition_id), conn)
      : await fetchServiceQuoteCurrencyInfo(effectiveServiceCaseId, conn);
    const curr = String(currency_code || req.body?.currency || quoteCurrency.currency || 'USD').toUpperCase();
    const exRate = Number(exchange_rate || quoteCurrency.exchange_rate || 1) || 1;
    const isPyg = curr === 'PYG' || curr === 'GS';
    const currencyFactor = isPyg ? exRate : 1;
    const baseAmount = round2(baseAmountUsd * currencyFactor);

    const itemsFromQuote = deal_id
      ? await fetchQuoteItemsForInvoice(deal_id, conn)
      : useAddition
      ? await fetchServiceQuoteAdditionItemsForInvoice(Number(service_quote_addition_id), conn)
      : await fetchServiceQuoteItemsForInvoice(effectiveServiceCaseId, conn);
    const factor = perc / 100;
    let invoiceItems = [];
    if (itemsFromQuote.length > 0) {
      invoiceItems = itemsFromQuote.map((it, idx) => {
        const qty = Number(it.quantity || 0) || 1;
        const unitPriceAdjUsd = round2(Number(it.unit_price || 0) * factor);
        const unitPriceAdj = round2(unitPriceAdjUsd * currencyFactor);
        const subtotal = round2(qty * unitPriceAdj);
        return {
          description: it.description || 'Item',
          quantity: qty,
          unit_price: unitPriceAdj,
          subtotal,
          tax_rate: Number(it.tax_rate ?? 0) || 0,
          item_order: Number.isFinite(Number(it.item_order)) ? Number(it.item_order) : idx,
        };
      });
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

    const credited_total = 0;
    const net_total_amount = Number((total_amount - credited_total).toFixed(2));
    const net_balance = Number((total_amount - credited_total).toFixed(2));

    const [result] = await conn.query(
  `INSERT INTO invoices (
    deal_id, service_case_id, service_quote_addition_id, organization_id, invoice_number, issue_date, due_date, payment_terms, notes,
    payment_condition, timbrado_number, timbrado_start_date, timbrado_expires_at,
    point_of_issue, establishment, customer_doc_type, customer_doc, customer_email, customer_address,
    currency_code, exchange_rate, sales_rep, purchase_order_ref,
    percentage, base_amount, subtotal, tax_amount, total_amount,
    paid_amount, balance,
    credited_total, net_total_amount, net_balance,
    status, created_by
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?
  )`,
  [
    deal ? deal.id : null,
    serviceCase ? serviceCase.id : null,
    service_quote_addition_id ? Number(service_quote_addition_id) : null,
    deal ? deal.organization_id : serviceCase?.organization_id,
    invoice_number,
    issueDate,
    dueDate,
    payment_terms || null,
    notes || '',
    payment_condition || 'credito',
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
    purchase_order_ref || null,
    perc,
    baseAmount,
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
  ]
);

    const newId = result.insertId;

    // Guardar items
    await ensureInvoiceItemsTaxColumn();
    for (const it of invoiceItems) {
      await conn.query(
        `INSERT INTO invoice_items
         (invoice_id, description, quantity, unit_price, subtotal, tax_rate, item_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          it.description,
          it.quantity,
          it.unit_price,
          it.subtotal,
          it.tax_rate ?? 0,
          it.item_order ?? 0,
        ]
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

    const data = {
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
    if (!canManageInvoice(req.user, invoice)) {
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
        const rate = Number(inputs.exchange_rate_operation_sell_usd || 0) || 0;
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
    if (!canManageInvoice(req.user, invoice)) {
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
        const rate = Number(inputs.exchange_rate_operation_sell_usd || 0) || 0;
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
      facturaAfectada: '',
      condicionVenta: invoice.payment_condition || 'credito',
      moneda: (invoice.currency_code || invoice.currency || 'USD').toUpperCase(),
      refNumero: invoice.deal_reference || invoice.deal_id || '',
      refDetalle: invoice.deal_title || '' ,
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
      return res.status(400).json({ error: `Excede lo disponible en 10% (disp: ${availability.disponible.base10})` });
    }
    if (breakdown.base5 > availability.disponible.base5 + 0.01) {
      return res.status(400).json({ error: `Excede lo disponible en 5% (disp: ${availability.disponible.base5})` });
    }
    if (breakdown.base0 > availability.disponible.base0 + 0.01) {
      return res.status(400).json({ error: `Excede lo disponible exentas (disp: ${availability.disponible.base0})` });
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
    const data = {
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
      hora: new Date().toLocaleTimeString('es-PY', { hour12: false }),
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
        tax_rate: Number(it.tax_rate ?? 0),
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
