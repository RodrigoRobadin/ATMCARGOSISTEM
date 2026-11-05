import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';
import { createFactpyClient, factpyMode } from '../services/factpyClient.js';
import { buildFactpyReceipt, validateFactpyReceiptCurrency } from '../services/factpyReceipt.js';
import { receiptExpeditionForInvoices } from '../services/receiptExpedition.js';

const router = Router();

export async function ensureFactpyReceiptSchema(conn = pool) {
  await conn.query(`CREATE TABLE IF NOT EXISTS receipt_factpy_sequences (
    environment VARCHAR(12) NOT NULL, establishment CHAR(3) NOT NULL, point CHAR(3) NOT NULL,
    next_number INT NOT NULL, PRIMARY KEY (environment, establishment, point)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await conn.query(`CREATE TABLE IF NOT EXISTS receipt_factpy_submissions (
    id INT AUTO_INCREMENT PRIMARY KEY, receipt_id INT NOT NULL, environment VARCHAR(12) NOT NULL,
    receiptid VARCHAR(100) NOT NULL, document_number VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL, payload_json JSON NOT NULL, response_json JSON NULL,
    error_message VARCHAR(500) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_receipt_factpy_receipt (receipt_id), UNIQUE KEY uq_receipt_factpy_receiptid (receiptid),
    UNIQUE KEY uq_receipt_factpy_number (environment, document_number)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

export async function markStaleFactpyReceipts(conn = pool) {
  await conn.query(`UPDATE receipt_factpy_submissions
    SET status = 'review', error_message = 'El envío se interrumpió antes de confirmar el resultado. Verificá este recibo en FactPy antes de intentar cualquier acción.'
    WHERE status = 'sending' AND updated_at < NOW() - INTERVAL 2 MINUTE`);
}

function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}

function assertReceiptSendingEnabled() {
  fail('Los recibos se emiten solo en el CRM. El envío a FactPy está suspendido hasta que admita recibos en USD.', 409);
}

function settings(mode, invoices) {
  const { establishment, point } = receiptExpeditionForInvoices(invoices);
  const start = Number(process.env[`FACTPY_RECEIPT_SEQUENCE_START_${point}`] || (mode === 'mock' ? 1 : NaN));
  if (!Number.isSafeInteger(start) || start < 1 || start > 9999999) {
    fail(`Configurá FACTPY_RECEIPT_SEQUENCE_START_${point} con el primer número libre de recibo en FactPy Test`, 409);
  }
  return { establishment, point, start };
}

export function validateFactpyReceiptConfig(invoices) {
  const mode = factpyMode();
  if (!mode) fail('FactPy no está habilitado en este entorno', 503);
  createFactpyClient(mode);
  return settings(mode, invoices);
}

async function receiptData(conn, id) {
  const [[receipt]] = await conn.query('SELECT * FROM receipts WHERE id = ? FOR UPDATE', [id]);
  if (!receipt) fail('Recibo no encontrado', 404);
  const [invoices] = await conn.query(`SELECT i.id, i.invoice_number, i.total_amount, i.due_date,
      i.currency_code, i.exchange_rate, i.customer_doc, i.customer_email, i.fiscal_mode,
      o.ruc AS org_ruc, o.name AS org_name, o.razon_social AS org_razon_social, o.email AS org_email,
      fd.status AS fiscal_status, ra.amount_applied
    FROM receipt_applications ra JOIN invoices i ON i.id = ra.invoice_id
    LEFT JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN fiscal_documents fd ON fd.document_type = 'invoice' AND fd.local_id = i.id
    WHERE ra.receipt_id = ? ORDER BY ra.id`, [id]);
  return { receipt, invoices };
}

function publicRow(row, mode) {
  return row ? {
    environment: row.environment, status: row.status, receiptid: row.receiptid,
    document_number: row.document_number, message: row.error_message,
    response: row.response_json ? (typeof row.response_json === 'string' ? JSON.parse(row.response_json) : row.response_json) : null,
  } : { environment: mode, status: 'not_sent' };
}

router.get('/receipts/:id/factpy', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    if (!factpyMode()) fail('FactPy no está habilitado en este entorno', 503);
    await ensureFactpyReceiptSchema();
    await markStaleFactpyReceipts();
    const [[receipt]] = await pool.query('SELECT id FROM receipts WHERE id = ?', [req.params.id]);
    if (!receipt) fail('Recibo no encontrado', 404);
    const [[row]] = await pool.query('SELECT * FROM receipt_factpy_submissions WHERE receipt_id = ?', [req.params.id]);
    res.json(publicRow(row, factpyMode()));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'No se pudo consultar FactPy' });
  }
});

router.post('/receipts/:id/factpy/preview', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  let conn;
  try {
    assertReceiptSendingEnabled();
    const mode = factpyMode();
    if (!mode) fail('FactPy no está habilitado en este entorno', 503);
    await ensureFactpyReceiptSchema();
    conn = await pool.getConnection();
    const { receipt, invoices } = await receiptData(conn, req.params.id);
    const { establishment, point } = settings(mode, invoices);
    const [[existing]] = await conn.query('SELECT * FROM receipt_factpy_submissions WHERE receipt_id = ?', [receipt.id]);
    const payload = existing ? JSON.parse(existing.payload_json) : buildFactpyReceipt({
      receipt, invoices, number: `${establishment}-${point}-0000001`,
      receiptId: `atm-${mode}-receipt-${receipt.id}`, securityCode: '000000001',
      exchangeRate: req.body?.exchange_rate,
    });
    res.json({ payload, reserved: Boolean(existing), status: existing?.status || 'not_sent' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'No se pudo preparar el recibo' });
  } finally { conn?.release(); }
});

export async function submitFactpyReceipt(id, { exchangeRate, scenario } = {}) {
  let conn;
  let prepared;
  try {
    assertReceiptSendingEnabled();
    const mode = factpyMode();
    if (!mode) fail('FactPy no está habilitado en este entorno', 503);
    const client = createFactpyClient(mode);
    await ensureFactpyReceiptSchema();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const { receipt, invoices } = await receiptData(conn, id);
    const { establishment, point, start } = settings(mode, invoices);
    const [[existing]] = await conn.query('SELECT id FROM receipt_factpy_submissions WHERE receipt_id = ?', [receipt.id]);
    if (existing) fail('Este recibo ya tiene un envío FactPy; no se reenviará', 409);
    await conn.query(`INSERT INTO receipt_factpy_sequences (environment, establishment, point, next_number)
      VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE next_number = next_number`, [mode, establishment, point, start]);
    const [[sequence]] = await conn.query(`SELECT next_number FROM receipt_factpy_sequences
      WHERE environment = ? AND establishment = ? AND point = ? FOR UPDATE`, [mode, establishment, point]);
    if (sequence.next_number > 9999999) fail('Numeración de recibos agotada', 409);
    const number = `${establishment}-${point}-${String(sequence.next_number).padStart(7, '0')}`;
    const receiptId = `atm-${mode}-receipt-${receipt.id}`;
    const payload = buildFactpyReceipt({ receipt, invoices, number, receiptId,
      securityCode: String(randomInt(0, 1_000_000_000)).padStart(9, '0'),
      exchangeRate });
    validateFactpyReceiptCurrency(mode, payload);
    await conn.query(`UPDATE receipt_factpy_sequences SET next_number = next_number + 1
      WHERE environment = ? AND establishment = ? AND point = ?`, [mode, establishment, point]);
    await conn.query(`INSERT INTO receipt_factpy_submissions
      (receipt_id, environment, receiptid, document_number, status, payload_json)
      VALUES (?, ?, ?, ?, 'sending', ?)`, [receipt.id, mode, receiptId, number, JSON.stringify(payload)]);
    await conn.commit();
    prepared = { receiptId, payload, mode, client };
  } catch (error) {
    if (conn) await conn.rollback();
    throw error;
  } finally { conn?.release(); }

  return sendPreparedReceipt(prepared, scenario);
}

async function sendPreparedReceipt(prepared, scenario) {
  try {
    const response = prepared.mode === 'mock' && scenario === 'rejected'
      ? { status: false, code: 'Recibo rechazado (simulado)' }
      : await prepared.client.send(prepared.payload,
        prepared.mode === 'mock' ? scenario : undefined);
    const status = response?.status === true ? 'accepted' : response?.status === false ? 'rejected' : 'review';
    await pool.query(`UPDATE receipt_factpy_submissions SET status = ?, response_json = ?, error_message = ?
      WHERE receiptid = ? AND status = 'sending'`,
    [status, JSON.stringify(response), status === 'accepted' ? null : String(response?.code || 'Respuesta incierta').slice(0, 500), prepared.receiptId]);
  } catch (error) {
    await pool.query(`UPDATE receipt_factpy_submissions SET status = 'review', error_message = ?
      WHERE receiptid = ? AND status = 'sending'`, [String(error.message || error).slice(0, 500), prepared.receiptId]);
  }
  const [[row]] = await pool.query('SELECT * FROM receipt_factpy_submissions WHERE receiptid = ?', [prepared.receiptId]);
  return publicRow(row, prepared.mode);
}

router.post('/receipts/:id/factpy/retry', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    assertReceiptSendingEnabled();
    if (req.body?.confirm_not_found !== true) fail('Confirmá que el recibo no existe en FactPy antes de reintentar');
    const mode = factpyMode();
    if (!mode) fail('FactPy no está habilitado en este entorno', 503);
    const client = createFactpyClient(mode);
    await ensureFactpyReceiptSchema();
    await markStaleFactpyReceipts();
    const [[row]] = await pool.query(`SELECT s.*, r.status AS receipt_status
      FROM receipt_factpy_submissions s JOIN receipts r ON r.id = s.receipt_id
      WHERE s.receipt_id = ?`, [req.params.id]);
    if (!row) fail('No hay un envío previo para este recibo', 404);
    if (row.environment !== mode || row.status !== 'review' || row.receipt_status !== 'emitido') {
      fail('El recibo no está disponible para reintento en este ambiente', 409);
    }
    const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
    validateFactpyReceiptCurrency(mode, payload);
    const [claim] = await pool.query(`UPDATE receipt_factpy_submissions
      SET status = 'sending', error_message = NULL WHERE id = ? AND status = 'review'`, [row.id]);
    if (claim.affectedRows !== 1) fail('Otro envío ya está en curso', 409);
    res.json(await sendPreparedReceipt({
      receiptId: row.receiptid,
      payload,
      mode, client,
    }, req.body?.scenario));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'No se pudo reintentar el recibo' });
  }
});

router.post('/receipts/:id/factpy/send', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    if (req.body?.confirm !== true) fail('Confirmá el envío de prueba');
    res.json(await submitFactpyReceipt(req.params.id, {
      exchangeRate: req.body?.exchange_rate, scenario: req.body?.scenario,
    }));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'No se pudo enviar el recibo' });
  }
});

export default router;
