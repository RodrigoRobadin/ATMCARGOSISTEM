import { pool } from './db.js';
import { ensureSupplierCreditNoteTables, recalculateSupplierDocument } from './supplierCreditNotes.js';

export const PAYMENT_SOURCES = {
  'operation-expense': { table: 'operation_expense_invoices', supplier: 'supplier_id', paymentTable: 'operation_expense_payments' },
  'purchase-invoice': { table: 'purchase_invoices', supplier: 'supplier_id', paymentTable: 'purchase_invoice_payments' },
  'admin-expense': { table: 'admin_expenses', supplier: 'provider_id', paymentTable: 'admin_expense_payments' },
};

export const PAYMENT_METHODS = ['Transferencia', 'Efectivo', 'Cheque', 'Tarjeta', 'Deposito', 'Otro'];

export function validatePaymentMethod(value) {
  if (!PAYMENT_METHODS.includes(value)) {
    throw Object.assign(new Error('Seleccione un método de pago válido'), { statusCode: 400 });
  }
  return value;
}

let schemaPromise;
export function ensureUnifiedPaymentOrderSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS ap_payment_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_number VARCHAR(32) NULL,
      request_id VARCHAR(64) NOT NULL,
      supplier_id INT NOT NULL,
      supplier_name VARCHAR(160) NOT NULL,
      supplier_ruc VARCHAR(32) NULL,
      currency_code VARCHAR(8) NOT NULL,
      beneficiary_account VARCHAR(255) NULL,
      planned_payment_date DATE NULL,
      payment_method VARCHAR(32) NULL,
      company_account VARCHAR(160) NULL,
      notes TEXT NULL,
      amount DECIMAL(15,2) NOT NULL,
      paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      status VARCHAR(24) NOT NULL DEFAULT 'pendiente',
      created_by INT NULL,
      approved_by INT NULL,
      approved_at DATETIME NULL,
      cancelled_by INT NULL,
      cancelled_at DATETIME NULL,
      cancel_reason VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ap_order_request (request_id),
      UNIQUE KEY uq_ap_order_number (order_number),
      INDEX idx_ap_order_supplier (supplier_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [methodColumns] = await pool.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_payment_orders' AND COLUMN_NAME = 'payment_method'`);
    if (!methodColumns.length) {
      await pool.query('ALTER TABLE ap_payment_orders ADD COLUMN payment_method VARCHAR(32) NULL AFTER planned_payment_date');
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS ap_payment_order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      source_type VARCHAR(32) NOT NULL,
      source_id INT NOT NULL,
      document_number VARCHAR(64) NULL,
      amount DECIMAL(15,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ap_order_item (order_id, source_type, source_id),
      INDEX idx_ap_item_document (source_type, source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ap_payment_order_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      request_id VARCHAR(64) NOT NULL,
      payment_date DATE NOT NULL,
      method VARCHAR(32) NOT NULL,
      company_account VARCHAR(160) NOT NULL,
      reference_number VARCHAR(128) NULL,
      receipt_path VARCHAR(512) NOT NULL,
      receipt_name VARCHAR(255) NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ap_payment_request (request_id),
      INDEX idx_ap_payment_order (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ap_payment_order_allocations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payment_id INT NOT NULL,
      item_id INT NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      source_payment_id INT NOT NULL,
      UNIQUE KEY uq_ap_payment_item (payment_id, item_id),
      INDEX idx_ap_allocation_item (item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ap_payment_order_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      event_type VARCHAR(32) NOT NULL,
      actor_user_id INT NULL,
      detail_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ap_event_order (order_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

export function cents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return NaN;
  return Math.round(number * 100);
}

export function availableCents(balance, reserved) {
  return Math.max(0, cents(balance) - cents(reserved));
}

export function validateSelection(items) {
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('Seleccione al menos un documento'), { statusCode: 400 });
  const seen = new Set();
  return items.map((item) => {
    const sourceType = String(item.source_type || '');
    const sourceId = Number(item.source_id);
    const amount = cents(item.amount);
    if (!PAYMENT_SOURCES[sourceType] || !Number.isSafeInteger(sourceId) || sourceId <= 0 || !Number.isSafeInteger(amount) || amount <= 0) {
      throw Object.assign(new Error('Documento o importe inválido'), { statusCode: 400 });
    }
    const key = `${sourceType}:${sourceId}`;
    if (seen.has(key)) throw Object.assign(new Error('Documento repetido en la orden'), { statusCode: 400 });
    seen.add(key);
    return { sourceType, sourceId, amount };
  }).sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.sourceId - b.sourceId);
}

export async function reservedCents(conn, sourceType, sourceId, excludeOrderId = null) {
  const [[row]] = await conn.query(`
    SELECT COALESCE(SUM(GREATEST(0, i.amount - COALESCE((
      SELECT SUM(a.amount) FROM ap_payment_order_allocations a WHERE a.item_id = i.id
    ), 0))), 0) AS reserved
    FROM ap_payment_order_items i
    JOIN ap_payment_orders o ON o.id = i.order_id
    WHERE i.source_type = ? AND i.source_id = ? AND o.status <> 'anulada'
      AND (? IS NULL OR o.id <> ?)`, [sourceType, sourceId, excludeOrderId, excludeOrderId]);
  return cents(row?.reserved || 0);
}

export async function assertDirectPaymentAvailable(sourceType, sourceId, amount, balance) {
  await ensureUnifiedPaymentOrderSchema();
  const reserved = await reservedCents(pool, sourceType, sourceId);
  if (reserved > 0) {
    throw Object.assign(new Error('Este documento tiene una orden de pago unificada activa. Registre el pago desde la orden'), { statusCode: 409 });
  }
  if (cents(amount) > cents(balance)) {
    throw Object.assign(new Error('El pago supera el saldo pendiente'), { statusCode: 409 });
  }
}

export async function assertNoUnifiedReservation(sourceType, sourceId) {
  await ensureUnifiedPaymentOrderSchema();
  if (await reservedCents(pool, sourceType, sourceId)) {
    throw Object.assign(new Error('El documento ya está incluido en una orden de pago unificada'), { statusCode: 409 });
  }
}

export async function assertNoUnifiedOrderHistory(sourceType, sourceId) {
  await ensureUnifiedPaymentOrderSchema();
  const [[row]] = await pool.query(`SELECT o.id FROM ap_payment_order_items i
    JOIN ap_payment_orders o ON o.id = i.order_id
    WHERE i.source_type = ? AND i.source_id = ? AND o.status <> 'anulada' LIMIT 1`, [sourceType, sourceId]);
  if (row) throw Object.assign(new Error('El documento tiene una orden de pago unificada; revise esa orden antes de anularlo'), { statusCode: 409 });
}

export async function lockedDocument(conn, sourceType, sourceId) {
  const spec = PAYMENT_SOURCES[sourceType];
  if (!spec) return null;
  const [[row]] = await conn.query(`SELECT * FROM ${spec.table} WHERE id = ? FOR UPDATE`, [sourceId]);
  if (!row) return null;
  const totals = await recalculateSupplierDocument(sourceType, sourceId, conn);
  const supplierId = Number(row[spec.supplier] || 0);
  const currency = sourceType === 'purchase-invoice' ? 'PYG' : String(row.currency_code || 'PYG').toUpperCase();
  const number = sourceType === 'operation-expense' ? row.receipt_number
    : sourceType === 'purchase-invoice' ? (row.supplier_invoice_number || row.invoice_number)
      : row.receipt_number;
  const supplierDocNumber = sourceType === 'purchase-invoice' ? row.supplier_invoice_number : row.receipt_number;
  return { row, totals, supplierId, currency, number: String(number || ''), supplierDocNumber: String(supplierDocNumber || ''), status: String(row.status || '').toLowerCase() };
}

export async function duplicateSupplierDocument(conn, supplierId, documentNumber, sourceType, sourceId) {
  const number = String(documentNumber || '').trim().toUpperCase();
  if (!number) return null;
  const [rows] = await conn.query(`
    SELECT 'operation-expense' AS source_type, id AS source_id FROM operation_expense_invoices
      WHERE supplier_id = ? AND UPPER(TRIM(receipt_number)) = ? AND status <> 'anulada'
    UNION ALL
    SELECT 'purchase-invoice', id FROM purchase_invoices
      WHERE supplier_id = ? AND UPPER(TRIM(supplier_invoice_number)) = ? AND status <> 'anulada'
    UNION ALL
    SELECT 'admin-expense', id FROM admin_expenses
      WHERE provider_id = ? AND UPPER(TRIM(receipt_number)) = ? AND status <> 'anulado'`,
  [supplierId, number, supplierId, number, supplierId, number]);
  return rows.find((row) => row.source_type !== sourceType || Number(row.source_id) !== Number(sourceId)) || null;
}

export async function legacyOrderExists(conn, sourceType, sourceId) {
  if (sourceType === 'operation-expense') {
    const [[row]] = await conn.query(`SELECT o.id FROM operation_expense_payment_orders o
      LEFT JOIN operation_expense_payment_order_items i ON i.order_id = o.id
      WHERE (o.invoice_id = ? OR i.invoice_id = ?) AND o.status IN ('pendiente', 'aprobada', 'pago_parcial') LIMIT 1`, [sourceId, sourceId]);
    return Boolean(row);
  }
  if (sourceType === 'admin-expense') {
    const [[row]] = await conn.query(`SELECT id FROM admin_expense_payment_orders WHERE expense_id = ? AND status IN ('pendiente', 'aprobada', 'pago_parcial') LIMIT 1`, [sourceId]);
    return Boolean(row);
  }
  return false;
}

export async function createSourcePayment(conn, { sourceType, sourceId, amount, date, method, account, reference, notes, userId }) {
  const value = amount / 100;
  let result;
  if (sourceType === 'operation-expense') {
    [result] = await conn.query(`INSERT INTO operation_expense_payments
      (invoice_id, payment_date, amount, method, account, reference_number, notes, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmado', ?)`, [sourceId, date, value, method, account, reference, notes, userId]);
  } else if (sourceType === 'purchase-invoice') {
    [result] = await conn.query(`INSERT INTO purchase_invoice_payments
      (invoice_id, payment_date, amount, payment_method, reference_number, notes, registered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [sourceId, date, value, method, reference, notes, userId]);
  } else {
    [result] = await conn.query(`INSERT INTO admin_expense_payments
      (expense_id, payment_date, method, account, reference_number, notes, amount, currency_code, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmado', ?)`, [sourceId, date, method, account, reference, notes, value, (await lockedDocument(conn, sourceType, sourceId)).currency, userId]);
  }
  const updated = await recalculateSupplierDocument(sourceType, sourceId, conn);
  if (sourceType === 'admin-expense') {
    await conn.query(`UPDATE admin_expenses SET status = CASE
      WHEN ? THEN 'pagado' WHEN status = 'pagado' THEN 'pendiente' ELSE status END WHERE id = ?`,
    [updated.balance <= 0.009, sourceId]);
    try {
      const [commissions] = await conn.query(`SELECT a.liquidation_id, ci.id AS commission_invoice_id, a.amount
        FROM commission_invoices ci JOIN commission_invoice_allocations a ON a.commission_invoice_id = ci.id
        WHERE ci.admin_expense_id = ?`, [sourceId]);
      for (const commission of commissions) {
        const proportional = updated.gross_amount > 0 ? value * (Number(commission.amount || 0) / updated.gross_amount) : 0;
        await conn.query(`INSERT INTO commission_audit_events
          (liquidation_id, commission_invoice_id, event_type, detail, payload_json, actor_user_id)
          VALUES (?, ?, 'payment_registered', ?, ?, ?)`,
        [commission.liquidation_id, commission.commission_invoice_id, 'Pago de comisión registrado',
          JSON.stringify({ payment_id: result.insertId, amount: proportional, currency_code: (await getCurrency(conn, sourceId)) }), userId]);
      }
    } catch (auditError) {
      if (auditError?.code !== 'ER_NO_SUCH_TABLE') throw auditError;
    }
  }
  return result.insertId;
}

async function getCurrency(conn, expenseId) {
  const [[row]] = await conn.query('SELECT currency_code FROM admin_expenses WHERE id = ?', [expenseId]);
  return row?.currency_code || 'PYG';
}
