// server/src/routes/adminOpsPurchases.js
import { Router } from 'express';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';
import generatePaymentOrderPDF from '../services/paymentOrderTemplatePdfkit.js';

const router = Router();

function renderPaymentOrderPdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    generatePaymentOrderPDF(data, stream).catch(reject);
  });
}

function normalizePayableStatus(row) {
  const balance = Number(row?.balance || 0);
  const paid = Math.max(0, Number(row?.amount_total || 0) - balance);
  const condition = String(row?.condition_type || '').toUpperCase();
  const poStatus = String(row?.payment_order_status || '').toLowerCase();
  const isCredit = condition === 'CREDITO' || condition === 'CREDIT';
  const due = row?.due_date ? new Date(row.due_date) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (balance <= 0.009 || String(row?.payment_status || '').toLowerCase() === 'pagado') return 'pagado';
  if (paid > 0 || String(row?.payment_status || '').toLowerCase() === 'parcial') return 'pago_parcial';
  if (isCredit && !row?.due_date) return 'bloqueado';
  if (isCredit && !row?.payment_order_id) return 'sin_op';
  if (isCredit && poStatus === 'pendiente') return 'op_pendiente';
  if (isCredit && (poStatus === 'aprobada' || poStatus === 'pago_parcial')) return 'listo_pago';
  if (due && !Number.isNaN(due.getTime())) {
    due.setHours(0, 0, 0, 0);
    if (due < today) return 'vencido';
  }
  return 'listo_pago';
}

function hasSupplierBankData(row) {
  return Boolean(
    row?.supplier_bank_name ||
      row?.supplier_bank_account ||
      row?.supplier_bank_holder ||
      row?.supplier_bank_cci_iban
  );
}

function documentAlerts(row) {
  const alerts = [];
  const condition = String(row?.condition_type || '').toUpperCase();
  if (!hasSupplierBankData(row) && Number(row?.balance || 0) > 0.009) alerts.push('Proveedor sin cuenta bancaria');
  if ((condition === 'CREDITO' || condition === 'CREDIT') && !row?.due_date) alerts.push('Credito sin vencimiento');
  if (!row?.receipt_number) alerts.push('Sin numero de comprobante');
  if (!row?.expense_rubros || String(row.expense_rubros).toUpperCase().includes('SIN CLASIFICAR')) alerts.push('Sin clasificar');
  return alerts;
}

async function ensurePaymentOrderAdminTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_expense_payment_order_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      event_type VARCHAR(32) NOT NULL,
      event_note TEXT NULL,
      event_payload JSON NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order (order_id),
      INDEX idx_event_type (event_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  const [cols] = await pool.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operation_expense_payment_orders'
  `);
  const have = new Set(cols.map((c) => c.COLUMN_NAME));
  const add = [];
  if (!have.has('cancelled_by')) add.push('ADD COLUMN cancelled_by INT NULL AFTER approved_at');
  if (!have.has('cancelled_at')) add.push('ADD COLUMN cancelled_at TIMESTAMP NULL AFTER cancelled_by');
  if (!have.has('cancel_reason')) add.push('ADD COLUMN cancel_reason TEXT NULL AFTER cancelled_at');
  if (!have.has('scheduled_payment_date')) add.push('ADD COLUMN scheduled_payment_date DATE NULL AFTER payment_date');
  if (!have.has('planned_company_account')) add.push('ADD COLUMN planned_company_account VARCHAR(160) NULL AFTER scheduled_payment_date');
  if (!have.has('priority')) add.push("ADD COLUMN priority VARCHAR(20) NULL DEFAULT 'normal' AFTER planned_company_account");
  if (add.length) {
    await pool.query(`ALTER TABLE operation_expense_payment_orders ${add.join(', ')}`);
  }
}

async function addPaymentOrderEvent(orderId, eventType, note, payload, userId, conn = pool) {
  await conn.query(
    `INSERT INTO operation_expense_payment_order_events
     (order_id, event_type, event_note, event_payload, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [orderId, eventType, note || null, payload ? JSON.stringify(payload) : null, userId || null]
  );
}

async function recomputeAdminPaymentOrder(orderId, conn = pool) {
  const [[order]] = await conn.query(
    `SELECT id, status, approved_at FROM operation_expense_payment_orders WHERE id = ? LIMIT 1`,
    [orderId]
  );
  if (!order) return;
  if (String(order.status || '').toLowerCase() === 'anulada') return;
  const [[sumItems]] = await conn.query(
    `SELECT COALESCE(SUM(amount),0) AS total
       FROM operation_expense_payment_order_items
      WHERE order_id = ?`,
    [orderId]
  );
  const [[sumPaid]] = await conn.query(
    `SELECT COALESCE(SUM(p.amount),0) AS paid
       FROM operation_expense_payments p
       JOIN operation_expense_payment_order_items i ON i.invoice_id = p.invoice_id
      WHERE i.order_id = ? AND p.status <> 'anulado'`,
    [orderId]
  );
  const total = Number(sumItems?.total || 0);
  const paid = Number(sumPaid?.paid || 0);
  const balance = Math.max(0, total - paid);
  let status = order.status || 'pendiente';
  if (total > 0 && paid >= total - 0.01) status = 'pagada';
  else if (paid > 0) status = 'pago_parcial';
  else if (status === 'pago_parcial' || status === 'pagada') status = order.approved_at ? 'aprobada' : 'pendiente';
  await conn.query(
    `UPDATE operation_expense_payment_orders
        SET amount = ?, paid_amount = ?, balance = ?, status = ?
      WHERE id = ?`,
    [total, paid, balance, status, orderId]
  );
}

async function updateAdminInvoicePaymentStatus(invoiceId, conn = pool) {
  const [[inv]] = await conn.query(`SELECT amount_total FROM operation_expense_invoices WHERE id = ?`, [invoiceId]);
  if (!inv) return;
  const [[sumRow]] = await conn.query(
    `SELECT COALESCE(SUM(amount),0) AS paid
       FROM operation_expense_payments
      WHERE invoice_id = ? AND status <> 'anulado'`,
    [invoiceId]
  );
  const paid = Number(sumRow?.paid || 0);
  const total = Number(inv.amount_total || 0);
  const balance = Math.max(0, total - paid);
  const paymentStatus = balance <= 0.01 ? 'pagado' : paid > 0 ? 'parcial' : 'pendiente';
  await conn.query(
    `UPDATE operation_expense_invoices
        SET paid_amount = ?, balance = ?, payment_status = ?
      WHERE id = ?`,
    [paid, balance, paymentStatus, invoiceId]
  );
}

router.get('/operation-expenses', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    const {
      from_date,
      to_date,
      due_from,
      due_to,
      status,
      search_q,
      client_q,
      operation_q,
      supplier_q,
      currency_code,
      payment_status,
      overdue,
    } = req.query || {};

    const where = [];
    const params = [];

    if (from_date) {
      where.push('e.invoice_date >= ?');
      params.push(from_date);
    }
    if (to_date) {
      where.push('e.invoice_date <= ?');
      params.push(to_date);
    }
    if (due_from) {
      where.push('e.due_date >= ?');
      params.push(due_from);
    }
    if (due_to) {
      where.push('e.due_date <= ?');
      params.push(due_to);
    }
    if (status) {
      where.push('e.status = ?');
      params.push(status);
    }
    if (currency_code) {
      where.push('e.currency_code = ?');
      params.push(currency_code);
    }
    if (payment_status) {
      where.push('e.payment_status = ?');
      params.push(payment_status);
    }
    if (String(overdue || '') === '1') {
      where.push(`UPPER(e.condition_type) = 'CREDITO' AND e.balance > 0 AND e.due_date IS NOT NULL AND e.due_date < CURDATE()`);
    }
    if (client_q) {
      where.push('(org.name LIKE ? OR org.razon_social LIKE ? OR org.ruc LIKE ?)');
      const like = `%${client_q}%`;
      params.push(like, like, like);
    }
    if (operation_q) {
      where.push('(d.reference LIKE ? OR d.title LIKE ?)');
      const like = `%${operation_q}%`;
      params.push(like, like);
    }
    if (supplier_q) {
      where.push('(sup.name LIKE ? OR sup.razon_social LIKE ? OR sup.ruc LIKE ? OR e.supplier_name LIKE ? OR e.supplier_ruc LIKE ?)');
      const like = `%${supplier_q}%`;
      params.push(like, like, like, like, like);
    }
    if (search_q) {
      where.push(`(
        org.name LIKE ? OR org.razon_social LIKE ? OR org.ruc LIKE ?
        OR sup.name LIKE ? OR sup.razon_social LIKE ? OR sup.ruc LIKE ? OR e.supplier_name LIKE ? OR e.supplier_ruc LIKE ?
        OR e.receipt_number LIKE ? OR e.receipt_type LIKE ?
        OR d.reference LIKE ? OR d.title LIKE ? OR sc.reference LIKE ?
        OR po2.order_number LIKE ? OR po3.order_number LIKE ?
      )`);
      const like = `%${search_q}%`;
      params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `
      SELECT e.*,
             CASE WHEN e.operation_type = 'service' THEN sc.reference ELSE d.reference END AS operation_reference,
             CASE WHEN e.operation_type = 'service' THEN sc.work_type ELSE d.title END AS operation_title,
             CASE WHEN e.operation_type = 'service' THEN sc.org_id ELSE d.org_id END AS client_id,
             COALESCE(org.razon_social, org.name) AS client_name,
             org.ruc AS client_ruc,
             COALESCE(sup.razon_social, sup.name, e.supplier_name) AS supplier_display,
             COALESCE(sup.ruc, e.supplier_ruc) AS supplier_ruc_display,
             sup.supplier_bank_name,
             sup.supplier_bank_account,
             sup.supplier_bank_currency,
             sup.supplier_bank_account_type,
             sup.supplier_bank_holder,
             sup.supplier_bank_holder_ruc,
             sup.supplier_bank_cci_iban,
             sup.supplier_bank_swift,
             COALESCE(po2.id, po3.id) AS payment_order_id,
             COALESCE(po2.order_number, po3.order_number) AS payment_order_number,
             COALESCE(po2.status, po3.status) AS payment_order_status,
             COALESCE(po2.payment_date, po3.payment_date) AS payment_order_date,
             (
               SELECT a.file_url
               FROM operation_expense_attachments a
               WHERE a.invoice_id = e.id
               ORDER BY a.id DESC
               LIMIT 1
             ) AS attachment_url,
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
             (
               SELECT GROUP_CONCAT(DISTINCT COALESCE(NULLIF(it.expense_rubro, ''), 'SIN CLASIFICAR') ORDER BY it.expense_rubro SEPARATOR ', ')
               FROM operation_expense_invoice_items it
               WHERE it.invoice_id = e.id
             ) AS expense_rubros
        FROM operation_expense_invoices e
        LEFT JOIN deals d ON d.id = e.operation_id AND e.operation_type = 'deal'
        LEFT JOIN service_cases sc ON sc.id = e.operation_id AND e.operation_type = 'service'
        LEFT JOIN organizations org ON org.id = CASE WHEN e.operation_type = 'service' THEN sc.org_id ELSE d.org_id END
        LEFT JOIN organizations sup ON sup.id = e.supplier_id
        LEFT JOIN (
          SELECT invoice_id, MAX(order_id) AS order_id
          FROM operation_expense_payment_order_items
          GROUP BY invoice_id
        ) poi ON poi.invoice_id = e.id
        LEFT JOIN operation_expense_payment_orders po2 ON po2.id = poi.order_id
        LEFT JOIN (
          SELECT invoice_id, MAX(id) AS last_id
          FROM operation_expense_payment_orders
          GROUP BY invoice_id
        ) pol ON pol.invoice_id = e.id
        LEFT JOIN operation_expense_payment_orders po3 ON po3.id = pol.last_id
       ${whereSql}
       ORDER BY e.invoice_date DESC, e.id DESC
      `,
      params
    );

    res.json(
      rows.map((row) => ({
        ...row,
        payable_status: normalizePayableStatus(row),
        supplier_has_bank_account: hasSupplierBankData(row),
        document_alerts: documentAlerts(row),
      }))
    );
  } catch (e) {
    console.error('[admin-ops] operation-expenses error', e);
    res.status(500).json({ error: 'Error listing operation expenses' });
  }
});

router.get('/operation-expenses/export', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    const {
      from_date,
      to_date,
      due_from,
      due_to,
      status,
      search_q,
      client_q,
      operation_q,
      supplier_q,
      currency_code,
      payment_status,
      overdue,
    } = req.query || {};

    const where = [];
    const params = [];

    if (from_date) {
      where.push('e.invoice_date >= ?');
      params.push(from_date);
    }
    if (to_date) {
      where.push('e.invoice_date <= ?');
      params.push(to_date);
    }
    if (due_from) {
      where.push('e.due_date >= ?');
      params.push(due_from);
    }
    if (due_to) {
      where.push('e.due_date <= ?');
      params.push(due_to);
    }
    if (status) {
      where.push('e.status = ?');
      params.push(status);
    }
    if (currency_code) {
      where.push('e.currency_code = ?');
      params.push(currency_code);
    }
    if (payment_status) {
      where.push('e.payment_status = ?');
      params.push(payment_status);
    }
    if (client_q) {
      where.push('(org.name LIKE ? OR org.razon_social LIKE ? OR org.ruc LIKE ?)');
      const like = `%${client_q}%`;
      params.push(like, like, like);
    }
    if (operation_q) {
      where.push('(d.reference LIKE ? OR d.title LIKE ?)');
      const like = `%${operation_q}%`;
      params.push(like, like);
    }
    if (supplier_q) {
      where.push('(sup.name LIKE ? OR sup.razon_social LIKE ? OR sup.ruc LIKE ? OR e.supplier_name LIKE ? OR e.supplier_ruc LIKE ?)');
      const like = `%${supplier_q}%`;
      params.push(like, like, like, like, like);
    }
    if (search_q) {
      where.push(`(
        org.name LIKE ? OR org.razon_social LIKE ? OR org.ruc LIKE ?
        OR sup.name LIKE ? OR sup.razon_social LIKE ? OR sup.ruc LIKE ? OR e.supplier_name LIKE ? OR e.supplier_ruc LIKE ?
        OR e.receipt_number LIKE ? OR e.receipt_type LIKE ?
        OR d.reference LIKE ? OR d.title LIKE ? OR sc.reference LIKE ?
        OR po2.order_number LIKE ? OR po3.order_number LIKE ?
      )`);
      const like = `%${search_q}%`;
      params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
    }
    if (String(overdue || '') === '1') {
      where.push(`UPPER(e.condition_type) = 'CREDITO' AND e.balance > 0 AND e.due_date IS NOT NULL AND e.due_date < CURDATE()`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `
      SELECT e.*,
             CASE WHEN e.operation_type = 'service' THEN sc.reference ELSE d.reference END AS operation_reference,
             CASE WHEN e.operation_type = 'service' THEN sc.work_type ELSE d.title END AS operation_title,
             CASE WHEN e.operation_type = 'service' THEN sc.org_id ELSE d.org_id END AS client_id,
             COALESCE(org.razon_social, org.name) AS client_name,
             org.ruc AS client_ruc,
             COALESCE(sup.razon_social, sup.name, e.supplier_name) AS supplier_display,
             COALESCE(sup.ruc, e.supplier_ruc) AS supplier_ruc_display,
             sup.supplier_bank_name,
             sup.supplier_bank_account,
             sup.supplier_bank_currency,
             sup.supplier_bank_account_type,
             sup.supplier_bank_holder,
             sup.supplier_bank_holder_ruc,
             sup.supplier_bank_cci_iban,
             sup.supplier_bank_swift,
             COALESCE(po2.id, po3.id) AS payment_order_id,
             COALESCE(po2.order_number, po3.order_number) AS payment_order_number,
             COALESCE(po2.status, po3.status) AS payment_order_status,
             (
               SELECT GROUP_CONCAT(DISTINCT COALESCE(NULLIF(it.expense_rubro, ''), 'SIN CLASIFICAR') ORDER BY it.expense_rubro SEPARATOR ', ')
               FROM operation_expense_invoice_items it
               WHERE it.invoice_id = e.id
             ) AS expense_rubros
        FROM operation_expense_invoices e
        LEFT JOIN deals d ON d.id = e.operation_id AND e.operation_type = 'deal'
        LEFT JOIN service_cases sc ON sc.id = e.operation_id AND e.operation_type = 'service'
        LEFT JOIN organizations org ON org.id = CASE WHEN e.operation_type = 'service' THEN sc.org_id ELSE d.org_id END
        LEFT JOIN organizations sup ON sup.id = e.supplier_id
        LEFT JOIN (
          SELECT invoice_id, MAX(order_id) AS order_id
          FROM operation_expense_payment_order_items
          GROUP BY invoice_id
        ) poi ON poi.invoice_id = e.id
        LEFT JOIN operation_expense_payment_orders po2 ON po2.id = poi.order_id
        LEFT JOIN (
          SELECT invoice_id, MAX(id) AS last_id
          FROM operation_expense_payment_orders
          GROUP BY invoice_id
        ) pol ON pol.invoice_id = e.id
        LEFT JOIN operation_expense_payment_orders po3 ON po3.id = pol.last_id
       ${whereSql}
       ORDER BY e.invoice_date DESC, e.id DESC
      `,
      params
    );

    const ids = rows.map((r) => r.id);
    let payments = [];
    if (ids.length) {
      const [payRows] = await pool.query(
        `SELECT p.*, e.operation_id
           FROM operation_expense_payments p
           JOIN operation_expense_invoices e ON e.id = p.invoice_id
          WHERE p.invoice_id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      payments = payRows;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CRM';
    wb.created = new Date();

    const sheet = wb.addWorksheet('Compras operativas');
    sheet.addRow([
      'Fecha',
      'Operación',
      'Cliente',
      'Proveedor',
      'Comprobante',
      'Moneda',
      'Total',
      'IVA 10',
      'IVA 5',
      'Exento',
      'Condición',
      'Vencimiento',
      'Estado',
      'Pago',
      'Saldo',
      'Tipo operación',
    ]);
    rows.forEach((r) => {
      sheet.addRow([
        r.invoice_date,
        r.operation_reference || r.operation_id,
        r.client_name || '',
        r.supplier_display || '',
        `${r.receipt_type || ''} ${r.receipt_number || ''}`.trim(),
        r.currency_code,
        r.amount_total,
        r.iva_10,
        r.iva_5,
        r.iva_exempt,
        r.condition_type,
        r.due_date,
        r.status,
        r.payment_status,
        r.balance,
        r.operation_type || 'deal',
      ]);
    });

    const paySheet = wb.addWorksheet('Pagos');
    paySheet.addRow([
      'Factura ID',
      'Operación',
      'Fecha',
      'Monto',
      'Método',
      'Cuenta',
      'Referencia',
      'Estado',
    ]);
    payments.forEach((p) => {
      paySheet.addRow([
        p.invoice_id,
        p.operation_id,
        p.payment_date,
        p.amount,
        p.method,
        p.account,
        p.reference_number,
        p.status,
      ]);
    });

    const paymentPlan = wb.addWorksheet('Planilla de pagos');
    paymentPlan.columns = [
      { header: 'Proveedor', key: 'supplier', width: 30 },
      { header: 'RUC', key: 'supplier_ruc', width: 18 },
      { header: 'Banco proveedor', key: 'supplier_bank_name', width: 22 },
      { header: 'Cuenta proveedor', key: 'supplier_bank_account', width: 24 },
      { header: 'Titular cuenta', key: 'supplier_bank_holder', width: 24 },
      { header: 'Operacion', key: 'operation', width: 18 },
      { header: 'Cliente', key: 'client', width: 28 },
      { header: 'Comprobante', key: 'document', width: 24 },
      { header: 'Rubro', key: 'rubro', width: 22 },
      { header: 'Vencimiento', key: 'due_date', width: 16 },
      { header: 'Moneda', key: 'currency', width: 10 },
      { header: 'Saldo', key: 'balance', width: 16 },
      { header: 'OP', key: 'payment_order', width: 18 },
      { header: 'Estado', key: 'status', width: 18 },
      { header: 'Alertas', key: 'alerts', width: 34 },
      { header: 'Cuenta origen', key: 'company_account', width: 24 },
      { header: 'Referencia pago', key: 'payment_reference', width: 22 },
    ];
    rows.forEach((r) => {
      const latestPayment = payments
        .filter((p) => Number(p.invoice_id) === Number(r.id))
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
      paymentPlan.addRow({
        supplier: r.supplier_display || '',
        supplier_ruc: r.supplier_ruc_display || '',
        supplier_bank_name: r.supplier_bank_name || '',
        supplier_bank_account: r.supplier_bank_account || '',
        supplier_bank_holder: r.supplier_bank_holder || '',
        operation: r.operation_reference || r.operation_id || '',
        client: r.client_name || '',
        document: `${r.receipt_type || ''} ${r.receipt_number || ''}`.trim(),
        rubro: r.expense_rubros || r.expense_rubro || 'SIN CLASIFICAR',
        due_date: r.due_date || '',
        currency: r.currency_code || '',
        balance: Number(r.balance || 0),
        payment_order: r.payment_order_number || '',
        status: normalizePayableStatus(r),
        alerts: documentAlerts(r).join(' | '),
        company_account: latestPayment?.account || '',
        payment_reference: latestPayment?.reference_number || '',
      });
    });
    paymentPlan.getRow(1).font = { bold: true };
    paymentPlan.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const status = row.getCell('status').value;
      if (status === 'vencido' || status === 'bloqueado') {
        row.getCell('status').font = { bold: true, color: { argb: 'B91C1C' } };
      }
      if (row.getCell('alerts').value) {
        row.getCell('alerts').font = { color: { argb: 'B45309' } };
      }
    });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="compras-operativas.xlsx"`
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[admin-ops] export error', e);
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

router.get('/payment-orders', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensurePaymentOrderAdminTables();
    const {
      from_date,
      to_date,
      payment_from,
      payment_to,
      due_from,
      due_to,
      status,
      search_q,
      supplier_q,
      operation_q,
      currency_code,
    } = req.query || {};

    const where = [];
    const params = [];

    if (from_date) { where.push('po.created_at >= ?'); params.push(from_date); }
    if (to_date) { where.push('po.created_at <= ?'); params.push(to_date); }
    if (payment_from) { where.push('po.payment_date >= ?'); params.push(payment_from); }
    if (payment_to) { where.push('po.payment_date <= ?'); params.push(payment_to); }
    if (due_from) { where.push('e.due_date >= ?'); params.push(due_from); }
    if (due_to) { where.push('e.due_date <= ?'); params.push(due_to); }
    if (status) { where.push('po.status = ?'); params.push(status); }
    if (currency_code) { where.push('po.currency_code = ?'); params.push(currency_code); }
    if (supplier_q) {
      where.push('(sup.name LIKE ? OR sup.razon_social LIKE ? OR sup.ruc LIKE ? OR po.supplier_name LIKE ? OR po.supplier_ruc LIKE ?)');
      const like = `%${supplier_q}%`;
      params.push(like, like, like, like, like);
    }
    if (operation_q) {
      where.push('(d.reference LIKE ? OR d.title LIKE ? OR sc.reference LIKE ?)');
      const like = `%${operation_q}%`;
      params.push(like, like, like);
    }
    if (search_q) {
      where.push(`(
        org.name LIKE ? OR org.razon_social LIKE ? OR org.ruc LIKE ?
        OR sup.name LIKE ? OR sup.razon_social LIKE ? OR sup.ruc LIKE ? OR po.supplier_name LIKE ? OR po.supplier_ruc LIKE ?
        OR po.order_number LIKE ?
        OR e.receipt_number LIKE ? OR e_legacy.receipt_number LIKE ?
        OR d.reference LIKE ? OR d.title LIKE ? OR sc.reference LIKE ?
      )`);
      const like = `%${search_q}%`;
      params.push(like, like, like, like, like, like, like, like, like, like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `
      SELECT po.*,
             COALESCE(SUM(i.amount), po.amount, 0) AS amount,
             COALESCE(
               (
                 SELECT COALESCE(SUM(p.amount),0)
                   FROM operation_expense_payments p
                   JOIN operation_expense_payment_order_items i2 ON i2.invoice_id = p.invoice_id
                  WHERE i2.order_id = po.id AND p.status <> 'anulado'
               ),
               (
                 SELECT COALESCE(SUM(p.amount),0)
                   FROM operation_expense_payments p
                  WHERE p.invoice_id = po.invoice_id AND p.status <> 'anulado'
               ),
               po.paid_amount,
               0
             ) AS paid_amount,
             (
               COALESCE(SUM(i.amount), po.amount, 0) -
               COALESCE(
                 (
                   SELECT COALESCE(SUM(p.amount),0)
                     FROM operation_expense_payments p
                     JOIN operation_expense_payment_order_items i2 ON i2.invoice_id = p.invoice_id
                    WHERE i2.order_id = po.id AND p.status <> 'anulado'
                 ),
                 (
                   SELECT COALESCE(SUM(p.amount),0)
                     FROM operation_expense_payments p
                    WHERE p.invoice_id = po.invoice_id AND p.status <> 'anulado'
                 ),
                 po.paid_amount,
                 0
               )
             ) AS balance,
             COALESCE(MIN(CONVERT(e.receipt_number USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(e_legacy.receipt_number USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS receipt_number,
             COALESCE(MIN(e.invoice_date), MAX(e_legacy.invoice_date)) AS invoice_date,
             COALESCE(MIN(e.due_date), MAX(e_legacy.due_date)) AS due_date,
             COALESCE(MIN(CONVERT(e.condition_type USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(e_legacy.condition_type USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS condition_type,
             MAX(CASE WHEN po.operation_type = 'service' THEN CONVERT(sc.reference USING utf8mb4) COLLATE utf8mb4_unicode_ci ELSE CONVERT(d.reference USING utf8mb4) COLLATE utf8mb4_unicode_ci END) AS operation_reference,
             COALESCE(MAX(CONVERT(org.razon_social USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(org.name USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS client_name,
             MAX(CONVERT(org.ruc USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS client_ruc,
             COALESCE(MAX(CONVERT(sup.razon_social USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(sup.name USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(po.supplier_name USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS supplier_display,
             COALESCE(MAX(CONVERT(sup.ruc USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(po.supplier_ruc USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS supplier_ruc_display,
             MAX(CONVERT(sup.supplier_bank_name USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_name,
             MAX(CONVERT(sup.supplier_bank_account USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_account,
             MAX(CONVERT(sup.supplier_bank_currency USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_currency,
             MAX(CONVERT(sup.supplier_bank_account_type USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_account_type,
             MAX(CONVERT(sup.supplier_bank_holder USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_holder,
             MAX(CONVERT(sup.supplier_bank_holder_ruc USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_holder_ruc,
             MAX(CONVERT(sup.supplier_bank_cci_iban USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_cci_iban,
             MAX(CONVERT(sup.supplier_bank_swift USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_swift,
             COALESCE(MIN(e.id), MAX(e_legacy.id), MAX(po.invoice_id)) AS primary_invoice_id,
             CASE WHEN COUNT(i.id) > 0 THEN COUNT(i.id) ELSE IF(po.invoice_id IS NULL, 0, 1) END AS invoice_count,
             GROUP_CONCAT(CONCAT(e.id, '::', COALESCE(CONVERT(e.receipt_number USING utf8mb4) COLLATE utf8mb4_unicode_ci, ''), '::', i.amount, '::', CONVERT(po.currency_code USING utf8mb4) COLLATE utf8mb4_unicode_ci, '::', COALESCE(e.due_date, '')) ORDER BY e.invoice_date SEPARATOR '||') AS invoices_list
        FROM operation_expense_payment_orders po
        LEFT JOIN operation_expense_payment_order_items i ON i.order_id = po.id
        LEFT JOIN operation_expense_invoices e ON e.id = i.invoice_id
        LEFT JOIN operation_expense_invoices e_legacy ON e_legacy.id = po.invoice_id
        LEFT JOIN deals d ON d.id = po.operation_id AND po.operation_type = 'deal'
        LEFT JOIN service_cases sc ON sc.id = po.operation_id AND po.operation_type = 'service'
        LEFT JOIN organizations sup ON sup.id = po.supplier_id
        LEFT JOIN organizations org ON org.id = CASE WHEN po.operation_type = 'service' THEN sc.org_id ELSE d.org_id END
       ${whereSql}
       GROUP BY po.id
       ORDER BY po.created_at DESC, po.id DESC
      `,
      params
    );

    res.json(rows);
  } catch (e) {
    console.error('[admin-ops] payment-orders error', e);
    res.status(500).json({ error: 'Error listing payment orders' });
  }
});

router.get('/payment-orders/export', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensurePaymentOrderAdminTables();
    const {
      from_date,
      to_date,
      payment_from,
      payment_to,
      due_from,
      due_to,
      status,
      search_q,
      supplier_q,
      operation_q,
      currency_code,
    } = req.query || {};

    const where = [];
    const params = [];

    if (from_date) { where.push('po.created_at >= ?'); params.push(from_date); }
    if (to_date) { where.push('po.created_at <= ?'); params.push(to_date); }
    if (payment_from) { where.push('po.payment_date >= ?'); params.push(payment_from); }
    if (payment_to) { where.push('po.payment_date <= ?'); params.push(payment_to); }
    if (due_from) { where.push('e.due_date >= ?'); params.push(due_from); }
    if (due_to) { where.push('e.due_date <= ?'); params.push(due_to); }
    if (status) { where.push('po.status = ?'); params.push(status); }
    if (currency_code) { where.push('po.currency_code = ?'); params.push(currency_code); }
    if (supplier_q) {
      where.push('(sup.name LIKE ? OR sup.razon_social LIKE ? OR sup.ruc LIKE ? OR po.supplier_name LIKE ? OR po.supplier_ruc LIKE ?)');
      const like = `%${supplier_q}%`;
      params.push(like, like, like, like, like);
    }
    if (operation_q) {
      where.push('(d.reference LIKE ? OR d.title LIKE ? OR sc.reference LIKE ?)');
      const like = `%${operation_q}%`;
      params.push(like, like, like);
    }
    if (search_q) {
      where.push(`(
        org.name LIKE ? OR org.razon_social LIKE ? OR org.ruc LIKE ?
        OR sup.name LIKE ? OR sup.razon_social LIKE ? OR sup.ruc LIKE ? OR po.supplier_name LIKE ? OR po.supplier_ruc LIKE ?
        OR po.order_number LIKE ?
        OR e.receipt_number LIKE ? OR e_legacy.receipt_number LIKE ?
        OR d.reference LIKE ? OR d.title LIKE ? OR sc.reference LIKE ?
      )`);
      const like = `%${search_q}%`;
      params.push(like, like, like, like, like, like, like, like, like, like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `
      SELECT po.*,
             COALESCE(SUM(i.amount), po.amount, 0) AS amount,
             COALESCE(
               (
                 SELECT COALESCE(SUM(p.amount),0)
                   FROM operation_expense_payments p
                   JOIN operation_expense_payment_order_items i2 ON i2.invoice_id = p.invoice_id
                  WHERE i2.order_id = po.id AND p.status <> 'anulado'
               ),
               (
                 SELECT COALESCE(SUM(p.amount),0)
                   FROM operation_expense_payments p
                  WHERE p.invoice_id = po.invoice_id AND p.status <> 'anulado'
               ),
               po.paid_amount,
               0
             ) AS paid_amount,
             (
               COALESCE(SUM(i.amount), po.amount, 0) -
               COALESCE(
                 (
                   SELECT COALESCE(SUM(p.amount),0)
                     FROM operation_expense_payments p
                     JOIN operation_expense_payment_order_items i2 ON i2.invoice_id = p.invoice_id
                    WHERE i2.order_id = po.id AND p.status <> 'anulado'
                 ),
                 (
                   SELECT COALESCE(SUM(p.amount),0)
                     FROM operation_expense_payments p
                    WHERE p.invoice_id = po.invoice_id AND p.status <> 'anulado'
                 ),
                 po.paid_amount,
                 0
               )
             ) AS balance,
             COALESCE(MIN(CONVERT(e.receipt_number USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(e_legacy.receipt_number USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS receipt_number,
             COALESCE(MIN(e.invoice_date), MAX(e_legacy.invoice_date)) AS invoice_date,
             COALESCE(MIN(e.due_date), MAX(e_legacy.due_date)) AS due_date,
             COALESCE(MIN(CONVERT(e.condition_type USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(e_legacy.condition_type USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS condition_type,
             MAX(CASE WHEN po.operation_type = 'service' THEN CONVERT(sc.reference USING utf8mb4) COLLATE utf8mb4_unicode_ci ELSE CONVERT(d.reference USING utf8mb4) COLLATE utf8mb4_unicode_ci END) AS operation_reference,
             COALESCE(MAX(CONVERT(org.razon_social USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(org.name USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS client_name,
             MAX(CONVERT(org.ruc USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS client_ruc,
             COALESCE(MAX(CONVERT(sup.razon_social USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(sup.name USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(po.supplier_name USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS supplier_display,
             COALESCE(MAX(CONVERT(sup.ruc USING utf8mb4) COLLATE utf8mb4_unicode_ci), MAX(CONVERT(po.supplier_ruc USING utf8mb4) COLLATE utf8mb4_unicode_ci)) AS supplier_ruc_display,
             MAX(CONVERT(sup.supplier_bank_name USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_name,
             MAX(CONVERT(sup.supplier_bank_account USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_account,
             MAX(CONVERT(sup.supplier_bank_currency USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_currency,
             MAX(CONVERT(sup.supplier_bank_account_type USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_account_type,
             MAX(CONVERT(sup.supplier_bank_holder USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_holder,
             MAX(CONVERT(sup.supplier_bank_holder_ruc USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_holder_ruc,
             MAX(CONVERT(sup.supplier_bank_cci_iban USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_cci_iban,
             MAX(CONVERT(sup.supplier_bank_swift USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS supplier_bank_swift,
             COALESCE(MIN(e.id), MAX(e_legacy.id), MAX(po.invoice_id)) AS primary_invoice_id,
             CASE WHEN COUNT(i.id) > 0 THEN COUNT(i.id) ELSE IF(po.invoice_id IS NULL, 0, 1) END AS invoice_count,
             GROUP_CONCAT(CONCAT(e.id, '::', COALESCE(CONVERT(e.receipt_number USING utf8mb4) COLLATE utf8mb4_unicode_ci, ''), '::', i.amount, '::', CONVERT(po.currency_code USING utf8mb4) COLLATE utf8mb4_unicode_ci, '::', COALESCE(e.due_date, '')) ORDER BY e.invoice_date SEPARATOR '||') AS invoices_list
        FROM operation_expense_payment_orders po
        LEFT JOIN operation_expense_payment_order_items i ON i.order_id = po.id
        LEFT JOIN operation_expense_invoices e ON e.id = i.invoice_id
        LEFT JOIN operation_expense_invoices e_legacy ON e_legacy.id = po.invoice_id
        LEFT JOIN deals d ON d.id = po.operation_id AND po.operation_type = 'deal'
        LEFT JOIN service_cases sc ON sc.id = po.operation_id AND po.operation_type = 'service'
        LEFT JOIN organizations sup ON sup.id = po.supplier_id
        LEFT JOIN organizations org ON org.id = CASE WHEN po.operation_type = 'service' THEN sc.org_id ELSE d.org_id END
       ${whereSql}
       GROUP BY po.id
       ORDER BY po.created_at DESC, po.id DESC
      `,
      params
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ordenes de pago');
    ws.columns = [
      { header: 'Orden', key: 'order_number', width: 18 },
      { header: 'Proveedor', key: 'supplier_display', width: 28 },
      { header: 'RUC proveedor', key: 'supplier_ruc_display', width: 18 },
      { header: 'Banco proveedor', key: 'supplier_bank_name', width: 22 },
      { header: 'Cuenta proveedor', key: 'supplier_bank_account', width: 24 },
      { header: 'Cant facturas', key: 'invoice_count', width: 14 },
      { header: 'Operacion', key: 'operation_reference', width: 16 },
      { header: 'Cliente', key: 'client_name', width: 28 },
      { header: 'Metodo', key: 'payment_method', width: 16 },
      { header: 'Fecha pago', key: 'payment_date', width: 14 },
      { header: 'Fecha programada', key: 'scheduled_payment_date', width: 16 },
      { header: 'Cuenta origen', key: 'planned_company_account', width: 28 },
      { header: 'Prioridad', key: 'priority', width: 12 },
      { header: 'Vencimiento', key: 'due_date', width: 14 },
      { header: 'Monto', key: 'amount', width: 14 },
      { header: 'Pagado', key: 'paid_amount', width: 14 },
      { header: 'Saldo', key: 'balance', width: 14 },
      { header: 'Moneda', key: 'currency_code', width: 10 },
      { header: 'Condicion', key: 'condition_type', width: 12 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Alertas', key: 'alerts', width: 34 },
      { header: 'Motivo anulacion', key: 'cancel_reason', width: 34 },
      { header: 'Creado', key: 'created_at', width: 20 },
    ];

    rows.forEach((r) => {
      ws.addRow({
        order_number: r.order_number,
        supplier_display: r.supplier_display,
        supplier_ruc_display: r.supplier_ruc_display,
        supplier_bank_name: r.supplier_bank_name,
        supplier_bank_account: r.supplier_bank_account,
        invoice_count: r.invoice_count,
        operation_reference: r.operation_reference,
        client_name: r.client_name,
        payment_method: r.payment_method,
        payment_date: r.payment_date,
        scheduled_payment_date: r.scheduled_payment_date,
        planned_company_account: r.planned_company_account,
        priority: r.priority,
        due_date: r.due_date,
        amount: r.amount,
        paid_amount: r.paid_amount,
        balance: r.balance,
        currency_code: r.currency_code,
        condition_type: r.condition_type,
        status: r.status,
        alerts: [
          !hasSupplierBankData(r) && Number(r.balance || 0) > 0.009 ? 'Proveedor sin cuenta bancaria' : null,
          String(r.status || '').toLowerCase() === 'pendiente' ? 'Pendiente de aprobacion' : null,
        ].filter(Boolean).join(' | '),
        cancel_reason: r.cancel_reason || '',
        created_at: r.created_at,
      });
    });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ordenes-de-pago.xlsx"`
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    await wb.xlsx.write(res);
  } catch (e) {
    console.error('[admin-ops] payment-orders export error', e);
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

router.post('/payment-orders/export-zip', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensurePaymentOrderAdminTables();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'Sin ordenes seleccionadas' });
    if (ids.length > 200) return res.status(400).json({ error: 'Demasiadas ordenes' });

    const [orders] = await pool.query(
      `
      SELECT po.*,
             CASE WHEN po.operation_type = 'service' THEN sc.reference ELSE d.reference END AS operation_reference
        FROM operation_expense_payment_orders po
        LEFT JOIN deals d ON d.id = po.operation_id AND po.operation_type = 'deal'
        LEFT JOIN service_cases sc ON sc.id = po.operation_id AND po.operation_type = 'service'
       WHERE po.id IN (?)
       ORDER BY po.created_at ASC, po.id ASC
      `,
      [ids]
    );

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ordenes-de-pago.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[admin-ops] zip error', err);
      res.status(500).end();
    });
    archive.pipe(res);

    for (const row of orders) {
      const [items] = await pool.query(
        `SELECT i.invoice_id, i.amount, e.receipt_number, e.invoice_date
           FROM operation_expense_payment_order_items i
           JOIN operation_expense_invoices e ON e.id = i.invoice_id
          WHERE i.order_id = ?
          ORDER BY e.invoice_date ASC, e.id ASC`,
        [row.id]
      );

      const pdfBuffer = await renderPaymentOrderPdfBuffer({
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
      });

      const filename = `orden-pago-${row.order_number || row.id}.pdf`;
      archive.append(pdfBuffer, { name: filename });
    }

    await archive.finalize();
  } catch (e) {
    console.error('[admin-ops] payment-orders zip error', e);
    res.status(500).json({ error: 'No se pudo generar el zip' });
  }
});

router.patch('/payment-orders/:id/approve', requireAuth, requireAnyRole('admin'), async (req, res) => {
  try {
    await ensurePaymentOrderAdminTables();
    const { id } = req.params;
    const [[row]] = await pool.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Orden no encontrada' });
    if (row.status !== 'pendiente') {
      return res.status(400).json({ error: 'La orden no está pendiente' });
    }
    await pool.query(
      `UPDATE operation_expense_payment_orders
          SET status = 'aprobada', approved_by = ?, approved_at = NOW()
        WHERE id = ?`,
      [req.user?.id || null, id]
    );
    await addPaymentOrderEvent(id, 'approved', req.body?.note || 'Orden aprobada', { previous_status: row.status }, req.user?.id || null);
    const [[updated]] = await pool.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[admin-ops] approve order error', e);
    res.status(500).json({ error: 'No se pudo aprobar' });
  }
});

router.get('/payment-orders/:id/detail', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensurePaymentOrderAdminTables();
    const { id } = req.params;
    const [[order]] = await pool.query(
      `SELECT po.*,
              COALESCE(sup.razon_social, sup.name, po.supplier_name) AS supplier_display,
              COALESCE(sup.ruc, po.supplier_ruc) AS supplier_ruc_display,
              sup.supplier_bank_name, sup.supplier_bank_account, sup.supplier_bank_currency,
              sup.supplier_bank_account_type, sup.supplier_bank_holder, sup.supplier_bank_holder_ruc,
              sup.supplier_bank_cci_iban, sup.supplier_bank_swift,
              CASE WHEN po.operation_type = 'service' THEN sc.reference ELSE d.reference END AS operation_reference,
              COALESCE(org.razon_social, org.name) AS client_name,
              org.ruc AS client_ruc
         FROM operation_expense_payment_orders po
         LEFT JOIN organizations sup ON sup.id = po.supplier_id
         LEFT JOIN deals d ON d.id = po.operation_id AND po.operation_type = 'deal'
         LEFT JOIN service_cases sc ON sc.id = po.operation_id AND po.operation_type = 'service'
         LEFT JOIN organizations org ON org.id = CASE WHEN po.operation_type = 'service' THEN sc.org_id ELSE d.org_id END
        WHERE po.id = ?
        LIMIT 1`,
      [id]
    );
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    const [items] = await pool.query(
      `SELECT i.invoice_id, i.amount AS order_amount,
              e.receipt_type, e.receipt_number, e.invoice_date, e.due_date,
              e.currency_code, e.amount_total, e.paid_amount, e.balance, e.payment_status,
              e.supplier_name, e.supplier_ruc
         FROM operation_expense_payment_order_items i
         JOIN operation_expense_invoices e ON e.id = i.invoice_id
        WHERE i.order_id = ?
        ORDER BY e.invoice_date ASC, e.id ASC`,
      [id]
    );
    let detailItems = items;
    if (!detailItems.length && order.invoice_id) {
      const [legacy] = await pool.query(
        `SELECT e.id AS invoice_id, e.amount_total AS order_amount,
                e.receipt_type, e.receipt_number, e.invoice_date, e.due_date,
                e.currency_code, e.amount_total, e.paid_amount, e.balance, e.payment_status,
                e.supplier_name, e.supplier_ruc
           FROM operation_expense_invoices e
          WHERE e.id = ?`,
        [order.invoice_id]
      );
      detailItems = legacy;
    }
    const invoiceIds = detailItems.map((item) => item.invoice_id).filter(Boolean);
    let payments = [];
    if (invoiceIds.length) {
      const [payRows] = await pool.query(
        `SELECT p.*, e.currency_code, e.receipt_number
           FROM operation_expense_payments p
           JOIN operation_expense_invoices e ON e.id = p.invoice_id
          WHERE p.invoice_id IN (${invoiceIds.map(() => '?').join(',')}) AND p.status <> 'anulado'
          ORDER BY p.payment_date DESC, p.id DESC`,
        invoiceIds
      );
      payments = payRows;
    }
    const [events] = await pool.query(
      `SELECT ev.*, u.name AS user_name, u.email AS user_email
         FROM operation_expense_payment_order_events ev
         LEFT JOIN users u ON u.id = ev.created_by
        WHERE ev.order_id = ?
        ORDER BY ev.created_at DESC, ev.id DESC`,
      [id]
    );
    res.json({ order, items: detailItems, payments, events });
  } catch (e) {
    console.error('[admin-ops] payment-order detail error', e);
    res.status(500).json({ error: 'No se pudo cargar el detalle de la orden' });
  }
});

router.patch('/payment-orders/:id/cancel', requireAuth, requireAnyRole('admin'), async (req, res) => {
  try {
    await ensurePaymentOrderAdminTables();
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Motivo de anulacion requerido' });
    const [[row]] = await pool.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Orden no encontrada' });
    if (String(row.status || '').toLowerCase() === 'anulada') return res.status(400).json({ error: 'La orden ya esta anulada' });
    const [[paid]] = await pool.query(
      `SELECT COALESCE(SUM(p.amount),0) AS paid
         FROM operation_expense_payments p
         JOIN operation_expense_payment_order_items i ON i.invoice_id = p.invoice_id
        WHERE i.order_id = ? AND p.status <> 'anulado'`,
      [id]
    );
    if (Number(paid?.paid || 0) > 0.009) return res.status(409).json({ error: 'No se puede anular una OP con pagos registrados' });
    await pool.query(
      `UPDATE operation_expense_payment_orders
          SET status = 'anulada', cancelled_by = ?, cancelled_at = NOW(), cancel_reason = ?
        WHERE id = ?`,
      [req.user?.id || null, reason, id]
    );
    await addPaymentOrderEvent(id, 'cancelled', reason, { previous_status: row.status }, req.user?.id || null);
    const [[updated]] = await pool.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[admin-ops] cancel order error', e);
    res.status(500).json({ error: 'No se pudo anular la orden' });
  }
});

router.patch('/payment-orders/:id/schedule', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensurePaymentOrderAdminTables();
    const { id } = req.params;
    const scheduledPaymentDate = req.body?.scheduled_payment_date || null;
    const plannedCompanyAccount = String(req.body?.planned_company_account || '').trim() || null;
    const priority = String(req.body?.priority || 'normal').trim() || 'normal';
    const note = String(req.body?.note || '').trim() || null;
    const [[row]] = await pool.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Orden no encontrada' });
    await pool.query(
      `UPDATE operation_expense_payment_orders
          SET scheduled_payment_date = ?, planned_company_account = ?, priority = ?
        WHERE id = ?`,
      [scheduledPaymentDate, plannedCompanyAccount, priority, id]
    );
    await addPaymentOrderEvent(
      id,
      'scheduled',
      note || 'Pago programado',
      { scheduled_payment_date: scheduledPaymentDate, planned_company_account: plannedCompanyAccount, priority },
      req.user?.id || null
    );
    const [[updated]] = await pool.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[admin-ops] schedule order error', e);
    res.status(500).json({ error: 'No se pudo programar la orden' });
  }
});

router.post('/payment-orders/:id/payments', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensurePaymentOrderAdminTables();
    const { id } = req.params;
    const paymentDate = req.body?.payment_date || null;
    const method = String(req.body?.method || '').trim();
    const account = String(req.body?.account || '').trim() || null;
    const referenceNumber = String(req.body?.reference_number || '').trim() || null;
    const notes = String(req.body?.notes || '').trim() || null;
    const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];
    if (!method) return res.status(400).json({ error: 'Metodo de pago requerido' });
    if (!payments.length) return res.status(400).json({ error: 'Debe indicar pagos por factura' });
    const [[order]] = await conn.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    const orderStatus = String(order.status || '').toLowerCase();
    if (!['aprobada', 'pago_parcial'].includes(orderStatus)) {
      return res.status(400).json({ error: 'La orden debe estar aprobada para registrar pagos' });
    }
    const [items] = await conn.query(
      `SELECT i.invoice_id, i.amount AS order_amount, e.amount_total, e.balance
         FROM operation_expense_payment_order_items i
         JOIN operation_expense_invoices e ON e.id = i.invoice_id
        WHERE i.order_id = ?`,
      [id]
    );
    const allowed = new Map(items.map((item) => [Number(item.invoice_id), item]));
    if (!allowed.size && order.invoice_id) {
      const [[legacy]] = await conn.query(
        `SELECT id AS invoice_id, amount_total AS order_amount, amount_total, balance
           FROM operation_expense_invoices
          WHERE id = ?`,
        [order.invoice_id]
      );
      if (legacy) allowed.set(Number(legacy.invoice_id), legacy);
    }
    await conn.beginTransaction();
    const created = [];
    for (const payment of payments) {
      const invoiceId = Number(payment.invoice_id || 0);
      const amount = Number(payment.amount || 0);
      if (!invoiceId || amount <= 0) continue;
      const item = allowed.get(invoiceId);
      if (!item) throw new Error(`Factura ${invoiceId} no pertenece a la orden`);
      const [[sumRow]] = await conn.query(
        `SELECT COALESCE(SUM(amount),0) AS paid
           FROM operation_expense_payments
          WHERE invoice_id = ? AND status <> 'anulado'`,
        [invoiceId]
      );
      const paid = Number(sumRow?.paid || 0);
      const total = Number(item.amount_total || 0);
      if (amount > total - paid + 0.01) {
        const err = new Error(`El pago supera el saldo pendiente de la factura ${invoiceId}`);
        err.statusCode = 400;
        throw err;
      }
      const [result] = await conn.query(
        `INSERT INTO operation_expense_payments
         (invoice_id, payment_date, amount, method, account, reference_number, notes, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmado', ?)`,
        [invoiceId, paymentDate, amount, method, account, referenceNumber, notes, req.user?.id || null]
      );
      await updateAdminInvoicePaymentStatus(invoiceId, conn);
      created.push({ id: result.insertId, invoice_id: invoiceId, amount });
    }
    await recomputeAdminPaymentOrder(id, conn);
    await addPaymentOrderEvent(id, 'payment_registered', notes || 'Pago registrado', { payments: created, method, account, reference_number: referenceNumber }, req.user?.id || null, conn);
    await conn.commit();
    res.status(201).json({ ok: true, payments: created });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[admin-ops] payment-order payment error', e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo registrar el pago de la orden' });
  } finally {
    conn.release();
  }
});

export default router;

