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

router.get('/operation-expenses', requireAuth, requireAnyRole('admin', 'manager'), async (req, res) => {
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
             ) AS item_count
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

    res.json(rows);
  } catch (e) {
    console.error('[admin-ops] operation-expenses error', e);
    res.status(500).json({ error: 'Error listing operation expenses' });
  }
});

router.get('/operation-expenses/export', requireAuth, requireAnyRole('admin', 'manager'), async (req, res) => {
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
             COALESCE(sup.ruc, e.supplier_ruc) AS supplier_ruc_display
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

router.get('/payment-orders', requireAuth, requireAnyRole('admin', 'manager'), async (req, res) => {
  try {
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
             COALESCE(MIN(e.receipt_number), e_legacy.receipt_number) AS receipt_number,
             COALESCE(MIN(e.invoice_date), e_legacy.invoice_date) AS invoice_date,
             COALESCE(MIN(e.due_date), e_legacy.due_date) AS due_date,
             COALESCE(MIN(e.condition_type), e_legacy.condition_type) AS condition_type,
             CASE WHEN po.operation_type = 'service' THEN sc.reference ELSE d.reference END AS operation_reference,
             COALESCE(sup.razon_social, sup.name, po.supplier_name) AS supplier_display,
             CASE WHEN COUNT(i.id) > 0 THEN COUNT(i.id) ELSE IF(po.invoice_id IS NULL, 0, 1) END AS invoice_count,
             GROUP_CONCAT(CONCAT(e.receipt_number, '::', i.amount, '::', po.currency_code) ORDER BY e.invoice_date SEPARATOR '||') AS invoices_list
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

router.get('/payment-orders/export', requireAuth, requireAnyRole('admin', 'manager'), async (req, res) => {
  try {
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
             COALESCE(MIN(e.receipt_number), e_legacy.receipt_number) AS receipt_number,
             COALESCE(MIN(e.invoice_date), e_legacy.invoice_date) AS invoice_date,
             COALESCE(MIN(e.due_date), e_legacy.due_date) AS due_date,
             COALESCE(MIN(e.condition_type), e_legacy.condition_type) AS condition_type,
             CASE WHEN po.operation_type = 'service' THEN sc.reference ELSE d.reference END AS operation_reference,
             COALESCE(sup.razon_social, sup.name, po.supplier_name) AS supplier_display,
             CASE WHEN COUNT(i.id) > 0 THEN COUNT(i.id) ELSE IF(po.invoice_id IS NULL, 0, 1) END AS invoice_count,
             GROUP_CONCAT(CONCAT(e.receipt_number, '::', i.amount, '::', po.currency_code) ORDER BY e.invoice_date SEPARATOR '||') AS invoices_list
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
      { header: 'Cant facturas', key: 'invoice_count', width: 14 },
      { header: 'Operacion', key: 'operation_reference', width: 16 },
      { header: 'Metodo', key: 'payment_method', width: 16 },
      { header: 'Fecha pago', key: 'payment_date', width: 14 },
      { header: 'Vencimiento', key: 'due_date', width: 14 },
      { header: 'Monto', key: 'amount', width: 14 },
      { header: 'Pagado', key: 'paid_amount', width: 14 },
      { header: 'Saldo', key: 'balance', width: 14 },
      { header: 'Moneda', key: 'currency_code', width: 10 },
      { header: 'Condicion', key: 'condition_type', width: 12 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Creado', key: 'created_at', width: 20 },
    ];

    rows.forEach((r) => {
      ws.addRow({
        order_number: r.order_number,
        supplier_display: r.supplier_display,
        invoice_count: r.invoice_count,
        operation_reference: r.operation_reference,
        payment_method: r.payment_method,
        payment_date: r.payment_date,
        due_date: r.due_date,
        amount: r.amount,
        paid_amount: r.paid_amount,
        balance: r.balance,
        currency_code: r.currency_code,
        condition_type: r.condition_type,
        status: r.status,
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

router.post('/payment-orders/export-zip', requireAuth, requireAnyRole('admin', 'manager'), async (req, res) => {
  try {
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

router.patch('/payment-orders/:id/approve', requireAuth, requireAnyRole('admin', 'manager'), async (req, res) => {
  try {
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
    const [[updated]] = await pool.query('SELECT * FROM operation_expense_payment_orders WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[admin-ops] approve order error', e);
    res.status(500).json({ error: 'No se pudo aprobar' });
  }
});

export default router;
