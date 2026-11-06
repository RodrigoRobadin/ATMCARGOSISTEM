import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { electronicPointFor } from '../services/electronicExpedition.js';
import {
  buildInvoicePayload, buildCreditNotePayload, createFactpyClient, factpyMode, mockScenario, fiscalDateTime,
  canRetryTestDocument, canRetryProductionDuplicate, cancellationResult, canRetryTestCancellation,
} from '../services/factpyClient.js';

const router = Router();
const tables = { invoice: 'invoices', credit_note: 'credit_notes' };
const documentNumberColumns = { invoice: 'invoice_number', credit_note: 'credit_note_number' };

function fiscalError(error, res) {
  console.error('[electronic-invoicing]', error);
  if (!res.headersSent) res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Error de facturación electrónica' });
}

function canSend(req) {
  return ['admin', 'finanzas'].includes(String(req.user?.role || '').toLowerCase());
}

async function modeFor(type, id) {
  try {
    const [[row]] = await pool.query(`SELECT fiscal_mode FROM ${tables[type]} WHERE id = ?`, [id]);
    return row?.fiscal_mode || 'legacy';
  } catch (error) {
    if (error.code === 'ER_BAD_FIELD_ERROR') return 'legacy';
    throw error;
  }
}

async function fiscalRow(type, id, conn = pool) {
  const [[row]] = await conn.query(
    'SELECT * FROM fiscal_documents WHERE document_type = ? AND local_id = ? LIMIT 1', [type, id]
  );
  return row || null;
}

function publicState(row, mode) {
  return {
    fiscal_mode: 'electronic', environment: mode, status: row?.status || 'draft',
    receipt_id: row?.receipt_id || null, document_number: row?.document_number || null,
    cdc: ['approved', 'cancelled'].includes(row?.status) ? row.cdc : null,
    provisional_cdc: row?.cdc && !['approved', 'cancelled'].includes(row?.status) ? row.cdc : null,
    kude_url: row?.status === 'approved' ? row.kude_url : null,
    xml_url: row?.status === 'approved' ? row.xml_url : null,
    message: row?.error_message || null, sent_at: row?.sent_at || null,
    approved_at: row?.approved_at || null, last_checked_at: row?.last_checked_at || null,
  };
}

async function loadDocument(type, id, conn = pool) {
  const table = tables[type];
  const [[row]] = await conn.query(
    type === 'invoice'
      ? `SELECT i.*, bu.key_slug AS business_unit_key,
                o.ruc AS org_ruc, o.name AS org_name, o.razon_social AS org_razon_social,
                o.address AS org_address, o.email AS org_email
           FROM invoices i LEFT JOIN organizations o ON o.id = i.organization_id
           LEFT JOIN deals d ON d.id = i.deal_id
           LEFT JOIN business_units bu ON bu.id = d.business_unit_id
          WHERE i.id = ?`
      : `SELECT n.*, i.organization_id, i.customer_doc, i.customer_address, i.customer_email,
                i.currency_code, i.exchange_rate, i.fiscal_transaction_type,
                i.deal_id, i.service_case_id, i.container_billing_cycle_id,
                bu.key_slug AS business_unit_key,
                o.ruc AS org_ruc, o.name AS org_name, o.razon_social AS org_razon_social,
                o.address AS org_address, o.email AS org_email
           FROM credit_notes n JOIN invoices i ON i.id = n.invoice_id
           LEFT JOIN organizations o ON o.id = i.organization_id
           LEFT JOIN deals d ON d.id = i.deal_id
           LEFT JOIN business_units bu ON bu.id = d.business_unit_id
          WHERE n.id = ?`,
    [id]
  );
  if (!row) throw Object.assign(new Error('Documento no encontrado'), { statusCode: 404 });
  return row;
}

async function validateDocument(type, id) {
  const document = await loadDocument(type, id);
  const itemTable = type === 'invoice' ? 'invoice_items' : 'credit_note_items';
  const fk = type === 'invoice' ? 'invoice_id' : 'credit_note_id';
  const [items] = await pool.query(`SELECT * FROM ${itemTable} WHERE ${fk} = ? ORDER BY item_order, id`, [id]);
  const point = electronicPointFor({
    dealId: document.deal_id, serviceCaseId: document.service_case_id,
    containerBillingCycleId: document.container_billing_cycle_id,
    businessUnitKey: document.business_unit_key,
  });
  const establishment = String(process.env.FACTPY_ESTABLISHMENT || '001').padStart(3, '0');
  const args = { invoice: document, note: document, organization: organizationFrom(document),
    items, number: `${establishment}-${point}-0000001`, receiptId: 'validation-only', securityCode: '000000001' };
  if (type === 'credit_note') {
    const parent = await fiscalRow('invoice', document.invoice_id);
    if (parent?.status !== 'approved') throw Object.assign(new Error('La factura asociada no está aprobada'), { statusCode: 409 });
    args.invoiceCdc = parent.cdc;
    buildCreditNotePayload(args);
  } else {
    buildInvoicePayload(args);
  }
  return { valid: true, item_count: items.length, total_amount: document.total_amount };
}

function organizationFrom(row) {
  return { ruc: row.org_ruc, name: row.org_name, razon_social: row.org_razon_social,
    address: row.org_address, email: row.org_email };
}

async function reserveNumber(conn, type, environment, document) {
  const establishment = String(process.env.FACTPY_ESTABLISHMENT || '001').padStart(3, '0');
  const point = electronicPointFor({
    dealId: document.deal_id, serviceCaseId: document.service_case_id,
    containerBillingCycleId: document.container_billing_cycle_id,
    businessUnitKey: document.business_unit_key,
  });
  if (!/^\d{3}$/.test(establishment) || !/^\d{3}$/.test(point)) {
    throw Object.assign(new Error('Configurá establecimiento y punto FactPy de tres dígitos'), { statusCode: 400 });
  }
  if (environment === 'test' && !process.env.FACTPY_ESTABLISHMENT) {
    throw Object.assign(new Error('Falta configurar el establecimiento de FactPy Test'), { statusCode: 400 });
  }
  const start = Number(process.env[`FACTPY_SEQUENCE_START_${point}`] ||
    (point === '001' ? process.env.FACTPY_SEQUENCE_START : null) || 1);
  if (!Number.isInteger(start) || start < 1 || start > 9999999) {
    throw Object.assign(new Error('Secuencia FactPy inválida'), { statusCode: 400 });
  }
  await conn.query(
    `INSERT INTO fiscal_sequences (environment, document_type, establishment, point, next_number)
     VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE next_number = next_number`,
    [environment, type, establishment, point, start]
  );
  const [[sequence]] = await conn.query(
    `SELECT next_number FROM fiscal_sequences WHERE environment = ? AND document_type = ?
      AND establishment = ? AND point = ? FOR UPDATE`,
    [environment, type, establishment, point]
  );
  if (sequence.next_number > 9999999) throw Object.assign(new Error('Secuencia fiscal agotada'), { statusCode: 409 });
  await conn.query(
    `UPDATE fiscal_sequences SET next_number = next_number + 1 WHERE environment = ?
      AND document_type = ? AND establishment = ? AND point = ?`,
    [environment, type, establishment, point]
  );
  return `${establishment}-${point}-${String(sequence.next_number).padStart(7, '0')}`;
}

async function applyCreditTotals(conn, invoiceId, cancelledBy = null) {
  const [[invoice]] = await conn.query(
    'SELECT id, total_amount, container_billing_cycle_id FROM invoices WHERE id = ? FOR UPDATE', [invoiceId]
  );
  const [[credits]] = await conn.query(
    "SELECT COALESCE(SUM(total_amount), 0) AS amount FROM credit_notes WHERE invoice_id = ? AND status = 'emitida'",
    [invoiceId]
  );
  const [[payments]] = await conn.query(
    `SELECT COALESCE(SUM(COALESCE(ra.amount_applied, r.amount)), 0) AS amount
       FROM receipts r LEFT JOIN receipt_applications ra ON ra.receipt_id = r.id
      WHERE COALESCE(ra.invoice_id, r.invoice_id) = ? AND r.status = 'emitido'`,
    [invoiceId]
  );
  const credited = Number(credits.amount);
  const paid = Number(payments.amount);
  const netTotal = Math.max(0, Number(invoice.total_amount) - credited);
  const balance = Math.max(0, netTotal - paid);
  const status = netTotal <= 0.01 ? 'anulada' : balance <= 0.01 ? 'pagada' : paid > 0 ? 'pago_parcial' : 'emitida';
  await conn.query(
    `UPDATE invoices SET credited_total = ?, net_total_amount = ?, net_balance = ?, balance = ?,
       paid_amount = ?, status = ?, canceled_by_credit_note_id = ? WHERE id = ?`,
    [credited, netTotal, balance, balance, paid, status, status === 'anulada' ? cancelledBy : null, invoiceId]
  );
  if (invoice.container_billing_cycle_id) {
    await conn.query('UPDATE container_billing_cycles SET status = ? WHERE id = ?', [
      status === 'anulada' ? 'pendiente' : status === 'pagada' ? 'cobrado' : 'facturado',
      invoice.container_billing_cycle_id,
    ]);
  }
}

async function issue(type, req, res) {
  if (!canSend(req)) return res.status(403).json({ error: 'Solo admin y finanzas pueden enviar documentos electrónicos' });
  const environment = factpyMode();
  const conn = await pool.getConnection();
  let prepared;
  try {
    await conn.beginTransaction();
    const document = await loadDocument(type, req.params.id, conn);
    const [[locked]] = await conn.query(`SELECT id, status FROM ${tables[type]} WHERE id = ? FOR UPDATE`, [req.params.id]);
    if (locked.status !== 'borrador') throw Object.assign(new Error('Solo se puede enviar un borrador'), { statusCode: 409 });
    if (await fiscalRow(type, document.id, conn)) {
      throw Object.assign(new Error('Este documento ya tiene un envío; consultá su estado antes de continuar'), { statusCode: 409 });
    }
    const number = await reserveNumber(conn, type, environment, document);
    const [establishment, point] = number.split('-');
    await conn.query(`UPDATE ${tables[type]} SET establishment = ?, point_of_issue = ? WHERE id = ?`,
      [establishment, point, document.id]);
    const receiptId = `atm-${environment}-${type}-${document.id}`;
    const securityCode = String(randomInt(0, 1000000000)).padStart(9, '0');
    const itemTable = type === 'invoice' ? 'invoice_items' : 'credit_note_items';
    const fk = type === 'invoice' ? 'invoice_id' : 'credit_note_id';
    const [items] = await conn.query(`SELECT * FROM ${itemTable} WHERE ${fk} = ? ORDER BY item_order, id`, [document.id]);
    let payload;
    if (type === 'invoice') {
      payload = buildInvoicePayload({ invoice: document, organization: organizationFrom(document), items,
        number, receiptId, securityCode });
    } else {
      const parent = await fiscalRow('invoice', document.invoice_id, conn);
      if (!parent || parent.status !== 'approved') {
        throw Object.assign(new Error('La factura electrónica asociada todavía no está aprobada'), { statusCode: 409 });
      }
      payload = buildCreditNotePayload({ invoice: document, note: document, organization: organizationFrom(document),
        items, number, receiptId, securityCode, invoiceCdc: parent.cdc });
    }
    const scenario = environment === 'mock' ? mockScenario(req.body?.mock_scenario) : null;
    await conn.query(
      `INSERT INTO fiscal_documents (document_type, local_id, environment, receipt_id, document_number,
        status, request_json, mock_scenario, attempt_count, sent_at)
       VALUES (?, ?, ?, ?, ?, 'sending', ?, ?, 1, NOW())`,
      [type, document.id, environment, receiptId, number, JSON.stringify(payload), scenario]
    );
    await conn.commit();
    prepared = { id: document.id, receiptId, payload, scenario };
  } catch (error) {
    await conn.rollback().catch(() => {});
    return fiscalError(error, res);
  } finally {
    conn.release();
  }

  return res.status(202).json(await deliver(type, prepared, environment));
}

async function deliver(type, prepared, environment) {
  try {
    const client = createFactpyClient(environment);
    const response = await client.send(prepared.payload, prepared.scenario);
    if (response?.status !== true && response?.status !== false) {
      throw new Error('FactPy no devolvió una aceptación o rechazo inequívoco');
    }
    const links = client.links(response);
    await pool.query(
      `UPDATE fiscal_documents SET status = ?, error_message = ?, cdc = ?, kude_url = ?, xml_url = ?
       WHERE document_type = ? AND local_id = ? AND status = 'sending'`,
      [response?.status === false ? 'rejected' : 'processing',
        response?.status === false ? String(response?.code || 'FactPy rechazó el envío').slice(0, 500) : null,
        /^\d{44}$/.test(String(response?.cdc || '')) ? response.cdc : null,
        links.kude, links.xml, type, prepared.id]
    );
  } catch (error) {
    await pool.query(
      `UPDATE fiscal_documents SET status = 'review', error_message = ?
       WHERE document_type = ? AND local_id = ? AND status = 'sending'`,
      [String(error.message || 'Resultado incierto').slice(0, 500), type, prepared.id]
    );
  }
  return publicState(await fiscalRow(type, prepared.id), environment);
}

async function retry(type, req, res) {
  if (!canSend(req)) return res.status(403).json({ error: 'Sin permiso para reintentar el envío' });
  const environment = factpyMode();
  const productionReceiptId = process.env.FACTPY_PRODUCTION_RETRY_RECEIPT_ID || '';
  if (environment !== 'test' && environment !== 'production') {
    return res.status(409).json({ error: 'El reintento fiscal no está habilitado' });
  }
  if (req.body?.confirm_same_document !== true) {
    return res.status(400).json({ error: 'Confirmá expresamente el reenvío del mismo documento fiscal' });
  }
  const document = await fiscalRow(type, req.params.id);
  const eligible = environment === 'test'
    ? canRetryTestDocument(document)
    : canRetryProductionDuplicate(document, productionReceiptId);
  if (!document || document.environment !== environment || !eligible ||
      (environment === 'production' && (type !== 'invoice' || req.body?.confirm_factpy_absent !== true))) {
    return res.status(409).json({ error: 'Este documento no está autorizado para reintento fiscal' });
  }
  let checked;
  try {
    checked = await createFactpyClient(environment).check(document.receipt_id);
  } catch (error) {
    return fiscalError(error, res);
  }
  const previouslyRejectedDuplicate = environment === 'production' && checked.state === 'rejected' &&
    /documento electr[oó]nico duplicado/i.test(String(checked.message || ''));
  if (!checked.notFound && !previouslyRejectedDuplicate) {
    return res.status(409).json({ error: `${checked.message || 'FactPy no confirmó que el documento esté ausente'}. No se reenviará.` });
  }

  const conn = await pool.getConnection();
  let prepared;
  try {
    await conn.beginTransaction();
    const [[current]] = await conn.query('SELECT * FROM fiscal_documents WHERE id = ? FOR UPDATE', [document.id]);
    const [[local]] = await conn.query(`SELECT status FROM ${tables[type]} WHERE id = ? FOR UPDATE`, [document.local_id]);
    const stillEligible = environment === 'test'
      ? canRetryTestDocument(current)
      : canRetryProductionDuplicate(current, productionReceiptId);
    if (!stillEligible || local?.status !== 'borrador') {
      throw Object.assign(new Error('El documento cambió de estado; consultá nuevamente'), { statusCode: 409 });
    }
    const payload = JSON.parse(current.request_json || 'null');
    const number = `${payload?.establecimiento}-${payload?.punto}-${payload?.numero}`;
    if (!payload || payload.receiptid !== current.receipt_id || number !== current.document_number) {
      throw Object.assign(new Error('El envío guardado no coincide con el número reservado'), { statusCode: 409 });
    }
    if (String(payload.fecha || '').slice(0, 10) !== fiscalDateTime().slice(0, 10)) {
      throw Object.assign(new Error('La fecha fiscal guardada ya no es de hoy; requiere revisión manual'), { statusCode: 409 });
    }
    await conn.query(
      "UPDATE fiscal_documents SET status = 'sending', error_message = NULL, attempt_count = attempt_count + 1 WHERE id = ?",
      [current.id]
    );
    await conn.commit();
    prepared = { id: current.local_id, payload, scenario: current.mock_scenario };
  } catch (error) {
    await conn.rollback().catch(() => {});
    return fiscalError(error, res);
  } finally {
    conn.release();
  }
  return res.status(202).json(await deliver(type, prepared, environment));
}

async function refresh(type, req, res) {
  if (!canSend(req)) return res.status(403).json({ error: 'Sin permiso para consultar FactPy' });
  const document = await fiscalRow(type, req.params.id);
  if (!document) return res.status(404).json({ error: 'Todavía no se envió este documento' });
  if (['approved', 'rejected', 'cancelled'].includes(document.status)) {
    return res.json(publicState(document, document.environment));
  }
  let state;
  try {
    state = await createFactpyClient(document.environment).check(
      document.receipt_id, document.mock_scenario, Number(document.check_count || 0)
    );
  } catch (error) {
    state = { state: 'review', message: String(error.message || 'Consulta fallida') };
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[current]] = await conn.query(
      'SELECT * FROM fiscal_documents WHERE id = ? FOR UPDATE', [document.id]
    );
    if (['approved', 'rejected', 'cancelled'].includes(current.status)) {
      await conn.commit();
      return res.json(publicState(current, current.environment));
    }
    if (state.state === 'approved') {
      if (!/^\d{44}$/.test(String(state.cdc || ''))) {
        state = { state: 'review', message: 'Aprobación sin CDC válido' };
      } else if (state.number && state.number !== current.document_number) {
        state = { state: 'review', message: 'El número aprobado no coincide con el reservado' };
      }
    }
    if (state.notFound && current.cdc) {
      state = {
        state: 'review',
        message: `FactPy devolvió un CDC al enviar, pero no encuentra el receiptid al consultar. Verificá el CDC en FactPy ${document.environment === 'production' ? 'Producción' : 'Test'}; no se reenviará.`,
      };
    }
    await conn.query(
      `UPDATE fiscal_documents SET status = ?, cdc = COALESCE(?, cdc), error_message = ?,
         check_count = check_count + 1, last_checked_at = NOW(),
         approved_at = IF(? = 'approved', NOW(), approved_at) WHERE id = ?`,
      [state.state, state.state === 'approved' ? state.cdc : null,
        state.message || null, state.state, current.id]
    );
    if (state.state === 'approved') {
      await conn.query(
        `UPDATE ${tables[type]} SET status = 'emitida', ${documentNumberColumns[type]} = ?,
          establishment = ?, point_of_issue = ?, issue_date = DATE(?), issued_by = ? WHERE id = ?`,
        [current.document_number, ...current.document_number.split('-').slice(0, 2),
          current.sent_at, req.user.id, current.local_id]
      );
      if (type === 'credit_note') {
        const [[note]] = await conn.query('SELECT invoice_id FROM credit_notes WHERE id = ?', [current.local_id]);
        await applyCreditTotals(conn, note.invoice_id, current.local_id);
      } else {
        const [[invoice]] = await conn.query('SELECT container_billing_cycle_id FROM invoices WHERE id = ?', [current.local_id]);
        if (invoice?.container_billing_cycle_id) {
          await conn.query(
            "UPDATE container_billing_cycles SET status = 'facturado', invoice_id = ?, invoiced_at = NOW(), invoiced_by = ? WHERE id = ?",
            [current.local_id, req.user.id, invoice.container_billing_cycle_id]
          );
        }
      }
    }
    await conn.commit();
    return res.json(publicState(await fiscalRow(type, req.params.id), document.environment));
  } catch (error) {
    await conn.rollback().catch(() => {});
    return fiscalError(error, res);
  } finally {
    conn.release();
  }
}

async function cancellationDocument(type, id) {
  const document = await fiscalRow(type, id);
  if (!document || document.status !== 'approved') {
    throw Object.assign(new Error('Solo se puede cancelar un documento aprobado'), { statusCode: 409 });
  }
  if (Date.now() - new Date(document.approved_at).getTime() > 48 * 60 * 60 * 1000) {
    throw Object.assign(new Error('Fuera del plazo de 48 horas; usá una nota de crédito'), { statusCode: 409 });
  }
  if (type === 'invoice') {
    const [[receipts]] = await pool.query(`SELECT COUNT(*) AS count FROM receipts r
      LEFT JOIN receipt_applications ra ON ra.receipt_id = r.id
      WHERE COALESCE(ra.invoice_id, r.invoice_id) = ? AND r.status = 'emitido'`, [id]);
    const [[notes]] = await pool.query("SELECT COUNT(*) AS count FROM credit_notes WHERE invoice_id = ? AND status <> 'anulada'", [id]);
    if (receipts.count || notes.count) {
      throw Object.assign(new Error('La factura tiene cobros o notas vinculadas'), { statusCode: 409 });
    }
  }
  return document;
}

async function sendCancellation(type, req, res, document, eventId, reason) {
  let response;
  try {
    response = await createFactpyClient(document.environment).cancel(document.cdc, reason);
  } catch (error) {
    const message = String(error.message || 'Resultado incierto').slice(0, 500);
    await pool.query("UPDATE fiscal_events SET status = 'review', message = ? WHERE id = ?", [message, eventId]);
    return res.status(202).json({ ok: true, status: 'review', message });
  }
  try {
    const message = String(response?.code || '').slice(0, 500);
    const outcome = cancellationResult(response);
    if (outcome === 'rejected') {
      await pool.query("UPDATE fiscal_events SET status = 'rejected', message = ?, checked_at = NOW() WHERE id = ?", [
        message, eventId,
      ]);
      return res.json({ ok: false, status: 'rejected', message });
    }
    if (outcome === 'review') {
      await pool.query("UPDATE fiscal_events SET status = 'review', message = ?, checked_at = NOW() WHERE id = ?", [
        message || 'FactPy devolvió una respuesta sin resultado definitivo', eventId,
      ]);
      return res.status(202).json({ ok: true, status: 'review',
        message: message || 'FactPy devolvió una respuesta sin resultado definitivo' });
    }
    // FactPy confirmed the fiscal event; retain that confirmation if local reconciliation fails.
    await pool.query("UPDATE fiscal_events SET status = 'confirmed', message = ?, checked_at = NOW() WHERE id = ?", [
      message, eventId,
    ]);
    await finalizeCancellation(type, req.params.id, document.id, eventId);
    return res.json({ ok: true, status: 'approved' });
  } catch (error) {
    return fiscalError(error, res);
  }
}

async function cancel(type, req, res) {
  if (!canSend(req)) return res.status(403).json({ error: 'Sin permiso para cancelar documentos electrónicos' });
  if (factpyMode() === 'production' && process.env.FACTPY_PRODUCTION_CANCELLATION_ENABLED !== '1') {
    return res.status(503).json({ error: 'La cancelación fiscal en Producción todavía no está habilitada; utilizá una nota de crédito.' });
  }
  const reason = String(req.body?.reason || '').trim();
  if (!reason || reason.length > 255) return res.status(400).json({ error: 'Ingresá un motivo de hasta 255 caracteres' });
  const document = await cancellationDocument(type, req.params.id);
  let result;
  try {
    [result] = await pool.query(
      `INSERT INTO fiscal_events (fiscal_document_id, event_type, status, reason, submitted_at)
       VALUES (?, 'cancel', 'sending', ?, NOW())`, [document.id, reason]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un evento de cancelación; consultá su estado' });
    throw error;
  }
  return sendCancellation(type, req, res, document, result.insertId, reason);
}

async function retryCancellation(type, req, res) {
  if (!canSend(req)) return res.status(403).json({ error: 'Sin permiso para reintentar la cancelación' });
  if (factpyMode() !== 'test' || req.body?.confirm_factpy_active !== true) {
    return res.status(409).json({ error: 'El reintento requiere FactPy Test y confirmar que el documento sigue vigente en FactPy' });
  }
  const document = await cancellationDocument(type, req.params.id);
  if (document.environment !== 'test') return res.status(409).json({ error: 'Solo disponible para documentos Test' });
  const conn = await pool.getConnection();
  let event;
  try {
    await conn.beginTransaction();
    [[event]] = await conn.query(
      "SELECT * FROM fiscal_events WHERE fiscal_document_id = ? AND event_type = 'cancel' FOR UPDATE", [document.id]
    );
    if (!canRetryTestCancellation(event) || !event.reason) {
      throw Object.assign(new Error('El evento no admite reintento; verificá su estado en FactPy'), { statusCode: 409 });
    }
    await conn.query(
      "UPDATE fiscal_events SET status = 'sending', message = NULL, submitted_at = NOW() WHERE id = ?", [event.id]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
  return sendCancellation(type, req, res, document, event.id, event.reason);
}

async function finalizeCancellation(type, localId, fiscalId, eventId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[event]] = await conn.query('SELECT status FROM fiscal_events WHERE id = ? FOR UPDATE', [eventId]);
    if (event?.status === 'approved') {
      await conn.commit();
      return;
    }
    if (event?.status !== 'confirmed') throw Object.assign(new Error('La cancelación no está confirmada por FactPy'), { statusCode: 409 });
    await conn.query("UPDATE fiscal_events SET status = 'approved', approved_at = NOW() WHERE id = ?", [eventId]);
    await conn.query("UPDATE fiscal_documents SET status = 'cancelled' WHERE id = ?", [fiscalId]);
    await conn.query(`UPDATE ${tables[type]} SET status = 'anulada' WHERE id = ?`, [localId]);
    if (type === 'credit_note') {
      const [[note]] = await conn.query('SELECT invoice_id FROM credit_notes WHERE id = ?', [localId]);
      await applyCreditTotals(conn, note.invoice_id);
    } else {
      await conn.query('UPDATE invoices SET balance = 0, net_balance = 0 WHERE id = ?', [localId]);
      const [[invoice]] = await conn.query('SELECT container_billing_cycle_id FROM invoices WHERE id = ?', [localId]);
      if (invoice?.container_billing_cycle_id) {
        await conn.query(
          "UPDATE container_billing_cycles SET status = 'pendiente', invoice_id = NULL, invoiced_at = NULL, invoiced_by = NULL WHERE id = ?",
          [invoice.container_billing_cycle_id]
        );
      }
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

async function refreshCancellation(type, req, res) {
  if (!canSend(req)) return res.status(403).json({ error: 'Sin permiso' });
  const document = await fiscalRow(type, req.params.id);
  if (!document) return res.status(404).json({ error: 'Documento fiscal no encontrado' });
  const [[event]] = await pool.query(
    "SELECT * FROM fiscal_events WHERE fiscal_document_id = ? AND event_type = 'cancel'", [document.id]
  );
  if (!event) return res.status(404).json({ error: 'No hay cancelación pendiente' });
  if (event.status === 'confirmed') {
    await finalizeCancellation(type, req.params.id, document.id, event.id);
    return res.json({ status: 'approved' });
  }
  return res.json({ status: event.status, message: event.message });
}

router.get('/electronic-config', requireAuth, (_req, res) => {
  res.json({ enabled: Boolean(factpyMode()), environment: factpyMode() });
});

for (const [prefix, type] of [['', 'invoice'], ['/credit-notes', 'credit_note']]) {
  router.get(`${prefix}/:id/fiscal-validation`, requireAuth, async (req, res) => {
    if (!canSend(req)) return res.status(403).json({ error: 'Sin permiso' });
    try {
      if (await modeFor(type, req.params.id) !== 'electronic') return res.status(404).json({ error: 'Documento autoimpreso' });
      return res.json(await validateDocument(type, req.params.id));
    } catch (error) {
      if (error.statusCode === 400 || error.statusCode === 409) return res.json({ valid: false, errors: [error.message] });
      return fiscalError(error, res);
    }
  });
  router.get(`${prefix}/:id/fiscal-status`, requireAuth, async (req, res) => {
    if (!canSend(req)) return res.status(403).json({ error: 'Sin permiso para consultar el estado fiscal' });
    try {
      if (await modeFor(type, req.params.id) !== 'electronic') return res.status(404).json({ error: 'Documento autoimpreso' });
      const row = await fiscalRow(type, req.params.id);
      const [[event]] = row ? await pool.query(
        "SELECT status, message FROM fiscal_events WHERE fiscal_document_id = ? AND event_type = 'cancel'", [row.id]
      ) : [[]];
      const retryAvailable = type === 'invoice' && factpyMode() === 'production' &&
        canRetryProductionDuplicate(row, process.env.FACTPY_PRODUCTION_RETRY_RECEIPT_ID || '');
      return res.json({ ...publicState(row, factpyMode()), cancellation: event || null,
        production_retry_available: retryAvailable });
    } catch (error) { return fiscalError(error, res); }
  });
  router.post(`${prefix}/:id/fiscal-status/refresh`, requireAuth, async (req, res) => {
    try { return await refresh(type, req, res); } catch (error) { return fiscalError(error, res); }
  });
  router.post(`${prefix}/:id/fiscal-retry`, requireAuth, async (req, res) => {
    try {
      if (await modeFor(type, req.params.id) !== 'electronic') return res.status(404).json({ error: 'Documento autoimpreso' });
      if (!factpyMode()) return res.status(503).json({ error: 'FactPy está deshabilitado' });
      return await retry(type, req, res);
    } catch (error) { return fiscalError(error, res); }
  });
  router.post(`${prefix}/:id/fiscal-cancel/refresh`, requireAuth, async (req, res) => {
    try { return await refreshCancellation(type, req, res); } catch (error) { return fiscalError(error, res); }
  });
  router.post(`${prefix}/:id/fiscal-cancel/retry`, requireAuth, async (req, res) => {
    try { return await retryCancellation(type, req, res); } catch (error) { return fiscalError(error, res); }
  });
  router.post(`${prefix}/:id/issue`, requireAuth, async (req, res, next) => {
    try {
      if (await modeFor(type, req.params.id) !== 'electronic') return next();
      if (!factpyMode()) return res.status(503).json({ error: 'FactPy está deshabilitado' });
      return issue(type, req, res);
    } catch (error) { return fiscalError(error, res); }
  });
  router.post(`${prefix}/:id/cancel`, requireAuth, async (req, res, next) => {
    try {
      if (await modeFor(type, req.params.id) !== 'electronic') return next();
      if (!factpyMode()) return res.status(503).json({ error: 'FactPy está deshabilitado' });
      return cancel(type, req, res);
    } catch (error) { return fiscalError(error, res); }
  });
  router.get(`${prefix}/:id/pdf`, requireAuth, async (req, res, next) => {
    try {
      if (await modeFor(type, req.params.id) !== 'electronic') return next();
      return res.status(409).json({ error: 'Usá el KuDE del documento electrónico aprobado' });
    } catch (error) { return fiscalError(error, res); }
  });
}

router.post('/:id/receipts', requireAuth, async (req, res, next) => {
  try {
    if (await modeFor('invoice', req.params.id) !== 'electronic') return next();
    const row = await fiscalRow('invoice', req.params.id);
    if (row?.status !== 'approved') return res.status(409).json({ error: 'Esperá la aprobación fiscal antes de registrar cobros' });
    return next();
  } catch (error) { return fiscalError(error, res); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (await modeFor('invoice', req.params.id) !== 'electronic') return next();
    return res.status(409).json({ error: 'Los documentos electrónicos no se eliminan localmente' });
  } catch (error) { return fiscalError(error, res); }
});

export default router;
