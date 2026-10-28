import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole, requireRole } from '../middlewares/auth.js';
import { ensureUnifiedPaymentOrderSchema } from '../services/unifiedPaymentOrders.js';
import { assertBankPaymentMatch, normalizeStatement, readStatement, validateOpeningBalance } from '../services/bankStatementImport.js';
import { buildBankBook, countUnassignedBankBookRows, loadBankBookRows } from '../services/bankBook.js';
import { bankPeriodFingerprint, periodEnd, reconcileBankBook } from '../services/bankReconciliationPeriod.js';
import { normalizeBankTransfer } from '../services/bankTransfers.js';

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
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_account_opening_balances (
      account_param_id INT PRIMARY KEY, balance_date DATE NOT NULL,
      amount DECIMAL(15,2) NOT NULL, updated_by INT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_account_balance_events (
      id INT AUTO_INCREMENT PRIMARY KEY, account_param_id INT NOT NULL,
      previous_date DATE NULL, previous_amount DECIMAL(15,2) NULL,
      balance_date DATE NOT NULL, amount DECIMAL(15,2) NOT NULL,
      actor_user_id INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bank_balance_events_account (account_param_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_book_manual_entries (
      id INT AUTO_INCREMENT PRIMARY KEY, account_param_id INT NOT NULL,
      request_id CHAR(36) NULL, movement_date DATE NOT NULL,
      direction VARCHAR(8) NOT NULL, amount DECIMAL(15,2) NOT NULL,
      description VARCHAR(500) NOT NULL, reference_number VARCHAR(160) NULL,
      reverses_entry_id INT NULL, created_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bank_book_request (request_id),
      UNIQUE KEY uq_bank_book_reversal (reverses_entry_id),
      INDEX idx_bank_book_account_date (account_param_id, movement_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_internal_transfers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id CHAR(36) NULL,
      from_account_param_id INT NOT NULL, to_account_param_id INT NOT NULL,
      from_account_label VARCHAR(180) NOT NULL, to_account_label VARCHAR(180) NOT NULL,
      movement_date DATE NOT NULL, currency_code VARCHAR(8) NOT NULL,
      amount DECIMAL(15,2) NOT NULL, reference_number VARCHAR(160) NULL,
      observations VARCHAR(500) NULL, reverses_transfer_id INT NULL,
      created_by INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bank_transfer_request (request_id),
      UNIQUE KEY uq_bank_transfer_reversal (reverses_transfer_id),
      INDEX idx_bank_transfer_from_date (from_account_param_id, movement_date),
      INDEX idx_bank_transfer_to_date (to_account_param_id, movement_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [purchaseAccountColumns] = await pool.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_invoice_payments' AND COLUMN_NAME = 'account'`);
    if (!purchaseAccountColumns.length) {
      await pool.query('ALTER TABLE purchase_invoice_payments ADD COLUMN account VARCHAR(128) NULL AFTER payment_method');
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_reconciliation_periods (
      id INT AUTO_INCREMENT PRIMARY KEY, account_param_id INT NOT NULL,
      period CHAR(7) NOT NULL, bank_balance DECIMAL(15,2) NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'open', notes VARCHAR(500) NULL,
      updated_by INT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      closed_by INT NULL, closed_at DATETIME NULL, snapshot_hash CHAR(64) NULL,
      UNIQUE KEY uq_bank_period (account_param_id, period)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_book_clearances (
      id INT AUTO_INCREMENT PRIMARY KEY, account_param_id INT NOT NULL,
      source_type VARCHAR(32) NOT NULL, source_id INT NOT NULL,
      period CHAR(7) NOT NULL, cleared_by INT NOT NULL,
      cleared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bank_book_clearance (account_param_id, source_type, source_id),
      INDEX idx_bank_clearance_period (account_param_id, period)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bank_reconciliation_period_events (
      id INT AUTO_INCREMENT PRIMARY KEY, account_param_id INT NOT NULL,
      period CHAR(7) NOT NULL, event_type VARCHAR(24) NOT NULL,
      detail_json JSON NULL, actor_user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bank_period_events (account_param_id, period, id)
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

async function periodState(conn, account, period) {
  const endDate = periodEnd(period);
  const [[opening]] = await conn.query(
    'SELECT balance_date, amount FROM bank_account_opening_balances WHERE account_param_id = ?', [account.id]
  );
  if (!opening || String(opening.balance_date).slice(0, 10) > endDate) {
    fail('Configure el saldo inicial antes de conciliar este mes');
  }
  const [[saved]] = await conn.query(
    'SELECT * FROM bank_reconciliation_periods WHERE account_param_id = ? AND period = ?',
    [account.id, period]
  );
  const rows = (await loadBankBookRows(conn, account, opening.balance_date))
    .filter((row) => String(row.movement_date).slice(0, 10) <= endDate);
  const book = buildBankBook(opening.amount, rows);
  const [marks] = await conn.query(
    'SELECT source_type, source_id, period FROM bank_book_clearances WHERE account_param_id = ?', [account.id]
  );
  const clearances = new Map(marks.map((row) => [`${row.source_type}:${row.source_id}`, row.period]));
  const summary = reconcileBankBook(book, clearances, period, saved?.bank_balance ?? null);
  const unassignedCount = await countUnassignedBankBookRows(
    conn, account.currency_code, opening.balance_date, endDate
  );
  const snapshot = bankPeriodFingerprint(opening, saved?.bank_balance ?? null, summary.rows);
  return { account, period, end_date: endDate, opening, saved: saved || null,
    ...summary, unassigned_count: unassignedCount,
    stale: saved?.status === 'closed' && (saved.snapshot_hash !== snapshot || unassignedCount > 0),
    snapshot };
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

router.get('/balance', async (req, res) => {
  try {
    await ensureBankReconciliationSchema();
    await ensureUnifiedPaymentOrderSchema();
    const account = await accountById(Number(req.query.account_param_id));
    const [[opening]] = await pool.query(
      'SELECT balance_date, amount, updated_at FROM bank_account_opening_balances WHERE account_param_id = ?',
      [account.id]
    );
    const book = opening
      ? buildBankBook(opening.amount, await loadBankBookRows(pool, account, opening.balance_date))
      : { rows: [], credits: '0.00', debits: '0.00', calculated_balance: null };
    const unassignedCount = opening
      ? await countUnassignedBankBookRows(pool, account.currency_code, opening.balance_date) : 0;
    const [events] = await pool.query(`SELECT previous_date, previous_amount, balance_date, amount,
      actor_user_id, created_at FROM bank_account_balance_events
      WHERE account_param_id = ? ORDER BY id DESC LIMIT 10`, [account.id]);
    res.json({ opening: opening || null, ...book, movement_count: book.rows.length,
      unassigned_count: unassignedCount, events });
  } catch (e) {
    console.error('[bank-reconciliation] balance', e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo cargar el saldo de la cuenta' });
  }
});

router.get('/period', async (req, res) => {
  try {
    await ensureBankReconciliationSchema();
    await ensureUnifiedPaymentOrderSchema();
    const account = await accountById(Number(req.query.account_param_id));
    const state = await periodState(pool, account, String(req.query.period || ''));
    const [events] = await pool.query(`SELECT event_type, detail_json, actor_user_id, created_at
      FROM bank_reconciliation_period_events WHERE account_param_id = ? AND period = ?
      ORDER BY id DESC LIMIT 20`, [account.id, state.period]);
    res.json({ ...state, snapshot: undefined, events });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo cargar la conciliación' });
  }
});

router.put('/period', async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    const account = await accountById(Number(req.body.account_param_id));
    const period = String(req.body.period || '');
    periodEnd(period);
    const amount = String(req.body.bank_balance ?? '').trim();
    validateOpeningBalance(`${period}-01`, amount);
    const notes = String(req.body.notes || '').trim();
    if (notes.length > 500) fail('La observación es demasiado larga');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[existing]] = await conn.query(
      'SELECT status FROM bank_reconciliation_periods WHERE account_param_id = ? AND period = ? FOR UPDATE',
      [account.id, period]
    );
    if (existing?.status === 'closed') fail('El mes está cerrado', 409);
    const [[opening]] = await conn.query(
      'SELECT balance_date FROM bank_account_opening_balances WHERE account_param_id = ?', [account.id]
    );
    if (!opening || String(opening.balance_date).slice(0, 10) > periodEnd(period)) {
      fail('Configure el saldo inicial antes de conciliar este mes');
    }
    await conn.query(`INSERT INTO bank_reconciliation_periods
      (account_param_id, period, bank_balance, notes, updated_by) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE bank_balance = VALUES(bank_balance), notes = VALUES(notes),
      updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
    [account.id, period, amount, notes || null, req.user.id]);
    await conn.query(`INSERT INTO bank_reconciliation_period_events
      (account_param_id, period, event_type, detail_json, actor_user_id)
      VALUES (?, ?, 'bank_balance_saved', ?, ?)`,
    [account.id, period, JSON.stringify({ bank_balance: amount, notes }), req.user.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo guardar el saldo del banco' });
  } finally { conn?.release(); }
});

router.put('/period/clearance', async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    await ensureUnifiedPaymentOrderSchema();
    const account = await accountById(Number(req.body.account_param_id));
    const period = String(req.body.period || '');
    periodEnd(period);
    const sourceType = String(req.body.source_type || '');
    const sourceId = Number(req.body.source_id);
    const cleared = req.body.cleared === true;
    if (!/^(receipt|payment_order|operation_expense|admin_expense|purchase_invoice|manual|transfer)$/.test(sourceType) ||
        !Number.isSafeInteger(sourceId) || sourceId <= 0) fail('Movimiento inválido');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[saved]] = await conn.query(
      'SELECT status FROM bank_reconciliation_periods WHERE account_param_id = ? AND period = ? FOR UPDATE',
      [account.id, period]
    );
    if (saved?.status === 'closed') fail('El mes está cerrado', 409);
    const state = await periodState(conn, account, period);
    if (!state.rows.some((row) => row.source_type === sourceType && Number(row.source_id) === sourceId)) {
      fail('El movimiento no pertenece a este Libro banco', 404);
    }
    const [[previous]] = await conn.query(`SELECT period FROM bank_book_clearances
      WHERE account_param_id = ? AND source_type = ? AND source_id = ? FOR UPDATE`,
    [account.id, sourceType, sourceId]);
    if (cleared) {
      if (previous && previous.period !== period) fail('El movimiento ya fue conciliado en otro mes', 409);
      if (!previous) await conn.query(`INSERT INTO bank_book_clearances
        (account_param_id, source_type, source_id, period, cleared_by) VALUES (?, ?, ?, ?, ?)`,
      [account.id, sourceType, sourceId, period, req.user.id]);
    } else {
      if (previous?.period !== period) fail('El movimiento no está conciliado en este mes', 409);
      await conn.query(`DELETE FROM bank_book_clearances
        WHERE account_param_id = ? AND source_type = ? AND source_id = ?`,
      [account.id, sourceType, sourceId]);
    }
    await conn.query(`INSERT INTO bank_reconciliation_period_events
      (account_param_id, period, event_type, detail_json, actor_user_id) VALUES (?, ?, ?, ?, ?)`,
    [account.id, period, cleared ? 'cleared' : 'uncleared', JSON.stringify({ source_type: sourceType, source_id: sourceId }), req.user.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(e.statusCode || (e.code === 'ER_DUP_ENTRY' ? 409 : 500)).json({
      error: e.statusCode ? e.message : 'No se pudo actualizar el movimiento',
    });
  } finally { conn?.release(); }
});

router.post('/period/close', requireRole('admin'), async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    await ensureUnifiedPaymentOrderSchema();
    const account = await accountById(Number(req.body.account_param_id));
    const period = String(req.body.period || '');
    periodEnd(period);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[saved]] = await conn.query(`SELECT status FROM bank_reconciliation_periods
      WHERE account_param_id = ? AND period = ? FOR UPDATE`, [account.id, period]);
    if (!saved || saved.status === 'closed') fail('Guarde el saldo del banco o el mes ya está cerrado', 409);
    const state = await periodState(conn, account, period);
    if (state.saved.bank_balance == null || state.difference !== '0.00' || state.unassigned_count) {
      fail('Resuelva la diferencia y los movimientos sin cuenta antes de cerrar', 409);
    }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Asuncion' }).format(new Date());
    if (state.end_date >= today) fail('El mes todavía no terminó', 409);
    await conn.query(`UPDATE bank_reconciliation_periods SET status = 'closed', closed_by = ?,
      closed_at = NOW(), snapshot_hash = ? WHERE account_param_id = ? AND period = ?`,
    [req.user.id, state.snapshot, account.id, period]);
    await conn.query(`INSERT INTO bank_reconciliation_period_events
      (account_param_id, period, event_type, detail_json, actor_user_id)
      VALUES (?, ?, 'closed', ?, ?)`,
    [account.id, period, JSON.stringify({ bank_balance: state.saved.bank_balance,
      book_balance: state.calculated_balance, adjusted_bank_balance: state.adjusted_bank_balance,
      outstanding_count: state.outstanding_count }), req.user.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo cerrar la conciliación' });
  } finally { conn?.release(); }
});

router.post('/period/reopen', requireRole('admin'), async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    const account = await accountById(Number(req.body.account_param_id));
    const period = String(req.body.period || '');
    periodEnd(period);
    const reason = String(req.body.reason || '').trim();
    if (!reason || reason.length > 500) fail('Indique el motivo para reabrir el mes');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[saved]] = await conn.query(`SELECT status FROM bank_reconciliation_periods
      WHERE account_param_id = ? AND period = ? FOR UPDATE`, [account.id, period]);
    if (saved?.status !== 'closed') fail('El mes no está cerrado', 409);
    const [[later]] = await conn.query(`SELECT id FROM bank_reconciliation_periods
      WHERE account_param_id = ? AND period > ? AND status = 'closed' LIMIT 1`, [account.id, period]);
    if (later) fail('Reabra primero los meses posteriores', 409);
    await conn.query(`UPDATE bank_reconciliation_periods SET status = 'open', closed_by = NULL,
      closed_at = NULL, snapshot_hash = NULL WHERE account_param_id = ? AND period = ?`,
    [account.id, period]);
    await conn.query(`INSERT INTO bank_reconciliation_period_events
      (account_param_id, period, event_type, detail_json, actor_user_id)
      VALUES (?, ?, 'reopened', ?, ?)`,
    [account.id, period, JSON.stringify({ reason }), req.user.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo reabrir el mes' });
  } finally { conn?.release(); }
});

async function assertTransferWindow(conn, accountIds, date) {
  const [openings] = await conn.query(`SELECT account_param_id, balance_date
    FROM bank_account_opening_balances WHERE account_param_id IN (?, ?)
    ORDER BY account_param_id FOR UPDATE`, accountIds);
  if (openings.length !== 2 || openings.some((row) => date < String(row.balance_date).slice(0, 10))) {
    fail('Configure el saldo inicial de ambas cuentas antes de la transferencia');
  }
  const [closed] = await conn.query(`SELECT account_param_id, status FROM bank_reconciliation_periods
    WHERE account_param_id IN (?, ?) AND period = ? ORDER BY account_param_id FOR UPDATE`,
  [...accountIds, date.slice(0, 7)]);
  if (closed.some((row) => row.status === 'closed')) fail('Reabra el mes cerrado antes de transferir', 409);
}

router.post('/transfers', async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    const requestId = String(req.body?.request_id || '').trim();
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId)) fail('Solicitud de transferencia inválida');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const accountIds = [Number(req.body.from_account_param_id), Number(req.body.to_account_param_id)].sort((a, b) => a - b);
    if (!Number.isSafeInteger(accountIds[0]) || !Number.isSafeInteger(accountIds[1]) ||
        accountIds[0] <= 0 || accountIds[0] === accountIds[1]) fail('Seleccione dos cuentas diferentes');
    const [locked] = await conn.query(`SELECT id FROM param_values
      WHERE id IN (?, ?) AND \`key\` = 'company_bank_account' AND active = 1 ORDER BY id FOR UPDATE`, accountIds);
    if (locked.length !== 2) fail('Una de las cuentas ya no está activa', 409);
    const from = await accountById(Number(req.body.from_account_param_id), conn);
    const to = await accountById(Number(req.body.to_account_param_id), conn);
    const transfer = normalizeBankTransfer(req.body, from, to);
    await assertTransferWindow(conn, accountIds, transfer.date);
    const [inserted] = await conn.query(`INSERT INTO bank_internal_transfers
      (request_id, from_account_param_id, to_account_param_id, from_account_label, to_account_label,
       movement_date, currency_code, amount, reference_number, observations, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [requestId, from.id, to.id, from.alias, to.alias, transfer.date, transfer.currency,
      transfer.amount, transfer.reference || null, transfer.observations || null, req.user.id]);
    await conn.commit();
    res.status(201).json({ id: inserted.insertId });
  } catch (e) {
    if (conn) await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY' && req.body?.request_id) {
      const [[existing]] = await pool.query('SELECT id FROM bank_internal_transfers WHERE request_id = ?', [req.body.request_id]);
      if (existing) return res.json({ id: existing.id, repeated: true });
    }
    console.error('[bank-reconciliation] transfer', e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo registrar la transferencia' });
  } finally { conn?.release(); }
});

router.post('/transfers/:id/reverse', async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    const reason = String(req.body?.reason || '').trim();
    if (!reason || reason.length > 500) fail('Indique un motivo de reversión');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[original]] = await conn.query('SELECT * FROM bank_internal_transfers WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!original || original.reverses_transfer_id) fail('Transferencia no encontrada', 404);
    const [[reversal]] = await conn.query('SELECT id FROM bank_internal_transfers WHERE reverses_transfer_id = ?', [original.id]);
    if (reversal) fail('La transferencia ya fue revertida', 409);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Asuncion' }).format(new Date());
    const ids = [original.from_account_param_id, original.to_account_param_id].sort((a, b) => a - b);
    await assertTransferWindow(conn, ids, today);
    await conn.query(`INSERT INTO bank_internal_transfers
      (from_account_param_id, to_account_param_id, from_account_label, to_account_label,
       movement_date, currency_code, amount, reference_number, observations, reverses_transfer_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [original.to_account_param_id, original.from_account_param_id, original.to_account_label,
      original.from_account_label, today, original.currency_code, original.amount,
      original.reference_number, reason, original.id, req.user.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo revertir la transferencia' });
  } finally { conn?.release(); }
});

router.post('/book-entries', async (req, res) => {
  try {
    await ensureBankReconciliationSchema();
    const account = await accountById(Number(req.body.account_param_id));
    const date = String(req.body.movement_date || '');
    const amount = String(req.body.amount ?? '').trim();
    const direction = String(req.body.direction || '');
    const description = String(req.body.description || '').trim();
    const reference = String(req.body.reference_number || '').trim();
    const requestId = String(req.body.request_id || '').trim();
    validateOpeningBalance(date, amount);
    if (Number(amount) <= 0 || !['credit', 'debit'].includes(direction) ||
        !description || description.length > 500 || reference.length > 160 ||
        !/^[a-f0-9-]{36}$/i.test(requestId)) fail('Complete el movimiento bancario');
    const [[opening]] = await pool.query(
      'SELECT balance_date FROM bank_account_opening_balances WHERE account_param_id = ?', [account.id]
    );
    if (!opening || date < String(opening.balance_date).slice(0, 10)) {
      fail('El movimiento debe ser posterior al inicio del Libro banco');
    }
    const [[closed]] = await pool.query(`SELECT id FROM bank_reconciliation_periods
      WHERE account_param_id = ? AND period = ? AND status = 'closed'`,
    [account.id, date.slice(0, 7)]);
    if (closed) fail('El mes está cerrado', 409);
    const [inserted] = await pool.query(`INSERT INTO bank_book_manual_entries
      (account_param_id, request_id, movement_date, direction, amount, description,
       reference_number, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [account.id, requestId, date, direction, amount, description, reference || null, req.user.id]);
    res.status(201).json({ id: inserted.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY' && req.body?.request_id) {
      const [[existing]] = await pool.query(
        'SELECT id FROM bank_book_manual_entries WHERE request_id = ?', [req.body.request_id]
      );
      if (existing) return res.json({ id: existing.id });
    }
    console.error('[bank-reconciliation] book entry', e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo registrar el movimiento' });
  }
});

router.post('/book-entries/:id/reverse', async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    const reason = String(req.body?.reason || '').trim();
    if (!reason || reason.length > 400) fail('Indique un motivo de reversión');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[entry]] = await conn.query(
      'SELECT * FROM bank_book_manual_entries WHERE id = ? FOR UPDATE', [req.params.id]
    );
    if (!entry || entry.reverses_entry_id) fail('Movimiento manual no encontrado', 404);
    await accountById(entry.account_param_id, conn);
    const [[previous]] = await conn.query(
      'SELECT id FROM bank_book_manual_entries WHERE reverses_entry_id = ?', [entry.id]
    );
    if (previous) fail('El movimiento ya fue revertido', 409);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Asuncion' }).format(new Date());
    const [[opening]] = await conn.query(
      'SELECT balance_date FROM bank_account_opening_balances WHERE account_param_id = ?', [entry.account_param_id]
    );
    if (!opening || today < String(opening.balance_date).slice(0, 10)) {
      fail('La reversión debe estar dentro del período del Libro banco');
    }
    const [[closed]] = await conn.query(`SELECT id FROM bank_reconciliation_periods
      WHERE account_param_id = ? AND period = ? AND status = 'closed'`,
    [entry.account_param_id, today.slice(0, 7)]);
    if (closed) fail('El mes está cerrado', 409);
    await conn.query(`INSERT INTO bank_book_manual_entries
      (account_param_id, movement_date, direction, amount, description,
       reference_number, reverses_entry_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.account_param_id, today, entry.direction === 'credit' ? 'debit' : 'credit', entry.amount,
      `Reversión: ${reason}`, entry.reference_number, entry.id, req.user.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo revertir el movimiento' });
  } finally { conn?.release(); }
});

router.put('/balance', async (req, res) => {
  let conn;
  try {
    await ensureBankReconciliationSchema();
    const account = await accountById(Number(req.body.account_param_id));
    const balanceDate = String(req.body.balance_date || '');
    const amount = String(req.body.amount ?? '').trim();
    validateOpeningBalance(balanceDate, amount);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[closed]] = await conn.query(`SELECT id FROM bank_reconciliation_periods
      WHERE account_param_id = ? AND status = 'closed' LIMIT 1`, [account.id]);
    if (closed) fail('Reabra los meses cerrados antes de cambiar el saldo inicial', 409);
    const [[previous]] = await conn.query(
      'SELECT balance_date, amount FROM bank_account_opening_balances WHERE account_param_id = ? FOR UPDATE',
      [account.id]
    );
    await conn.query(`INSERT INTO bank_account_opening_balances
      (account_param_id, balance_date, amount, updated_by) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE balance_date = VALUES(balance_date), amount = VALUES(amount),
      updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
    [account.id, balanceDate, amount, req.user.id]);
    await conn.query(`INSERT INTO bank_account_balance_events
      (account_param_id, previous_date, previous_amount, balance_date, amount, actor_user_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [account.id, previous?.balance_date || null, previous?.amount ?? null, balanceDate, amount, req.user.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback();
    console.error('[bank-reconciliation] save balance', e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'No se pudo guardar el saldo inicial' });
  } finally { conn?.release(); }
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
