import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';
import { ensureSupplierCreditNoteTables } from '../services/supplierCreditNotes.js';
import { ensureBankReconciliationSchema } from './bankReconciliation.js';
import generatePaymentOrderPDF from '../services/paymentOrderTemplatePdfkit.js';
import {
  availableCents, cents, createSourcePayment, duplicateSupplierDocument, ensureUnifiedPaymentOrderSchema,
  legacyOrderExists, lockedDocument, reservedCents, validatePaymentMethod, validateSelection,
} from '../services/unifiedPaymentOrders.js';

const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const receiptDir = path.resolve(process.env.PRIVATE_UPLOAD_DIR || 'private_uploads', 'ap-payment-orders');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdir(receiptDir, { recursive: true }).then(() => cb(null, receiptDir), cb); },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});

async function orderDetail(id, conn = pool) {
  const [[order]] = await conn.query('SELECT * FROM ap_payment_orders WHERE id = ?', [id]);
  if (!order) return null;
  const [items] = await conn.query(`SELECT i.*, COALESCE((SELECT SUM(a.amount) FROM ap_payment_order_allocations a WHERE a.item_id = i.id), 0) AS paid_amount,
    (SELECT e.operation_id FROM operation_expense_invoices e WHERE i.source_type = 'operation-expense' AND e.id = i.source_id) AS operation_id,
    (SELECT e.operation_type FROM operation_expense_invoices e WHERE i.source_type = 'operation-expense' AND e.id = i.source_id) AS operation_type
    FROM ap_payment_order_items i WHERE i.order_id = ? ORDER BY i.id`, [id]);
  const [payments] = await conn.query(`SELECT p.id, p.payment_date, p.method, p.company_account, p.reference_number,
      p.receipt_name, p.amount, p.notes, p.created_at,
      (SELECT k.movement_id FROM bank_payment_matches k WHERE k.payment_id = p.id) AS bank_movement_id,
      (SELECT COUNT(*) FROM ap_payment_order_allocations a WHERE a.payment_id = p.id) AS allocation_count,
      (SELECT COUNT(*) FROM ap_payment_order_allocations a
       JOIN ap_payment_order_items i ON i.id = a.item_id
       JOIN accounts_payable_payment_meta m ON m.source_type = i.source_type AND m.payment_id = a.source_payment_id
       WHERE a.payment_id = p.id AND m.reconciled = 1) AS reconciled_count
    FROM ap_payment_order_payments p WHERE p.order_id = ? ORDER BY p.id DESC`, [id]);
  const [events] = await conn.query('SELECT event_type, actor_user_id, detail_json, created_at FROM ap_payment_order_events WHERE order_id = ? ORDER BY id DESC', [id]);
  return { order, items, payments, events };
}

async function addEvent(conn, orderId, eventType, userId, detail = {}) {
  await conn.query(`INSERT INTO ap_payment_order_events (order_id, event_type, actor_user_id, detail_json)
    VALUES (?, ?, ?, ?)`, [orderId, eventType, userId, JSON.stringify(detail)]);
}

export default function unifiedPaymentOrdersRouter(loadDocuments, ensurePaymentMeta) {
  const router = Router();
  router.use(requireAuth, requireAnyRole('admin', 'finanzas'));
  router.use(async (_req, _res, next) => { try { await ensurePaymentMeta(); await ensureBankReconciliationSchema(); next(); } catch (e) { next(e); } });

  router.get('/eligible', async (req, res) => {
    try {
      await ensureUnifiedPaymentOrderSchema();
      const supplierId = Number(req.query.supplier_id);
      if (!Number.isSafeInteger(supplierId) || supplierId <= 0) throw error('Seleccione un proveedor');
      const { rows } = await loadDocuments({ open_only: '1' });
      const filtered = rows.filter((row) => Number(row.supplier_id) === supplierId && Number(row.balance) > 0.009);
      const result = [];
      for (const row of filtered) {
        const sourceId = Number(row.invoice_id || row.expense_id);
        const reserved = await reservedCents(pool, row.source_type, sourceId);
        const legacy = await legacyOrderExists(pool, row.source_type, sourceId);
        result.push({ ...row, source_id: sourceId, reserved_amount: reserved / 100,
          available_amount: legacy ? 0 : availableCents(row.balance, reserved / 100) / 100,
          unavailable_reason: legacy ? 'Tiene una orden anterior activa' : null });
      }
      res.json({ rows: result });
    } catch (e) {
      console.error('[ap-unified] eligible', e);
      res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudieron cargar los documentos' });
    }
  });

  router.get('/', async (_req, res) => {
    try {
      await ensureUnifiedPaymentOrderSchema();
      const [rows] = await pool.query(`SELECT * FROM ap_payment_orders ORDER BY id DESC LIMIT 200`);
      res.json({ rows });
    } catch (e) {
      console.error('[ap-unified] list', e);
      res.status(500).json({ error: 'No se pudieron cargar las órdenes' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      await ensureUnifiedPaymentOrderSchema();
      const detail = await orderDetail(req.params.id);
      if (!detail) return res.status(404).json({ error: 'Orden no encontrada' });
      res.json(detail);
    } catch (e) {
      console.error('[ap-unified] detail', e);
      res.status(500).json({ error: 'No se pudo cargar la orden' });
    }
  });

  router.get('/:id/pdf', async (req, res) => {
    try {
      await ensureUnifiedPaymentOrderSchema();
      const detail = await orderDetail(req.params.id);
      if (!detail) return res.status(404).json({ error: 'Orden no encontrada' });
      const { order, items } = detail;
      const [documents] = await pool.query(`SELECT i.source_type, i.source_id,
        DATE_FORMAT(CASE
          WHEN i.source_type = 'operation-expense' THEN oe.invoice_date
          WHEN i.source_type = 'purchase-invoice' THEN pi.invoice_date
          WHEN i.source_type = 'admin-expense' THEN COALESCE(ae.invoice_date, ae.expense_date)
        END, '%d/%m/%Y') AS invoice_date
        FROM ap_payment_order_items i
        LEFT JOIN operation_expense_invoices oe ON i.source_type = 'operation-expense' AND oe.id = i.source_id
        LEFT JOIN purchase_invoices pi ON i.source_type = 'purchase-invoice' AND pi.id = i.source_id
        LEFT JOIN admin_expenses ae ON i.source_type = 'admin-expense' AND ae.id = i.source_id
        WHERE i.order_id = ?`, [order.id]);
      const dates = new Map(documents.map((row) => [`${row.source_type}:${row.source_id}`, row.invoice_date]));
      const observations = [order.supplier_ruc && `RUC: ${order.supplier_ruc}`,
        order.beneficiary_account && `Cuenta beneficiaria: ${order.beneficiary_account}`,
        order.notes].filter(Boolean).join(' | ');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="orden-pago-${order.order_number}.pdf"`);
      await generatePaymentOrderPDF({
        order_number: order.order_number,
        supplier_name: order.supplier_name,
        payment_method: order.payment_method || 'A definir',
        payment_method_label: 'FORMA DE PAGO PREVISTA',
        payment_date: order.planned_payment_date instanceof Date
          ? order.planned_payment_date.toLocaleDateString('es-PY')
          : order.planned_payment_date || '-',
        payment_date_label: 'FECHA PREVISTA',
        invoice_number: items.length > 1 ? 'Varios' : null,
        amount: order.amount,
        currency_code: order.currency_code,
        condition_type: 'Orden unificada',
        description: `Pago de ${items.length} documento${items.length === 1 ? '' : 's'}`,
        observations,
        document_label: 'COMPROBANTE N°',
        documents_label: 'DOCUMENTOS',
        invoices: items.map((item) => ({
          receipt_number: item.document_number || `#${item.source_id}`,
          invoice_date: dates.get(`${item.source_type}:${item.source_id}`) || '-',
          amount: item.amount,
        })),
      }, res);
    } catch (e) {
      console.error('[ap-unified] pdf', e);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el PDF' });
    }
  });

  router.post('/', async (req, res) => {
    let conn;
    try {
      await ensureUnifiedPaymentOrderSchema();
      await ensureSupplierCreditNoteTables();
      const supplierId = Number(req.body?.supplier_id);
      const requestId = String(req.body?.request_id || '').trim();
      const items = validateSelection(req.body?.items);
      const paymentMethod = validatePaymentMethod(req.body?.payment_method);
      if (!Number.isSafeInteger(supplierId) || supplierId <= 0 || !/^[\w-]{12,64}$/.test(requestId)) throw error('Proveedor o solicitud inválida');
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[previous]] = await conn.query('SELECT id FROM ap_payment_orders WHERE request_id = ?', [requestId]);
      if (previous) {
        await conn.rollback();
        return res.status(200).json(await orderDetail(previous.id));
      }
      const [[supplier]] = await conn.query(`SELECT id, name, razon_social, ruc, supplier_bank_name,
        supplier_bank_account, supplier_bank_cci_iban FROM organizations WHERE id = ?`, [supplierId]);
      if (!supplier) throw error('Proveedor no encontrado');
      let currency = null;
      let total = 0;
      const resolved = [];
      for (const item of items) {
        const doc = await lockedDocument(conn, item.sourceType, item.sourceId);
        if (!doc || doc.supplierId !== supplierId || ['anulada', 'anulado'].includes(doc.status)) throw error('Documento inválido o de otro proveedor', 409);
        if (item.sourceType === 'purchase-invoice' && !['registrada', 'pago_parcial'].includes(doc.status)) throw error('La factura de compra debe estar registrada', 409);
        if (['operation-expense', 'admin-expense'].includes(item.sourceType) && ['borrador', 'cancelado', 'pagado'].includes(doc.status)) throw error('Documento no disponible para pago', 409);
        if (!currency) currency = doc.currency;
        if (currency !== doc.currency) throw error('La orden debe tener una sola moneda');
        if (await legacyOrderExists(conn, item.sourceType, item.sourceId)) throw error('Un documento ya tiene una orden anterior activa', 409);
        if (await duplicateSupplierDocument(conn, supplierId, doc.supplierDocNumber, item.sourceType, item.sourceId)) {
          throw error(`El comprobante ${doc.supplierDocNumber} aparece también en otro módulo. Revise el duplicado antes de pagar`, 409);
        }
        const reserved = await reservedCents(conn, item.sourceType, item.sourceId);
        if (item.amount > availableCents(doc.totals.balance, reserved / 100)) throw error(`El importe supera el saldo disponible de ${doc.number || item.sourceId}`, 409);
        resolved.push({ ...item, number: doc.number });
        total += item.amount;
      }
      const [created] = await conn.query(`INSERT INTO ap_payment_orders
        (request_id, supplier_id, supplier_name, supplier_ruc, currency_code, beneficiary_account,
         planned_payment_date, payment_method, company_account, notes, amount, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`,
        [requestId, supplierId, supplier.razon_social || supplier.name, supplier.ruc,
          currency, [supplier.supplier_bank_name, supplier.supplier_bank_account || supplier.supplier_bank_cci_iban].filter(Boolean).join(' - ') || null,
          req.body?.planned_payment_date || null, paymentMethod, req.body?.company_account || null,
          req.body?.notes || null, total / 100, req.user?.id || null]);
      const orderId = created.insertId;
      await conn.query('UPDATE ap_payment_orders SET order_number = ? WHERE id = ?', [`OPU-${String(orderId).padStart(6, '0')}`, orderId]);
      for (const item of resolved) await conn.query(`INSERT INTO ap_payment_order_items
        (order_id, source_type, source_id, document_number, amount) VALUES (?, ?, ?, ?, ?)`,
      [orderId, item.sourceType, item.sourceId, item.number, item.amount / 100]);
      await addEvent(conn, orderId, 'created', req.user?.id, { items: resolved.length, amount: total / 100 });
      await conn.commit();
      res.status(201).json(await orderDetail(orderId));
    } catch (e) {
      if (conn) await conn.rollback();
      if (e.code === 'ER_DUP_ENTRY' && req.body?.request_id) {
        const [[existing]] = await pool.query('SELECT id FROM ap_payment_orders WHERE request_id = ?', [req.body.request_id]);
        if (existing) return res.json(await orderDetail(existing.id));
      }
      console.error('[ap-unified] create', e);
      res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo crear la orden' });
    } finally { conn?.release(); }
  });

  router.post('/:id/approve', async (req, res) => {
    let conn;
    try {
      await ensureUnifiedPaymentOrderSchema();
      await ensureSupplierCreditNoteTables();
      if (String(req.user?.role || '').toLowerCase() !== 'admin') throw error('Solo administración puede aprobar', 403);
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[order]] = await conn.query('SELECT * FROM ap_payment_orders WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!order || order.status !== 'pendiente') throw error('La orden no está pendiente', 409);
      const [items] = await conn.query('SELECT * FROM ap_payment_order_items WHERE order_id = ? ORDER BY source_type, source_id', [order.id]);
      for (const item of items) {
        const doc = await lockedDocument(conn, item.source_type, item.source_id);
        if (!doc || doc.supplierId !== Number(order.supplier_id) || doc.currency !== order.currency_code || doc.number !== String(item.document_number || '') || ['anulada', 'anulado'].includes(doc.status)) throw error('Cambió un documento de la orden', 409);
        const otherReserved = await reservedCents(conn, item.source_type, item.source_id, order.id);
        if (cents(item.amount) > availableCents(doc.totals.balance, otherReserved / 100)) throw error(`Saldo insuficiente en ${item.document_number || item.source_id}`, 409);
      }
      await conn.query(`UPDATE ap_payment_orders SET status = 'aprobada', approved_by = ?, approved_at = NOW() WHERE id = ?`, [req.user.id, order.id]);
      await addEvent(conn, order.id, 'approved', req.user.id);
      await conn.commit();
      res.json(await orderDetail(order.id));
    } catch (e) {
      if (conn) await conn.rollback();
      res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo aprobar la orden' });
    } finally { conn?.release(); }
  });

  router.post('/:id/cancel', async (req, res) => {
    let conn;
    try {
      await ensureUnifiedPaymentOrderSchema();
      if (String(req.user?.role || '').toLowerCase() !== 'admin') throw error('Solo administración puede anular', 403);
      const reason = String(req.body?.reason || '').trim();
      if (!reason) throw error('Indique el motivo de anulación');
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[order]] = await conn.query('SELECT * FROM ap_payment_orders WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!order || order.status === 'anulada') throw error('Orden no disponible', 409);
      if (Number(order.paid_amount) > 0) throw error('La orden tiene pagos y no puede anularse', 409);
      await conn.query(`UPDATE ap_payment_orders SET status = 'anulada', cancelled_by = ?, cancelled_at = NOW(), cancel_reason = ? WHERE id = ?`, [req.user.id, reason, order.id]);
      await addEvent(conn, order.id, 'cancelled', req.user.id, { reason });
      await conn.commit();
      res.json(await orderDetail(order.id));
    } catch (e) {
      if (conn) await conn.rollback();
      res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo anular la orden' });
    } finally { conn?.release(); }
  });

  router.post('/:id/payments', upload.single('receipt'), async (req, res) => {
    let conn;
    let committed = false;
    try {
      await ensureUnifiedPaymentOrderSchema();
      await ensureSupplierCreditNoteTables();
      if (!req.file) throw error('Adjunte el comprobante de pago (PDF o imagen)');
      const requestId = String(req.body?.request_id || '').trim();
      const date = String(req.body?.payment_date || '');
      const method = String(req.body?.method || '').trim();
      const account = String(req.body?.company_account || '').trim();
      const reference = String(req.body?.reference_number || '').trim();
      const allocations = JSON.parse(req.body?.allocations || '[]');
      if (!/^[\w-]{12,64}$/.test(requestId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !method || !account || !Array.isArray(allocations) || !allocations.length) throw error('Complete fecha, método, cuenta e importes');
      if (method.toLowerCase() === 'transferencia' && !reference) throw error('Indique la referencia bancaria');
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[previous]] = await conn.query('SELECT id, order_id FROM ap_payment_order_payments WHERE request_id = ?', [requestId]);
      if (previous) {
        await conn.rollback();
        return res.json(await orderDetail(previous.order_id));
      }
      const [[order]] = await conn.query('SELECT * FROM ap_payment_orders WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!order || !['aprobada', 'pago_parcial'].includes(order.status)) throw error('La orden debe estar aprobada', 409);
      if (method.toLowerCase() === 'transferencia' && !order.beneficiary_account) throw error('Falta la cuenta bancaria del proveedor. Cárguela y regenere esta orden antes de transferir', 409);
      const [items] = await conn.query(`SELECT i.*, COALESCE((SELECT SUM(a.amount) FROM ap_payment_order_allocations a WHERE a.item_id = i.id), 0) AS paid
        FROM ap_payment_order_items i WHERE i.order_id = ? ORDER BY i.source_type, i.source_id`, [order.id]);
      const byId = new Map(items.map((item) => [Number(item.id), item]));
      const seen = new Set();
      let total = 0;
      const resolved = [];
      for (const allocation of allocations) {
        const itemId = Number(allocation.item_id);
        const amount = cents(allocation.amount);
        const item = byId.get(itemId);
        if (!item || seen.has(itemId) || !Number.isSafeInteger(amount) || amount <= 0) throw error('Distribución inválida');
        seen.add(itemId);
        const doc = await lockedDocument(conn, item.source_type, item.source_id);
        if (!doc || ['anulada', 'anulado'].includes(doc.status) || doc.supplierId !== Number(order.supplier_id) || doc.currency !== order.currency_code || doc.number !== String(item.document_number || '')) {
          throw error('El documento ya no coincide con el proveedor o la moneda de la orden', 409);
        }
        if (amount > cents(item.amount) - cents(item.paid) || amount > cents(doc.totals.balance)) throw error(`El pago supera el saldo de ${item.document_number}`, 409);
        total += amount;
        resolved.push({ item, amount });
      }
      if (total > cents(order.amount) - cents(order.paid_amount)) throw error('El pago supera el saldo de la orden', 409);
      const [payment] = await conn.query(`INSERT INTO ap_payment_order_payments
        (order_id, request_id, payment_date, method, company_account, reference_number, receipt_path, receipt_name, amount, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [order.id, requestId, date, method, account, reference || null, req.file.path, req.file.originalname, total / 100, req.body?.notes || null, req.user.id]);
      for (const part of resolved) {
        const sourcePaymentId = await createSourcePayment(conn, {
          sourceType: part.item.source_type, sourceId: part.item.source_id, amount: part.amount,
          date, method, account, reference, notes: `OP ${order.order_number}: ${req.body?.notes || ''}`.trim(), userId: req.user.id,
        });
        await conn.query(`INSERT INTO ap_payment_order_allocations (payment_id, item_id, amount, source_payment_id) VALUES (?, ?, ?, ?)`,
        [payment.insertId, part.item.id, part.amount / 100, sourcePaymentId]);
      }
      const paid = cents(order.paid_amount) + total;
      await conn.query(`UPDATE ap_payment_orders SET paid_amount = ?, status = ? WHERE id = ?`,
        [paid / 100, paid >= cents(order.amount) ? 'pagada' : 'pago_parcial', order.id]);
      await addEvent(conn, order.id, 'payment_registered', req.user.id, { payment_id: payment.insertId, amount: total / 100, reference });
      await conn.commit();
      committed = true;
      res.status(201).json(await orderDetail(order.id));
    } catch (e) {
      if (conn && !committed) await conn.rollback();
      if (e.code === 'ER_DUP_ENTRY' && req.body?.request_id) {
        const [[existing]] = await pool.query('SELECT order_id FROM ap_payment_order_payments WHERE request_id = ?', [req.body.request_id]);
        if (existing) return res.json(await orderDetail(existing.order_id));
      }
      console.error('[ap-unified] payment', e);
      res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo registrar el pago' });
    } finally {
      conn?.release();
      if (!committed && req.file) await fs.unlink(req.file.path).catch(() => {});
    }
  });

  router.get('/payments/:paymentId/receipt', async (req, res) => {
    try {
      await ensureUnifiedPaymentOrderSchema();
      const [[row]] = await pool.query('SELECT receipt_path, receipt_name FROM ap_payment_order_payments WHERE id = ?', [req.params.paymentId]);
      if (!row) return res.status(404).json({ error: 'Comprobante no encontrado' });
      res.download(row.receipt_path, row.receipt_name);
    } catch (e) {
      res.status(500).json({ error: 'No se pudo descargar el comprobante' });
    }
  });

  router.patch('/payments/:paymentId/reconciliation', async (req, res) => {
    let conn;
    try {
      await ensureUnifiedPaymentOrderSchema();
      await ensureBankReconciliationSchema();
      const reconciled = req.body?.reconciled === false ? 0 : 1;
      const at = reconciled ? (req.body?.reconciled_at || new Date().toISOString().slice(0, 10)) : null;
      const notes = String(req.body?.notes || '').trim() || null;
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[payment]] = await conn.query('SELECT id, order_id FROM ap_payment_order_payments WHERE id = ? FOR UPDATE', [req.params.paymentId]);
      if (!payment) throw error('Pago no encontrado', 404);
      const [[bankMatch]] = await conn.query('SELECT movement_id FROM bank_payment_matches WHERE payment_id = ?', [payment.id]);
      if (bankMatch) throw error('Este pago está vinculado a un movimiento bancario. Quite la conciliación desde Conciliación bancaria', 409);
      const [items] = await conn.query(`SELECT i.source_type, a.source_payment_id
        FROM ap_payment_order_allocations a JOIN ap_payment_order_items i ON i.id = a.item_id
        WHERE a.payment_id = ?`, [payment.id]);
      for (const item of items) {
        await conn.query(`INSERT INTO accounts_payable_payment_meta
          (source_type, payment_id, reconciled, reconciled_at, reconciled_by, reconciliation_notes, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE reconciled = VALUES(reconciled), reconciled_at = VALUES(reconciled_at),
            reconciled_by = VALUES(reconciled_by), reconciliation_notes = VALUES(reconciliation_notes),
            updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
        [item.source_type, item.source_payment_id, reconciled, at, reconciled ? req.user.id : null, notes, req.user.id]);
      }
      await addEvent(conn, payment.order_id, reconciled ? 'reconciled' : 'reconciliation_removed', req.user.id, { payment_id: payment.id, notes });
      await conn.commit();
      res.json(await orderDetail(payment.order_id));
    } catch (e) {
      if (conn) await conn.rollback();
      console.error('[ap-unified] reconcile', e);
      res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo conciliar el pago' });
    } finally { conn?.release(); }
  });
  return router;
}
