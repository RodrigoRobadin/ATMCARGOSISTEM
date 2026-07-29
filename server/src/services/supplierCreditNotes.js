import { pool } from './db.js';

export const SUPPLIER_CREDIT_SOURCE_TYPES = new Set([
  'operation-expense',
  'purchase-invoice',
  'admin-expense',
]);

let supplierCreditNotesReady = null;

export function normalizeSupplierCreditSourceType(value) {
  const sourceType = String(value || '').trim().toLowerCase();
  return SUPPLIER_CREDIT_SOURCE_TYPES.has(sourceType) ? sourceType : null;
}

async function ensureColumns(tableName, definitions) {
  const [columns] = await pool.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  const existing = new Set((columns || []).map((row) => String(row.COLUMN_NAME)));
  const missing = Object.entries(definitions)
    .filter(([name]) => !existing.has(name))
    .map(([name, definition]) => `ADD COLUMN ${name} ${definition}`);
  if (missing.length) await pool.query(`ALTER TABLE ${tableName} ${missing.join(', ')}`);
}

export async function ensureSupplierCreditNoteTables() {
  if (supplierCreditNotesReady) return supplierCreditNotesReady;
  supplierCreditNotesReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS supplier_credit_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        supplier_id INT NULL,
        supplier_name VARCHAR(160) NULL,
        supplier_ruc VARCHAR(32) NULL,
        note_date DATE NOT NULL,
        receipt_number VARCHAR(64) NOT NULL,
        timbrado_number VARCHAR(64) NULL,
        currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
        reason VARCHAR(255) NOT NULL,
        notes TEXT NULL,
        gravado_10 DECIMAL(15,2) NOT NULL DEFAULT 0,
        gravado_5 DECIMAL(15,2) NOT NULL DEFAULT 0,
        iva_10 DECIMAL(15,2) NOT NULL DEFAULT 0,
        iva_5 DECIMAL(15,2) NOT NULL DEFAULT 0,
        iva_exempt DECIMAL(15,2) NOT NULL DEFAULT 0,
        iva_no_taxed DECIMAL(15,2) NOT NULL DEFAULT 0,
        amount_total DECIMAL(15,2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'registrada',
        created_by INT NULL,
        canceled_by INT NULL,
        canceled_at DATETIME NULL,
        cancel_reason VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_supplier_credit_supplier (supplier_id),
        INDEX idx_supplier_credit_date (note_date),
        INDEX idx_supplier_credit_status (status),
        INDEX idx_supplier_credit_document (receipt_number, timbrado_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS supplier_credit_note_applications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        credit_note_id INT NOT NULL,
        source_type VARCHAR(32) NOT NULL,
        source_id INT NOT NULL,
        applied_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_supplier_credit_application (credit_note_id, source_type, source_id),
        INDEX idx_supplier_credit_source (source_type, source_id),
        CONSTRAINT fk_supplier_credit_application_note
          FOREIGN KEY (credit_note_id) REFERENCES supplier_credit_notes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS supplier_credit_note_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        credit_note_id INT NOT NULL,
        description VARCHAR(255) NOT NULL,
        quantity DECIMAL(15,3) NOT NULL DEFAULT 1,
        unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
        tax_rate INT NOT NULL DEFAULT 10,
        expense_rubro VARCHAR(32) NULL,
        source_item_id INT NULL,
        item_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_supplier_credit_item_note (credit_note_id),
        CONSTRAINT fk_supplier_credit_item_note
          FOREIGN KEY (credit_note_id) REFERENCES supplier_credit_notes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS supplier_credit_note_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        credit_note_id INT NOT NULL,
        file_url VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_supplier_credit_attachment_note (credit_note_id),
        CONSTRAINT fk_supplier_credit_attachment_note
          FOREIGN KEY (credit_note_id) REFERENCES supplier_credit_notes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS supplier_credit_note_audit (
        id INT AUTO_INCREMENT PRIMARY KEY,
        credit_note_id INT NOT NULL,
        action VARCHAR(32) NOT NULL,
        previous_json LONGTEXT NULL,
        current_json LONGTEXT NULL,
        reason VARCHAR(255) NULL,
        user_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_supplier_credit_audit_note (credit_note_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await ensureColumns('operation_expense_invoices', {
      credited_amount: 'DECIMAL(15,2) NOT NULL DEFAULT 0',
      net_amount: 'DECIMAL(15,2) NULL',
      supplier_credit_balance: 'DECIMAL(15,2) NOT NULL DEFAULT 0',
    });
    await ensureColumns('purchase_invoices', {
      credited_amount: 'DECIMAL(15,2) NOT NULL DEFAULT 0',
      net_amount: 'DECIMAL(15,2) NULL',
      supplier_credit_balance: 'DECIMAL(15,2) NOT NULL DEFAULT 0',
    });
    await ensureColumns('admin_expenses', {
      credited_amount: 'DECIMAL(15,2) NOT NULL DEFAULT 0',
      net_amount: 'DECIMAL(15,2) NULL',
      balance: 'DECIMAL(15,2) NULL',
      supplier_credit_balance: 'DECIMAL(15,2) NOT NULL DEFAULT 0',
    });
  })().catch((error) => {
    supplierCreditNotesReady = null;
    throw error;
  });
  return supplierCreditNotesReady;
}

export async function getSupplierSourceDocument(sourceTypeValue, sourceId, conn = pool) {
  const sourceType = normalizeSupplierCreditSourceType(sourceTypeValue);
  const id = Number(sourceId || 0);
  if (!sourceType || !id) return null;

  if (sourceType === 'operation-expense') {
    const [[row]] = await conn.query(
      `SELECT e.id, e.supplier_id,
              COALESCE(o.razon_social, o.name, e.supplier_name) AS supplier_name,
              COALESCE(o.ruc, e.supplier_ruc) AS supplier_ruc,
              UPPER(COALESCE(e.currency_code, 'PYG')) AS currency_code,
              COALESCE(e.amount_total, 0) AS gross_amount,
              COALESCE(e.receipt_number, CONCAT('GASTO-', e.id)) AS document_number,
              e.status, e.condition_type, e.expense_rubro, e.operation_id, e.operation_type
         FROM operation_expense_invoices e
         LEFT JOIN organizations o ON o.id = e.supplier_id
        WHERE e.id = ? LIMIT 1`,
      [id]
    );
    return row ? { ...row, source_type: sourceType } : null;
  }
  if (sourceType === 'purchase-invoice') {
    const [[row]] = await conn.query(
      `SELECT pi.id, pi.supplier_id,
              COALESCE(o.razon_social, o.name) AS supplier_name,
              o.ruc AS supplier_ruc,
              'PYG' AS currency_code,
              COALESCE(pi.total_amount, 0) AS gross_amount,
              COALESCE(pi.supplier_invoice_number, pi.invoice_number, CONCAT('COMPRA-', pi.id)) AS document_number,
              pi.status, NULL AS expense_rubro, NULL AS operation_id, NULL AS operation_type
         FROM purchase_invoices pi
         LEFT JOIN organizations o ON o.id = pi.supplier_id
        WHERE pi.id = ? LIMIT 1`,
      [id]
    );
    return row ? { ...row, source_type: sourceType } : null;
  }
  const [[row]] = await conn.query(
    `SELECT e.id, e.provider_id AS supplier_id,
            COALESCE(o.razon_social, o.name, e.supplier_name) AS supplier_name,
            COALESCE(o.ruc, e.supplier_ruc) AS supplier_ruc,
            UPPER(COALESCE(e.currency_code, 'PYG')) AS currency_code,
            COALESCE(e.amount, 0) AS gross_amount,
            COALESCE(e.receipt_number, CONCAT('GASTO-ADM-', e.id)) AS document_number,
            e.status, NULL AS expense_rubro, NULL AS operation_id, NULL AS operation_type
       FROM admin_expenses e
       LEFT JOIN organizations o ON o.id = e.provider_id
      WHERE e.id = ? LIMIT 1`,
    [id]
  );
  return row ? { ...row, source_type: sourceType } : null;
}

export async function getSupplierCreditSummary(sourceTypeValue, sourceId, conn = pool) {
  await ensureSupplierCreditNoteTables();
  const sourceType = normalizeSupplierCreditSourceType(sourceTypeValue);
  if (!sourceType) return { credited_amount: 0, count: 0 };
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(a.applied_amount), 0) AS credited_amount,
            COUNT(DISTINCT n.id) AS count
       FROM supplier_credit_note_applications a
       INNER JOIN supplier_credit_notes n ON n.id = a.credit_note_id
      WHERE a.source_type = ? AND a.source_id = ? AND n.status = 'registrada'`,
    [sourceType, Number(sourceId)]
  );
  return {
    credited_amount: Number(row?.credited_amount || 0),
    count: Number(row?.count || 0),
  };
}

export async function recalculateSupplierDocument(sourceTypeValue, sourceId, conn = pool) {
  await ensureSupplierCreditNoteTables();
  const sourceType = normalizeSupplierCreditSourceType(sourceTypeValue);
  const document = await getSupplierSourceDocument(sourceType, sourceId, conn);
  if (!document) return null;
  const { credited_amount: creditedAmount } = await getSupplierCreditSummary(sourceType, sourceId, conn);
  const grossAmount = Number(document.gross_amount || 0);
  const netAmount = Math.max(0, Number((grossAmount - creditedAmount).toFixed(2)));
  let paidAmount = 0;

  if (sourceType === 'operation-expense') {
    const [[paidRow]] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid
         FROM operation_expense_payments
        WHERE invoice_id = ? AND COALESCE(status, '') <> 'anulado'`,
      [sourceId]
    );
    paidAmount = Number(paidRow?.paid || 0);
  } else if (sourceType === 'purchase-invoice') {
    const [[paidRow]] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM purchase_invoice_payments WHERE invoice_id = ?`,
      [sourceId]
    );
    paidAmount = Number(paidRow?.paid || 0);
  } else {
    const [[paidRow]] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid
         FROM admin_expense_payments
        WHERE expense_id = ? AND COALESCE(status, '') <> 'anulado'`,
      [sourceId]
    );
    paidAmount = Number(paidRow?.paid || 0);
  }

  const balance = Math.max(0, Number((netAmount - paidAmount).toFixed(2)));
  const supplierCreditBalance = Math.max(0, Number((paidAmount - netAmount).toFixed(2)));

  if (sourceType === 'operation-expense') {
    const conditionType = String(document.condition_type || '').toUpperCase();
    const paymentStatus = conditionType && conditionType !== 'CREDITO'
      ? 'n/a'
      : balance <= 0
        ? 'pagado'
        : paidAmount > 0
          ? 'parcial'
          : 'pendiente';
    await conn.query(
      `UPDATE operation_expense_invoices
          SET credited_amount = ?, net_amount = ?, paid_amount = ?, balance = ?,
              supplier_credit_balance = ?, payment_status = ?
        WHERE id = ?`,
      [creditedAmount, netAmount, paidAmount, balance, supplierCreditBalance, paymentStatus, sourceId]
    );
  } else if (sourceType === 'purchase-invoice') {
    let status = String(document.status || 'registrada');
    if (['registrada', 'pago_parcial', 'pagada'].includes(status)) {
      status = balance <= 0 ? 'pagada' : paidAmount > 0 ? 'pago_parcial' : 'registrada';
    }
    await conn.query(
      `UPDATE purchase_invoices
          SET credited_amount = ?, net_amount = ?, paid_amount = ?, balance = ?,
              supplier_credit_balance = ?, status = ?
        WHERE id = ?`,
      [creditedAmount, netAmount, paidAmount, balance, supplierCreditBalance, status, sourceId]
    );
  } else {
    await conn.query(
      `UPDATE admin_expenses
          SET credited_amount = ?, net_amount = ?, balance = ?, supplier_credit_balance = ?
        WHERE id = ?`,
      [creditedAmount, netAmount, balance, supplierCreditBalance, sourceId]
    );
  }

  return {
    gross_amount: grossAmount,
    credited_amount: creditedAmount,
    net_amount: netAmount,
    paid_amount: paidAmount,
    balance,
    supplier_credit_balance: supplierCreditBalance,
  };
}

