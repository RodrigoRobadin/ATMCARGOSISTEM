// server/src/routes/adminExpenses.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import ExcelJS from 'exceljs';

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
      ord INT NULL DEFAULT 0,
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
      ord INT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS admin_expense_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(40) NULL,
      name VARCHAR(160) NOT NULL,
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
      invoice_date DATE NULL,
      supplier_ruc VARCHAR(32) NULL,
      supplier_name VARCHAR(160) NULL,
      iva_10 DECIMAL(15,2) NULL,
      iva_5 DECIMAL(15,2) NULL,
      iva_exempt DECIMAL(15,2) NULL,
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
      invoice_date DATE NULL,
      supplier_ruc VARCHAR(32) NULL,
      supplier_name VARCHAR(160) NULL,
      iva_10 DECIMAL(15,2) NULL,
      iva_5 DECIMAL(15,2) NULL,
      iva_exempt DECIMAL(15,2) NULL,
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
  await ensureExpenseInvoiceColumns();
  await ensureRecurrenceInvoiceColumns();
  await ensureExpenseAccountColumns();
  await ensureExpensePurchaseColumns();
  await ensureRecurrencePurchaseColumns();
  await ensureExpenseItemsTable();
  await ensureCategoryOrderColumns();
  await ensureSubcategoryOrderColumns();

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

  await seedAdminExpenseMasters();
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

async function ensureExpenseInvoiceColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_expenses'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('invoice_date')) add.push('ADD COLUMN invoice_date DATE NULL');
    if (!have.has('supplier_ruc')) add.push('ADD COLUMN supplier_ruc VARCHAR(32) NULL');
    if (!have.has('supplier_name')) add.push('ADD COLUMN supplier_name VARCHAR(160) NULL');
    if (!have.has('iva_10')) add.push('ADD COLUMN iva_10 DECIMAL(15,2) NULL');
    if (!have.has('iva_5')) add.push('ADD COLUMN iva_5 DECIMAL(15,2) NULL');
    if (!have.has('iva_exempt')) add.push('ADD COLUMN iva_exempt DECIMAL(15,2) NULL');
    if (add.length) {
      await pool.query(`ALTER TABLE admin_expenses ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[admin-expenses] ensure expense columns error', e?.message || e);
  }
}

async function ensureRecurrenceInvoiceColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_expense_recurrences'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('invoice_date')) add.push('ADD COLUMN invoice_date DATE NULL');
    if (!have.has('supplier_ruc')) add.push('ADD COLUMN supplier_ruc VARCHAR(32) NULL');
    if (!have.has('supplier_name')) add.push('ADD COLUMN supplier_name VARCHAR(160) NULL');
    if (!have.has('iva_10')) add.push('ADD COLUMN iva_10 DECIMAL(15,2) NULL');
    if (!have.has('iva_5')) add.push('ADD COLUMN iva_5 DECIMAL(15,2) NULL');
    if (!have.has('iva_exempt')) add.push('ADD COLUMN iva_exempt DECIMAL(15,2) NULL');
    if (add.length) {
      await pool.query(`ALTER TABLE admin_expense_recurrences ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[admin-expenses] ensure recurrence columns error', e?.message || e);
  }
}

async function ensureExpenseAccountColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_expenses'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('account_id')) add.push('ADD COLUMN account_id INT NULL');
    if (add.length) {
      await pool.query(`ALTER TABLE admin_expenses ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[admin-expenses] ensure account columns error', e?.message || e);
  }
}

async function ensureExpensePurchaseColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_expenses'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('condition_type')) add.push('ADD COLUMN condition_type VARCHAR(20) NULL');
    if (!have.has('due_date')) add.push('ADD COLUMN due_date DATE NULL');
    if (!have.has('buyer_ruc')) add.push('ADD COLUMN buyer_ruc VARCHAR(32) NULL');
    if (!have.has('buyer_name')) add.push('ADD COLUMN buyer_name VARCHAR(160) NULL');
    if (!have.has('tax_mode')) add.push('ADD COLUMN tax_mode VARCHAR(16) NULL');
    if (!have.has('gravado_10')) add.push('ADD COLUMN gravado_10 DECIMAL(15,2) NULL');
    if (!have.has('gravado_5')) add.push('ADD COLUMN gravado_5 DECIMAL(15,2) NULL');
    if (!have.has('iva_no_taxed')) add.push('ADD COLUMN iva_no_taxed DECIMAL(15,2) NULL');
    if (!have.has('exchange_rate')) add.push('ADD COLUMN exchange_rate DECIMAL(15,2) NULL');
    if (add.length) {
      await pool.query(`ALTER TABLE admin_expenses ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[admin-expenses] ensure purchase columns error', e?.message || e);
  }
}

async function ensureRecurrencePurchaseColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_expense_recurrences'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('condition_type')) add.push('ADD COLUMN condition_type VARCHAR(20) NULL');
    if (!have.has('due_date')) add.push('ADD COLUMN due_date DATE NULL');
    if (!have.has('buyer_ruc')) add.push('ADD COLUMN buyer_ruc VARCHAR(32) NULL');
    if (!have.has('buyer_name')) add.push('ADD COLUMN buyer_name VARCHAR(160) NULL');
    if (!have.has('tax_mode')) add.push('ADD COLUMN tax_mode VARCHAR(16) NULL');
    if (!have.has('gravado_10')) add.push('ADD COLUMN gravado_10 DECIMAL(15,2) NULL');
    if (!have.has('gravado_5')) add.push('ADD COLUMN gravado_5 DECIMAL(15,2) NULL');
    if (!have.has('iva_no_taxed')) add.push('ADD COLUMN iva_no_taxed DECIMAL(15,2) NULL');
    if (!have.has('exchange_rate')) add.push('ADD COLUMN exchange_rate DECIMAL(15,2) NULL');
    if (add.length) {
      await pool.query(`ALTER TABLE admin_expense_recurrences ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[admin-expenses] ensure recurrence purchase columns error', e?.message || e);
  }
}

async function ensureExpenseItemsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_expense_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        expense_id INT NOT NULL,
        description VARCHAR(255) NOT NULL,
        quantity DECIMAL(15,2) NOT NULL DEFAULT 1,
        unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
        tax_rate DECIMAL(5,2) NOT NULL DEFAULT 10,
        subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_expense (expense_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error('[admin-expenses] ensure items table error', e?.message || e);
  }
}

async function ensureCategoryOrderColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_expense_categories'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (!have.has('ord')) {
      await pool.query(`ALTER TABLE admin_expense_categories ADD COLUMN ord INT NULL DEFAULT 0`);
    }
  } catch (e) {
    console.error('[admin-expenses] ensure category ord error', e?.message || e);
  }
}

async function ensureSubcategoryOrderColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_expense_subcategories'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (!have.has('ord')) {
      await pool.query(
        `ALTER TABLE admin_expense_subcategories ADD COLUMN ord INT NULL DEFAULT 0`
      );
    }
  } catch (e) {
    console.error('[admin-expenses] ensure subcategory ord error', e?.message || e);
  }
}

async function seedAdminExpenseMasters() {
  try {
    const categories = {
      'Servicios básicos': ['ANDE', 'ESSAP'],
      'Telefonía e internet': ['CLARO', 'PERSONAL', 'COPACO LINEAS TELEFONICAS'],
      'Alquileres': ['ALQUILER OFICINA'],
      'Viáticos y viajes': ['VIATICO / HOTEL VIAJES'],
      'Impuestos y tasas': ['PATENTE', 'IPS', 'SET'],
      'Caja chica': ['CAJA CHICA RAYFLEX'],
      'Combustible y flota': [
        'COMBUSTIBLE / FLOTA BR',
        'COMBUSTIBLE / FLOTA PETROBRAS',
        'MANTENIMIENTO CAMIONETAS / GSTO CAMIONETA',
        'SEGURO SAVEIRO ROJO DEBITO',
        'SEGURO NOAH DEBITO',
        'SEGURO GOLCITO DEBITO',
        'SEGURO SAVEIRO GRIS',
        'SEGURO AMAROK DEBITO',
      ],
      'Gastos financieros': [
        'GASTOS FINANCIEROS CTA USD Y GS',
        'TARJETA DE CREDITO ITAU',
        'PRESTAMO ITAU / CAPITAL OPERATIVO',
        'PRESTAMO ITAU',
      ],
      'Administración general': ['GASTOS VARIOS', 'GESTIONES / MOTO TAXI', 'TRAMITES JUDICIALES'],
      'Regalos y eventos': ['REGALOS NAVIDEÑOS', 'EXPO LOGISTICA / PUBLICIDAD', 'CLUB DE EJECUTIVO'],
      'Oficina y suministros': ['UTILES DE OFICINA', 'IMPRENTA'],
      'Sistemas y software': ['SISTEMA', 'EQUIFAX', 'HOSTIN', 'MONITAL'],
      'Mantenimiento y equipamientos': ['MANTENIMIENTO Y EQUIPAMIENTOS', 'TUPI', 'MODICA'],
      'Nómina': ['SUELDOS Y EXTRAS RAYFLEX', 'SUELDOS ATM', 'VACACIONES- AGUINALDOS - LIQUIDACION'],
      'Activos fijos': ['COMPRA NOAH', 'COMPRA AMAROK', 'COMPRA SAVEIRO', 'COMPRA GOLCITO'],
      'Otros': ['ATOLPAR'],
    };

    for (const [catName, subs] of Object.entries(categories)) {
      const [[cat]] = await pool.query(
        `SELECT id FROM admin_expense_categories WHERE name = ? LIMIT 1`,
        [catName]
      );
      let catId = cat?.id;
      if (!catId) {
        const [ins] = await pool.query(
          `INSERT INTO admin_expense_categories (name, active) VALUES (?, 1)`,
          [catName]
        );
        catId = ins.insertId;
      }
      for (const subName of subs) {
        const [[sub]] = await pool.query(
          `SELECT id FROM admin_expense_subcategories WHERE name = ? AND category_id = ? LIMIT 1`,
          [subName, catId]
        );
        if (!sub?.id) {
          await pool.query(
            `INSERT INTO admin_expense_subcategories (name, category_id, active) VALUES (?, ?, 1)`,
            [subName, catId]
          );
        }
      }
    }

    const [[cc]] = await pool.query(
      `SELECT id FROM admin_expense_cost_centers WHERE name = 'IPS' LIMIT 1`
    );
    if (!cc?.id) {
      await pool.query(
        `INSERT INTO admin_expense_cost_centers (name, active) VALUES ('IPS', 1)`
      );
    }
  } catch (e) {
    console.error('[admin-expenses] seed masters error', e?.message || e);
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
          invoice_date, supplier_ruc, supplier_name, iva_10, iva_5, iva_exempt,
          amount, currency_code, tax_rate, receipt_type, receipt_number, timbrado_number, status,
          recurrence_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          expenseDate,
          rec.provider_id || null,
          rec.category_id || null,
          rec.subcategory_id || null,
          rec.cost_center_id || null,
          rec.description || '',
          rec.invoice_date || null,
          rec.supplier_ruc || null,
          rec.supplier_name || null,
          rec.iva_10 || null,
          rec.iva_5 || null,
          rec.iva_exempt || null,
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

async function getUpcomingRecurrenceDates(rec, count = 6) {
  const dates = [];
  const start = toDateOnly(rec.next_run_date || rec.start_date);
  if (!start) return dates;
  const endDate = toDateOnly(rec.end_date);
  const dom = rec.day_of_month || new Date(rec.start_date).getDate();
  let cursor = start;
  while (dates.length < count) {
    if (!endDate || cursor <= endDate) {
      dates.push(formatDate(cursor));
    } else {
      break;
    }
    cursor = addMonths(cursor, 1, dom);
  }
  return dates;
}

function computeNextRunDate(rec) {
  const explicit = toDateOnly(rec.next_run_date);
  if (explicit) return explicit;
  const start = toDateOnly(rec.start_date);
  if (!start) return null;
  const dom = rec.day_of_month || new Date(rec.start_date).getDate();
  const today = toDateOnly(new Date());
  let cursor = start;
  while (cursor < today) {
    cursor = addMonths(cursor, 1, dom);
  }
  return cursor;
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
      `SELECT * FROM admin_expense_categories ORDER BY ord, name`
    );
    const [subcategories] = await pool.query(
      `SELECT * FROM admin_expense_subcategories ORDER BY ord, name`
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
    const { from_date, to_date, status, category_id, cost_center_id, provider_id, currency_code, recurrence_id } =
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
    if (recurrence_id) {
      where.push('e.recurrence_id = ?');
      params.push(recurrence_id);
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
      invoice_date,
      supplier_ruc,
      supplier_name,
      iva_10,
      iva_5,
      iva_exempt,
      condition_type,
      due_date,
      buyer_ruc,
      buyer_name,
      tax_mode,
      gravado_10,
      gravado_5,
      iva_no_taxed,
      exchange_rate,
      amount,
      currency_code,
      tax_rate,
      receipt_type,
      receipt_number,
      timbrado_number,
      status,
      items,
    } = req.body || {};

    const [result] = await pool.query(
      `INSERT INTO admin_expenses
       (expense_date, provider_id, category_id, subcategory_id, cost_center_id, description,
        invoice_date, supplier_ruc, supplier_name, iva_10, iva_5, iva_exempt,
        condition_type, due_date, buyer_ruc, buyer_name, tax_mode,
        gravado_10, gravado_5, iva_no_taxed, exchange_rate,
        amount, currency_code, tax_rate, receipt_type, receipt_number, timbrado_number, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expense_date,
        provider_id || null,
        category_id || null,
        subcategory_id || null,
        cost_center_id || null,
        description || '',
        invoice_date || null,
        supplier_ruc || null,
        supplier_name || null,
        Number(iva_10 || 0) || null,
        Number(iva_5 || 0) || null,
        Number(iva_exempt || 0) || null,
        condition_type || null,
        due_date || null,
        buyer_ruc || null,
        buyer_name || null,
        tax_mode || null,
        Number(gravado_10 || 0) || null,
        Number(gravado_5 || 0) || null,
        Number(iva_no_taxed || 0) || null,
        Number(exchange_rate || 0) || null,
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
    if (Array.isArray(items) && items.length) {
      const rows = items.map((it) => [
        result.insertId,
        String(it.description || ''),
        Number(it.quantity || 0) || 0,
        Number(it.unit_price || 0) || 0,
        Number(it.tax_rate ?? 10),
        Number(it.subtotal || 0) || 0,
      ]);
      await pool.query(
        `INSERT INTO admin_expense_items
         (expense_id, description, quantity, unit_price, tax_rate, subtotal)
         VALUES ?`,
        [rows]
      );
    }
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
      'condition_type',
      'due_date',
      'buyer_ruc',
      'buyer_name',
      'tax_mode',
      'gravado_10',
      'gravado_5',
      'iva_no_taxed',
      'exchange_rate',
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
  }
});

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

router.get('/:id/items', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureAdminExpenseTables();
    const [rows] = await pool.query(
      `SELECT * FROM admin_expense_items WHERE expense_id = ? ORDER BY id ASC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error('[admin-expenses] items list error', e);
    res.status(500).json({ error: 'Error loading items' });
  }
});

router.put('/:id/items', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    await ensureAdminExpenseTables();
    await pool.query(`DELETE FROM admin_expense_items WHERE expense_id = ?`, [id]);
    if (items.length) {
      const rows = items.map((it) => [
        id,
        String(it.description || ''),
        Number(it.quantity || 0) || 0,
        Number(it.unit_price || 0) || 0,
        Number(it.tax_rate ?? 10),
        Number(it.subtotal || 0) || 0,
      ]);
      await pool.query(
        `INSERT INTO admin_expense_items
         (expense_id, description, quantity, unit_price, tax_rate, subtotal)
         VALUES ?`,
        [rows]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-expenses] items update error', e);
    res.status(500).json({ error: 'Error saving items' });
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
      invoice_date,
      supplier_ruc,
      supplier_name,
      iva_10,
      iva_5,
      iva_exempt,
      condition_type,
      due_date,
      buyer_ruc,
      buyer_name,
      tax_mode,
      gravado_10,
      gravado_5,
      iva_no_taxed,
      exchange_rate,
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
        cost_center_id, description, invoice_date, supplier_ruc, supplier_name, iva_10, iva_5, iva_exempt,
        condition_type, due_date, buyer_ruc, buyer_name, tax_mode, gravado_10, gravado_5, iva_no_taxed, exchange_rate,
        amount, currency_code, tax_rate, receipt_type, receipt_number, timbrado_number, status, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        invoice_date || null,
        supplier_ruc || null,
        supplier_name || null,
        Number(iva_10 || 0) || null,
        Number(iva_5 || 0) || null,
        Number(iva_exempt || 0) || null,
        condition_type || null,
        due_date || null,
        buyer_ruc || null,
        buyer_name || null,
        tax_mode || null,
        Number(gravado_10 || 0) || null,
        Number(gravado_5 || 0) || null,
        Number(iva_no_taxed || 0) || null,
        Number(exchange_rate || 0) || null,
        Number(amount || 0),
        currency_code || 'PYG',
        tax_rate || null,
        receipt_type || null,
        receipt_number || null,
        timbrado_number || null,
        status || 'pendiente',
        1,
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
  const [rows] = await pool.query(
    'SELECT * FROM admin_expense_categories ORDER BY ord, name'
  );
  res.json(rows);
});

router.get('/recurrences/upcoming', requireAuth, async (req, res) => {
  try {
    const count = Number(req.query?.count || 6) || 6;
    await generateRecurringExpenses(pool);
    const [rows] = await pool.query(
      `SELECT r.*, c.name AS category_name, sc.name AS subcategory_name,
              cc.name AS cost_center_name, org.name AS provider_name, org.razon_social AS provider_razon
         FROM admin_expense_recurrences r
         LEFT JOIN admin_expense_categories c ON c.id = r.category_id
         LEFT JOIN admin_expense_subcategories sc ON sc.id = r.subcategory_id
         LEFT JOIN admin_expense_cost_centers cc ON cc.id = r.cost_center_id
         LEFT JOIN organizations org ON org.id = r.provider_id
        WHERE r.active = 1
        ORDER BY r.next_run_date ASC, r.id DESC`
    );
    const out = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        description: r.description || '',
        category_name: r.category_name || '',
        subcategory_name: r.subcategory_name || '',
        cost_center_name: r.cost_center_name || '',
        provider_name: r.provider_razon || r.provider_name || '',
        currency_code: r.currency_code || 'PYG',
        amount: r.amount,
        next_dates: await getUpcomingRecurrenceDates(
          { ...r, next_run_date: r.next_run_date || computeNextRunDate(r) },
          count
        ),
      }))
    );
    res.json(out);
  } catch (e) {
    console.error('[admin-expenses] upcoming recurrences error', e);
    res.status(500).json({ error: 'Error loading upcoming recurrences' });
  }
});

router.post('/recurrences/run', requireAuth, async (_req, res) => {
  try {
    await generateRecurringExpenses(pool);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-expenses] recurrences run error', e);
    res.status(500).json({ error: 'Error running recurrences' });
  }
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

router.patch('/categories/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    const fields = ['name', 'active', 'ord'];
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
    await pool.query(`UPDATE admin_expense_categories SET ${sets.join(', ')} WHERE id = ?`, params);
    const [[row]] = await pool.query(
      'SELECT * FROM admin_expense_categories WHERE id = ?',
      [id]
    );
    res.json(row);
  } catch (e) {
    console.error('[admin-expenses] category update error', e);
    res.status(500).json({ error: 'Error updating category' });
  }
});

router.get('/subcategories', requireAuth, async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM admin_expense_subcategories ORDER BY ord, name'
  );
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

router.patch('/subcategories/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    const fields = ['name', 'active', 'ord', 'category_id'];
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
      `UPDATE admin_expense_subcategories SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    const [[row]] = await pool.query(
      'SELECT * FROM admin_expense_subcategories WHERE id = ?',
      [id]
    );
    res.json(row);
  } catch (e) {
    console.error('[admin-expenses] subcategory update error', e);
    res.status(500).json({ error: 'Error updating subcategory' });
  }
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

router.get('/export', requireAuth, async (req, res) => {
  try {
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
      SELECT e.expense_date, e.invoice_date, e.receipt_type, e.receipt_number, e.timbrado_number,
             e.supplier_ruc, e.supplier_name, e.iva_10, e.iva_5, e.iva_exempt, e.amount,
             e.currency_code, e.tax_rate, e.condition_type, e.due_date, e.buyer_ruc, e.buyer_name,
             e.tax_mode, e.gravado_10, e.gravado_5, e.iva_no_taxed, e.exchange_rate,
             c.name AS category_name, sc.name AS subcategory_name,
             cc.name AS cost_center_name
        FROM admin_expenses e
        LEFT JOIN admin_expense_categories c ON c.id = e.category_id
        LEFT JOIN admin_expense_subcategories sc ON sc.id = e.subcategory_id
        LEFT JOIN admin_expense_cost_centers cc ON cc.id = e.cost_center_id
        ${whereSql}
        ORDER BY e.expense_date DESC, e.id DESC
      `,
      params
    );

    const [payments] = await pool.query(
      `
      SELECT p.payment_date, p.amount, p.currency_code, p.method, p.account, p.reference_number, p.status,
             e.id AS expense_id, e.expense_date, e.description,
             COALESCE(org.razon_social, org.name) AS provider_name
        FROM admin_expense_payments p
        JOIN admin_expenses e ON e.id = p.expense_id
        LEFT JOIN organizations org ON org.id = e.provider_id
      `
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CRM';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Libro de compras');
    sheet.addRow([
      'Fecha gasto',
      'Fecha factura',
      'Tipo',
      'Comprobante',
      'Timbrado',
      'RUC proveedor',
      'Proveedor',
      'IVA 10',
      'IVA 5',
      'Exento',
      'Total',
      'Moneda',
      'TC',
      'Condicion',
      'Vencimiento',
      'RUC comprador',
      'Comprador',
      'Tipo IVA',
      'Gravado 10',
      'Gravado 5',
      'No gravado',
      'Tipo de cambio',
      'Categoría',
      'Subcategoría',
      'Centro de costo',
    ]);
    rows.forEach((r) => {
      sheet.addRow([
        r.expense_date,
        r.invoice_date,
        r.receipt_type,
        r.receipt_number,
        r.timbrado_number,
        r.supplier_ruc,
        r.supplier_name,
        r.iva_10,
        r.iva_5,
        r.iva_exempt,
        r.amount,
        r.currency_code,
        r.tax_rate,
        r.condition_type,
        r.due_date,
        r.buyer_ruc,
        r.buyer_name,
        r.tax_mode,
        r.gravado_10,
        r.gravado_5,
        r.iva_no_taxed,
        r.exchange_rate,
        r.category_name,
        r.subcategory_name,
        r.cost_center_name,
      ]);
    });

    const paySheet = wb.addWorksheet('Pagos');
    paySheet.addRow([
      'Fecha pago',
      'Gasto ID',
      'Fecha gasto',
      'Proveedor',
      'Descripción',
      'Monto',
      'Moneda',
      'Método',
      'Cuenta',
      'Referencia',
      'Estado',
    ]);
    payments.forEach((p) => {
      paySheet.addRow([
        p.payment_date,
        p.expense_id,
        p.expense_date,
        p.provider_name,
        p.description,
        p.amount,
        p.currency_code,
        p.method,
        p.account,
        p.reference_number,
        p.status,
      ]);
    });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="libro-compras-administrativo.xlsx"`
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[admin-expenses] export error', e);
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

router.get('/report', requireAuth, async (req, res) => {
  try {
    const { from_date, to_date, status, currency_code } = req.query || {};
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
    if (currency_code) {
      where.push('e.currency_code = ?');
      params.push(currency_code);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [byCostCenter] = await pool.query(
      `
      SELECT cc.name AS cost_center_name, e.currency_code, SUM(e.amount) AS total
        FROM admin_expenses e
        LEFT JOIN admin_expense_cost_centers cc ON cc.id = e.cost_center_id
        ${whereSql}
       GROUP BY cc.name, e.currency_code
       ORDER BY total DESC
      `,
      params
    );

    res.json({ byCostCenter });
  } catch (e) {
    console.error('[admin-expenses] report error', e);
    res.status(500).json({ error: 'No se pudo cargar el reporte' });
  }
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


