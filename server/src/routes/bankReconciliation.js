import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';
import { ensureUnifiedPaymentOrderSchema } from '../services/unifiedPaymentOrders.js';
import { assertBankPaymentMatch, normalizeStatement, readStatement } from '../services/bankStatementImport.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
let schemaPromise;

export function ensureBankReconciliationSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_statement_imports (
      id INT AUTO_INCREMENT PRIMARY KEY, account_param_id INT NOT NULL, bank_name VARCHAR(120) NOT NULL,
      currency_code VARCHAR(8) NOT NULL, file_name VARCHAR(255) NOT NULL, file_hash CHAR(64) NOT NULL,
      row_count INT NOT NULL, imported_by INT NULL, imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bank_import_file (account_param_id, file_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_statement_movements (
      id INT AUTO_INCREMENT PRIMARY KEY, import_id INT NOT NULL, account_param_id INT NOT NULL,
      source_row_number INT NOT NULL, movement_date DATE NOT NULL, description VARCHAR(500) NOT NULL,
      reference_number VARCHAR(160) NULL, debit_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      credit_amount DECIMAL(15,2) NOT NULL DEFAULT 0, fingerprint CHAR(64) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bank_movement_fingerprint (account_param_id, fingerprint),
      INDEX idx_bank_movement_account_date (account_param_id, movement_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_payment_matches (
      id INT AUTO_INCREMENT PRIMARY KEY, movement_id INT NOT NULL, payment_id INT NOT NULL,
      matched_by INT NOT NULL, matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bank_match_movement (movement_id), UNIQUE KEY uq_bank_match_payment (payment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_reconciliation_events (
      id INT AUTO_INCREMENT PRIMARY KEY, movement_id INT NOT NULL, payment_id INT NULL,
      event_type VARCHAR(24) NOT NULL, reason VARCHAR(500) NULL, actor_user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_bank_event_movement (movement_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch((e) => { schemaPromise = null; throw e; });
  return schemaPromise;
}

async function accountById(id, conn = pool) {
  const [[row]] = await conn.query("SELECT id, value FROM param_values WHERE id = ? AND `key` = 'company_bank_account' AND active = 1", [id]);
  if (!row) fail('Seleccione una cuenta de la empresa configurada en Parámetros');
  let value;
  try { value = JSON.parse(row.value); } catch { value = { alias: row.value }; }
  const account = {
    id: row.id, alias: String(value.alias || value.bank_name || row.value || '').trim(),
    bank_name: String(value.bank_name || '').trim(), currency_code: String(value.currency_code || value.currency || 'PYG').toUpperCase(),
    account_number: String(value.account_number || '').trim(),
  };
  if (!['PYG', 'USD'].includes(account.currency_code)) fail('Moneda de cuenta no admitida');
  return account;
}

async function markAllocationMeta(conn, paymentId, reconciled, userId, note) {
  const [items] = await conn.query(`SELECT i.source_type, a.source_payment_id
    FROM ap_payment_order_allocations a JOIN ap_payment_order_items i ON i.id = a.item_id
    WHERE a.payment_id = ?`, [paymentId]);
  for (const item of items) {
    await conn.query(`INSERT INTO accounts_payable_payment_meta
      (source_type, payment_id, reconciled, reconciled_at, reconciled_by, reconciliation_notes, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE reconciled = VALUES(reconciled), reconciled_at = VALUES(reconciled_at),
      reconciled_by = VALUES(reconciled_by), reconciliation_notes = VALUES(reconciliation_notes),
      updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
    [item.source_type, item.source_payment_id, reconciled, reconciled ? new Date().toISOString().slice(0, 10) : null,
      reconciled ? userId : null, note, userId]);
  }
}

router.use(requireAuth, requireAnyRole('admin', 'finanzas'));

router.get('/accounts', async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT id FROM param_values WHERE `key` = 'company_bank_account' AND active = 1 ORDER BY ord, id");
    res.json({ rows: await Promise.all(rows.map((row) => accountById(row.id))) });
  } catch (e) { console.error('[bank-reconciliation] accounts', e); res.status(500).json({ error: 'No se pudieron cargar las cuentas' }); }
});

router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) fail('Seleccione un extracto CSV o XLSX');
    const rows = await readStatement(req.file.buffer, req.file.originalname);
    res.json({ headers: rows[0], sample: rows.slice(1, 6), row_count: rows.length - 1 });
  } catch (e) { res.status(e.statusCode || 400).json({ error: e.message || 'No se pudo leer el extracto' }); }
});

router.post('/imports', upload.single('file'), async (req, res) => {
  let conn;
  try {
    if (!req.file) fail('Seleccione un extracto');
    await ensureBankReconciliationSchema();
    const account = await accountById(Number(req.body.account_param_id));
    const mapping = JSON.parse(req.body.mapping || '{}');
    const rows = normalizeStatement(await readStatement(req.file.buffer, req.file.originalname), mapping);
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[previous]] = await conn.query('SELECT id FROM bank_statement_imports WHERE account_param_id = ? AND file_hash = ?', [account.id, hash]);
    if (previous) fail('Este archivo ya fue importado para la cuenta', 409);
    const [created] = await conn.query(`INSERT INTO bank_statement_imports
      (account_param_id, bank_name, currency_code, file_name, file_hash, row_count, imported_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [account.id, account.bank_name, account.currency_code, req.file.originalname, hash, rows.length, req.user.id]);
    let inserted = 0;
    for (const row of rows) {
      try {
        await conn.query(`INSERT INTO bank_statement_movements
          (import_id, account_param_id, source_row_number, movement_date, description, reference_number, debit_amount, credit_amount, fingerprint)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [created.insertId, account.id, row.rowNumber, row.date, row.description, row.reference || null,
          row.debit / 100, row.credit / 100, row.fingerprint]);
        inserted += 1;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
    await conn.commit();
    res.status(201).json({ import_id: created.insertId, inserted, skipped: rows.length - inserted });
  } catch (e) {
    if (conn) await conn.rollback();
    console.error('[bank-reconciliation] import', e);
    res.status(e.statusCode || (e.code === 'ER_DUP_ENTRY' ? 409 : 500)).json({ error: e.statusCode ? e.message : 'No se pudo importar el extracto' });
  } finally { conn?.release(); }
});

router.get('/movements', async (req, res) => {
  try {
    await ensureBankReconciliationSchema();
    const account = await accountById(Number(req.query.account_param_id));
    const [rows] = await pool.query(`SELECT m.id, m.movement_date, m.description, m.reference_number,
      m.debit_amount, m.credit_amount, i.file_name, k.payment_id,
      p.reference_number AS payment_reference, o.order_number
      FROM bank_statement_movements m JOIN bank_statement_imports i ON i.id = m.import_id
      LEFT JOIN bank_payment_matches k ON k.movement_id = m.id
      LEFT JOIN ap_payment_order_payments p ON p.id = k.payment_id
      LEFT JOIN ap_payment_orders o ON o.id = p.order_id
      WHERE m.account_param_id = ? ORDER BY m.movement_date DESC, m.id DESC LIMIT 500`, [account.id]);
    res.json({ rows });
  } catch (e) { console.error('[bank-reconciliation] movements', e); res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudieron cargar los movimientos' }); }
});

router.get('/payments', async (req, res) => {
  try {
    await ensureBankReconciliationSchema();
    await ensureUnifiedPaymentOrderSchema();
    const account = await accountById(Number(req.query.account_param_id));
    const [rows] = await pool.query(`SELECT p.id, p.payment_date, p.reference_number, p.amount, p.company_account,
      o.id AS order_id, o.order_number, o.supplier_name
      FROM ap_payment_order_payments p JOIN ap_payment_orders o ON o.id = p.order_id
      LEFT JOIN bank_payment_matches k ON k.payment_id = p.id
      WHERE k.id IS NULL AND o.currency_code = ? AND p.company_account IN (?, ?)
      ORDER BY p.payment_date DESC, p.id DESC LIMIT 500`,
    [account.currency_code, account.alias, account.account_number || account.alias]);
    res.json({ rows });
  } catch (e) { console.error('[bank-reconciliation] payments', e); res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudieron cargar los pagos' }); }
});

router.post('/matches', async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    await ensureUnifiedPaymentOrderSchema();
    const movementId = Number(req.body.movement_id);
    const paymentId = Number(req.body.payment_id);
    if (!Number.isSafeInteger(movementId) || !Number.isSafeInteger(paymentId)) fail('Seleccione movimiento y pago');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[movement]] = await conn.query('SELECT * FROM bank_statement_movements WHERE id = ? FOR UPDATE', [movementId]);
    const [[payment]] = await conn.query(`SELECT p.*, o.currency_code, o.order_number FROM ap_payment_order_payments p
      JOIN ap_payment_orders o ON o.id = p.order_id WHERE p.id = ? FOR UPDATE`, [paymentId]);
    if (!movement || !payment) fail('Movimiento o pago no encontrado', 404);
    const account = await accountById(movement.account_param_id, conn);
    try { assertBankPaymentMatch(movement, payment, account); }
    catch (e) { e.statusCode = 409; throw e; }
    const [[existing]] = await conn.query(`SELECT k.id FROM bank_payment_matches k WHERE k.movement_id = ? OR k.payment_id = ?`, [movementId, paymentId]);
    if (existing) fail('El movimiento o pago ya está conciliado', 409);
    await conn.query('INSERT INTO bank_payment_matches (movement_id, payment_id, matched_by) VALUES (?, ?, ?)', [movementId, paymentId, req.user.id]);
    await markAllocationMeta(conn, paymentId, 1, req.user.id, `Extracto bancario: movimiento #${movementId}`);
    await conn.query(`INSERT INTO bank_reconciliation_events (movement_id, payment_id, event_type, actor_user_id)
      VALUES (?, ?, 'matched', ?)`, [movementId, paymentId, req.user.id]);
    await conn.query(`INSERT INTO ap_payment_order_events (order_id, event_type, actor_user_id, detail_json)
      VALUES (?, 'reconciled', ?, ?)`, [payment.order_id, req.user.id, JSON.stringify({ payment_id: paymentId, movement_id: movementId })]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(e.statusCode || (e.code === 'ER_DUP_ENTRY' ? 409 : 500)).json({ error: e.statusCode ? e.message : 'No se pudo conciliar' });
  } finally { conn?.release(); }
});

router.delete('/matches/:movementId', async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    const reason = String(req.body?.reason || '').trim();
    if (!reason) fail('Indique el motivo');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[movement]] = await conn.query('SELECT id FROM bank_statement_movements WHERE id = ? FOR UPDATE', [req.params.movementId]);
    if (!movement) fail('Movimiento no encontrado', 404);
    const [[match]] = await conn.query('SELECT payment_id FROM bank_payment_matches WHERE movement_id = ? FOR UPDATE', [movement.id]);
    if (!match) fail('El movimiento no está conciliado', 409);
    const [[payment]] = await conn.query('SELECT order_id FROM ap_payment_order_payments WHERE id = ? FOR UPDATE', [match.payment_id]);
    await conn.query('DELETE FROM bank_payment_matches WHERE movement_id = ?', [movement.id]);
    await markAllocationMeta(conn, match.payment_id, 0, req.user.id, reason);
    await conn.query(`INSERT INTO bank_reconciliation_events
      (movement_id, payment_id, event_type, reason, actor_user_id) VALUES (?, ?, 'unmatched', ?, ?)`,
    [movement.id, match.payment_id, reason, req.user.id]);
    await conn.query(`INSERT INTO ap_payment_order_events (order_id, event_type, actor_user_id, detail_json)
      VALUES (?, 'reconciliation_removed', ?, ?)`, [payment.order_id, req.user.id,
      JSON.stringify({ payment_id: match.payment_id, movement_id: movement.id, reason })]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo quitar la conciliación' });
  } finally { conn?.release(); }
});

export default router;
