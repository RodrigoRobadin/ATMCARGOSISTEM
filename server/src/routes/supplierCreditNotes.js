import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';
import {
  ensureSupplierCreditNoteTables,
  getSupplierCreditSummary,
  getSupplierSourceDocument,
  normalizeSupplierCreditSourceType,
  recalculateSupplierDocument,
} from '../services/supplierCreditNotes.js';

const router = Router();

const attachmentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.resolve('uploads', 'supplier-credit-notes', String(req.params.id || 'pending'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeName = String(file.originalname || 'documento')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-160);
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({ storage: attachmentStorage });


function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value) {
  return String(value || 'PYG').trim().toUpperCase() || 'PYG';
}

function normalizeItems(rawItems, fallback = {}) {
  const rows = Array.isArray(rawItems) ? rawItems : [];
  const source = rows.length
    ? rows
    : [{
        description: fallback.description || 'Nota de credito del proveedor',
        quantity: 1,
        unit_price: fallback.amount_total,
        subtotal: fallback.amount_total,
        tax_rate: fallback.tax_rate,
        expense_rubro: fallback.expense_rubro,
      }];
  return source.map((item, index) => {
    const quantity = Math.max(0, number(item.quantity || 1));
    const unitPrice = Math.max(0, number(item.unit_price));
    const subtotal = Math.max(0, number(item.subtotal || quantity * unitPrice));
    return {
      description: String(item.description || `Item ${index + 1}`).trim() || `Item ${index + 1}`,
      quantity,
      unit_price: unitPrice,
      subtotal: Number(subtotal.toFixed(2)),
      tax_rate: [0, 5, 10].includes(Number(item.tax_rate)) ? Number(item.tax_rate) : 10,
      expense_rubro: String(item.expense_rubro || fallback.expense_rubro || 'SIN CLASIFICAR').trim().toUpperCase(),
      source_item_id: Number(item.source_item_id || 0) || null,
      item_order: index,
    };
  });
}

function calculateTaxes(items) {
  const totals = {
    gravado_10: 0,
    gravado_5: 0,
    iva_10: 0,
    iva_5: 0,
    iva_exempt: 0,
    iva_no_taxed: 0,
    amount_total: 0,
  };
  for (const item of items) {
    const amount = number(item.subtotal);
    totals.amount_total += amount;
    if (Number(item.tax_rate) === 10) {
      totals.gravado_10 += amount;
      totals.iva_10 += amount / 11;
    } else if (Number(item.tax_rate) === 5) {
      totals.gravado_5 += amount;
      totals.iva_5 += amount / 21;
    } else {
      totals.iva_exempt += amount;
    }
  }
  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, Number(value.toFixed(2))])
  );
}

async function insertAudit(conn, creditNoteId, action, userId, previous, current, reason = null) {
  await conn.query(
    `INSERT INTO supplier_credit_note_audit
      (credit_note_id, action, previous_json, current_json, reason, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      creditNoteId,
      action,
      previous ? JSON.stringify(previous) : null,
      current ? JSON.stringify(current) : null,
      reason || null,
      userId || null,
    ]
  );
}

async function fetchDetail(id, conn = pool) {
  const [[note]] = await conn.query(
    `SELECT n.*, creator.name AS created_by_name, canceler.name AS canceled_by_name
       FROM supplier_credit_notes n
       LEFT JOIN users creator ON creator.id = n.created_by
       LEFT JOIN users canceler ON canceler.id = n.canceled_by
      WHERE n.id = ?`,
    [id]
  );
  if (!note) return null;
  const [applications] = await conn.query(
    `SELECT * FROM supplier_credit_note_applications WHERE credit_note_id = ? ORDER BY id`,
    [id]
  );
  const [items] = await conn.query(
    `SELECT * FROM supplier_credit_note_items WHERE credit_note_id = ? ORDER BY item_order, id`,
    [id]
  );
  const [attachments] = await conn.query(
    `SELECT * FROM supplier_credit_note_attachments WHERE credit_note_id = ? ORDER BY id DESC`,
    [id]
  );
  const [audit] = await conn.query(
    `SELECT a.*, u.name AS user_name
       FROM supplier_credit_note_audit a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.credit_note_id = ?
      ORDER BY a.created_at DESC, a.id DESC`,
    [id]
  );
  return { ...note, applications, items, attachments, audit };
}

router.get('/', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensureSupplierCreditNoteTables();
    const where = ['1=1'];
    const params = [];
    const sourceType = req.query.source_type
      ? normalizeSupplierCreditSourceType(req.query.source_type)
      : null;
    if (req.query.source_type && !sourceType) {
      return res.status(400).json({ error: 'Tipo de documento afectado invalido' });
    }
    if (sourceType) {
      where.push('a.source_type = ?');
      params.push(sourceType);
    }
    if (req.query.source_id) {
      where.push('a.source_id = ?');
      params.push(Number(req.query.source_id));
    }
    if (req.query.supplier_id) {
      where.push('n.supplier_id = ?');
      params.push(Number(req.query.supplier_id));
    }
    if (req.query.status) {
      where.push('n.status = ?');
      params.push(String(req.query.status));
    }
    const [rows] = await pool.query(
      `SELECT n.*, a.source_type, a.source_id, a.applied_amount,
              u.name AS created_by_name,
              (SELECT COUNT(*) FROM supplier_credit_note_attachments att WHERE att.credit_note_id = n.id) AS attachment_count
         FROM supplier_credit_notes n
         INNER JOIN supplier_credit_note_applications a ON a.credit_note_id = n.id
         LEFT JOIN users u ON u.id = n.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY n.note_date DESC, n.id DESC`,
      params
    );
    res.json(rows);
  } catch (error) {
    console.error('[supplier-credit-notes] list error', error);
    res.status(500).json({ error: 'No se pudieron cargar las notas de credito de proveedores' });
  }
});

router.get('/source/:sourceType/:sourceId', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensureSupplierCreditNoteTables();
    const sourceType = normalizeSupplierCreditSourceType(req.params.sourceType);
    if (!sourceType) return res.status(400).json({ error: 'Tipo de documento afectado invalido' });
    const document = await getSupplierSourceDocument(sourceType, req.params.sourceId);
    if (!document) return res.status(404).json({ error: 'Factura afectada no encontrada' });
    const [notes] = await pool.query(
      `SELECT n.*, a.applied_amount, a.source_type, a.source_id,
              u.name AS created_by_name,
              (SELECT COUNT(*) FROM supplier_credit_note_attachments att WHERE att.credit_note_id = n.id) AS attachment_count
         FROM supplier_credit_note_applications a
         INNER JOIN supplier_credit_notes n ON n.id = a.credit_note_id
         LEFT JOIN users u ON u.id = n.created_by
        WHERE a.source_type = ? AND a.source_id = ?
        ORDER BY n.note_date DESC, n.id DESC`,
      [sourceType, Number(req.params.sourceId)]
    );
    const summary = await recalculateSupplierDocument(sourceType, req.params.sourceId);
    res.json({ document, summary, notes });
  } catch (error) {
    console.error('[supplier-credit-notes] source detail error', error);
    res.status(500).json({ error: 'No se pudo cargar la factura y sus notas de credito' });
  }
});

router.get('/:id', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensureSupplierCreditNoteTables();
    const detail = await fetchDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: 'Nota de credito no encontrada' });
    res.json(detail);
  } catch (error) {
    console.error('[supplier-credit-notes] detail error', error);
    res.status(500).json({ error: 'No se pudo cargar la nota de credito' });
  }
});

router.post('/', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureSupplierCreditNoteTables();
    const body = req.body || {};
    const sourceType = normalizeSupplierCreditSourceType(body.source_type);
    const sourceId = Number(body.source_id || 0);
    if (!sourceType || !sourceId) {
      return res.status(400).json({ error: 'Factura afectada es requerida' });
    }
    if (!body.note_date || !String(body.receipt_number || '').trim()) {
      return res.status(400).json({ error: 'Fecha y numero de nota de credito son requeridos' });
    }
    if (!String(body.reason || '').trim()) {
      return res.status(400).json({ error: 'Motivo de la nota de credito es requerido' });
    }
    const document = await getSupplierSourceDocument(sourceType, sourceId);
    if (!document || String(document.status || '').toLowerCase() === 'anulada') {
      return res.status(404).json({ error: 'Factura afectada no encontrada o anulada' });
    }
    const noteCurrency = currency(body.currency_code || document.currency_code);
    if (noteCurrency !== currency(document.currency_code)) {
      return res.status(400).json({ error: 'La nota de credito debe tener la misma moneda que la factura afectada' });
    }
    const requestedTotal = number(body.amount_total);
    const items = normalizeItems(body.items, {
      amount_total: requestedTotal,
      tax_rate: body.tax_rate,
      expense_rubro: body.expense_rubro || document.expense_rubro,
      description: body.reason,
    });
    if (items.some((item) => item.quantity <= 0 || item.subtotal <= 0)) {
      return res.status(400).json({ error: 'Todos los items deben tener cantidad e importe mayores a cero' });
    }
    const totals = calculateTaxes(items);
    if (totals.amount_total <= 0) {
      return res.status(400).json({ error: 'El total de la nota de credito debe ser mayor a cero' });
    }
    if (requestedTotal > 0 && Math.abs(requestedTotal - totals.amount_total) > 0.02) {
      return res.status(400).json({ error: 'La suma de items no coincide con el total de la nota de credito' });
    }
    const existingSummary = await getSupplierCreditSummary(sourceType, sourceId);
    const available = Math.max(0, number(document.gross_amount) - existingSummary.credited_amount);
    if (totals.amount_total > available + 0.01) {
      return res.status(400).json({
        error: `La nota de credito supera el importe disponible de la factura (${available.toFixed(2)} ${noteCurrency})`,
      });
    }
    const [[duplicate]] = await pool.query(
      `SELECT id FROM supplier_credit_notes
        WHERE COALESCE(supplier_id, 0) = COALESCE(?, 0)
          AND COALESCE(supplier_ruc, '') = COALESCE(?, '')
          AND COALESCE(timbrado_number, '') = COALESCE(?, '')
          AND receipt_number = ?
          AND status <> 'anulada'
        LIMIT 1`,
      [
        document.supplier_id || null,
        document.supplier_ruc || null,
        String(body.timbrado_number || '').trim() || null,
        String(body.receipt_number).trim(),
      ]
    );
    if (duplicate?.id) {
      return res.status(409).json({ error: 'Esta nota de credito ya fue registrada para el proveedor' });
    }

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO supplier_credit_notes
        (supplier_id, supplier_name, supplier_ruc, note_date, receipt_number, timbrado_number,
         currency_code, reason, notes, gravado_10, gravado_5, iva_10, iva_5,
         iva_exempt, iva_no_taxed, amount_total, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrada', ?)`,
      [
        document.supplier_id || null,
        document.supplier_name || null,
        document.supplier_ruc || null,
        body.note_date,
        String(body.receipt_number).trim(),
        String(body.timbrado_number || '').trim() || null,
        noteCurrency,
        String(body.reason).trim(),
        String(body.notes || '').trim() || null,
        totals.gravado_10,
        totals.gravado_5,
        totals.iva_10,
        totals.iva_5,
        totals.iva_exempt,
        totals.iva_no_taxed,
        totals.amount_total,
        req.user?.id || null,
      ]
    );
    const creditNoteId = result.insertId;
    await conn.query(
      `INSERT INTO supplier_credit_note_applications
        (credit_note_id, source_type, source_id, applied_amount)
       VALUES (?, ?, ?, ?)`,
      [creditNoteId, sourceType, sourceId, totals.amount_total]
    );
    for (const item of items) {
      await conn.query(
        `INSERT INTO supplier_credit_note_items
          (credit_note_id, description, quantity, unit_price, subtotal, tax_rate,
           expense_rubro, source_item_id, item_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          creditNoteId,
          item.description,
          item.quantity,
          item.unit_price,
          item.subtotal,
          item.tax_rate,
          item.expense_rubro,
          item.source_item_id,
          item.item_order,
        ]
      );
    }
    const current = await fetchDetail(creditNoteId, conn);
    await insertAudit(conn, creditNoteId, 'created', req.user?.id, null, current);
    await recalculateSupplierDocument(sourceType, sourceId, conn);
    await conn.commit();
    res.status(201).json(await fetchDetail(creditNoteId));
  } catch (error) {
    await conn.rollback();
    console.error('[supplier-credit-notes] create error', error);
    res.status(500).json({ error: 'No se pudo registrar la nota de credito del proveedor' });
  } finally {
    conn.release();
  }
});

router.post('/:id/attachments', requireAuth, requireAnyRole('admin', 'finanzas'), upload.single('file'), async (req, res) => {
  try {
    await ensureSupplierCreditNoteTables();
    if (!req.file) return res.status(400).json({ error: 'El archivo es requerido' });
    const [[note]] = await pool.query('SELECT id FROM supplier_credit_notes WHERE id = ?', [req.params.id]);
    if (!note) return res.status(404).json({ error: 'Nota de credito no encontrada' });
    const fileUrl = `/uploads/supplier-credit-notes/${req.params.id}/${req.file.filename}`;
    const [result] = await pool.query(
      `INSERT INTO supplier_credit_note_attachments
        (credit_note_id, file_url, file_name, created_by)
       VALUES (?, ?, ?, ?)`,
      [req.params.id, fileUrl, req.file.originalname || null, req.user?.id || null]
    );
    const [[row]] = await pool.query(
      'SELECT * FROM supplier_credit_note_attachments WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (error) {
    console.error('[supplier-credit-notes] attachment error', error);
    res.status(500).json({ error: 'No se pudo adjuntar el comprobante' });
  }
});

router.post('/:id/cancel', requireAuth, requireAnyRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureSupplierCreditNoteTables();
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'El motivo de anulacion es requerido' });
    const previous = await fetchDetail(Number(req.params.id), conn);
    if (!previous) return res.status(404).json({ error: 'Nota de credito no encontrada' });
    if (previous.status === 'anulada') return res.status(409).json({ error: 'La nota de credito ya esta anulada' });
    await conn.beginTransaction();
    await conn.query(
      `UPDATE supplier_credit_notes
          SET status = 'anulada', canceled_by = ?, canceled_at = NOW(), cancel_reason = ?
        WHERE id = ?`,
      [req.user?.id || null, reason, req.params.id]
    );
    const current = await fetchDetail(Number(req.params.id), conn);
    await insertAudit(conn, Number(req.params.id), 'canceled', req.user?.id, previous, current, reason);
    for (const application of previous.applications || []) {
      await recalculateSupplierDocument(application.source_type, application.source_id, conn);
    }
    await conn.commit();
    res.json(await fetchDetail(Number(req.params.id)));
  } catch (error) {
    await conn.rollback();
    console.error('[supplier-credit-notes] cancel error', error);
    res.status(500).json({ error: 'No se pudo anular la nota de credito' });
  } finally {
    conn.release();
  }
});

export default router;

