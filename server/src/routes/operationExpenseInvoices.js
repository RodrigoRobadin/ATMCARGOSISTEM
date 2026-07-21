// server/src/routes/operationExpenseInvoices.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pool } from '../services/db.js';
import generatePaymentOrderPDF from '../services/paymentOrderTemplatePdfkit.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';

const router = Router();

const attachmentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { invoiceId } = req.params;
    const dir = path.resolve('uploads', 'operation-expenses', String(invoiceId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = Date.now();
    cb(null, `${stamp}_${safe}`);
  },
});

const upload = multer({ storage: attachmentStorage });

const paymentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { paymentId } = req.params;
    const dir = path.resolve('uploads', 'operation-expense-payments', String(paymentId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = Date.now();
    cb(null, `${stamp}_${safe}`);
  },
});
const paymentUpload = multer({ storage: paymentStorage });

ensureOperationExpenseTables().catch((err) =>
  console.error('init operation expense tables', err?.message || err)
);

async function ensureOperationExpenseTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_expense_invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      operation_id INT NOT NULL,
      operation_type VARCHAR(16) NOT NULL DEFAULT 'deal',
      invoice_date DATE NULL,
      receipt_type VARCHAR(32) NULL,
      receipt_number VARCHAR(64) NULL,
      timbrado_number VARCHAR(64) NULL,
      cost_sheet_version_number INT NULL,
      quote_id INT NULL,
      quote_revision_id INT NULL,
      expense_rubro VARCHAR(32) NULL,
      expense_concept VARCHAR(255) NULL,
      tax_mode VARCHAR(16) NULL,
      gravado_10 DECIMAL(15,2) NULL,
      gravado_5 DECIMAL(15,2) NULL,
      condition_type VARCHAR(16) NULL,
      due_date DATE NULL,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      exchange_rate DECIMAL(15,6) NULL,
      amount_total DECIMAL(15,2) NULL,
      iva_10 DECIMAL(15,2) NULL,
      iva_5 DECIMAL(15,2) NULL,
      iva_exempt DECIMAL(15,2) NULL,
      iva_no_taxed DECIMAL(15,2) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      payment_status VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      balance DECIMAL(15,2) NOT NULL DEFAULT 0,
      paid_date DATE NULL,
      supplier_id INT NULL,
      supplier_name VARCHAR(160) NULL,
      supplier_ruc VARCHAR(32) NULL,
      buyer_name VARCHAR(160) NULL,
      buyer_ruc VARCHAR(32) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_operation (operation_id),
      INDEX idx_op_type (operation_type),
      INDEX idx_supplier (supplier_id),
      UNIQUE KEY uq_op_supplier_doc (operation_id, supplier_ruc, timbrado_number, receipt_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_expense_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      file_url VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_invoice (invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureOperationExpenseColumns();
  await ensureOperationExpenseIndexes();
  await ensurePaymentOrderColumns();
  await ensurePaymentOrderIndexes();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_expense_invoice_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      description VARCHAR(255) NOT NULL,
      quantity DECIMAL(15,3) NOT NULL DEFAULT 1,
      unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
      expense_rubro VARCHAR(32) NULL,
      tax_rate INT NOT NULL DEFAULT 10,
      subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
      item_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_invoice (invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_expense_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      payment_date DATE NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      method VARCHAR(32) NULL,
      account VARCHAR(64) NULL,
      reference_number VARCHAR(128) NULL,
      notes TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'confirmado',
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_invoice (invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_expense_payment_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payment_id INT NOT NULL,
      file_url VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_payment (payment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_expense_payment_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NULL,
      operation_id INT NOT NULL,
      operation_type VARCHAR(16) NOT NULL DEFAULT 'deal',
      order_number VARCHAR(64) NOT NULL,
      payment_method VARCHAR(64) NULL,
      payment_date DATE NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      condition_type VARCHAR(16) NULL,
      supplier_id INT NULL,
      supplier_name VARCHAR(160) NULL,
      supplier_ruc VARCHAR(32) NULL,
      description TEXT NULL,
      observations TEXT NULL,
      paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      balance DECIMAL(15,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      approved_by INT NULL,
      approved_at TIMESTAMP NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_operation (operation_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_expense_payment_order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      invoice_id INT NOT NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order (order_id),
      INDEX idx_invoice (invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_expense_control_settings (
      operation_id INT NOT NULL,
      operation_type VARCHAR(16) NOT NULL DEFAULT 'deal',
      exchange_rate DECIMAL(15,6) NULL,
      updated_by INT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (operation_id, operation_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureOperationExpenseItemColumns();
}

async function ensureOperationExpenseItemColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operation_expense_invoice_items'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('expense_rubro')) add.push('ADD COLUMN expense_rubro VARCHAR(32) NULL AFTER unit_price');
    if (add.length) {
      await pool.query(`ALTER TABLE operation_expense_invoice_items ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[operation-expense] ensure item columns error', e?.message || e);
  }
}

async function ensureOperationExpenseControlSettings() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS operation_expense_control_settings (
        operation_id INT NOT NULL,
        operation_type VARCHAR(16) NOT NULL DEFAULT 'deal',
        exchange_rate DECIMAL(15,6) NULL,
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (operation_id, operation_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error('[operation-expense] ensure control settings error', e?.message || e);
  }
}

async function ensureOperationExpenseTablesPost() {
  await ensureOperationExpenseItemColumns();
  await ensureOperationExpenseControlSettings();
}

ensureOperationExpenseTablesPost().catch((err) =>
  console.error('init operation expense post tables', err?.message || err)
);

function revisionScopeFromSource(source = {}) {
  return {
    costSheetVersionNumber: Number(source.cost_sheet_version_number || source.cost_sheet_version || 0) || null,
    quoteId: Number(source.quote_id || 0) || null,
    quoteRevisionId: Number(source.quote_revision_id || source.revision_id || 0) || null,
  };
}

function appendExpenseRevisionScope(where, params, source = {}, alias = 'e') {
  const scope = revisionScopeFromSource(source);
  const prefix = alias ? `${alias}.` : '';
  if (scope.costSheetVersionNumber) {
    where.push(`${prefix}cost_sheet_version_number = ?`);
    params.push(scope.costSheetVersionNumber);
  }
  if (scope.quoteRevisionId) {
    where.push(`${prefix}quote_revision_id = ?`);
    params.push(scope.quoteRevisionId);
  } else if (scope.quoteId) {
    where.push(`${prefix}quote_id = ?`);
    params.push(scope.quoteId);
  }
  return scope;
}

async function ensureOperationExpenseColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operation_expense_invoices'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('operation_type')) add.push("ADD COLUMN operation_type VARCHAR(16) NOT NULL DEFAULT 'deal'");
    if (!have.has('status')) add.push("ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pendiente'");
    if (!have.has('payment_status')) add.push("ADD COLUMN payment_status VARCHAR(20) NOT NULL DEFAULT 'pendiente'");
    if (!have.has('paid_amount')) add.push("ADD COLUMN paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0");
    if (!have.has('balance')) add.push("ADD COLUMN balance DECIMAL(15,2) NOT NULL DEFAULT 0");
    if (!have.has('paid_date')) add.push("ADD COLUMN paid_date DATE NULL");
    if (!have.has('due_date')) add.push("ADD COLUMN due_date DATE NULL");
    if (!have.has('cost_sheet_version_number')) add.push('ADD COLUMN cost_sheet_version_number INT NULL AFTER timbrado_number');
    if (!have.has('quote_id')) add.push('ADD COLUMN quote_id INT NULL AFTER cost_sheet_version_number');
    if (!have.has('quote_revision_id')) add.push('ADD COLUMN quote_revision_id INT NULL AFTER quote_id');
    if (!have.has('tax_mode')) add.push('ADD COLUMN tax_mode VARCHAR(16) NULL');
    if (!have.has('gravado_10')) add.push('ADD COLUMN gravado_10 DECIMAL(15,2) NULL');
    if (!have.has('gravado_5')) add.push('ADD COLUMN gravado_5 DECIMAL(15,2) NULL');
    if (!have.has('expense_rubro')) add.push('ADD COLUMN expense_rubro VARCHAR(32) NULL AFTER timbrado_number');
    if (!have.has('expense_concept')) add.push('ADD COLUMN expense_concept VARCHAR(255) NULL AFTER expense_rubro');
    if (add.length) {
      await pool.query(`ALTER TABLE operation_expense_invoices ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[operation-expense] ensure columns error', e?.message || e);
  }
}

async function ensureOperationExpenseIndexes() {
  try {
    const [idx] = await pool.query(
      `
      SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
        FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'operation_expense_invoices'
         AND INDEX_NAME = 'uq_op_supplier_doc'
       GROUP BY INDEX_NAME
      `
    );
    const cols = String(idx?.[0]?.cols || '');
    if (cols && !cols.includes('operation_type')) {
      await pool.query(`ALTER TABLE operation_expense_invoices DROP INDEX uq_op_supplier_doc`);
      await pool.query(
        `ALTER TABLE operation_expense_invoices
         ADD UNIQUE KEY uq_op_supplier_doc (operation_type, operation_id, supplier_ruc, timbrado_number, receipt_number)`
      );
    }
  } catch (e) {
    console.error('[operation-expense] ensure index error', e?.message || e);
  }
}

async function ensurePaymentOrderColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operation_expense_payment_orders'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('paid_amount')) add.push('ADD COLUMN paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0');
    if (!have.has('balance')) add.push('ADD COLUMN balance DECIMAL(15,2) NOT NULL DEFAULT 0');
    if (!have.has('approved_by')) add.push('ADD COLUMN approved_by INT NULL');
    if (!have.has('approved_at')) add.push('ADD COLUMN approved_at TIMESTAMP NULL');
    if (have.has('invoice_id')) {
      add.push('MODIFY COLUMN invoice_id INT NULL');
    }
    if (add.length) {
      await pool.query(`ALTER TABLE operation_expense_payment_orders ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[operation-expense] ensure payment order columns error', e?.message || e);
  }
}

async function ensurePaymentOrderIndexes() {
  try {
    const [idx] = await pool.query(
      `
      SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'operation_expense_payment_orders'
         AND INDEX_NAME = 'uq_invoice'
       GROUP BY INDEX_NAME
      `
    );
    if (idx?.length) {
      await pool.query(`ALTER TABLE operation_expense_payment_orders DROP INDEX uq_invoice`);
    }
  } catch (e) {
    console.error('[operation-expense] ensure payment order index error', e?.message || e);
  }
}

function toNum(v) {
  const n = Number(String(v ?? '').replace(/,/g, '.'));
  return Number.isFinite(n) ? n : 0;
}

function toLocalizedNum(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!raw) return 0;
  const sign = raw.startsWith('-') ? -1 : 1;
  const unsigned = raw.replace(/-/g, '');
  const lastComma = unsigned.lastIndexOf(',');
  const lastDot = unsigned.lastIndexOf('.');
  let normalized = unsigned;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    normalized = unsigned.replace(thousands, '').replace(decimal, '.');
  } else if (lastComma >= 0) {
    normalized = unsigned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot >= 0) {
    const dotCount = (unsigned.match(/\./g) || []).length;
    const integerPart = unsigned.slice(0, lastDot);
    const digitsAfter = unsigned.length - lastDot - 1;
    normalized = dotCount > 1 || (digitsAfter === 3 && integerPart !== '0')
      ? unsigned.replace(/\./g, '')
      : unsigned;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? sign * parsed : 0;
}

async function getParamValue(key) {
  try {
    const [[row]] = await pool.query(
      'SELECT `key`, value FROM param_values WHERE `key` = ? ORDER BY ord, id DESC LIMIT 1',
      [key]
    );
    return row || null;
  } catch (_) {
    return null;
  }
}

async function upsertParam(key, value) {
  try {
    const existing = await getParamValue(key);
    if (existing?.key) {
      await pool.query('UPDATE param_values SET value = ?, active = 1, ord = 0 WHERE `key` = ?', [value, key]);
      return;
    }
  } catch (_) {}
  await pool.query('INSERT INTO param_values (`key`, value, ord, active) VALUES (?, ?, 0, 1)', [key, value]);
}

async function nextPaymentOrderNumber() {
  const paramKey = 'op_payment_order_next';
  const [[row]] = await pool.query(
    "SELECT MAX(CAST(SUBSTRING(order_number, 5) AS UNSIGNED)) AS max_ref FROM operation_expense_payment_orders WHERE order_number REGEXP '^OPG-[0-9]+$'"
  );
  let next = Number(row?.max_ref || 0) + 1;
  const paramVal = parseInt((await getParamValue(paramKey))?.value || 'NaN', 10);
  if (Number.isFinite(paramVal)) next = Math.max(next, paramVal);
  if (next < 1) next = 1;
  await upsertParam(paramKey, String(next + 1));
  return `OPG-${String(next).padStart(6, '0')}`;
}

async function recomputePaymentOrder(orderId, conn = pool) {
  const [[order]] = await conn.query(
    `SELECT id, status, approved_at
       FROM operation_expense_payment_orders
      WHERE id = ? LIMIT 1`,
    [orderId]
  );
  if (!order) return;

  const [[sumItems]] = await conn.query(
    `SELECT COALESCE(SUM(amount),0) AS total
       FROM operation_expense_payment_order_items
      WHERE order_id = ?`,
    [orderId]
  );
  const total = Number(sumItems?.total || 0);

  const [[sumPaid]] = await conn.query(
    `SELECT COALESCE(SUM(p.amount),0) AS paid
       FROM operation_expense_payments p
       JOIN operation_expense_payment_order_items i ON i.invoice_id = p.invoice_id
      WHERE i.order_id = ? AND p.status <> 'anulado'`,
    [orderId]
  );
  const paid = Number(sumPaid?.paid || 0);
  const balance = Math.max(0, total - paid);
  let status = order.status || 'pendiente';
  if (total > 0 && paid >= total - 0.01) status = 'pagada';
  else if (paid > 0) status = 'pago_parcial';
  else {
    if (status === 'pago_parcial' || status === 'pagada') {
      status = order.approved_at ? 'aprobada' : 'pendiente';
    }
  }
  await conn.query(
    `UPDATE operation_expense_payment_orders
        SET amount = ?, paid_amount = ?, balance = ?, status = ?
      WHERE id = ?`,
    [total, paid, balance, status, order.id]
  );
}

async function findOrderForInvoice(invoiceId) {
  const [[row]] = await pool.query(
    `SELECT po.*
       FROM operation_expense_payment_orders po
       JOIN operation_expense_payment_order_items i ON i.order_id = po.id
      WHERE i.invoice_id = ? LIMIT 1`,
    [invoiceId]
  );
  if (row?.id) return row;
  const [[legacy]] = await pool.query(
    `SELECT *
       FROM operation_expense_payment_orders
      WHERE invoice_id = ? LIMIT 1`,
    [invoiceId]
  );
  return legacy || null;
}

function normalizeItems(items = []) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((it, idx) => {
      const qty = toLocalizedNum(it.quantity || 0) || 1;
      const unit = toLocalizedNum(it.unit_price || 0);
      const subtotal = toLocalizedNum(it.subtotal || qty * unit);
      const taxRate = Number(it.tax_rate ?? 10);
      return {
        description: String(it.description || '').trim() || 'Sin descripción',
        expense_rubro: String(it.expense_rubro || it.rubro || '').trim().toUpperCase() || 'SIN CLASIFICAR',
        quantity: qty,
        unit_price: unit,
        tax_rate: taxRate === 5 ? 5 : taxRate === 0 ? 0 : 10,
        subtotal: subtotal,
        item_order: Number(it.item_order ?? idx) || idx,
      };
    })
    .filter((it) => it.description);
}

function totalsFromItems(items = []) {
  const totals = {
    total: 0,
    gravado10: 0,
    gravado5: 0,
    exento: 0,
  };
  for (const it of items) {
    const sub = toNum(it.subtotal);
    totals.total += sub;
    if (Number(it.tax_rate) === 5) totals.gravado5 += sub;
    else if (Number(it.tax_rate) === 0) totals.exento += sub;
    else totals.gravado10 += sub;
  }
  return totals;
}

async function updateInvoicePaymentStatus(invoiceId, conn = pool) {
  const [[inv]] = await conn.query(
    `SELECT id, amount_total, condition_type FROM operation_expense_invoices WHERE id = ?`,
    [invoiceId]
  );
  if (!inv?.id) return;

  const [[sumRow]] = await conn.query(
    `SELECT COALESCE(SUM(amount),0) AS paid
       FROM operation_expense_payments
      WHERE invoice_id = ? AND status <> 'anulado'`,
    [invoiceId]
  );
  const paid = Number(sumRow?.paid || 0);
  const total = Number(inv.amount_total || 0);
  const balance = Number((total - paid).toFixed(2));

  let paymentStatus = 'pendiente';
  if (String(inv.condition_type || '').toUpperCase() !== 'CREDITO') {
    paymentStatus = 'n/a';
  } else if (paid <= 0) {
    paymentStatus = 'pendiente';
  } else if (balance > 0) {
    paymentStatus = 'parcial';
  } else {
    paymentStatus = 'pagado';
  }

  await conn.query(
    `UPDATE operation_expense_invoices
        SET paid_amount = ?, balance = ?, payment_status = ?, paid_date = IF(? <= 0, CURDATE(), paid_date)
      WHERE id = ?`,
    [paid, balance, paymentStatus, balance, invoiceId]
  );
}

async function ensureSupplierId(payload) {
  if (payload.supplier_id) return payload.supplier_id;
  const name = String(payload.supplier_name || '').trim();
  const ruc = String(payload.supplier_ruc || '').trim();
  if (!name && !ruc) return null;

  if (ruc) {
    const [[found]] = await pool.query(
      `SELECT id FROM organizations WHERE ruc = ? AND LOWER(tipo_org) = 'proveedor' LIMIT 1`,
      [ruc]
    );
    if (found?.id) return found.id;
  }

  if (name) {
    const [[foundByName]] = await pool.query(
      `SELECT id FROM organizations WHERE (razon_social = ? OR name = ?) AND LOWER(tipo_org) = 'proveedor' LIMIT 1`,
      [name, name]
    );
    if (foundByName?.id) return foundByName.id;
  }

  if (!name) return null;

  const [ins] = await pool.query(
    `INSERT INTO organizations (razon_social, name, ruc, tipo_org, created_at, updated_at)
     VALUES (?, ?, ?, 'Proveedor', NOW(), NOW())`,
    [name, name, ruc || null]
  );
  return ins.insertId || null;
}

router.get('/:id/expense-invoices', requireAuth, async (req, res) => {
  try {
    await ensureOperationExpenseTables();
    const { id } = req.params;
    const opType = String(req.query?.op_type || 'deal').toLowerCase();
    const where = ['e.operation_id = ?', 'e.operation_type = ?'];
    const params = [id, opType];
    appendExpenseRevisionScope(where, params, req.query || {}, 'e');
    const [rows] = await pool.query(
      `
      SELECT e.*,
             COALESCE(o.razon_social, o.name) AS supplier_org_name,
             o.ruc AS supplier_org_ruc,
             (
               SELECT COUNT(*)
               FROM operation_expense_attachments a
               WHERE a.invoice_id = e.id
             ) AS attachment_count,
             (
               SELECT COUNT(*)
               FROM operation_expense_invoice_items it
               WHERE it.invoice_id = e.id
             ) AS item_count,
             COALESCE(
               (
                 SELECT GROUP_CONCAT(DISTINCT COALESCE(NULLIF(it.expense_rubro, ''), 'SIN CLASIFICAR') ORDER BY it.expense_rubro SEPARATOR ', ')
                 FROM operation_expense_invoice_items it
                 WHERE it.invoice_id = e.id
               ),
               COALESCE(NULLIF(e.expense_rubro, ''), 'SIN CLASIFICAR')
             ) AS expense_rubros
        FROM operation_expense_invoices e
        LEFT JOIN organizations o ON o.id = e.supplier_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.invoice_date DESC, e.id DESC
      `,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error('[operation-expense] list error', e);
    res.status(500).json({ error: 'Error listing operation expenses' });
  }
});

router.post('/:id/expense-invoices', requireAuth, async (req, res) => {
  try {
    await ensureOperationExpenseTables();
    const { id } = req.params;
    const payload = req.body || {};
    const opType = String(payload.operation_type || 'deal').toLowerCase();

    if (!payload.invoice_date) {
      return res.status(400).json({ error: 'invoice_date es requerido' });
    }
    const hasSupplier =
      payload.supplier_id ||
      String(payload.supplier_name || '').trim() ||
      String(payload.supplier_ruc || '').trim();
    if (!hasSupplier) {
      return res.status(400).json({ error: 'Proveedor es requerido' });
    }
    const items = normalizeItems(payload.items || []);
    const invalidItemIndex = items.findIndex((item) => item.quantity <= 0 || item.unit_price <= 0 || item.subtotal <= 0);
    if (invalidItemIndex >= 0) {
      return res.status(400).json({ error: 'El item #' + (invalidItemIndex + 1) + ' debe tener cantidad y precio mayores a cero' });
    }
    const totalNum = toNum(payload.amount_total);
    if (!items.length && (!totalNum || totalNum <= 0)) {
      return res.status(400).json({ error: 'Total comprobante es requerido' });
    }
    if (
      payload.currency_code &&
      payload.currency_code !== 'PYG' &&
      !payload.exchange_rate
    ) {
      return res
        .status(400)
        .json({ error: 'Tipo de cambio es requerido' });
    }

    const supplierId = await ensureSupplierId(payload);
    const scope = revisionScopeFromSource(payload);

    let taxMode = String(payload.tax_mode || '').toLowerCase();
    let gravado10 = toNum(payload.gravado_10);
    let gravado5 = toNum(payload.gravado_5);
    let iva10 = 0;
    let iva5 = 0;
    let totalFinal = totalNum;

    if (items.length) {
      const t = totalsFromItems(items);
      totalFinal = Number(t.total.toFixed(2));
      gravado10 = Number(t.gravado10.toFixed(2));
      gravado5 = Number(t.gravado5.toFixed(2));
      const exento = Number(t.exento.toFixed(2));
      const taxBucketCount = [gravado10, gravado5, exento].filter((value) => value > 0).length;
      taxMode =
        taxBucketCount > 1
          ? 'mixto'
          : gravado10
          ? 'solo10'
          : gravado5
          ? 'solo5'
          : 'mixto';
      iva10 = gravado10 ? gravado10 / 11 : 0;
      iva5 = gravado5 ? gravado5 / 21 : 0;
      payload.iva_exempt = exento || 0;
    } else {
      if (taxMode === 'solo10') {
        gravado10 = totalNum;
        gravado5 = 0;
        iva10 = totalNum / 11;
      } else if (taxMode === 'solo5') {
        gravado10 = 0;
        gravado5 = totalNum;
        iva5 = totalNum / 21;
      } else if (taxMode === 'mixto') {
        if (!gravado10 && !gravado5) {
          return res.status(400).json({ error: 'Debe indicar gravado 10% o 5% para mixto' });
        }
        const ex = toNum(payload.iva_exempt);
        const nt = toNum(payload.iva_no_taxed);
        const sum = gravado10 + gravado5 + ex + nt;
        if (sum > totalNum + 0.01) {
          return res.status(400).json({ error: 'La suma de gravados/exentos supera el total' });
        }
        iva10 = gravado10 ? gravado10 / 11 : 0;
        iva5 = gravado5 ? gravado5 / 21 : 0;
      } else {
        return res.status(400).json({ error: 'tax_mode es requerido' });
      }
    }

    const [result] = await pool.query(
      `
      INSERT INTO operation_expense_invoices
      (operation_id, operation_type, invoice_date, receipt_type, receipt_number, timbrado_number,
       cost_sheet_version_number, quote_id, quote_revision_id,
       expense_rubro, expense_concept,
       tax_mode, gravado_10, gravado_5,
       condition_type, due_date, currency_code, exchange_rate, amount_total,
       iva_10, iva_5, iva_exempt, iva_no_taxed,
       status, payment_status, paid_amount, balance,
       supplier_id, supplier_name, supplier_ruc, buyer_name, buyer_ruc, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        Number(id),
        opType,
        payload.invoice_date || null,
        payload.receipt_type || null,
        payload.receipt_number || null,
        payload.timbrado_number || null,
        scope.costSheetVersionNumber,
        scope.quoteId,
        scope.quoteRevisionId,
        payload.expense_rubro || 'SIN CLASIFICAR',
        payload.expense_concept || null,
        taxMode || null,
        gravado10 || null,
        gravado5 || null,
        payload.condition_type || null,
        payload.due_date || null,
        payload.currency_code || 'PYG',
        payload.exchange_rate || null,
        totalFinal || null,
        iva10 ? Number(iva10.toFixed(2)) : 0,
        iva5 ? Number(iva5.toFixed(2)) : 0,
        payload.iva_exempt || null,
        payload.iva_no_taxed || null,
        payload.status || 'pendiente',
        String(payload.condition_type || '').toUpperCase() === 'CREDITO' ? 'pendiente' : 'n/a',
        0,
        totalFinal || 0,
        supplierId,
        payload.supplier_name || null,
        payload.supplier_ruc || null,
        payload.buyer_name || null,
        payload.buyer_ruc || null,
        payload.notes || null,
        req.user?.id || null,
      ]
    );

    const [[row]] = await pool.query(
      `SELECT * FROM operation_expense_invoices WHERE id = ?`,
      [result.insertId]
    );
    if (items.length) {
      for (const it of items) {
        await pool.query(
          `INSERT INTO operation_expense_invoice_items
           (invoice_id, description, quantity, unit_price, expense_rubro, tax_rate, subtotal, item_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            result.insertId,
            it.description,
            it.quantity,
            it.unit_price,
            it.expense_rubro || payload.expense_rubro || 'SIN CLASIFICAR',
            it.tax_rate,
            it.subtotal,
            it.item_order,
          ]
        );
      }
    }
    res.status(201).json(row);
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return res
        .status(409)
        .json({ error: 'Factura duplicada para esta operación.' });
    }
    console.error('[operation-expense] create error', e);
    res.status(500).json({ error: 'Error creating operation expense invoice' });
  }
});

router.patch('/:id/expense-invoices/:invoiceId', requireAuth, async (req, res) => {
  try {
    await ensureOperationExpenseTables();
    const { id, invoiceId } = req.params;
    const patch = req.body || {};
    const opType = String(req.query?.op_type || patch.operation_type || 'deal').toLowerCase();

    const [[current]] = await pool.query(
      `SELECT * FROM operation_expense_invoices WHERE operation_id = ? AND id = ? AND operation_type = ?`,
      [id, invoiceId, opType]
    );
    if (!current?.id) return res.status(404).json({ error: 'Not found' });

    const fields = [
      'invoice_date',
      'receipt_type',
      'receipt_number',
      'timbrado_number',
      'cost_sheet_version_number',
      'quote_id',
      'quote_revision_id',
      'expense_rubro',
      'expense_concept',
      'tax_mode',
      'gravado_10',
      'gravado_5',
      'condition_type',
      'due_date',
      'currency_code',
      'exchange_rate',
      'amount_total',
      'iva_exempt',
      'iva_no_taxed',
      'supplier_id',
      'supplier_name',
      'supplier_ruc',
      'buyer_name',
      'buyer_ruc',
      'status',
      'notes',
    ];

    const sets = [];
    const params = [];
    fields.forEach((f) => {
      if (patch[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push(patch[f]);
      }
    });

    const items = patch.items ? normalizeItems(patch.items || []) : null;
    if (items) {
      const invalidItemIndex = items.findIndex((item) => item.quantity <= 0 || item.unit_price <= 0 || item.subtotal <= 0);
      if (invalidItemIndex >= 0) {
        return res.status(400).json({ error: 'El item #' + (invalidItemIndex + 1) + ' debe tener cantidad y precio mayores a cero' });
      }
    }
    let totalNum = toNum(patch.amount_total ?? current.amount_total);
    let taxMode = String(patch.tax_mode || current.tax_mode || '').toLowerCase();
    let gravado10 = toNum(patch.gravado_10 ?? current.gravado_10);
    let gravado5 = toNum(patch.gravado_5 ?? current.gravado_5);
    let iva10 = 0;
    let iva5 = 0;

    if (items && items.length) {
      const t = totalsFromItems(items);
      totalNum = Number(t.total.toFixed(2));
      gravado10 = Number(t.gravado10.toFixed(2));
      gravado5 = Number(t.gravado5.toFixed(2));
      const exento = Number(t.exento.toFixed(2)) || 0;
      const taxBucketCount = [gravado10, gravado5, exento].filter((value) => value > 0).length;
      taxMode =
        taxBucketCount > 1
          ? 'mixto'
          : gravado10
          ? 'solo10'
          : gravado5
          ? 'solo5'
          : 'mixto';
      iva10 = gravado10 ? gravado10 / 11 : 0;
      iva5 = gravado5 ? gravado5 / 21 : 0;
      sets.push('amount_total = ?', 'tax_mode = ?', 'gravado_10 = ?', 'gravado_5 = ?', 'iva_exempt = ?');
      params.push(totalNum, taxMode, gravado10, gravado5, exento);
    } else if (taxMode) {
      if (taxMode === 'solo10') {
        gravado10 = totalNum;
        gravado5 = 0;
        iva10 = totalNum / 11;
      } else if (taxMode === 'solo5') {
        gravado10 = 0;
        gravado5 = totalNum;
        iva5 = totalNum / 21;
      } else if (taxMode === 'mixto') {
        iva10 = gravado10 ? gravado10 / 11 : 0;
        iva5 = gravado5 ? gravado5 / 21 : 0;
      }
    }

    if (taxMode) {
      sets.push('iva_10 = ?', 'iva_5 = ?');
      params.push(
        iva10 ? Number(iva10.toFixed(2)) : 0,
        iva5 ? Number(iva5.toFixed(2)) : 0
      );
    }
    if (!sets.length) return res.json({ ok: true });
    params.push(Number(id), Number(invoiceId), opType);
    await pool.query(
      `UPDATE operation_expense_invoices SET ${sets.join(', ')} WHERE operation_id = ? AND id = ? AND operation_type = ?`,
      params
    );
    if (items) {
      await pool.query(
        `DELETE FROM operation_expense_invoice_items WHERE invoice_id = ?`,
        [invoiceId]
      );
      for (const it of items) {
        await pool.query(
          `INSERT INTO operation_expense_invoice_items
           (invoice_id, description, quantity, unit_price, expense_rubro, tax_rate, subtotal, item_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId,
            it.description,
            it.quantity,
            it.unit_price,
            it.expense_rubro || patch.expense_rubro || 'SIN CLASIFICAR',
            it.tax_rate,
            it.subtotal,
            it.item_order,
          ]
        );
      }
    }
    await updateInvoicePaymentStatus(invoiceId, pool);
    const [[row]] = await pool.query(
      `SELECT * FROM operation_expense_invoices WHERE id = ?`,
      [invoiceId]
    );
    res.json(row);
  } catch (e) {
    console.error('[operation-expense] update error', e);
    res.status(500).json({ error: 'Error updating operation expense invoice' });
  }
});

router.get('/:id/expense-invoices/:invoiceId/attachments', requireAuth, async (req, res) => {
  try {
    await ensureOperationExpenseTables();
    const { id, invoiceId } = req.params;
    const opType = String(req.query?.op_type || 'deal').toLowerCase();
    const [[belongs]] = await pool.query(
      `SELECT id FROM operation_expense_invoices WHERE id = ? AND operation_id = ? AND operation_type = ?`,
      [invoiceId, id, opType]
    );
    if (!belongs?.id) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query(
      `SELECT * FROM operation_expense_attachments WHERE invoice_id = ? ORDER BY id DESC`,
      [invoiceId]
    );
    res.json(rows);
  } catch (e) {
    console.error('[operation-expense] attachments list error', e);
    res.status(500).json({ error: 'Error loading attachments' });
  }
});

router.get('/:id/expense-invoices/:invoiceId/items', requireAuth, async (req, res) => {
  try {
    await ensureOperationExpenseTables();
    const { id, invoiceId } = req.params;
    const opType = String(req.query?.op_type || 'deal').toLowerCase();
    const [[belongs]] = await pool.query(
      `SELECT id FROM operation_expense_invoices WHERE id = ? AND operation_id = ? AND operation_type = ?`,
      [invoiceId, id, opType]
    );
    if (!belongs?.id) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query(
      `SELECT * FROM operation_expense_invoice_items WHERE invoice_id = ? ORDER BY item_order, id`,
      [invoiceId]
    );
    res.json(rows);
  } catch (e) {
    console.error('[operation-expense] items list error', e);
    res.status(500).json({ error: 'Error loading items' });
  }
});

router.post('/:id/expense-invoices/:invoiceId/attachments', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    await ensureOperationExpenseTables();
    const { id, invoiceId } = req.params;
    const opType = String(req.query?.op_type || 'deal').toLowerCase();
    const [[belongs]] = await pool.query(
      `SELECT id FROM operation_expense_invoices WHERE id = ? AND operation_id = ? AND operation_type = ?`,
      [invoiceId, id, opType]
    );
    if (!belongs?.id) return res.status(404).json({ error: 'Not found' });
    const relUrl = `/uploads/operation-expenses/${invoiceId}/${req.file.filename}`;
    const [result] = await pool.query(
      `INSERT INTO operation_expense_attachments (invoice_id, file_url, file_name)
       VALUES (?, ?, ?)`,
      [invoiceId, relUrl, req.file.originalname || req.file.filename]
    );
    const [[row]] = await pool.query(
      `SELECT * FROM operation_expense_attachments WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('[operation-expense] attachment upload error', e);
    res.status(500).json({ error: 'Error uploading attachment' });
  }
});

router.post('/:id/expense-invoices/:invoiceId/payments', requireAuth, async (req, res) => {
  try {
    await ensureOperationExpenseTables();
    const { id, invoiceId } = req.params;
    const opType = String(req.query?.op_type || 'deal').toLowerCase();
    const {
      payment_date,
      amount,
      method,
      account,
      reference_number,
      notes,
      status,
    } = req.body || {};
    if (!method) {
      return res.status(400).json({ error: 'Metodo de pago es requerido' });
    }

    const [[inv]] = await pool.query(
      `SELECT * FROM operation_expense_invoices WHERE id = ? AND operation_id = ? AND operation_type = ?`,
      [invoiceId, id, opType]
    );
    if (!inv?.id) return res.status(404).json({ error: 'Not found' });
    const isCredit = String(inv.condition_type || '').toUpperCase() === 'CREDITO';
    const order = isCredit ? await findOrderForInvoice(invoiceId) : null;
    if (isCredit) {
      if (!order) return res.status(400).json({ error: 'Debe generar una orden de pago primero' });
      if (order.status === 'pendiente') {
        return res.status(400).json({ error: 'La orden de pago debe ser aprobada' });
      }
      if (order.status === 'anulada') {
        return res.status(400).json({ error: 'La orden de pago está anulada' });
      }
      if (order.status === 'pagada') {
        return res.status(400).json({ error: 'La orden de pago ya está pagada' });
      }
    }
    const amt = Number(amount || 0);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Monto de pago es requerido' });
    }
    const [[sumRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS paid
         FROM operation_expense_payments
        WHERE invoice_id = ? AND status <> 'anulado'`,
      [invoiceId]
    );
    const paid = Number(sumRow?.paid || 0);
    const total = Number(inv.amount_total || 0);
    if (amt > total - paid + 0.01) {
      return res.status(400).json({ error: 'El pago supera el saldo pendiente' });
    }

    const [result] = await pool.query(
      `INSERT INTO operation_expense_payments
       (invoice_id, payment_date, amount, method, account, reference_number, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        payment_date || null,
        amt,
        method || null,
        account || null,
        reference_number || null,
        notes || null,
        status || 'confirmado',
        req.user?.id || null,
      ]
    );

    await updateInvoicePaymentStatus(invoiceId, pool);
    if (order?.id) {
      await recomputePaymentOrder(order.id);
    }

    res.status(201).json({ id: result.insertId });
  } catch (e) {
    console.error('[operation-expense] payment create error', e);
    res.status(500).json({ error: 'Error creating payment' });
  }
});

// ====== Ordenes de pago ======
router.get('/:id/expense-invoices/:invoiceId/payment-orders', requireAuth, async (req, res) => {
  try {
    const { id, invoiceId } = req.params;
    const opType = req.query?.operation_type || 'deal';
    const [rows] = await pool.query(
      `SELECT *
         FROM operation_expense_payment_orders
        WHERE invoice_id = ? AND operation_id = ? AND operation_type = ?
        ORDER BY id DESC`,
      [invoiceId, id, opType]
    );
    res.json(rows);
  } catch (e) {
    console.error('[operation-expense] payment-orders list error', e);
    res.status(500).json({ error: 'No se pudieron obtener las órdenes de pago' });
  }
});

router.post('/:id/expense-invoices/:invoiceId/payment-orders', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    const { id, invoiceId } = req.params;
    const opType = req.query?.operation_type || 'deal';

    const [[inv]] = await pool.query(
      `SELECT *
         FROM operation_expense_invoices
        WHERE id = ? AND operation_id = ? AND operation_type = ?`,
      [invoiceId, id, opType]
    );
    if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });

    const existing = await findOrderForInvoice(invoiceId);
    if (existing) return res.status(400).json({ error: 'La orden de pago ya existe' });

    const orderNumber = await nextPaymentOrderNumber();
    const amount = Number(req.body?.amount || inv.balance || inv.amount_total || 0);
    const payment_method = req.body?.payment_method || null;
    const payment_date = req.body?.payment_date || null;
    const observations = req.body?.observations || null;

    const [itemRows] = await pool.query(
      `SELECT description FROM operation_expense_invoice_items WHERE invoice_id = ? ORDER BY item_order, id LIMIT 1`,
      [invoiceId]
    );
    const description = itemRows?.[0]?.description || null;

    let supplierName = inv.supplier_name || null;
    let supplierRuc = inv.supplier_ruc || null;
    if (!supplierName && inv.supplier_id) {
      const [[org]] = await pool.query('SELECT razon_social, name, ruc FROM organizations WHERE id = ? LIMIT 1', [inv.supplier_id]);
      supplierName = org?.razon_social || org?.name || supplierName;
      supplierRuc = org?.ruc || supplierRuc;
    }

    const [result] = await pool.query(
      `INSERT INTO operation_expense_payment_orders
       (invoice_id, operation_id, operation_type, order_number, payment_method, payment_date,
        amount, currency_code, condition_type, supplier_id, supplier_name, supplier_ruc,
        description, observations, paid_amount, balance, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        invoiceId,
        id,
        opType,
        orderNumber,
        payment_method,
        payment_date,
        amount,
        inv.currency_code || 'PYG',
        inv.condition_type || null,
        inv.supplier_id || null,
        supplierName,
        supplierRuc,
        description,
        observations,
        0,
        amount,
        'pendiente',
        req.user?.id || null,
      ]
    );

    await pool.query(
      `INSERT INTO operation_expense_payment_order_items
       (order_id, invoice_id, amount)
       VALUES (?,?,?)`,
      [result.insertId, invoiceId, amount]
    );
    await recomputePaymentOrder(result.insertId);

    const [[created]] = await pool.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [result.insertId]);
    res.status(201).json(created);
  } catch (e) {
    console.error('[operation-expense] create payment-order error', e);
    res.status(500).json({ error: 'No se pudo crear la orden de pago' });
  }
});

// Crear o reutilizar una orden de pago para varias facturas (misma operacion/proveedor)
router.post('/:id/expense-invoices/payment-orders', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    const { id } = req.params;
    const opType = req.query?.operation_type || 'deal';
    const invoiceIds = Array.isArray(req.body?.invoice_ids) ? req.body.invoice_ids : [];
    if (!invoiceIds.length) return res.status(400).json({ error: 'invoice_ids requerido' });

    const [invRows] = await pool.query(
      `SELECT *
         FROM operation_expense_invoices
        WHERE id IN (${invoiceIds.map(() => '?').join(',')})
          AND operation_id = ?
          AND operation_type = ?`,
      [...invoiceIds, id, opType]
    );
    if (invRows.length !== invoiceIds.length) {
      return res.status(400).json({ error: 'Facturas inválidas' });
    }

    const existingOrders = new Map();
    for (const inv of invRows) {
      if (String(inv.condition_type || '').toUpperCase() !== 'CREDITO') {
        return res.status(400).json({ error: 'Solo facturas a crédito' });
      }
      const existing = await findOrderForInvoice(inv.id);
      if (existing && String(existing.status || '').toLowerCase() !== 'anulada') {
        existingOrders.set(existing.id, existing);
      }
    }

    const firstSupplier = invRows[0]?.supplier_id || invRows[0]?.supplier_ruc || null;
    const sameSupplier = invRows.every(
      (i) => (i.supplier_id || i.supplier_ruc || null) === firstSupplier
    );
    if (!sameSupplier) {
      return res.status(400).json({ error: 'Las facturas deben ser del mismo proveedor' });
    }

    const firstCurrency = invRows[0]?.currency_code || 'PYG';
    const sameCurrency = invRows.every((i) => (i.currency_code || 'PYG') === firstCurrency);
    if (!sameCurrency) {
      return res.status(400).json({ error: 'Las facturas deben ser de la misma moneda' });
    }

    const payment_method = req.body?.payment_method || null;
    const payment_date = req.body?.payment_date || null;
    const observations = req.body?.observations || null;
    const description = req.body?.description || null;

    let supplierName = invRows[0]?.supplier_name || null;
    let supplierRuc = invRows[0]?.supplier_ruc || null;
    const supplierId = invRows[0]?.supplier_id || null;
    if (!supplierName && supplierId) {
      const [[org]] = await pool.query('SELECT razon_social, name, ruc FROM organizations WHERE id = ? LIMIT 1', [supplierId]);
      supplierName = org?.razon_social || org?.name || supplierName;
      supplierRuc = org?.ruc || supplierRuc;
    }

    let targetOrderId = null;
    if (existingOrders.size) {
      const active = Array.from(existingOrders.values()).filter(
        (o) => String(o.status || '').toLowerCase() !== 'pagada'
      );
      if (!active.length) {
        return res.status(400).json({ error: 'Las ordenes existentes ya estan pagadas' });
      }
      active.sort((a, b) => Number(b.id) - Number(a.id));
      targetOrderId = active[0].id;
      await pool.query(
        `UPDATE operation_expense_payment_orders
            SET payment_method = COALESCE(?, payment_method),
                payment_date = COALESCE(?, payment_date),
                observations = COALESCE(?, observations),
                description = COALESCE(?, description),
                supplier_id = COALESCE(?, supplier_id),
                supplier_name = COALESCE(?, supplier_name),
                supplier_ruc = COALESCE(?, supplier_ruc),
                currency_code = COALESCE(?, currency_code),
                condition_type = COALESCE(?, condition_type)
          WHERE id = ?`,
        [
          payment_method,
          payment_date,
          observations,
          description,
          supplierId,
          supplierName,
          supplierRuc,
          firstCurrency,
          invRows[0]?.condition_type || null,
          targetOrderId,
        ]
      );
    } else {
      const orderNumber = await nextPaymentOrderNumber();
      const autoDescription =
        invRows[0]?.receipt_number ? `Facturas: ${invRows.map((i) => i.receipt_number).join(', ')}` : null;
      const [result] = await pool.query(
        `INSERT INTO operation_expense_payment_orders
         (invoice_id, operation_id, operation_type, order_number, payment_method, payment_date,
          amount, currency_code, condition_type, supplier_id, supplier_name, supplier_ruc,
          description, observations, paid_amount, balance, status, created_by)
         VALUES (NULL, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'pendiente', ?)`,
        [
          id,
          opType,
          orderNumber,
          payment_method,
          payment_date,
          invRows[0]?.currency_code || 'PYG',
          invRows[0]?.condition_type || null,
          supplierId,
          supplierName,
          supplierRuc,
          description || autoDescription,
          observations,
          req.user?.id || null,
        ]
      );
      targetOrderId = result.insertId;
    }

    const affectedOrders = new Set(existingOrders.keys());
    for (const inv of invRows) {
      const amt = Number(inv.balance || inv.amount_total || 0);
      await pool.query(`DELETE FROM operation_expense_payment_order_items WHERE invoice_id = ?`, [inv.id]);
      await pool.query(`UPDATE operation_expense_payment_orders SET invoice_id = NULL WHERE invoice_id = ?`, [inv.id]);
      await pool.query(
        `INSERT INTO operation_expense_payment_order_items (order_id, invoice_id, amount)
         VALUES (?,?,?)`,
        [targetOrderId, inv.id, amt]
      );
    }

    await recomputePaymentOrder(targetOrderId);
    for (const oid of affectedOrders) {
      if (Number(oid) !== Number(targetOrderId)) {
        await recomputePaymentOrder(oid);
      }
    }
    const [[created]] = await pool.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [targetOrderId]);
    res.status(201).json(created);
  } catch (e) {
    console.error('[operation-expense] create batch payment order error', e);
    res.status(500).json({ error: 'No se pudo crear la orden de pago' });
  }
});
router.get('/:id/payment-orders/:orderId/pdf', requireAuth, async (req, res) => {
  try {
    const { id, orderId } = req.params;
    const opType = req.query?.operation_type || 'deal';
    const [[row]] = await pool.query(
      `SELECT po.*, 
              CASE WHEN po.operation_type = 'service' THEN sc.reference ELSE d.reference END AS operation_reference
         FROM operation_expense_payment_orders po
         LEFT JOIN deals d ON d.id = po.operation_id AND po.operation_type = 'deal'
         LEFT JOIN service_cases sc ON sc.id = po.operation_id AND po.operation_type = 'service'
        WHERE po.id = ? AND po.operation_id = ? AND po.operation_type = ?`,
      [orderId, id, opType]
    );
    if (!row) return res.status(404).json({ error: 'Orden no encontrada' });

    let [items] = await pool.query(
      `SELECT i.invoice_id, i.amount, e.receipt_number, e.invoice_date
         FROM operation_expense_payment_order_items i
         JOIN operation_expense_invoices e ON e.id = i.invoice_id
        WHERE i.order_id = ?
        ORDER BY e.invoice_date ASC, e.id ASC`,
      [orderId]
    );
    if (!items.length && row.invoice_id) {
      const [legacy] = await pool.query(
        `SELECT id AS invoice_id, amount_total AS amount, receipt_number, invoice_date
           FROM operation_expense_invoices
          WHERE id = ?`,
        [row.invoice_id]
      );
      items = legacy;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="orden-pago-${row.order_number || row.id}.pdf"`
    );

    await generatePaymentOrderPDF(
      {
        order_number: row.order_number,
        supplier_name: row.supplier_name,
        payment_method: row.payment_method,
        payment_date: row.payment_date,
        invoice_number: null,
        amount: row.amount,
        currency_code: row.currency_code,
        condition_type: row.condition_type,
        description: row.description,
        observations: row.observations,
        operation_reference: row.operation_reference,
        invoices: items || [],
      },
      res
    );
  } catch (e) {
    console.error('[operation-expense] payment-order pdf error', e);
    res.status(500).json({ error: 'No se pudo generar el PDF' });
  }
});

router.get('/:id/expense-invoices/:invoiceId/payments', requireAuth, async (req, res) => {
  try {
    await ensureOperationExpenseTables();
    const { id, invoiceId } = req.params;
    const opType = String(req.query?.op_type || 'deal').toLowerCase();
    const [[inv]] = await pool.query(
      `SELECT id FROM operation_expense_invoices WHERE id = ? AND operation_id = ? AND operation_type = ?`,
      [invoiceId, id, opType]
    );
    if (!inv?.id) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query(
      `SELECT * FROM operation_expense_payments WHERE invoice_id = ? ORDER BY id DESC`,
      [invoiceId]
    );
    res.json(rows);
  } catch (e) {
    console.error('[operation-expense] payments list error', e);
    res.status(500).json({ error: 'Error loading payments' });
  }
});

router.get('/:id/expense-invoices/:invoiceId/payments/:paymentId/attachments', requireAuth, async (req, res) => {
  try {
    await ensureOperationExpenseTables();
    const { id, invoiceId, paymentId } = req.params;
    const opType = String(req.query?.op_type || 'deal').toLowerCase();
    const [[inv]] = await pool.query(
      `SELECT id FROM operation_expense_invoices WHERE id = ? AND operation_id = ? AND operation_type = ?`,
      [invoiceId, id, opType]
    );
    if (!inv?.id) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query(
      `SELECT * FROM operation_expense_payment_attachments WHERE payment_id = ? ORDER BY id DESC`,
      [paymentId]
    );
    res.json(rows);
  } catch (e) {
    console.error('[operation-expense] payment attachments list error', e);
    res.status(500).json({ error: 'Error loading payment attachments' });
  }
});

router.post('/:id/expense-invoices/:invoiceId/payments/:paymentId/attachments', requireAuth, paymentUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    await ensureOperationExpenseTables();
    const { id, invoiceId, paymentId } = req.params;
    const opType = String(req.query?.op_type || 'deal').toLowerCase();
    const [[inv]] = await pool.query(
      `SELECT id FROM operation_expense_invoices WHERE id = ? AND operation_id = ? AND operation_type = ?`,
      [invoiceId, id, opType]
    );
    if (!inv?.id) return res.status(404).json({ error: 'Not found' });
    const relUrl = `/uploads/operation-expense-payments/${paymentId}/${req.file.filename}`;
    const [result] = await pool.query(
      `INSERT INTO operation_expense_payment_attachments (payment_id, file_url, file_name)
       VALUES (?, ?, ?)`,
      [paymentId, relUrl, req.file.originalname || req.file.filename]
    );
    const [[row]] = await pool.query(
      `SELECT * FROM operation_expense_payment_attachments WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('[operation-expense] payment attachment upload error', e);
    res.status(500).json({ error: 'Error uploading payment attachment' });
  }
});

function asJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function normCurrency(value = 'PYG') {
  const code = String(value || 'PYG').toUpperCase();
  return code === 'GS' ? 'PYG' : code;
}

function convertAmount(amount, fromCurrency, toCurrency, exchangeRate) {
  const source = normCurrency(fromCurrency);
  const target = normCurrency(toCurrency);
  const value = Number(amount || 0);
  const rate = Number(exchangeRate || 0);
  if (!Number.isFinite(value)) return null;
  if (source === target) return value;
  if (!Number.isFinite(rate) || rate <= 1) return null;
  if (source === 'PYG' && target === 'USD') return value / rate;
  if (source === 'USD' && target === 'PYG') return value * rate;
  return null;
}

function moneyText(value, currency = 'PYG') {
  const code = normCurrency(currency);
  const decimals = code === 'PYG' ? 0 : 2;
  return `${code} ${Number(value || 0).toLocaleString('es-PY', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function costDiffText(value, currency = 'PYG') {
  const n = Number(value || 0);
  const sign = n < -0.009 ? '+' : '';
  return `${sign}${moneyText(n, currency)}`;
}

function pickNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function addBudgetRubro(map, rubro, amount) {
  const key = String(rubro || 'SIN CLASIFICAR').trim().toUpperCase() || 'SIN CLASIFICAR';
  map[key] = Number(((map[key] || 0) + pickNumber(amount)).toFixed(2));
}

function getRubroAmount(source, kind = 'buy') {
  if (kind === 'sell') {
    return pickNumber(
      source?.sell_usd,
      source?.total_sell_usd,
      source?.venta_usd,
      source?.sale_usd,
      source?.sell,
      source?.venta
    );
  }
  return pickNumber(
    source?.buy_usd,
    source?.total_buy_usd,
    source?.compra_usd,
    source?.cost_usd,
    source?.buy,
    source?.compra,
    source
  );
}

function buildIndustrialBudgetFromComputed(computed = {}, revisionLabel = 'Revision seleccionada') {
  const currencyCode = normCurrency(computed?.meta?.operation_currency || 'USD');
  const atmRate = pickNumber(computed?.meta?.exchange_rate_atm_gs_per_usd, 1) || 1;
  // The quote engine keeps its working totals normalized in USD. For a PYG
  // operation, expose the budget in PYG so it can be compared to real bills.
  const budgetAmount = (value) => {
    const amount = pickNumber(value);
    return currencyCode === 'PYG' ? amount * atmRate : amount;
  };
  const rubros = {};
  const sellRubros = {};
  const opRubros = computed?.operacion?.rubros || {};
  for (const [key, value] of Object.entries(opRubros)) {
    addBudgetRubro(rubros, key, budgetAmount(getRubroAmount(value, 'buy')));
    addBudgetRubro(sellRubros, key, budgetAmount(getRubroAmount(value, 'sell')));
  }
  addBudgetRubro(rubros, 'FLETE', budgetAmount(computed?.despacho?.totals?.freight_buy_usd));
  addBudgetRubro(rubros, 'DESPACHO', budgetAmount(computed?.despacho?.totals?.customs_total_usd_theoretical));
  addBudgetRubro(rubros, 'FINANCIACION', budgetAmount(computed?.financiacion?.totals?.financing_total_buy_usd));
  addBudgetRubro(rubros, 'INSTALACION', budgetAmount(computed?.instalacion?.totals?.installation_total_cost_usd));
  addBudgetRubro(sellRubros, 'DESPACHO', budgetAmount(computed?.despacho?.totals?.customs_total_sale_usd));
  addBudgetRubro(sellRubros, 'FINANCIACION', budgetAmount(computed?.financiacion?.totals?.financing_total_sale_usd));
  addBudgetRubro(sellRubros, 'INSTALACION', budgetAmount(computed?.instalacion?.totals?.installation_total_sale_usd));

  const installationLines = Array.isArray(computed?.instalacion?.lines)
    ? computed.instalacion.lines.map((line, idx) => {
        const costUsd = pickNumber(line.total_cost_usd, line.cost_usd, line.buy_usd, line.total_cost);
        return {
          line_no: idx + 1,
          description: line.description || line.concept || line.item || `Instalacion ${idx + 1}`,
          qty: pickNumber(line.qty, line.quantity, 1),
          total_cost: budgetAmount(costUsd),
          total_cost_usd: costUsd,
        };
      })
    : [];

  const totalBuyUsd = Number(computed?.operacion?.totals?.total_buy_usd);
  const totalSellUsd = Number(computed?.operacion?.totals?.total_sell_usd);
  const offerSellUsd = Number(computed?.oferta?.totals?.total_sales_usd);
  const budgetedBuy = Number.isFinite(totalBuyUsd)
    ? budgetAmount(totalBuyUsd)
    : Object.values(rubros).reduce((a, b) => a + Number(b || 0), 0);
  const budgetedSell = Number.isFinite(totalSellUsd)
    ? budgetAmount(totalSellUsd)
    : Number.isFinite(offerSellUsd)
      ? budgetAmount(offerSellUsd)
      : Object.values(sellRubros).reduce((a, b) => a + Number(b || 0), 0);

  return {
    currency_code: currencyCode,
    revision_label: revisionLabel,
    budgeted_purchase: budgetedBuy,
    budgeted_sell: budgetedSell,
    budgeted_profit: budgetedSell - budgetedBuy,
    rubros,
    sell_rubros: sellRubros,
    installation_lines: installationLines,
  };
}

async function fetchIndustrialBudget(operationId, quoteRevisionId, quoteId = null) {
  if (quoteRevisionId) {
    const [[row]] = await pool.query(
      `SELECT qr.id, qr.name, qr.created_at, qr.computed_json, q.ref_code, q.revision
         FROM quote_revisions qr
         JOIN quotes q ON q.id = qr.quote_id
        WHERE qr.id = ? AND q.deal_id = ?
        LIMIT 1`,
      [quoteRevisionId, operationId]
    );
    if (row?.id) {
      return buildIndustrialBudgetFromComputed(
        asJson(row.computed_json) || {},
        row.name || `REV ${row.id}`
      );
    }
  }
  if (quoteId) {
    const [[row]] = await pool.query(
      `SELECT id, ref_code, revision, computed_json, updated_at
         FROM quotes
        WHERE id = ? AND deal_id = ?
        LIMIT 1`,
      [quoteId, operationId]
    );
    if (row?.id) {
      return buildIndustrialBudgetFromComputed(asJson(row.computed_json) || {}, row.revision || row.ref_code || 'Cotizacion actual');
    }
  }
  const [[row]] = await pool.query(
    `SELECT id, ref_code, revision, computed_json, updated_at
       FROM quotes
      WHERE deal_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [operationId]
  );
  return buildIndustrialBudgetFromComputed(asJson(row?.computed_json) || {}, row?.revision || row?.ref_code || 'Cotizacion actual');
}

async function fetchCargoBudget(operationId, versionNumber) {
  let row = null;
  if (versionNumber) {
    const [[selected]] = await pool.query(
      `SELECT data, version_number, revision_name, created_at
         FROM deal_cost_sheet_versions
        WHERE deal_id = ? AND version_number = ?
        LIMIT 1`,
      [operationId, versionNumber]
    );
    row = selected || null;
  }
  if (!row) {
    const [[current]] = await pool.query(
      `SELECT v.data, v.version_number, v.revision_name, v.created_at
         FROM deal_cost_sheets s
         JOIN deal_cost_sheet_versions v ON v.id = s.current_version_id
        WHERE s.deal_id = ?
        LIMIT 1`,
      [operationId]
    );
    row = current || null;
  }
  const data = asJson(row?.data) || {};
  const totals = data.totals || {};
  const currency = normCurrency(data.operationCurrency || data.currency || data.currency_code || 'USD');
  const budgetedBuy = pickNumber(totals.totalCostos, totals.total_costos, data.totalCostos);
  const budgetedSell = pickNumber(totals.totalVentas, totals.total_ventas, data.totalVentas);
  return {
    currency_code: currency,
    revision_label: row?.revision_name || (row?.version_number ? `REV ${row.version_number}` : 'Planilla actual'),
    budgeted_purchase: budgetedBuy,
    budgeted_sell: budgetedSell,
    budgeted_profit: budgetedSell - budgetedBuy,
    rubros: { PRODUCTO: budgetedBuy },
    sell_rubros: { PRODUCTO: budgetedSell },
    installation_lines: [],
  };
}

async function fetchOperationExportMeta(operationId, opType) {
  if (opType === 'deal') {
    const [[row]] = await pool.query(
      `SELECT d.id, d.reference, COALESCE(o.razon_social, o.name, d.title) AS client_name,
              c.name AS contact_name, c.phone AS contact_phone
         FROM deals d
         LEFT JOIN organizations o ON o.id = d.org_id
         LEFT JOIN contacts c ON c.id = d.contact_id
        WHERE d.id = ?
        LIMIT 1`,
      [operationId]
    );
    return row || {};
  }
  return {};
}

async function buildExpenseControlData(operationId, opType, query = {}) {
  await ensureOperationExpenseTables();
  await ensureOperationExpenseTablesPost();
  const normalizedOpType = String(opType || 'deal').toLowerCase();
  const exchangeRateFromQuery = Number(query.exchange_rate || 0) || null;
  const [[settings]] = await pool.query(
    `SELECT exchange_rate FROM operation_expense_control_settings WHERE operation_id = ? AND operation_type = ?`,
    [operationId, normalizedOpType]
  );
  const exchangeRate = exchangeRateFromQuery || Number(settings?.exchange_rate || 0) || null;

  const industrialQuoteId = Number(query.quote_id || 0) || null;
  const industrialRevisionId = Number(query.quote_revision_id || 0) || null;
  const budget = industrialRevisionId || industrialQuoteId
    ? await fetchIndustrialBudget(operationId, industrialRevisionId, industrialQuoteId)
    : await fetchCargoBudget(operationId, query.cost_sheet_version_number);

  const invoiceWhere = ['e.operation_id = ?', 'e.operation_type = ?', "COALESCE(e.status, '') <> 'anulado'"];
  const invoiceParams = [operationId, normalizedOpType];
  appendExpenseRevisionScope(invoiceWhere, invoiceParams, query || {}, 'e');

  const [invoices] = await pool.query(
    `SELECT e.*,
            COALESCE(o.razon_social, o.name) AS supplier_org_name,
            o.ruc AS supplier_org_ruc,
            COALESCE(
              (
                SELECT GROUP_CONCAT(DISTINCT COALESCE(NULLIF(it.expense_rubro, ''), 'SIN CLASIFICAR') ORDER BY it.expense_rubro SEPARATOR ', ')
                FROM operation_expense_invoice_items it
                WHERE it.invoice_id = e.id
              ),
              COALESCE(NULLIF(e.expense_rubro, ''), 'SIN CLASIFICAR')
            ) AS expense_rubros
       FROM operation_expense_invoices e
       LEFT JOIN organizations o ON o.id = e.supplier_id
      WHERE ${invoiceWhere.join(' AND ')}
      ORDER BY e.invoice_date DESC, e.id DESC`,
    invoiceParams
  );

  const detailWhere = ['e.operation_id = ?', 'e.operation_type = ?', "COALESCE(e.status, '') <> 'anulado'"];
  const detailParams = [operationId, normalizedOpType];
  appendExpenseRevisionScope(detailWhere, detailParams, query || {}, 'e');

  const [detailRows] = await pool.query(
    `SELECT e.id AS invoice_id, e.currency_code, e.amount_total, e.expense_rubro AS invoice_rubro,
            it.id AS item_id, it.description, it.expense_rubro AS item_rubro, it.subtotal
       FROM operation_expense_invoices e
       LEFT JOIN operation_expense_invoice_items it ON it.invoice_id = e.id
      WHERE ${detailWhere.join(' AND ')}`,
    detailParams
  );

  const actualByRubro = {};
  const actualByCurrency = {};
  const invoiceHasItems = new Set(detailRows.filter((row) => row.item_id).map((row) => row.invoice_id));
  for (const invoice of invoices) {
    const currency = normCurrency(invoice.currency_code);
    actualByCurrency[currency] = Number(((actualByCurrency[currency] || 0) + Number(invoice.amount_total || 0)).toFixed(2));
  }
  for (const row of detailRows) {
    if (!row.item_id && invoiceHasItems.has(row.invoice_id)) continue;
    const rubro = String(row.item_rubro || row.invoice_rubro || 'SIN CLASIFICAR').toUpperCase();
    const sourceAmount = row.item_id ? row.subtotal : row.amount_total;
    const converted = convertAmount(sourceAmount, row.currency_code, budget.currency_code, exchangeRate);
    if (converted == null) {
      if (!actualByRubro[rubro]) actualByRubro[rubro] = null;
    } else {
      actualByRubro[rubro] = Number(((actualByRubro[rubro] || 0) + converted).toFixed(2));
    }
  }

  // Las comisiones aprobadas son un costo comercial de la operación. Se
  // registran como gasto administrativo para no duplicar facturas operativas,
  // pero se reflejan aquí para obtener el profit real completo.
  let commissionBudget = 0;
  let commissionActual = 0;
  try {
    const commissionWhere = ["l.operation_id = ?", "l.status <> 'anulada'"];
    const commissionParams = [operationId];
    if (industrialRevisionId) {
      commissionWhere.push('l.quote_revision_id = ?');
      commissionParams.push(industrialRevisionId);
    } else if (query.cost_sheet_version_number) {
      commissionWhere.push('l.cost_sheet_version_number = ?');
      commissionParams.push(Number(query.cost_sheet_version_number));
    }
    const [commissionRows] = await pool.query(
      `SELECT l.id, l.commission_gross, l.currency_code,
              COALESCE(SUM(a.amount), 0) AS invoiced_amount,
              MAX(ci.currency_code) AS invoice_currency_code
         FROM commission_liquidations l
         LEFT JOIN commission_invoice_allocations a ON a.liquidation_id = l.id
         LEFT JOIN commission_invoices ci ON ci.id = a.commission_invoice_id
        WHERE ${commissionWhere.join(' AND ')}
        GROUP BY l.id, l.commission_gross, l.currency_code`,
      commissionParams
    );
    for (const row of commissionRows) {
      const planned = convertAmount(row.commission_gross, row.currency_code, budget.currency_code, exchangeRate);
      if (planned != null) commissionBudget += planned;
      const actual = convertAmount(row.invoiced_amount, row.invoice_currency_code || row.currency_code, budget.currency_code, exchangeRate);
      if (actual != null) commissionActual += actual;
      addCurrencyAmount(actualByCurrency, row.invoice_currency_code || row.currency_code, row.invoiced_amount);
    }
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') throw error;
  }
  if (commissionBudget > 0) {
    budget.rubros = { ...(budget.rubros || {}), COMISION: Number(commissionBudget.toFixed(2)) };
    budget.budgeted_purchase = Number((Number(budget.budgeted_purchase || 0) + commissionBudget).toFixed(2));
    budget.budgeted_profit = Number((Number(budget.budgeted_sell || 0) - Number(budget.budgeted_purchase || 0)).toFixed(2));
  }
  if (commissionActual > 0) actualByRubro.COMISION = Number(((actualByRubro.COMISION || 0) + commissionActual).toFixed(2));

  const rubroOrder = ['FLETE', 'SEGURO', 'DESPACHO', 'PRODUCTO', 'ADICIONAL', 'INSTALACION', 'FINANCIACION', 'COMISION', 'SIN CLASIFICAR'];
  const rubroKeys = Array.from(new Set([...rubroOrder, ...Object.keys(budget.rubros || {}), ...Object.keys(actualByRubro)]));
  const rubros = rubroKeys.map((rubro) => {
    const budgeted = Number(budget.rubros?.[rubro] || 0);
    const actual = actualByRubro[rubro];
    const comparable = actual != null;
    const difference = comparable ? Number((Number(actual || 0) - budgeted).toFixed(2)) : null;
    return {
      rubro,
      currency_code: budget.currency_code,
      budgeted_purchase: budgeted,
      actual_purchase: comparable ? Number(actual || 0) : null,
      difference,
      status: !comparable ? 'not_comparable' : difference > 0.009 ? 'over_budget' : 'within_budget',
    };
  });

  const totalActualInBudget = invoices.reduce((sum, invoice) => {
    const converted = convertAmount(invoice.amount_total, invoice.currency_code, budget.currency_code, exchangeRate);
    return converted == null ? sum : sum + converted;
  }, 0) + commissionActual;
  const comparisons = Object.entries(actualByCurrency).map(([currency, actual]) => {
    const convertedBudget = convertAmount(budget.budgeted_purchase, budget.currency_code, currency, exchangeRate);
    const difference = convertedBudget == null ? null : Number((actual - convertedBudget).toFixed(2));
    return {
      currency_code: currency,
      actual_purchase: actual,
      budgeted_purchase: convertedBudget == null ? null : Number(convertedBudget.toFixed(2)),
      difference,
      status: difference == null ? 'not_comparable' : difference > 0.009 ? 'over_budget' : 'within_budget',
    };
  });

  return {
    operation_id: Number(operationId),
    operation_type: normalizedOpType,
    exchange_rate: exchangeRate,
    operation_meta: await fetchOperationExportMeta(operationId, normalizedOpType),
    budget,
    invoices,
    comparisons,
    rubros,
    real_profit_summary: {
      currency_code: budget.currency_code,
      budgeted_sell: Number(budget.budgeted_sell || 0),
      budgeted_buy: Number(budget.budgeted_purchase || 0),
      actual_buy: Number(totalActualInBudget.toFixed(2)),
      budgeted_profit: Number(budget.budgeted_profit || 0),
      real_profit: Number((Number(budget.budgeted_sell || 0) - totalActualInBudget).toFixed(2)),
      profit_difference: Number(((Number(budget.budgeted_sell || 0) - totalActualInBudget) - Number(budget.budgeted_profit || 0)).toFixed(2)),
    },
  };
}

function addCurrencyAmount(target, currency, amount) {
  const code = normCurrency(currency || 'USD');
  target[code] = Number(((target[code] || 0) + Number(amount || 0)).toFixed(2));
}

function convertCurrencyMap(values = {}, targetCurrency = 'USD', exchangeRate = null) {
  const result = {
    currency_code: normCurrency(targetCurrency),
    amount: 0,
    complete: true,
    missing_currencies: [],
  };
  for (const [currency, amount] of Object.entries(values || {})) {
    const converted = convertAmount(amount, currency, targetCurrency, exchangeRate);
    if (converted == null) {
      result.complete = false;
      result.missing_currencies.push(normCurrency(currency));
    } else {
      result.amount += converted;
    }
  }
  result.amount = Number(result.amount.toFixed(2));
  result.missing_currencies = Array.from(new Set(result.missing_currencies));
  return result;
}

function buildByCurrency(rows, field, currencyField = 'currency_code') {
  return rows.reduce((acc, row) => {
    addCurrencyAmount(acc, row[currencyField] || 'USD', row[field] || 0);
    return acc;
  }, {});
}

async function buildOperationFinancialStatement(operationId, opType, query = {}) {
  await ensureOperationExpenseTables();
  await ensureOperationExpenseTablesPost();
  const normalizedOpType = String(opType || 'deal').toLowerCase();
  const control = await buildExpenseControlData(operationId, normalizedOpType, query);
  const exchangeRate = Number(control.exchange_rate || 0) || null;
  const budgetCurrency = normCurrency(control.budget?.currency_code || 'USD');

  const [salesInvoices] = await pool.query(
    `
    SELECT
      i.id,
      i.invoice_number,
      i.issue_date,
      i.due_date,
      i.status,
      i.payment_condition,
      i.currency_code,
      i.total_amount,
      i.paid_amount AS paid_amount_db,
      i.credited_total AS credited_total_db,
      i.net_total_amount,
      i.net_balance,
      i.cost_sheet_version_number,
      i.quote_revision_id,
      COALESCE(o.razon_social, o.name) AS customer_name,
      o.ruc AS customer_ruc,
      COALESCE(rc.paid_amount, 0) AS receipts_paid,
      COALESCE(cn.credited_total, 0) AS credit_notes_total
    FROM invoices i
    LEFT JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS paid_amount
      FROM receipts
      WHERE status <> 'anulado'
      GROUP BY invoice_id
    ) rc ON rc.invoice_id = i.id
    LEFT JOIN (
      SELECT invoice_id, SUM(total_amount) AS credited_total
      FROM credit_notes
      WHERE status <> 'anulada'
      GROUP BY invoice_id
    ) cn ON cn.invoice_id = i.id
    WHERE i.deal_id = ?
    ORDER BY i.issue_date DESC, i.id DESC
    `,
    [operationId]
  );

  const saleDocuments = salesInvoices.map((row) => {
    const total = Number(row.total_amount || 0);
    const credited = Number(row.credit_notes_total || row.credited_total_db || 0);
    const paid = Number(row.receipts_paid || row.paid_amount_db || 0);
    const netTotal = Math.max(0, total - credited);
    const balance = Math.max(0, netTotal - paid);
    return {
      ...row,
      currency_code: normCurrency(row.currency_code || 'USD'),
      total_amount: Number(total.toFixed(2)),
      credited_total: Number(credited.toFixed(2)),
      paid_amount: Number(paid.toFixed(2)),
      net_total_amount: Number(netTotal.toFixed(2)),
      balance: Number(balance.toFixed(2)),
    };
  });

  const invoiceIds = saleDocuments.map((row) => Number(row.id)).filter(Boolean);
  let receipts = [];
  let canceledReceipts = [];
  let creditNotes = [];
  if (invoiceIds.length) {
    const placeholders = invoiceIds.map(() => '?').join(',');
    const [receiptRows] = await pool.query(
      `
      SELECT r.*, i.invoice_number
      FROM receipts r
      LEFT JOIN invoices i ON i.id = r.invoice_id
      WHERE r.status <> 'anulado' AND r.invoice_id IN (${placeholders})
      ORDER BY r.issue_date DESC, r.id DESC
      `,
      invoiceIds
    );
    receipts = receiptRows;
    const [canceledReceiptRows] = await pool.query(
      `
      SELECT r.*, i.invoice_number, u.name AS cancelled_by_name
      FROM receipts r
      LEFT JOIN invoices i ON i.id = r.invoice_id
      LEFT JOIN users u ON u.id = r.cancelled_by
      WHERE r.status = 'anulado' AND r.invoice_id IN (${placeholders})
      ORDER BY COALESCE(r.cancelled_at, r.updated_at, r.issue_date) DESC, r.id DESC
      `,
      invoiceIds
    );
    canceledReceipts = canceledReceiptRows;
    const [creditRows] = await pool.query(
      `
      SELECT cn.*, i.invoice_number
      FROM credit_notes cn
      LEFT JOIN invoices i ON i.id = cn.invoice_id
      WHERE cn.status <> 'anulada' AND cn.invoice_id IN (${placeholders})
      ORDER BY cn.issue_date DESC, cn.id DESC
      `,
      invoiceIds
    );
    creditNotes = creditRows;
  }

  const purchaseInvoices = (control.invoices || []).map((row) => ({
    ...row,
    currency_code: normCurrency(row.currency_code || 'PYG'),
    amount_total: Number(row.amount_total || 0),
    paid_amount: Number(row.paid_amount || 0),
    balance: Number(row.balance || 0),
  }));
  const scopedExpenseInvoiceIds = purchaseInvoices.map((row) => Number(row.id)).filter(Boolean);
  let expensePayments = [];
  let paymentOrders = [];
  if (scopedExpenseInvoiceIds.length) {
    const placeholders = scopedExpenseInvoiceIds.map(() => '?').join(',');
    const [paymentRows] = await pool.query(
      `
      SELECT
        p.*,
        e.receipt_number,
        e.supplier_name,
        e.supplier_ruc,
        e.currency_code AS invoice_currency_code
      FROM operation_expense_payments p
      INNER JOIN operation_expense_invoices e ON e.id = p.invoice_id
      WHERE p.invoice_id IN (${placeholders})
        AND COALESCE(e.status, '') <> 'anulado'
        AND COALESCE(p.status, '') <> 'anulado'
      ORDER BY p.payment_date DESC, p.id DESC
      `,
      scopedExpenseInvoiceIds
    );
    expensePayments = paymentRows;
    const [orderRows] = await pool.query(
      `
      SELECT DISTINCT po.*
      FROM operation_expense_payment_orders po
      LEFT JOIN operation_expense_payment_order_items poi ON poi.order_id = po.id
      WHERE COALESCE(po.status, '') <> 'anulada'
        AND (po.invoice_id IN (${placeholders}) OR poi.invoice_id IN (${placeholders}))
      ORDER BY po.created_at DESC, po.id DESC
      `,
      [...scopedExpenseInvoiceIds, ...scopedExpenseInvoiceIds]
    );
    paymentOrders = orderRows;
  }

  const sales = {
    invoices: saleDocuments,
    receipts,
    canceled_receipts: canceledReceipts,
    credit_notes: creditNotes,
    totals: {
      invoiced_by_currency: buildByCurrency(saleDocuments, 'total_amount'),
      credited_by_currency: buildByCurrency(saleDocuments, 'credited_total'),
      net_sales_by_currency: buildByCurrency(saleDocuments, 'net_total_amount'),
      collected_by_currency: buildByCurrency(saleDocuments, 'paid_amount'),
      receivable_by_currency: buildByCurrency(saleDocuments, 'balance'),
    },
  };

  const purchases = {
    invoices: purchaseInvoices,
    payments: expensePayments,
    payment_orders: paymentOrders,
    totals: {
      budgeted_by_currency: { [budgetCurrency]: Number(control.budget?.budgeted_purchase || 0) },
      actual_by_currency: buildByCurrency(purchaseInvoices, 'amount_total'),
      paid_by_currency: buildByCurrency(purchaseInvoices, 'paid_amount'),
      payable_by_currency: buildByCurrency(purchaseInvoices, 'balance'),
      payment_orders_by_currency: buildByCurrency(paymentOrders, 'amount'),
    },
  };

  const convertedSalesNet = convertCurrencyMap(sales.totals.net_sales_by_currency, budgetCurrency, exchangeRate);
  const convertedSalesCollected = convertCurrencyMap(sales.totals.collected_by_currency, budgetCurrency, exchangeRate);
  const convertedPurchasesActual = convertCurrencyMap(purchases.totals.actual_by_currency, budgetCurrency, exchangeRate);
  const convertedPurchasesPaid = convertCurrencyMap(purchases.totals.paid_by_currency, budgetCurrency, exchangeRate);
  const convertedReceivable = convertCurrencyMap(sales.totals.receivable_by_currency, budgetCurrency, exchangeRate);
  const convertedPayable = convertCurrencyMap(purchases.totals.payable_by_currency, budgetCurrency, exchangeRate);

  const convertedComplete = convertedSalesNet.complete && convertedPurchasesActual.complete;
  const budgetedSell = Number(control.budget?.budgeted_sell || 0);
  const budgetedBuy = Number(control.budget?.budgeted_purchase || 0);
  const budgetedProfit = Number(control.budget?.budgeted_profit || (budgetedSell - budgetedBuy));
  const realProfit = convertedComplete
    ? Number((convertedSalesNet.amount - convertedPurchasesActual.amount).toFixed(2))
    : null;

  const movements = [
    ...saleDocuments.map((row) => ({
      date: row.issue_date || row.created_at,
      type: 'venta',
      label: 'Factura venta',
      document_number: row.invoice_number || row.id,
      third_party: row.customer_name || 'Cliente',
      currency_code: row.currency_code,
      debit: row.net_total_amount,
      credit: 0,
      source_id: row.id,
      source_type: 'invoice',
    })),
    ...receipts.map((row) => ({
      date: row.issue_date || row.created_at,
      type: 'cobro',
      label: 'Cobro cliente',
      document_number: row.receipt_number || row.id,
      third_party: row.invoice_number || 'Factura',
      currency_code: normCurrency(row.currency_code || 'USD'),
      debit: 0,
      credit: Number(row.amount || 0),
      source_id: row.id,
      source_type: 'receipt',
    })),
    ...canceledReceipts.map((row) => ({
      date: row.cancelled_at || row.updated_at || row.issue_date || row.created_at,
      type: 'anulacion_recibo',
      label: 'Anulacion de recibo',
      document_number: row.receipt_number || row.id,
      third_party: row.invoice_number || 'Factura',
      description: row.cancel_reason
        ? `Motivo: ${row.cancel_reason}`
        : 'Recibo anulado',
      currency_code: normCurrency(row.currency_code || 'USD'),
      debit: Number(row.amount || 0),
      credit: 0,
      source_id: row.id,
      source_type: 'receipt',
    })),
    ...creditNotes.map((row) => ({
      date: row.issue_date || row.created_at,
      type: 'nota_credito',
      label: 'Nota de credito',
      document_number: row.credit_note_number || row.id,
      third_party: row.invoice_number || 'Factura',
      currency_code: normCurrency(row.currency_code || saleDocuments.find((inv) => Number(inv.id) === Number(row.invoice_id))?.currency_code || 'USD'),
      debit: 0,
      credit: Number(row.total_amount || 0),
      source_id: row.id,
      source_type: 'credit_note',
    })),
    ...purchaseInvoices.map((row) => ({
      date: row.invoice_date || row.created_at,
      type: 'compra',
      label: 'Factura compra',
      document_number: row.receipt_number || row.id,
      third_party: row.supplier_org_name || row.supplier_name || 'Proveedor',
      currency_code: row.currency_code,
      debit: 0,
      credit: Number(row.amount_total || 0),
      source_id: row.id,
      source_type: 'operation_expense_invoice',
    })),
    ...expensePayments.map((row) => ({
      date: row.payment_date || row.created_at,
      type: 'pago_proveedor',
      label: 'Pago proveedor',
      document_number: row.reference_number || row.id,
      third_party: row.supplier_name || row.receipt_number || 'Proveedor',
      currency_code: normCurrency(row.invoice_currency_code || 'PYG'),
      debit: 0,
      credit: Number(row.amount || 0),
      source_id: row.id,
      source_type: 'operation_expense_payment',
    })),
  ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  return {
    operation_id: Number(operationId),
    operation_type: normalizedOpType,
    operation_meta: control.operation_meta,
    exchange_rate: exchangeRate,
    budget: control.budget,
    sales,
    purchases,
    result: {
      currency_code: budgetCurrency,
      budgeted_sell: budgetedSell,
      budgeted_buy: budgetedBuy,
      budgeted_profit: Number(budgetedProfit.toFixed(2)),
      actual_net_sales: convertedSalesNet,
      actual_collected: convertedSalesCollected,
      actual_buy: convertedPurchasesActual,
      actual_paid_to_suppliers: convertedPurchasesPaid,
      receivable: convertedReceivable,
      payable: convertedPayable,
      real_profit: realProfit,
      profit_difference: realProfit == null ? null : Number((realProfit - budgetedProfit).toFixed(2)),
      status: realProfit == null ? 'sin_comparacion' : realProfit >= budgetedProfit ? 'mejor_o_igual' : 'menor_profit',
    },
    rubros: control.rubros,
    movements,
  };
}

router.get('/:id/expense-control', requireAuth, async (req, res) => {
  try {
    const data = await buildExpenseControlData(req.params.id, req.query?.op_type || 'deal', req.query || {});
    res.json(data);
  } catch (e) {
    console.error('[operation-expense] control error', e);
    res.status(500).json({ error: 'Error loading expense control' });
  }
});

router.get('/:id/financial-statement', requireAuth, async (req, res) => {
  try {
    const data = await buildOperationFinancialStatement(req.params.id, req.query?.op_type || 'deal', req.query || {});
    res.json(data);
  } catch (e) {
    console.error('[operation-expense] financial statement error', e);
    res.status(500).json({ error: 'Error loading operation financial statement' });
  }
});

router.put('/:id/expense-control-settings', requireAuth, async (req, res) => {
  try {
    await ensureOperationExpenseTables();
    const opType = String(req.body?.op_type || req.query?.op_type || 'deal').toLowerCase();
    const rate = req.body?.exchange_rate == null || req.body?.exchange_rate === '' ? null : Number(req.body.exchange_rate);
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) {
      return res.status(400).json({ error: 'TC invalido' });
    }
    await pool.query(
      `INSERT INTO operation_expense_control_settings (operation_id, operation_type, exchange_rate, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE exchange_rate = VALUES(exchange_rate), updated_by = VALUES(updated_by)`,
      [req.params.id, opType, rate, req.user?.id || null]
    );
    res.json({ ok: true, exchange_rate: rate });
  } catch (e) {
    console.error('[operation-expense] control settings error', e);
    res.status(500).json({ error: 'Error saving expense control settings' });
  }
});

function getOperationFinalTemplatePath() {
  const candidates = [
    path.resolve('templates', 'OPERACION_FINAL_TEMPLATE.xlsx'),
    path.resolve('server', 'templates', 'OPERACION_FINAL_TEMPLATE.xlsx'),
    path.resolve('templates', 'DETALLE_CALCULO_COSTOS_FINALES_TEMPLATE.xlsx'),
    path.resolve('server', 'templates', 'DETALLE_CALCULO_COSTOS_FINALES_TEMPLATE.xlsx'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function setCellValue(ws, address, value) {
  const cell = ws.getCell(address);
  cell.value = value ?? null;
}

function setMoneyCell(ws, address, value) {
  const cell = ws.getCell(address);
  cell.value = Number(value || 0);
  cell.numFmt = '#,##0.00';
}

function rubroRowValue(rowsByRubro, rubro, field) {
  const row = rowsByRubro.get(String(rubro || '').toUpperCase());
  if (!row) return 0;
  return Number(row[field] || 0);
}

function fillOperationFinalTemplate(workbook, data) {
  const ws = workbook.getWorksheet('DETALLE OPERACION FINAL') || workbook.worksheets[0];
  if (!ws) return;

  const ref = data.operation_meta?.reference || data.operation_id;
  const revision = data.budget?.revision_label || '';
  const refRevision = [ref, revision].filter(Boolean).join(' - ');
  ['H4', 'H5', 'H6'].forEach((cell) => setCellValue(ws, cell, `REF: ${refRevision}`));
  setCellValue(ws, 'D10', data.budget?.currency_code || data.real_profit_summary?.currency_code || 'USD');
  setCellValue(ws, 'C12', data.operation_meta?.client_name || '');
  setCellValue(ws, 'C13', data.operation_meta?.contact_name || '');
  setCellValue(ws, 'C14', data.operation_meta?.contact_phone || '');
  setCellValue(ws, 'C21', 'COSTOS FINALES');
  setCellValue(ws, 'I65', 'AGENTE / PROVEEDORES');

  if (data.exchange_rate) {
    setMoneyCell(ws, 'L18', data.exchange_rate);
    setMoneyCell(ws, 'L19', data.exchange_rate);
  }

  const rowsByRubro = new Map((data.rubros || []).map((row) => [String(row.rubro || '').toUpperCase(), row]));
  const sellRubros = data.budget?.sell_rubros || {};
  const hasSellBreakdown = Object.values(sellRubros).some((value) => Math.abs(Number(value || 0)) > 0.009);
  const totalSell = Number(data.real_profit_summary?.budgeted_sell || data.budget?.budgeted_sell || 0);

  const rowMap = [
    { rubro: 'PRODUCTO', row: 25, label: 'PRODUCTO / PUERTAS', buyCell: 'E25', sellCell: 'K25' },
    { rubro: 'FLETE', row: 26, label: 'FLETE', buyCell: 'E26', sellCell: 'K26' },
    { rubro: 'DESPACHO', row: 27, label: 'DESPACHO ADUANERO', buyCell: 'E27', sellCell: 'K27' },
    { rubro: 'ADICIONAL', row: 28, label: 'ADICIONAL', buyCell: 'E28', sellCell: 'K28' },
    { rubro: 'FINANCIACION', row: 29, label: 'FINANCIACION', buyCell: 'E29', sellCell: 'K29' },
    { rubro: 'INSTALACION', row: 40, label: 'INSTALACION', buyCell: 'E40', sellCell: 'K40' },
    { rubro: 'SEGURO', row: 55, label: 'SEGURO DE CARGA', buyCell: 'E55', sellCell: 'K55' },
  ];

  rowMap.forEach((item) => {
    setCellValue(ws, `B${item.row}`, item.label);
    setCellValue(ws, `C${item.row}`, item.label);
    const actual = rubroRowValue(rowsByRubro, item.rubro, 'actual_purchase');
    setMoneyCell(ws, item.buyCell, actual);
    const sell = hasSellBreakdown ? Number(sellRubros[item.rubro] || 0) : item.rubro === 'PRODUCTO' ? totalSell : 0;
    setMoneyCell(ws, item.sellCell, sell);
  });

  const unclassified = rubroRowValue(rowsByRubro, 'SIN CLASIFICAR', 'actual_purchase');
  if (Math.abs(unclassified) > 0.009) {
    setCellValue(ws, 'B30', 'SIN CLASIFICAR');
    setCellValue(ws, 'C30', 'SIN CLASIFICAR');
    setMoneyCell(ws, 'E30', unclassified);
  }

  setMoneyCell(ws, 'C53', totalSell);

  const invoices = data.invoices || [];
  const paymentStart = 65;
  invoices.slice(0, 8).forEach((invoice, idx) => {
    const row = paymentStart + idx;
    setCellValue(ws, `H${row}`, idx + 1);
    setCellValue(ws, `I${row}`, invoice.supplier_org_name || invoice.supplier_name || 'Proveedor');
    setCellValue(ws, `J${row}`, invoice.currency_code || data.budget?.currency_code || 'USD');
    setMoneyCell(ws, `K${row}`, invoice.amount_total || 0);
  });
}

function addExpenseControlSheets(workbook, data) {
  const existingRubros = workbook.getWorksheet('Rubros');
  if (existingRubros) workbook.removeWorksheet(existingRubros.id);
  const rubros = workbook.addWorksheet('Rubros');
  rubros.addRow(['Item compra', 'Moneda', 'Compra real', 'Compra presup.', 'Diferencia', 'Estado']);
  data.rubros.forEach((row) =>
    rubros.addRow([row.rubro, row.currency_code, row.actual_purchase, row.budgeted_purchase, row.difference, row.status])
  );
  rubros.columns = [{ width: 22 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];

  const existingInvoices = workbook.getWorksheet('Facturas reales');
  if (existingInvoices) workbook.removeWorksheet(existingInvoices.id);
  const invoicesSheet = workbook.addWorksheet('Facturas reales');
  invoicesSheet.addRow(['Fecha', 'Proveedor', 'Comprobante', 'Item compra', 'Concepto', 'Moneda', 'Total', 'Pagado', 'Saldo', 'Estado']);
  data.invoices.forEach((inv) =>
    invoicesSheet.addRow([
      inv.invoice_date,
      inv.supplier_org_name || inv.supplier_name,
      [inv.receipt_type, inv.receipt_number].filter(Boolean).join(' '),
      inv.expense_rubros || inv.expense_rubro || 'SIN CLASIFICAR',
      inv.expense_concept || '',
      inv.currency_code,
      Number(inv.amount_total || 0),
      Number(inv.paid_amount || 0),
      Number(inv.balance || 0),
      inv.payment_status || inv.status,
    ])
  );
  invoicesSheet.columns = [
    { width: 14 }, { width: 28 }, { width: 20 }, { width: 18 }, { width: 24 },
    { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];

  for (const ws of [rubros, invoicesSheet]) {
    ws.getRow(1).font = { bold: true };
    ws.eachRow((row) => row.eachCell((cell) => {
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    }));
  }
}

router.get('/:id/expense-control/export-xlsx', requireAuth, async (req, res) => {
  try {
    const data = await buildExpenseControlData(req.params.id, req.query?.op_type || 'deal', req.query || {});
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATMCARGO';
    const templatePath = getOperationFinalTemplatePath();
    if (templatePath) await wb.xlsx.readFile(templatePath);
    else wb.addWorksheet('DETALLE OPERACION FINAL');
    fillOperationFinalTemplate(wb, data);
    addExpenseControlSheets(wb, data);
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="costos-finales-op-${req.params.id}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('[operation-expense] export xlsx error', e);
    res.status(500).json({ error: 'Error exporting expense control' });
  }
});

router.get('/:id/expense-control/export-pdf', requireAuth, async (req, res) => {
  try {
    const data = await buildExpenseControlData(req.params.id, req.query?.op_type || 'deal', req.query || {});
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="costos-finales-op-${req.params.id}.pdf"`);
      res.send(buffer);
    });
    doc.fontSize(16).text('OPERACION FINAL', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9);
    doc.text(`REF: ${data.operation_meta?.reference || data.operation_id} - ${data.budget?.revision_label || ''}`);
    doc.text(`Cliente: ${data.operation_meta?.client_name || ''}`);
    doc.text(`Contacto: ${data.operation_meta?.contact_name || ''}`);
    doc.text(`Telefono: ${data.operation_meta?.contact_phone || ''}`);
    doc.moveDown();
    doc.fontSize(11).text('Resumen', { underline: true });
    const s = data.real_profit_summary;
    [
      ['Venta presupuestada', moneyText(s.budgeted_sell, s.currency_code)],
      ['Compra presupuestada', moneyText(s.budgeted_buy, s.currency_code)],
      ['Compra real', moneyText(s.actual_buy, s.currency_code)],
      ['Diferencia costo', costDiffText(s.actual_buy - s.budgeted_buy, s.currency_code)],
      ['Profit presupuestado', moneyText(s.budgeted_profit, s.currency_code)],
      ['Profit real', moneyText(s.real_profit, s.currency_code)],
    ].forEach(([label, value]) => doc.text(`${label}: ${value}`));
    doc.moveDown();
    doc.fontSize(11).text('Compra presupuestada vs real', { underline: true });
    doc.fontSize(8);
    data.rubros.forEach((row) => {
      doc.text(`${row.rubro}: Presup. ${moneyText(row.budgeted_purchase, row.currency_code)} | Real ${row.actual_purchase == null ? 'Sin TC' : moneyText(row.actual_purchase, row.currency_code)} | Dif. ${row.difference == null ? 'Sin comparacion' : costDiffText(row.difference, row.currency_code)} | ${row.status}`);
    });
    doc.moveDown();
    doc.fontSize(11).text('Facturas reales', { underline: true });
    doc.fontSize(8);
    data.invoices.slice(0, 40).forEach((inv) => {
      doc.text(`${inv.invoice_date || ''} | ${inv.supplier_org_name || inv.supplier_name || ''} | ${inv.receipt_number || ''} | ${inv.expense_rubros || inv.expense_rubro || 'SIN CLASIFICAR'} | ${moneyText(inv.amount_total, inv.currency_code)}`);
    });
    doc.end();
  } catch (e) {
    console.error('[operation-expense] export pdf error', e);
    res.status(500).json({ error: 'Error exporting expense control PDF' });
  }
});

router.delete('/:id/expense-invoices/:invoiceId', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureOperationExpenseTables();
    const { id, invoiceId } = req.params;
    const opType = String(req.query?.op_type || 'deal').toLowerCase();
    const [[inv]] = await conn.query(
      `SELECT * FROM operation_expense_invoices WHERE id = ? AND operation_id = ? AND operation_type = ? LIMIT 1`,
      [invoiceId, id, opType]
    );
    if (!inv?.id) return res.status(404).json({ error: 'Not found' });
    const [[pay]] = await conn.query(
      `SELECT COUNT(*) AS total FROM operation_expense_payments WHERE invoice_id = ? AND status <> 'anulado'`,
      [invoiceId]
    );
    if (Number(pay?.total || 0) > 0) {
      return res.status(409).json({ error: 'No se puede eliminar una factura con pagos registrados.' });
    }
    const [orders] = await conn.query(
      `SELECT DISTINCT po.id, po.status
         FROM operation_expense_payment_orders po
         LEFT JOIN operation_expense_payment_order_items i ON i.order_id = po.id
        WHERE i.invoice_id = ? OR po.invoice_id = ?`,
      [invoiceId, invoiceId]
    );
    const blocked = orders.find((o) => !['pendiente', 'anulada', '', null].includes(o.status));
    if (blocked) {
      return res.status(409).json({ error: 'No se puede eliminar una factura con orden de pago aprobada o pagada.' });
    }
    const [attachments] = await conn.query(
      `SELECT file_url FROM operation_expense_attachments WHERE invoice_id = ?`,
      [invoiceId]
    );
    await conn.beginTransaction();
    await conn.query(`DELETE FROM operation_expense_attachments WHERE invoice_id = ?`, [invoiceId]);
    await conn.query(`DELETE FROM operation_expense_invoice_items WHERE invoice_id = ?`, [invoiceId]);
    await conn.query(`DELETE FROM operation_expense_payment_order_items WHERE invoice_id = ?`, [invoiceId]);
    await conn.query(`DELETE FROM operation_expense_payment_orders WHERE invoice_id = ? AND status IN ('pendiente','anulada')`, [invoiceId]);
    await conn.query(`DELETE FROM operation_expense_invoices WHERE id = ?`, [invoiceId]);
    await conn.commit();
    for (const file of attachments) {
      if (!file.file_url) continue;
      const localPath = path.resolve('.', String(file.file_url).replace(/^\/+/, ''));
      fs.promises.unlink(localPath).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[operation-expense] delete error', e);
    res.status(500).json({ error: 'Error deleting operation expense invoice' });
  } finally {
    conn.release();
  }
});

export default router;
