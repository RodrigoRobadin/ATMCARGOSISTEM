// server/src/routes/operationExpenseInvoices.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { pool } from '../services/db.js';
import generatePaymentOrderPDF from '../services/paymentOrderTemplatePdfkit.js';
import { requireAuth } from '../middlewares/auth.js';

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
    if (!have.has('tax_mode')) add.push('ADD COLUMN tax_mode VARCHAR(16) NULL');
    if (!have.has('gravado_10')) add.push('ADD COLUMN gravado_10 DECIMAL(15,2) NULL');
    if (!have.has('gravado_5')) add.push('ADD COLUMN gravado_5 DECIMAL(15,2) NULL');
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

async function recomputePaymentOrder(orderId) {
  const [[order]] = await pool.query(
    `SELECT id, status, approved_at
       FROM operation_expense_payment_orders
      WHERE id = ? LIMIT 1`,
    [orderId]
  );
  if (!order) return;

  const [[sumItems]] = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total
       FROM operation_expense_payment_order_items
      WHERE order_id = ?`,
    [orderId]
  );
  const total = Number(sumItems?.total || 0);

  const [[sumPaid]] = await pool.query(
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
  await pool.query(
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
      const qty = toNum(it.quantity || 0) || 1;
      const unit = toNum(it.unit_price || 0);
      const subtotal = toNum(it.subtotal || qty * unit);
      const taxRate = Number(it.tax_rate ?? 10);
      return {
        description: String(it.description || '').trim() || 'Sin descripción',
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
             ) AS item_count
        FROM operation_expense_invoices e
        LEFT JOIN organizations o ON o.id = e.supplier_id
       WHERE e.operation_id = ? AND e.operation_type = ?
       ORDER BY e.invoice_date DESC, e.id DESC
      `,
      [id, opType]
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
      taxMode =
        gravado10 && gravado5
          ? 'mixto'
          : gravado10
          ? 'solo10'
          : gravado5
          ? 'solo5'
          : 'mixto';
      iva10 = gravado10 ? gravado10 / 11 : 0;
      iva5 = gravado5 ? gravado5 / 21 : 0;
      payload.iva_exempt = Number(t.exento.toFixed(2)) || 0;
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
       tax_mode, gravado_10, gravado_5,
       condition_type, due_date, currency_code, exchange_rate, amount_total,
       iva_10, iva_5, iva_exempt, iva_no_taxed,
       status, payment_status, paid_amount, balance,
       supplier_id, supplier_name, supplier_ruc, buyer_name, buyer_ruc, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        Number(id),
        opType,
        payload.invoice_date || null,
        payload.receipt_type || null,
        payload.receipt_number || null,
        payload.timbrado_number || null,
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
           (invoice_id, description, quantity, unit_price, tax_rate, subtotal, item_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            result.insertId,
            it.description,
            it.quantity,
            it.unit_price,
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
      taxMode =
        gravado10 && gravado5
          ? 'mixto'
          : gravado10
          ? 'solo10'
          : gravado5
          ? 'solo5'
          : 'mixto';
      iva10 = gravado10 ? gravado10 / 11 : 0;
      iva5 = gravado5 ? gravado5 / 21 : 0;
      const exento = Number(t.exento.toFixed(2)) || 0;
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
    params.push(Number(id), Number(invoiceId));
    await pool.query(
      `UPDATE operation_expense_invoices SET ${sets.join(', ')} WHERE operation_id = ? AND id = ?`,
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
           (invoice_id, description, quantity, unit_price, tax_rate, subtotal, item_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId,
            it.description,
            it.quantity,
            it.unit_price,
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
    if (String(inv.condition_type || '').toUpperCase() !== 'CREDITO') {
      return res.status(400).json({ error: 'La factura no es a crédito' });
    }
    const order = await findOrderForInvoice(invoiceId);
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
    await recomputePaymentOrder(order.id);

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

router.post('/:id/expense-invoices/:invoiceId/payment-orders', requireAuth, async (req, res) => {
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
router.post('/:id/expense-invoices/payment-orders', requireAuth, async (req, res) => {
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

export default router;
