import express from 'express';
import { pool } from '../services/db.js';
import { requireAnyRole, requireAuth, requireRole } from '../middlewares/auth.js';

const router = express.Router();

async function ensureReceiptAdminColumns(conn = pool) {
  const alters = [
    'ALTER TABLE receipts ADD COLUMN cancelled_by INT NULL',
    'ALTER TABLE receipts ADD COLUMN cancelled_at DATETIME NULL',
    'ALTER TABLE receipts ADD COLUMN cancel_reason VARCHAR(255) NULL',
  ];

  for (const sql of alters) {
    try {
      await conn.query(sql);
    } catch (error) {
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

async function recomputeInvoicePaymentsLocal(invoiceId, conn = pool) {
  const [[invoice]] = await conn.query(
    `SELECT id, status, total_amount, subtotal, tax_amount, credited_total, net_total_amount
       FROM invoices
      WHERE id = ?
      LIMIT 1`,
    [invoiceId]
  );
  if (!invoice) return null;

  const [[paidRow]] = await conn.query(
    `SELECT COALESCE(SUM(COALESCE(ra.amount_applied, r.amount)), 0) AS paid
       FROM receipts r LEFT JOIN receipt_applications ra ON ra.receipt_id = r.id
      WHERE COALESCE(ra.invoice_id, r.invoice_id) = ? AND r.status = 'emitido'`,
    [invoiceId]
  );

  const totalFromInvoice =
    Number(invoice.total_amount || 0) > 0
      ? Number(invoice.total_amount || 0)
      : Number(invoice.subtotal || 0) + Number(invoice.tax_amount || 0);
  const netTotal =
    Number(invoice.net_total_amount || 0) > 0
      ? Number(invoice.net_total_amount || 0)
      : Math.max(0, totalFromInvoice - Number(invoice.credited_total || 0));
  const paid = Number(paidRow?.paid || 0);
  const balance = Math.max(0, netTotal - paid);

  let nextStatus = 'emitida';
  if (String(invoice.status || '').toLowerCase() === 'anulada') {
    nextStatus = 'anulada';
  } else if (netTotal <= 0.01) {
    nextStatus = 'anulada';
  } else if (balance <= 0.01) {
    nextStatus = 'pagada';
  } else if (paid > 0.01) {
    nextStatus = 'pago_parcial';
  }

  await conn.query(
    `UPDATE invoices
        SET paid_amount = ?,
            net_balance = ?,
            status = ?
      WHERE id = ?`,
    [paid.toFixed(2), balance.toFixed(2), nextStatus, invoiceId]
  );

  return { paid, balance, status: nextStatus };
}

router.get('/receipts', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensureReceiptAdminColumns();

    const {
      search = '',
      method = '',
      currency = '',
      account = '',
      status = '',
      from = '',
      to = '',
    } = req.query || {};

    const where = [];
    const params = [];

    if (normalizeText(method)) {
      where.push('LOWER(r.payment_method) = LOWER(?)');
      params.push(normalizeText(method));
    }
    if (normalizeText(currency)) {
      where.push('UPPER(r.currency_code) = UPPER(?)');
      params.push(normalizeText(currency));
    }
    if (normalizeText(account)) {
      where.push('r.bank_account = ?');
      params.push(normalizeText(account));
    }
    if (normalizeText(status)) {
      where.push('r.status = ?');
      params.push(normalizeText(status));
    }
    if (normalizeText(from)) {
      where.push('DATE(COALESCE(r.issue_date, r.created_at)) >= ?');
      params.push(normalizeText(from));
    }
    if (normalizeText(to)) {
      where.push('DATE(COALESCE(r.issue_date, r.created_at)) <= ?');
      params.push(normalizeText(to));
    }
    if (normalizeText(search)) {
      const like = `%${normalizeText(search)}%`;
      where.push(`(
        r.receipt_number LIKE ?
        OR r.reference_number LIKE ?
        OR i.invoice_number LIKE ?
        OR EXISTS (SELECT 1 FROM receipt_applications ra_search
          JOIN invoices i_search ON i_search.id = ra_search.invoice_id
          WHERE ra_search.receipt_id = r.id AND i_search.invoice_number LIKE ?)
        OR COALESCE(d.reference, sc.reference) LIKE ?
        OR o.name LIKE ?
        OR o.ruc LIKE ?
      )`);
      params.push(like, like, like, like, like, like, like);
    }

    const [rows] = await pool.query(
      `SELECT r.*,
              i.invoice_number,
              i.organization_id,
              i.deal_id,
              i.service_case_id,
              i.currency_code AS invoice_currency_code,
              COALESCE(d.reference, sc.reference) AS deal_reference,
              o.name AS organization_name,
              o.ruc AS organization_ruc,
              creator.name AS created_by_name,
              issuer.name AS issued_by_name,
              canceller.name AS cancelled_by_name
         FROM receipts r
         LEFT JOIN invoices i ON i.id = r.invoice_id
         LEFT JOIN deals d ON d.id = i.deal_id
         LEFT JOIN service_cases sc ON sc.id = i.service_case_id
         LEFT JOIN organizations o ON o.id = i.organization_id
         LEFT JOIN users creator ON creator.id = r.created_by
         LEFT JOIN users issuer ON issuer.id = r.issued_by
         LEFT JOIN users canceller ON canceller.id = r.cancelled_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY COALESCE(r.issue_date, DATE(r.created_at)) DESC, r.id DESC`,
      params
    );

    const receiptIds = rows.map((row) => row.id);
    let applications = [];
    if (receiptIds.length) {
      [applications] = await pool.query(`SELECT ra.receipt_id, ra.invoice_id, ra.amount_applied,
        i.invoice_number FROM receipt_applications ra
        JOIN invoices i ON i.id = ra.invoice_id
        WHERE ra.receipt_id IN (${receiptIds.map(() => '?').join(',')}) ORDER BY ra.id`, receiptIds);
    }
    const byReceipt = new Map();
    for (const application of applications) {
      if (!byReceipt.has(application.receipt_id)) byReceipt.set(application.receipt_id, []);
      byReceipt.get(application.receipt_id).push(application);
    }
    res.json(rows.map((row) => ({ ...row, applications: byReceipt.get(row.id) || [{
      invoice_id: row.invoice_id, invoice_number: row.invoice_number, amount_applied: row.amount,
    }] })));
  } catch (error) {
    console.error('[receipts-admin] list error', error);
    res.status(500).json({ error: 'Error al listar recibos' });
  }
});

router.post('/receipts/:id/cancel', requireAuth, requireRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureReceiptAdminColumns(conn);
    const { id } = req.params;
    const reason = normalizeText(req.body?.reason);

    if (!reason) {
      return res.status(400).json({ error: 'Debe cargar un motivo de anulacion' });
    }

    await conn.beginTransaction();

    const [[receipt]] = await conn.query(
      `SELECT *
         FROM receipts
        WHERE id = ?
        LIMIT 1
        FOR UPDATE`,
      [id]
    );

    if (!receipt) {
      await conn.rollback();
      return res.status(404).json({ error: 'Recibo no encontrado' });
    }
    if (String(receipt.status || '').toLowerCase() === 'anulado') {
      await conn.rollback();
      return res.status(400).json({ error: 'El recibo ya esta anulado' });
    }

    await conn.query(
      `UPDATE receipts
          SET status = 'anulado',
              cancelled_by = ?,
              cancelled_at = NOW(),
              cancel_reason = ?
        WHERE id = ?`,
      [req.user?.id || null, reason, id]
    );

    const [applications] = await conn.query(`SELECT DISTINCT invoice_id FROM receipt_applications
      WHERE receipt_id = ?`, [id]);
    const invoiceIds = applications.length ? applications.map((row) => row.invoice_id) : [receipt.invoice_id];
    for (const invoiceId of invoiceIds) await recomputeInvoicePaymentsLocal(invoiceId, conn);

    await conn.commit();

    const [[updated]] = await pool.query(
      `SELECT r.*,
              i.invoice_number,
              i.organization_id,
              i.deal_id,
              i.service_case_id,
              COALESCE(d.reference, sc.reference) AS deal_reference,
              o.name AS organization_name,
              o.ruc AS organization_ruc,
              creator.name AS created_by_name,
              issuer.name AS issued_by_name,
              canceller.name AS cancelled_by_name
         FROM receipts r
         LEFT JOIN invoices i ON i.id = r.invoice_id
         LEFT JOIN deals d ON d.id = i.deal_id
         LEFT JOIN service_cases sc ON sc.id = i.service_case_id
         LEFT JOIN organizations o ON o.id = i.organization_id
         LEFT JOIN users creator ON creator.id = r.created_by
         LEFT JOIN users issuer ON issuer.id = r.issued_by
         LEFT JOIN users canceller ON canceller.id = r.cancelled_by
        WHERE r.id = ?
        LIMIT 1`,
      [id]
    );

    res.json(updated);
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error('[receipts-admin] cancel error', error);
    res.status(500).json({ error: 'Error al anular recibo' });
  } finally {
    conn.release();
  }
});

export default router;
