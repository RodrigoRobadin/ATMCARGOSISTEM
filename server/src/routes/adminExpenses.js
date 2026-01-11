// server/src/routes/adminExpenses.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { id } = req.params;
    const dir = path.resolve('uploads', 'admin-expenses', String(id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = Date.now();
    cb(null, `${stamp}_${safe}`);
  },
});

const upload = multer({ storage });

const paymentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { paymentId } = req.params;
    const dir = path.resolve('uploads', 'admin-expense-payments', String(paymentId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = Date.now();
    cb(null, `${stamp}_${safe}`);
  },
});

const paymentUpload = multer({ storage: paymentStorage });

ensureAdminExpenseTables().catch((err) =>
  console.error('init admin expenses tables', err?.message)
);

async function ensureAdminExpenseTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expense_categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expense_subcategories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cat (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expense_cost_centers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expense_providers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      ruc VARCHAR(32) NULL,
      contact_name VARCHAR(120) NULL,
      phone VARCHAR(60) NULL,
      email VARCHAR(120) NULL,
      address VARCHAR(255) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expense_recurrences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      start_date DATE NOT NULL,
      end_date DATE NULL,
      frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
      day_of_month INT NULL,
      next_run_date DATE NOT NULL,
      provider_id INT NULL,
      category_id INT NULL,
      subcategory_id INT NULL,
      cost_center_id INT NULL,
      description TEXT NULL,
      amount DECIMAL(15,2) NOT NULL,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      tax_rate DECIMAL(5,2) NULL,
      receipt_type VARCHAR(32) NULL,
      receipt_number VARCHAR(64) NULL,
      timbrado_number VARCHAR(64) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_next_run (next_run_date),
      INDEX idx_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      expense_date DATE NOT NULL,
      provider_id INT NULL,
      category_id INT NULL,
      subcategory_id INT NULL,
      cost_center_id INT NULL,
      description TEXT NULL,
      amount DECIMAL(15,2) NOT NULL,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      tax_rate DECIMAL(5,2) NULL,
      receipt_type VARCHAR(32) NULL,
      receipt_number VARCHAR(64) NULL,
      timbrado_number VARCHAR(64) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      recurrence_id INT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_expense_date (expense_date),
      INDEX idx_status (status),
      UNIQUE KEY uq_recurrence_date (recurrence_id, expense_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expense_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      expense_id INT NOT NULL,
      payment_date DATE NULL,
      method VARCHAR(32) NULL,
      account VARCHAR(64) NULL,
      reference_number VARCHAR(128) NULL,
      receipt_type VARCHAR(32) NULL,
      receipt_number VARCHAR(64) NULL,
      timbrado_number VARCHAR(64) NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      status VARCHAR(20) NOT NULL DEFAULT 'confirmado',
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_expense (expense_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensurePaymentReceiptColumns();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expense_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      expense_id INT NOT NULL,
      file_url VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_expense (expense_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expense_payment_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payment_id INT NOT NULL,
      file_url VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_payment (payment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

}

async function ensurePaymentReceiptColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_expense_payments'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('receipt_type')) add.push('ADD COLUMN receipt_type VARCHAR(32) NULL');
    if (!have.has('receipt_number')) add.push('ADD COLUMN receipt_number VARCHAR(64) NULL');
    if (!have.has('timbrado_number')) add.push('ADD COLUMN timbrado_number VARCHAR(64) NULL');
    if (add.length) {
      await pool.query(`ALTER TABLE admin_expense_payments ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[admin-expenses] ensure payment columns error', e?.message || e);
  }
}


async function ensureParamsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS params (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\` VARCHAR(100) NOT NULL,
      value TEXT NULL,
      ord INT NULL DEFAULT 0,
      active TINYINT(1) NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_params_key (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureParamValuesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS param_values (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\`   VARCHAR(100) NOT NULL,
      \`value\` TEXT NOT NULL,
      \`ord\`   INT NULL DEFAULT 0,
      \`active\` TINYINT(1) NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_key(\`key\`, \`ord\`),
      INDEX idx_active(\`active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function getParamValue(key, conn = pool) {
  try {
    await ensureParamValuesTable();
    const [[rowPV]] = await conn.query(
      `SELECT id, \`value\` FROM param_values WHERE \`key\` = ? AND (active IS NULL OR active <> 0) ORDER BY ord LIMIT 1`,
      [key]
    );
    if (rowPV) return { id: rowPV.id, value: rowPV.value, table: 'param_values' };
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
  try {
    await ensureParamsTable();
    const [[row]] = await conn.query(
      `SELECT id, value FROM params WHERE \`key\` = ? AND (active IS NULL OR active <> 0) ORDER BY ord LIMIT 1`,
      [key]
    );
    return row ? { id: row.id, value: row.value, table: 'params' } : null;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return null;
    throw err;
  }
}

async function upsertParam(key, value, conn = pool) {
  try {
    await ensureParamValuesTable();
    const existing = await getParamValue(key, conn);
    if (existing?.id) {
      const table = existing.table === 'params' ? 'params' : 'param_values';
      await conn.query(`UPDATE ${table} SET value = ? WHERE id = ?`, [value, existing.id]);
      return existing.id;
    }
    const [res] = await conn.query(
      `INSERT INTO param_values (\`key\`, \`value\`, \`ord\`, \`active\`) VALUES (?, ?, 0, 1)`,
      [key, value]
    );
    return res.insertId;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return null;
    throw err;
  }
}

function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function formatDate(date) {
  if (!date) return null;
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addMonths(baseDate, months, dayOfMonth) {
  const base = new Date(baseDate.getTime());
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const targetMonth = m + months;
  const tmp = new Date(Date.UTC(y, targetMonth, 1));
  const lastDay = new Date(Date.UTC(tmp.getUTCFullYear(), tmp.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(dayOfMonth || base.getUTCDate(), lastDay);
  return new Date(Date.UTC(tmp.getUTCFullYear(), tmp.getUTCMonth(), day));
}

async function generateRecurringExpenses(conn = pool) {
  await ensureAdminExpenseTables();
  const [rows] = await conn.query(
    `SELECT * FROM admin_expense_recurrences WHERE active = 1 ORDER BY id`
  );
  if (!rows.length) return;

  const today = toDateOnly(new Date());
  for (const rec of rows) {
    let nextRun = toDateOnly(rec.next_run_date || rec.start_date);
    if (!nextRun) continue;
    const endDate = toDateOnly(rec.end_date);
    const dom = rec.day_of_month || new Date(rec.start_date).getDate();

    while (nextRun <= today && (!endDate || nextRun <= endDate)) {
      const expenseDate = formatDate(nextRun);
      await conn.query(
        `INSERT IGNORE INTO admin_expenses
         (expense_date, provider_id, category_id, subcategory_id, cost_center_id, description,
          amount, currency_code, tax_rate, receipt_type, receipt_number, timbrado_number, status,
          recurrence_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          expenseDate,
          rec.provider_id || null,
          rec.category_id || null,
          rec.subcategory_id || null,
          rec.cost_center_id || null,
          rec.description || '',
          Number(rec.amount || 0),
          rec.currency_code || 'PYG',
          rec.tax_rate || null,
          rec.receipt_type || null,
          rec.receipt_number || null,
          rec.timbrado_number || null,
          rec.status || 'pendiente',
          rec.id,
          rec.created_by || null,
        ]
      );
      nextRun = addMonths(nextRun, 1, dom);
    }

    await conn.query(
      `UPDATE admin_expense_recurrences SET next_run_date = ? WHERE id = ?`,
      [formatDate(nextRun), rec.id]
    );
  }
}

router.get('/exchange-rate', requireAuth, async (_req, res) => {
  try {
    const row = await getParamValue('admin_expense_exchange_rate', pool);
    res.json({ value: row?.value || '' });
  } catch (e) {
    console.error('[admin-expenses] exchange-rate get error', e);
    res.status(500).json({ error: 'Error loading exchange rate' });
  }
});

router.put('/exchange-rate', requireAuth, async (req, res) => {
  try {
    const value = String(req.body?.value || '').trim();
    await upsertParam('admin_expense_exchange_rate', value, pool);
    res.json({ ok: true, value });
  } catch (e) {
    console.error('[admin-expenses] exchange-rate update error', e);
    res.status(500).json({ error: 'Error updating exchange rate' });
  }
});

router.get('/meta', requireAuth, async (_req, res) => {
  try {
    await ensureAdminExpenseTables();
    const [categories] = await pool.query(
      `SELECT * FROM admin_expense_categories WHERE active = 1 ORDER BY name`
    );
    const [subcategories] = await pool.query(
      `SELECT * FROM admin_expense_subcategories WHERE active = 1 ORDER BY name`
    );
    const [costCenters] = await pool.query(
      `SELECT * FROM admin_expense_cost_centers WHERE active = 1 ORDER BY name`
    );
    const [providers] = await pool.query(
      `SELECT id, razon_social, name, ruc
       FROM organizations
       WHERE LOWER(tipo_org) = 'proveedor'
       ORDER BY name`
    );
    const rate = await getParamValue('admin_expense_exchange_rate', pool);
    res.json({
      categories,
      subcategories,
      costCenters,
      providers,
      exchange_rate: rate?.value || '',
    });
  } catch (e) {
    console.error('[admin-expenses] meta error', e);
    res.status(500).json({ error: 'Error loading metadata' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    await generateRecurringExpenses(pool);
    const { from_date, to_date, status, category_id, cost_center_id, provider_id, currency_code } =
      req.query || {};

    const where = [];
    const params = [];
    if (from_date) {
      where.push('e.expense_date >= ?');
      params.push(from_date);
    }
    if (to_date) {
      where.push('e.expense_date <= ?');
      params.push(to_date);
    }
    if (status) {
      where.push('e.status = ?');
      params.push(status);
    }
    if (category_id) {
      where.push('e.category_id = ?');
      params.push(category_id);
    }
    if (cost_center_id) {
      where.push('e.cost_center_id = ?');
      params.push(cost_center_id);
    }
    if (provider_id) {
      where.push('e.provider_id = ?');
      params.push(provider_id);
    }
    if (currency_code) {
      where.push('e.currency_code = ?');
      params.push(currency_code);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `
      SELECT e.*,
             COALESCE(p.razon_social, p.name) AS provider_name,
             c.name AS category_name,
             sc.name AS subcategory_name,
             cc.name AS cost_center_name,
             (
               SELECT COALESCE(SUM(amount),0)
               FROM admin_expense_payments pay
               WHERE pay.expense_id = e.id AND pay.status <> 'anulado'
             ) AS paid_amount
        FROM admin_expenses e
        LEFT JOIN organizations p ON p.id = e.provider_id
        LEFT JOIN admin_expense_categories c ON c.id = e.category_id
        LEFT JOIN admin_expense_subcategories sc ON sc.id = e.subcategory_id
        LEFT JOIN admin_expense_cost_centers cc ON cc.id = e.cost_center_id
        ${whereSql}
        ORDER BY e.expense_date DESC, e.id DESC
      `,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error('[admin-expenses] list error', e);
    res.status(500).json({ error: 'Error listing expenses' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    await ensureAdminExpenseTables();
    const {
      expense_date,
      provider_id,
      category_id,
      subcategory_id,
      cost_center_id,
      description,
      amount,
      currency_code,
      tax_rate,
      receipt_type,
      receipt_number,
      timbrado_number,
      status,
    } = req.body || {};

    const [result] = await pool.query(
      `INSERT INTO admin_expenses
       (expense_date, provider_id, category_id, subcategory_id, cost_center_id, description,
        amount, currency_code, tax_rate, receipt_type, receipt_number, timbrado_number, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expense_date,
        provider_id || null,
        category_id || null,
        subcategory_id || null,
        cost_center_id || null,
        description || '',
        Number(amount || 0),
        currency_code || 'PYG',
        tax_rate || null,
        receipt_type || null,
        receipt_number || null,
        timbrado_number || null,
        status || 'pendiente',
        req.user?.id || null,
      ]
    );
    const [[row]] = await pool.query('SELECT * FROM admin_expenses WHERE id = ?', [
      result.insertId,
    ]);
    res.status(201).json(row);
  } catch (e) {
    console.error('[admin-expenses] create error', e);
    res.status(500).json({ error: 'Error creating expense' });
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    const fields = [
      'expense_date',
      'provider_id',
      'category_id',
      'subcategory_id',
      'cost_center_id',
      'description',
      'amount',
      'currency_code',
      'tax_rate',
      'receipt_type',
      'receipt_number',
      'timbrado_number',
      'status',
    ];
    const sets = [];
    const params = [];
    fields.forEach((f) => {
      if (patch[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push(patch[f]);
      }
    });
    if (!sets.length) return res.json({ ok: true });
    params.push(id);
    await pool.query(`UPDATE admin_expenses SET ${sets.join(', ')} WHERE id = ?`, params);
    const [[row]] = await pool.query('SELECT * FROM admin_expenses WHERE id = ?', [id]);
    res.json(row);
  } catch (e) {
    console.error('[admin-expenses] update error', e);
    res.status(500).json({ error: 'Error updating expense' });
  }
});

router.post('/:id/payments', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      payment_date,
      method,
      account,
      reference_number,
      receipt_type,
      receipt_number,
      timbrado_number,
      amount,
      currency_code,
      status,
    } = req.body || {};
    const [result] = await pool.query(
      `INSERT INTO admin_expense_payments
       (expense_id, payment_date, method, account, reference_number, receipt_type, receipt_number, timbrado_number, amount, currency_code, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        payment_date || null,
        method || null,
        account || null,
        reference_number || null,
        receipt_type || null,
        receipt_number || null,
        timbrado_number || null,
        Number(amount || 0),
        currency_code || 'PYG',
        status || 'confirmado',
        req.user?.id || null,
      ]
    );
    res.status(201).json({ id: result.insertId });
  } catch (e) {
    console.error('[admin-expenses] payment error', e);
    res.status(500).json({ error: 'Error creating payment' });
  }
});

router.get('/:id/payments', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM admin_expense_payments WHERE expense_id = ? ORDER BY id DESC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error('[admin-expenses] payments list error', e);
    res.status(500).json({ error: 'Error loading payments' });

router.get('/payments/:paymentId/attachments', requireAuth, async (req, res) => {
  try {
    const { paymentId } = req.params;
    await ensureAdminExpenseTables();
    const [rows] = await pool.query(
      `SELECT * FROM admin_expense_payment_attachments WHERE payment_id = ? ORDER BY id DESC`,
      [paymentId]
    );
    res.json(rows);
  } catch (e) {
    console.error('[admin-expenses] payment attachments list error', e);
    res.status(500).json({ error: 'Error loading payment attachments' });
  }
});

router.post('/payments/:paymentId/attachments', requireAuth, paymentUpload.single('file'), async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    await ensureAdminExpenseTables();
    const relUrl = `/uploads/admin-expense-payments/${paymentId}/${req.file.filename}`;
    const [result] = await pool.query(
      `INSERT INTO admin_expense_payment_attachments (payment_id, file_url, file_name)
       VALUES (?, ?, ?)`,
      [paymentId, relUrl, req.file.originalname || req.file.filename]
    );
    const [[row]] = await pool.query(
      `SELECT * FROM admin_expense_payment_attachments WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('[admin-expenses] payment attachment upload error', e);
    res.status(500).json({ error: 'Error uploading payment attachment' });
  }
});

  }
});

router.get('/:id/attachments', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureAdminExpenseTables();
    const [rows] = await pool.query(
      `SELECT * FROM admin_expense_attachments WHERE expense_id = ? ORDER BY id DESC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error('[admin-expenses] attachments list error', e);
    res.status(500).json({ error: 'Error loading attachments' });
  }
});

router.post('/:id/attachments', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    await ensureAdminExpenseTables();
    const relUrl = `/uploads/admin-expenses/${id}/${req.file.filename}`;
    const [result] = await pool.query(
      `INSERT INTO admin_expense_attachments (expense_id, file_url, file_name)
       VALUES (?, ?, ?)`,
      [id, relUrl, req.file.originalname || req.file.filename]
    );
    const [[row]] = await pool.query(
      `SELECT * FROM admin_expense_attachments WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('[admin-expenses] attachment upload error', e);
    res.status(500).json({ error: 'Error uploading attachment' });
  }
});

router.post('/recurrences', requireAuth, async (req, res) => {
  try {
    await ensureAdminExpenseTables();
    const {
      start_date,
      end_date,
      frequency,
      provider_id,
      category_id,
      subcategory_id,
      cost_center_id,
      description,
      amount,
      currency_code,
      tax_rate,
      receipt_type,
      receipt_number,
      timbrado_number,
      status,
    } = req.body || {};
    const start = toDateOnly(start_date);
    if (!start) return res.status(400).json({ error: 'start_date is required' });
    const dom = start.getUTCDate();
    const [result] = await pool.query(
      `INSERT INTO admin_expense_recurrences
       (start_date, end_date, frequency, day_of_month, next_run_date, provider_id, category_id, subcategory_id,
        cost_center_id, description, amount, currency_code, tax_rate, receipt_type, receipt_number,
        timbrado_number, status, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        formatDate(start),
        end_date || null,
        frequency || 'monthly',
        dom,
        formatDate(start),
        provider_id || null,
        category_id || null,
        subcategory_id || null,
        cost_center_id || null,
        description || '',
        Number(amount || 0),
        currency_code || 'PYG',
        tax_rate || null,
        receipt_type || null,
        receipt_number || null,
        timbrado_number || null,
        status || 'pendiente',
        req.user?.id || null,
      ]
    );
    await generateRecurringExpenses(pool);
    const [[row]] = await pool.query(
      `SELECT * FROM admin_expense_recurrences WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('[admin-expenses] recurrence error', e);
    res.status(500).json({ error: 'Error creating recurrence' });
  }
});

router.get('/recurrences', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM admin_expense_recurrences ORDER BY id DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error('[admin-expenses] recurrence list error', e);
    res.status(500).json({ error: 'Error listing recurrences' });
  }
});

router.patch('/recurrences/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    const fields = [
      'end_date',
      'active',
      'description',
      'amount',
      'currency_code',
      'category_id',
      'subcategory_id',
      'cost_center_id',
      'provider_id',
      'status',
    ];
    const sets = [];
    const params = [];
    fields.forEach((f) => {
      if (patch[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push(patch[f]);
      }
    });
    if (!sets.length) return res.json({ ok: true });
    params.push(id);
    await pool.query(
      `UPDATE admin_expense_recurrences SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    const [[row]] = await pool.query(
      `SELECT * FROM admin_expense_recurrences WHERE id = ?`,
      [id]
    );
    res.json(row);
  } catch (e) {
    console.error('[admin-expenses] recurrence update error', e);
    res.status(500).json({ error: 'Error updating recurrence' });
  }
});

router.get('/categories', requireAuth, async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM admin_expense_categories ORDER BY name');
  res.json(rows);
});

router.post('/categories', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const [result] = await pool.query(
    `INSERT INTO admin_expense_categories (name, active) VALUES (?, 1)`,
    [name]
  );
  const [[row]] = await pool.query(
    'SELECT * FROM admin_expense_categories WHERE id = ?',
    [result.insertId]
  );
  res.status(201).json(row);
});

router.get('/subcategories', requireAuth, async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM admin_expense_subcategories ORDER BY name');
  res.json(rows);
});

router.post('/subcategories', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const categoryId = req.body?.category_id || null;
  if (!name || !categoryId) {
    return res.status(400).json({ error: 'name and category_id are required' });
  }
  const [result] = await pool.query(
    `INSERT INTO admin_expense_subcategories (name, category_id, active) VALUES (?, ?, 1)`,
    [name, categoryId]
  );
  const [[row]] = await pool.query(
    'SELECT * FROM admin_expense_subcategories WHERE id = ?',
    [result.insertId]
  );
  res.status(201).json(row);
});

router.get('/cost-centers', requireAuth, async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM admin_expense_cost_centers ORDER BY name');
  res.json(rows);
});

router.post('/cost-centers', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const [result] = await pool.query(
    `INSERT INTO admin_expense_cost_centers (name, active) VALUES (?, 1)`,
    [name]
  );
  const [[row]] = await pool.query(
    'SELECT * FROM admin_expense_cost_centers WHERE id = ?',
    [result.insertId]
  );
  res.status(201).json(row);
});

router.get('/providers', requireAuth, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, razon_social, name, ruc
     FROM organizations
     WHERE LOWER(tipo_org) = 'proveedor'
     ORDER BY name`
  );
  res.json(rows);
});

router.get('/providers/search', requireAuth, async (req, res) => {
  const q = String(req.query?.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const [rows] = await pool.query(
    `SELECT id, razon_social, name, ruc
     FROM organizations
     WHERE LOWER(tipo_org) = 'proveedor'
       AND (name LIKE ? OR razon_social LIKE ? OR ruc LIKE ?)
     ORDER BY name
     LIMIT 20`,
    [like, like, like]
  );
  res.json(rows);
});

router.post('/providers', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const ruc = String(req.body?.ruc || '').trim() || null;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const [result] = await pool.query(
    `INSERT INTO organizations (razon_social, name, ruc, tipo_org, created_at, updated_at)
     VALUES (?, ?, ?, 'Proveedor', NOW(), NOW())`,
    [name, name, ruc]
  );
  const [[row]] = await pool.query(
    `SELECT id, razon_social, name, ruc
     FROM organizations
     WHERE id = ?`,
    [result.insertId]
  );
  res.status(201).json(row);
});

export default router;
