// server/src/routes/adminExpenses.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';
import { ensureSupplierCreditNoteTables, recalculateSupplierDocument } from '../services/supplierCreditNotes.js';
import ExcelJS from 'exceljs';

const router = Router();

const ADMIN_EXPENSE_CORE_CATEGORIES = [
  { system_key: 'ADMINISTRACION', name: 'Administración', ord: 10 },
  { system_key: 'OPERATIVO', name: 'Operativo', ord: 20 },
];

const ADMIN_EXPENSE_CORE_SUBCATEGORIES = [
  { system_key: 'FIJOS', name: 'Fijos', ord: 10 },
  { system_key: 'VARIABLES', name: 'Variables', ord: 20 },
];

const ADMIN_EXPENSE_COST_CENTERS = [
  'ALQUILER OFICINA',
  'ANDE',
  'ESSAP',
  'CLARO',
  'PERSONAL',
  'COPACO LINEAS TELEFONICAS',
  'MODICA',
  'VIATICO / HOTEL VIAJES ALEJO',
  'VIATICO / HOTEL VIAJES RODRIGO',
  'PATENTE',
  'CAJA CHICA RAYFLEX',
  'LIMPIEZA',
  'COMBUSTIBLE',
  'COMBUSTIBLE / FLOTA BR',
  'COMBUSTIBLE / FLOTA PETROBRAS',
  'GASTOS VARIOS',
  'UNIFORMES',
  'REGALOS NAVIDEÑOS',
  'UTILES DE OFICINA',
  'GASTOS FINANCIEROS CTA USD Y GS',
  'GESTIONES / MOTO TAXI',
  'SEGURO SAVEIRO ROJO DEBITO',
  'SEGURO NOAH DEBITO',
  'SEGURO GOLCITO DEBITO',
  'SEGURO SAVEIRO GRIS',
  'SEGURO AMAROK DEBITO',
  'SEGURO ADUANA',
  'ATOLPAR',
  'CLUB DE EJECUTIVO',
  'IPS',
  'SET',
  'SISTEMA',
  'MANTENIMIENTO Y EQUIPAMIENTOS',
  'TUPI',
  'TRAMITES JUDICIALES',
  'MONITAL',
  'GPS',
  'HONORARIOS CONTABILIDAD',
  'SUELDOS Y EXTRAS RAYFLEX',
  'SUELDOS ATM',
  'VACACIONES - AGUINALDOS - LIQUIDACION',
  'IMPRENTA',
  'HOSTIN',
  'HABILITACIONES',
  'EXPO LOGISTICA / PUBLICIDAD',
  'MANTENIMIENTO NOAH',
  'MANTENIMIENTO AMAROK',
  'MANTENIMIENTO SAVEIRO',
  'TARJETA DE CREDITO ITAU',
  'PRESTAMO ITAU / CAPITAL OPERATIVO',
  'INTERES PRESTAMO OPERATIVO',
  'PRESTAMO ITAU',
  'COMPRA AMAROK',
  'COMPRA SAVEIRO',
  'COMPRA GOLCITO',
];

function normalizeMasterName(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

router.use(requireAuth, requireAnyRole('admin', 'manager', 'finanzas'));

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
      system_key VARCHAR(40) NULL,
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
      system_key VARCHAR(40) NULL,
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
      ord INT NULL DEFAULT 0,
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
      notes TEXT NULL,
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
  await ensureAdminExpensePaymentOrdersTable();
  await ensureExpenseItemsTable();
  await ensureCategoryOrderColumns();
  await ensureSubcategoryOrderColumns();
  await ensureCostCenterOrderColumns();

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
    if (!have.has('notes')) add.push('ADD COLUMN notes TEXT NULL');
    if (!have.has('payment_order_id')) add.push('ADD COLUMN payment_order_id INT NULL');
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
    if (!have.has('credit_days')) add.push('ADD COLUMN credit_days INT NULL');
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

async function ensureAdminExpensePaymentOrdersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_expense_payment_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_number VARCHAR(32) NULL,
      expense_id INT NOT NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      payment_method VARCHAR(40) NULL,
      payment_date DATE NULL,
      description VARCHAR(255) NULL,
      observations TEXT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pendiente',
      requested_by INT NULL,
      approved_by INT NULL,
      requested_at DATETIME NULL,
      approved_at DATETIME NULL,
      canceled_by INT NULL,
      canceled_at DATETIME NULL,
      cancel_reason TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_admin_expense_op_expense (expense_id),
      INDEX idx_admin_expense_op_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
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
    const add = [];
    if (!have.has('ord')) add.push('ADD COLUMN ord INT NULL DEFAULT 0');
    if (!have.has('system_key')) add.push('ADD COLUMN system_key VARCHAR(40) NULL');
    if (add.length) {
      await pool.query(`ALTER TABLE admin_expense_categories ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[admin-expenses] ensure category columns error', e?.message || e);
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
    const add = [];
    if (!have.has('ord')) add.push('ADD COLUMN ord INT NULL DEFAULT 0');
    if (!have.has('system_key')) add.push('ADD COLUMN system_key VARCHAR(40) NULL');
    if (add.length) {
      await pool.query(`ALTER TABLE admin_expense_subcategories ${add.join(', ')}`);
    }
  } catch (e) {
    console.error('[admin-expenses] ensure subcategory columns error', e?.message || e);
  }
}

async function ensureCostCenterOrderColumns() {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_expense_cost_centers'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (!have.has('ord')) {
      await pool.query(
        `ALTER TABLE admin_expense_cost_centers ADD COLUMN ord INT NULL DEFAULT 0`
      );
    }
  } catch (e) {
    console.error('[admin-expenses] ensure cost center columns error', e?.message || e);
  }
}

async function seedAdminExpenseMasters() {
  try {
    const categoryIds = new Map();
    for (const category of ADMIN_EXPENSE_CORE_CATEGORIES) {
      const [[existing]] = await pool.query(
        `SELECT id FROM admin_expense_categories WHERE system_key = ? LIMIT 1`,
        [category.system_key]
      );
      let categoryId = existing?.id;
      if (!categoryId) {
        const [result] = await pool.query(
          `INSERT INTO admin_expense_categories (name, system_key, ord, active)
           VALUES (?, ?, ?, 1)`,
          [category.name, category.system_key, category.ord]
        );
        categoryId = result.insertId;
      }
      categoryIds.set(category.system_key, categoryId);

      for (const subcategory of ADMIN_EXPENSE_CORE_SUBCATEGORIES) {
        const [[existingSubcategory]] = await pool.query(
          `SELECT id
             FROM admin_expense_subcategories
            WHERE category_id = ? AND system_key = ?
            LIMIT 1`,
          [categoryId, subcategory.system_key]
        );
        if (!existingSubcategory?.id) {
          await pool.query(
            `INSERT INTO admin_expense_subcategories
             (category_id, name, system_key, ord, active)
             VALUES (?, ?, ?, ?, 1)`,
            [categoryId, subcategory.name, subcategory.system_key, subcategory.ord]
          );
        }
      }
    }

    const [existingCenters] = await pool.query(
      `SELECT id, name FROM admin_expense_cost_centers ORDER BY id`
    );
    const centerByName = new Map(
      existingCenters.map((row) => [normalizeMasterName(row.name), row])
    );
    for (let index = 0; index < ADMIN_EXPENSE_COST_CENTERS.length; index += 1) {
      const name = ADMIN_EXPENSE_COST_CENTERS[index];
      if (!centerByName.has(normalizeMasterName(name))) {
        const [result] = await pool.query(
          `INSERT INTO admin_expense_cost_centers (name, ord, active)
           VALUES (?, ?, 1)`,
          [name, (index + 1) * 10]
        );
        centerByName.set(normalizeMasterName(name), { id: result.insertId, name });
      }
    }

    const migration = await getParamValue('admin_expense_classification_v2_migrated', pool);
    if (migration?.value !== '1') {
      const adminCategoryId = categoryIds.get('ADMINISTRACION');
      const [[fixedSubcategory]] = await pool.query(
        `SELECT id
           FROM admin_expense_subcategories
          WHERE category_id = ? AND system_key = 'FIJOS'
          LIMIT 1`,
        [adminCategoryId]
      );
      const [legacySubcategories] = await pool.query(
        `SELECT id, name
           FROM admin_expense_subcategories
          WHERE system_key IS NULL`
      );
      for (const subcategory of legacySubcategories) {
        const center = centerByName.get(normalizeMasterName(subcategory.name));
        if (!center?.id) continue;
        await pool.query(
          `UPDATE admin_expenses
              SET cost_center_id = COALESCE(cost_center_id, ?)
            WHERE subcategory_id = ?`,
          [center.id, subcategory.id]
        );
        await pool.query(
          `UPDATE admin_expense_recurrences
              SET cost_center_id = COALESCE(cost_center_id, ?)
            WHERE subcategory_id = ?`,
          [center.id, subcategory.id]
        );
      }

      await pool.query(
        `UPDATE admin_expenses e
         LEFT JOIN admin_expense_categories c ON c.id = e.category_id
            SET e.category_id = ?, e.subcategory_id = NULL
          WHERE e.category_id IS NULL OR c.system_key IS NULL`,
        [adminCategoryId]
      );
      await pool.query(
        `UPDATE admin_expense_recurrences r
         LEFT JOIN admin_expense_categories c ON c.id = r.category_id
            SET r.category_id = ?, r.subcategory_id = ?
          WHERE r.category_id IS NULL OR c.system_key IS NULL`,
        [adminCategoryId, fixedSubcategory?.id || null]
      );
      await pool.query(
        `UPDATE admin_expense_categories SET active = 0 WHERE system_key IS NULL`
      );
      await pool.query(
        `UPDATE admin_expense_subcategories SET active = 0 WHERE system_key IS NULL`
      );
      await upsertParam('admin_expense_classification_v2_migrated', '1', pool);
    }
  } catch (e) {
    console.error('[admin-expenses] seed masters error', e?.message || e);
  }
}

async function validateExpenseClassification(input) {
  const categoryId = Number(input?.category_id);
  const subcategoryId = Number(input?.subcategory_id);
  const costCenterId = Number(input?.cost_center_id);
  if (!categoryId || !subcategoryId || !costCenterId) {
    return { error: 'Categoría, subcategoría y centro de costo son obligatorios' };
  }

  const [[category]] = await pool.query(
    `SELECT id FROM admin_expense_categories WHERE id = ? AND active = 1 LIMIT 1`,
    [categoryId]
  );
  if (!category) return { error: 'La categoría seleccionada no está disponible' };

  const [[subcategory]] = await pool.query(
    `SELECT id
       FROM admin_expense_subcategories
      WHERE id = ? AND category_id = ? AND active = 1
      LIMIT 1`,
    [subcategoryId, categoryId]
  );
  if (!subcategory) {
    return { error: 'La subcategoría no corresponde a la categoría seleccionada' };
  }

  const [[costCenter]] = await pool.query(
    `SELECT id FROM admin_expense_cost_centers WHERE id = ? AND active = 1 LIMIT 1`,
    [costCenterId]
  );
  if (!costCenter) return { error: 'El centro de costo seleccionado no está disponible' };

  return {
    category_id: categoryId,
    subcategory_id: subcategoryId,
    cost_center_id: costCenterId,
  };
}

async function findDuplicateMaster(table, name, options = {}) {
  const [rows] = await pool.query(
    `SELECT id, name FROM ${table} ${options.categoryId ? 'WHERE category_id = ?' : ''}`,
    options.categoryId ? [options.categoryId] : []
  );
  const normalized = normalizeMasterName(name);
  return rows.find(
    (row) =>
      Number(row.id) !== Number(options.excludeId || 0) &&
      normalizeMasterName(row.name) === normalized
  );
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

function addDaysToDate(value, days) {
  const base = toDateOnly(value);
  const count = Number(days);
  if (!base || !Number.isFinite(count) || count < 0) return null;
  base.setUTCDate(base.getUTCDate() + Math.trunc(count));
  return formatDate(base);
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
      `SELECT * FROM admin_expense_cost_centers ORDER BY ord, name`
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
    await ensureSupplierCreditNoteTables();
    const { from_date, to_date, status, category_id, cost_center_id, provider_id, currency_code, recurrence_id, q } =
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
    if (q) {
      const like = `%${String(q).trim()}%`;
      where.push(`(
        e.description LIKE ?
        OR e.receipt_number LIKE ?
        OR e.timbrado_number LIKE ?
        OR e.supplier_name LIKE ?
        OR e.supplier_ruc LIKE ?
        OR COALESCE(p.razon_social, p.name) LIKE ?
        OR p.ruc LIKE ?
      )`);
      params.push(like, like, like, like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `
      SELECT e.*,
             COALESCE(p.razon_social, p.name, e.supplier_name) AS provider_name,
             COALESCE(p.ruc, e.supplier_ruc) AS provider_ruc,
             p.supplier_bank_name,
             p.supplier_bank_account,
             p.supplier_bank_currency,
             p.supplier_bank_account_type,
             p.supplier_bank_holder,
             p.supplier_bank_holder_ruc,
             p.supplier_bank_cci_iban,
             p.supplier_bank_swift,
             c.name AS category_name,
             sc.name AS subcategory_name,
             cc.name AS cost_center_name,
             (
               SELECT COALESCE(SUM(amount),0)
               FROM admin_expense_payments pay
               WHERE pay.expense_id = e.id AND pay.status <> 'anulado'
             ) AS paid_amount,
             po.id AS payment_order_id,
             po.order_number AS payment_order_number,
             po.status AS payment_order_status,
             po.amount AS payment_order_amount,
             EXISTS(
               SELECT 1
               FROM admin_expense_attachments att
               WHERE att.expense_id = e.id
               LIMIT 1
             ) AS has_attachment
        FROM admin_expenses e
        LEFT JOIN organizations p ON p.id = e.provider_id
        LEFT JOIN admin_expense_categories c ON c.id = e.category_id
        LEFT JOIN admin_expense_subcategories sc ON sc.id = e.subcategory_id
        LEFT JOIN admin_expense_cost_centers cc ON cc.id = e.cost_center_id
        LEFT JOIN admin_expense_payment_orders po
          ON po.id = (
            SELECT po2.id
              FROM admin_expense_payment_orders po2
             WHERE po2.expense_id = e.id
               AND po2.status <> 'anulada'
             ORDER BY po2.id DESC
             LIMIT 1
          )
        ${whereSql}
        ORDER BY e.expense_date DESC, e.id DESC
      `,
      params
    );
    const out = (rows || []).map((row) => {
      const amount = Number(row.net_amount ?? row.amount ?? 0);
      const paid = Number(row.paid_amount || 0);
      const balance = Math.max(0, amount - paid);
      const statusRaw = String(row.status || '').toLowerCase();
      const condition = String(row.condition_type || '').toUpperCase();
      const todayIso = new Date().toISOString().slice(0, 10);
      const isOverdue =
        statusRaw !== 'anulado' &&
        statusRaw !== 'pagado' &&
        balance > 0.009 &&
        row.due_date &&
        String(row.due_date).slice(0, 10) < todayIso;
      let payableStatus = 'por_pagar';
      if (statusRaw === 'anulado') payableStatus = 'anulado';
      else if (balance <= 0.009 || statusRaw === 'pagado') payableStatus = 'pagado';
      else if (isOverdue) payableStatus = 'vencido';
      else if (condition === 'CONTADO') payableStatus = 'contado_pendiente';
      return {
        ...row,
        paid_amount: Number(paid.toFixed(2)),
        balance: Number(balance.toFixed(2)),
        is_overdue: Boolean(isOverdue),
        has_attachment: Number(row.has_attachment || 0) > 0,
        payable_status: payableStatus,
      };
    });
    res.json(out);
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
      credit_days,
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

    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'El monto del gasto debe ser mayor a cero' });
    }
    const classification = await validateExpenseClassification({
      category_id,
      subcategory_id,
      cost_center_id,
    });
    if (classification.error) {
      return res.status(400).json({ error: classification.error });
    }
    const normalizedCondition = String(condition_type || '').toUpperCase() || null;
    const normalizedCreditDays =
      normalizedCondition === 'CREDITO' && credit_days !== '' && credit_days != null
        ? Math.max(0, Math.trunc(Number(credit_days) || 0))
        : null;
    const normalizedDueDate =
      normalizedCondition === 'CREDITO'
        ? (due_date || addDaysToDate(invoice_date, normalizedCreditDays))
        : null;
    const [result] = await pool.query(
      `INSERT INTO admin_expenses
       (expense_date, provider_id, category_id, subcategory_id, cost_center_id, description,
        invoice_date, supplier_ruc, supplier_name, iva_10, iva_5, iva_exempt,
        condition_type, credit_days, due_date, buyer_ruc, buyer_name, tax_mode,
        gravado_10, gravado_5, iva_no_taxed, exchange_rate,
        amount, currency_code, tax_rate, receipt_type, receipt_number, timbrado_number, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expense_date,
        provider_id || null,
        classification.category_id,
        classification.subcategory_id,
        classification.cost_center_id,
        description || '',
        invoice_date || null,
        supplier_ruc || null,
        supplier_name || null,
        Number(iva_10 || 0) || null,
        Number(iva_5 || 0) || null,
        Number(iva_exempt || 0) || null,
        normalizedCondition,
        normalizedCreditDays,
        normalizedDueDate,
        buyer_ruc || null,
        buyer_name || null,
        tax_mode || null,
        Number(gravado_10 || 0) || null,
        Number(gravado_5 || 0) || null,
        Number(iva_no_taxed || 0) || null,
        Number(exchange_rate || 0) || null,
        numericAmount,
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
    if (
      patch.category_id !== undefined ||
      patch.subcategory_id !== undefined ||
      patch.cost_center_id !== undefined
    ) {
      const [[current]] = await pool.query(
        'SELECT category_id, subcategory_id, cost_center_id FROM admin_expenses WHERE id = ?',
        [id]
      );
      if (!current) return res.status(404).json({ error: 'Gasto no encontrado' });
      const classification = await validateExpenseClassification({
        category_id: patch.category_id ?? current.category_id,
        subcategory_id: patch.subcategory_id ?? current.subcategory_id,
        cost_center_id: patch.cost_center_id ?? current.cost_center_id,
      });
      if (classification.error) {
        return res.status(400).json({ error: classification.error });
      }
      patch.category_id = classification.category_id;
      patch.subcategory_id = classification.subcategory_id;
      patch.cost_center_id = classification.cost_center_id;
    }
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
      'credit_days',
      'due_date',
      'invoice_date',
      'supplier_ruc',
      'supplier_name',
      'iva_10',
      'iva_5',
      'iva_exempt',
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

router.get('/:id/detail', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureAdminExpenseTables();
    await ensureSupplierCreditNoteTables();
    await recalculateSupplierDocument('admin-expense', id, pool);
    const [[expense]] = await pool.query(
      `
      SELECT e.*,
             COALESCE(p.razon_social, p.name, e.supplier_name) AS provider_name,
             COALESCE(p.ruc, e.supplier_ruc) AS provider_ruc,
             p.supplier_bank_name,
             p.supplier_bank_account,
             p.supplier_bank_currency,
             p.supplier_bank_account_type,
             p.supplier_bank_holder,
             p.supplier_bank_holder_ruc,
             p.supplier_bank_cci_iban,
             p.supplier_bank_swift,
             c.name AS category_name,
             sc.name AS subcategory_name,
             cc.name AS cost_center_name,
             r.description AS recurrence_description,
             r.active AS recurrence_active,
             r.next_run_date AS recurrence_next_run_date,
             creator.name AS created_by_name,
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
        LEFT JOIN admin_expense_recurrences r ON r.id = e.recurrence_id
        LEFT JOIN users creator ON creator.id = e.created_by
       WHERE e.id = ?
       LIMIT 1
      `,
      [id]
    );
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });

    const [items] = await pool.query(
      `SELECT * FROM admin_expense_items WHERE expense_id = ? ORDER BY id ASC`,
      [id]
    );
    const [attachments] = await pool.query(
      `SELECT * FROM admin_expense_attachments WHERE expense_id = ? ORDER BY id DESC`,
      [id]
    );
    const [payments] = await pool.query(
      `SELECT p.*, u.name AS created_by_name
         FROM admin_expense_payments p
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.expense_id = ?
        ORDER BY p.id DESC`,
      [id]
    );

    const amount = Number(expense.net_amount ?? expense.amount ?? 0);
    const paid = Number(expense.paid_amount || 0);
    const balance = Math.max(0, amount - paid);
    res.json({
      expense: {
        ...expense,
        paid_amount: Number(paid.toFixed(2)),
        balance: Number(balance.toFixed(2)),
      },
      items: items || [],
      attachments: attachments || [],
      payments: payments || [],
      recurrence: expense.recurrence_id
        ? {
            id: expense.recurrence_id,
            description: expense.recurrence_description,
            active: expense.recurrence_active,
            next_run_date: expense.recurrence_next_run_date,
          }
        : null,
    });
  } catch (e) {
    console.error('[admin-expenses] detail error', e);
    res.status(500).json({ error: 'Error loading expense detail' });
  }
});

router.post('/:id/cancel', requireAuth, requireAnyRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await ensureSupplierCreditNoteTables();
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Debe cargar un motivo de anulacion' });

    const [[expense]] = await pool.query('SELECT * FROM admin_expenses WHERE id = ?', [id]);
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (String(expense.status || '').toLowerCase() === 'anulado') {
      return res.status(400).json({ error: 'El gasto ya esta anulado' });
    }
    const [[creditNote]] = await pool.query(
      `SELECT n.id
         FROM supplier_credit_note_applications a
         INNER JOIN supplier_credit_notes n ON n.id = a.credit_note_id AND n.status = 'registrada'
        WHERE a.source_type = 'admin-expense' AND a.source_id = ? LIMIT 1`,
      [id]
    );
    if (creditNote?.id) {
      return res.status(409).json({ error: 'Anula primero las notas de credito vinculadas a este gasto.' });
    }

    const note = [expense.description, `Anulado: ${reason}`].filter(Boolean).join('\n');
    await pool.query(
      `UPDATE admin_expenses
          SET status = 'anulado',
              description = ?
        WHERE id = ?`,
      [note, id]
    );
    await pool.query(
      `UPDATE admin_expense_payments SET status = 'anulado' WHERE expense_id = ?`,
      [id]
    );
    const [[updated]] = await pool.query('SELECT * FROM admin_expenses WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[admin-expenses] cancel error', e);
    res.status(500).json({ error: 'Error canceling expense' });
  }
});

router.get('/monthly-summary', requireAuth, async (req, res) => {
  try {
    await ensureAdminExpenseTables();
    await ensureSupplierCreditNoteTables();
    const year = Math.trunc(Number(req.query?.year || new Date().getFullYear()));
    const currency = String(req.query?.currency_code || 'PYG').toUpperCase();
    const requestedCategory = String(req.query?.category_id || '').trim();
    const requestedSubcategory = String(req.query?.subcategory_id || '').trim();
    const requestedCostCenter = String(req.query?.cost_center_id || '').trim();
    const includeEmpty = ['1', 'true', 'yes'].includes(
      String(req.query?.include_empty || '').toLowerCase()
    );
    if (!Number.isFinite(year) || year < 2000 || year > 2200) {
      return res.status(400).json({ error: 'Año inválido' });
    }

    let categoryId = null;
    if (!requestedCategory) {
      const [[adminCategory]] = await pool.query(
        `SELECT id
           FROM admin_expense_categories
          WHERE system_key = 'ADMINISTRACION'
          LIMIT 1`
      );
      categoryId = adminCategory?.id || null;
    } else if (requestedCategory.toLowerCase() !== 'all') {
      categoryId = Number(requestedCategory);
      if (!categoryId) return res.status(400).json({ error: 'Categoría inválida' });
    }
    const subcategoryId = requestedSubcategory ? Number(requestedSubcategory) : null;
    const costCenterId = requestedCostCenter ? Number(requestedCostCenter) : null;
    if (requestedSubcategory && !subcategoryId) {
      return res.status(400).json({ error: 'Subcategoría inválida' });
    }
    if (requestedCostCenter && !costCenterId) {
      return res.status(400).json({ error: 'Centro de costo inválido' });
    }

    const classificationWhere = [];
    const classificationParams = [];
    if (categoryId) {
      classificationWhere.push('e.category_id = ?');
      classificationParams.push(categoryId);
    }
    if (subcategoryId) {
      classificationWhere.push('e.subcategory_id = ?');
      classificationParams.push(subcategoryId);
    }
    if (costCenterId) {
      classificationWhere.push('e.cost_center_id = ?');
      classificationParams.push(costCenterId);
    }
    const extraWhere = classificationWhere.length
      ? ` AND ${classificationWhere.join(' AND ')}`
      : '';

    const [expenseRows] = await pool.query(
      `SELECT e.id,
              e.cost_center_id,
              COALESCE(cc.name, 'SIN CENTRO DE COSTO') AS detail,
              COALESCE(cc.ord, 999999) AS cost_center_ord,
              MONTH(COALESCE(e.due_date, e.invoice_date, e.expense_date)) AS month_number,
              COALESCE(e.net_amount, e.amount, 0) AS net_amount,
              COALESCE((
                SELECT SUM(pay.amount)
                  FROM admin_expense_payments pay
                 WHERE pay.expense_id = e.id
                   AND pay.status <> 'anulado'
              ), 0) AS paid_total
         FROM admin_expenses e
         LEFT JOIN admin_expense_cost_centers cc ON cc.id = e.cost_center_id
        WHERE YEAR(COALESCE(e.due_date, e.invoice_date, e.expense_date)) = ?
          AND UPPER(e.currency_code) = ?
          AND LOWER(COALESCE(e.status, 'pendiente')) <> 'anulado'
          ${extraWhere}
        ORDER BY cost_center_ord, detail, e.id`,
      [year, currency, ...classificationParams]
    );

    const [paymentRows] = await pool.query(
      `SELECT e.cost_center_id,
              COALESCE(cc.name, 'SIN CENTRO DE COSTO') AS detail,
              COALESCE(cc.ord, 999999) AS cost_center_ord,
              MONTH(pay.payment_date) AS month_number,
              SUM(pay.amount) AS paid_amount
         FROM admin_expense_payments pay
         INNER JOIN admin_expenses e ON e.id = pay.expense_id
         LEFT JOIN admin_expense_cost_centers cc ON cc.id = e.cost_center_id
        WHERE YEAR(pay.payment_date) = ?
          AND UPPER(pay.currency_code) = ?
          AND pay.status <> 'anulado'
          AND LOWER(COALESCE(e.status, 'pendiente')) <> 'anulado'
          ${extraWhere}
        GROUP BY e.cost_center_id, cc.name, cc.ord, MONTH(pay.payment_date)
        ORDER BY cost_center_ord, detail`,
      [year, currency, ...classificationParams]
    );

    const rowsMap = new Map();
    const ensureRow = (costCenterIdValue, detail, ord = 999999) => {
      const key = costCenterIdValue ? `cc:${costCenterIdValue}` : 'cc:unassigned';
      if (!rowsMap.has(key)) {
        rowsMap.set(key, {
          cost_center_id: costCenterIdValue || null,
          cost_center_ord: Number(ord ?? 999999),
          detail: String(detail || 'SIN CENTRO DE COSTO').trim() || 'SIN CENTRO DE COSTO',
          months: Array.from({ length: 12 }, (_, index) => ({
            month: index + 1,
            to_pay: 0,
            paid: 0,
          })),
          total_paid: 0,
        });
      }
      return rowsMap.get(key);
    };

    if (includeEmpty) {
      const emptyWhere = ['active = 1'];
      const emptyParams = [];
      if (costCenterId) {
        emptyWhere.push('id = ?');
        emptyParams.push(costCenterId);
      }
      const [centers] = await pool.query(
        `SELECT id, name, ord
           FROM admin_expense_cost_centers
          WHERE ${emptyWhere.join(' AND ')}
          ORDER BY ord, name`,
        emptyParams
      );
      centers.forEach((center) => ensureRow(center.id, center.name, center.ord));
    }

    expenseRows.forEach((row) => {
      const monthIndex = Number(row.month_number || 0) - 1;
      if (monthIndex < 0 || monthIndex > 11) return;
      const item = ensureRow(
        row.cost_center_id,
        row.detail,
        row.cost_center_ord
      );
      const balance = Math.max(0, Number(row.net_amount || 0) - Number(row.paid_total || 0));
      item.months[monthIndex].to_pay += balance;
    });
    paymentRows.forEach((row) => {
      const monthIndex = Number(row.month_number || 0) - 1;
      if (monthIndex < 0 || monthIndex > 11) return;
      const item = ensureRow(
        row.cost_center_id,
        row.detail,
        row.cost_center_ord
      );
      const paid = Number(row.paid_amount || 0);
      item.months[monthIndex].paid += paid;
      item.total_paid += paid;
    });

    const rows = Array.from(rowsMap.values()).sort(
      (a, b) =>
        Number(a.cost_center_ord || 0) - Number(b.cost_center_ord || 0) ||
        a.detail.localeCompare(b.detail, 'es')
    );
    const totals = Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      to_pay: rows.reduce((sum, row) => sum + Number(row.months[index].to_pay || 0), 0),
      paid: rows.reduce((sum, row) => sum + Number(row.months[index].paid || 0), 0),
    }));
    const rate = await getParamValue('admin_expense_exchange_rate', pool);
    res.json({
      year,
      currency_code: currency,
      exchange_rate: Number(rate?.value || 0),
      filters: {
        category_id: categoryId,
        subcategory_id: subcategoryId,
        cost_center_id: costCenterId,
        include_empty: includeEmpty,
      },
      rows,
      totals,
      total_paid: rows.reduce((sum, row) => sum + Number(row.total_paid || 0), 0),
    });
  } catch (e) {
    console.error('[admin-expenses] monthly summary error', e);
    res.status(500).json({ error: 'No se pudo cargar la planilla mensual' });
  }
});

router.get('/:id/payment-orders', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensureAdminExpensePaymentOrdersTable();
    const [rows] = await pool.query(`
      SELECT po.*,
             requester.name AS requested_by_name,
             approver.name AS approved_by_name,
             COALESCE((
               SELECT SUM(p.amount)
                 FROM admin_expense_payments p
                WHERE p.payment_order_id = po.id
                  AND p.status <> 'anulado'
             ), 0) AS paid_amount
        FROM admin_expense_payment_orders po
        LEFT JOIN users requester ON requester.id = po.requested_by
        LEFT JOIN users approver ON approver.id = po.approved_by
       WHERE po.expense_id = ?
       ORDER BY po.id DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (e) {
    console.error('[admin-expenses] payment orders list error', e);
    res.status(500).json({ error: 'No se pudieron cargar las ordenes de pago' });
  }
});

router.post('/:id/payment-orders', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  try {
    await ensureAdminExpenseTables();
    const { id } = req.params;
    const [[expense]] = await pool.query(`
      SELECT e.*,
             COALESCE((
               SELECT SUM(p.amount)
                 FROM admin_expense_payments p
                WHERE p.expense_id = e.id
                  AND p.status <> 'anulado'
             ), 0) AS paid_amount
        FROM admin_expenses e
       WHERE e.id = ?
       LIMIT 1
    `, [id]);
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (String(expense.status || '').toLowerCase() === 'anulado') {
      return res.status(400).json({ error: 'No se puede solicitar una OP para un gasto anulado' });
    }
    const [[activeOrder]] = await pool.query(`
      SELECT id, order_number, status
        FROM admin_expense_payment_orders
       WHERE expense_id = ?
         AND status IN ('pendiente', 'aprobada', 'pago_parcial')
       ORDER BY id DESC
       LIMIT 1
    `, [id]);
    if (activeOrder) {
      return res.status(409).json({
        error: 'El gasto ya tiene una orden de pago activa',
        payment_order: activeOrder,
      });
    }
    const balance = Math.max(
      0,
      Number(expense.net_amount ?? expense.amount ?? 0) - Number(expense.paid_amount || 0)
    );
    const requestedAmount = Number(req.body?.amount || balance);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ error: 'El monto de la orden debe ser mayor a cero' });
    }
    if (requestedAmount - balance > 0.009) {
      return res.status(400).json({ error: 'La orden no puede superar el saldo pendiente' });
    }
    const [result] = await pool.query(`
      INSERT INTO admin_expense_payment_orders
      (expense_id, amount, currency_code, payment_method, payment_date, description,
       observations, status, requested_by, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, NOW())
    `, [
      id,
      requestedAmount,
      expense.currency_code || 'PYG',
      req.body?.payment_method || null,
      req.body?.payment_date || expense.due_date || null,
      req.body?.description || expense.description || null,
      req.body?.observations || null,
      req.user?.id || null,
    ]);
    const orderNumber = 'OPA-' + String(result.insertId).padStart(6, '0');
    await pool.query(
      'UPDATE admin_expense_payment_orders SET order_number = ? WHERE id = ?',
      [orderNumber, result.insertId]
    );
    const [[row]] = await pool.query(
      'SELECT * FROM admin_expense_payment_orders WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('[admin-expenses] payment order create error', e);
    res.status(500).json({ error: 'No se pudo generar la orden de pago' });
  }
});

router.patch('/payment-orders/:orderId/approve', requireAuth, requireAnyRole('admin'), async (req, res) => {
  try {
    await ensureAdminExpensePaymentOrdersTable();
    const { orderId } = req.params;
    const [[order]] = await pool.query(
      'SELECT * FROM admin_expense_payment_orders WHERE id = ?',
      [orderId]
    );
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (String(order.status || '').toLowerCase() !== 'pendiente') {
      return res.status(400).json({ error: 'Solo se puede aprobar una orden pendiente' });
    }
    await pool.query(`
      UPDATE admin_expense_payment_orders
         SET status = 'aprobada', approved_by = ?, approved_at = NOW()
       WHERE id = ?
    `, [req.user?.id || null, orderId]);
    const [[updated]] = await pool.query(
      'SELECT * FROM admin_expense_payment_orders WHERE id = ?',
      [orderId]
    );
    res.json(updated);
  } catch (e) {
    console.error('[admin-expenses] payment order approve error', e);
    res.status(500).json({ error: 'No se pudo aprobar la orden de pago' });
  }
});

router.patch('/payment-orders/:orderId/cancel', requireAuth, requireAnyRole('admin'), async (req, res) => {
  try {
    await ensureAdminExpensePaymentOrdersTable();
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'El motivo es obligatorio' });
    const { orderId } = req.params;
    const [[paid]] = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) AS total
        FROM admin_expense_payments
       WHERE payment_order_id = ?
         AND status <> 'anulado'
    `, [orderId]);
    if (Number(paid?.total || 0) > 0.009) {
      return res.status(409).json({ error: 'No se puede anular una OP con pagos registrados' });
    }
    const [result] = await pool.query(`
      UPDATE admin_expense_payment_orders
         SET status = 'anulada', canceled_by = ?, canceled_at = NOW(), cancel_reason = ?
       WHERE id = ?
         AND status <> 'anulada'
    `, [req.user?.id || null, reason, orderId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-expenses] payment order cancel error', e);
    res.status(500).json({ error: 'No se pudo anular la orden de pago' });
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
      notes,
      amount,
      currency_code,
      status,
    } = req.body || {};
    await ensureAdminExpenseTables();
    await ensureSupplierCreditNoteTables();
    await recalculateSupplierDocument('admin-expense', id, pool);
    const [[expense]] = await pool.query(
      `
      SELECT e.*,
             (
               SELECT COALESCE(SUM(pay.amount),0)
               FROM admin_expense_payments pay
               WHERE pay.expense_id = e.id AND pay.status <> 'anulado'
             ) AS paid_amount
        FROM admin_expenses e
       WHERE e.id = ?
       LIMIT 1
      `,
      [id]
    );
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (String(expense.status || '').toLowerCase() === 'anulado') {
      return res.status(400).json({ error: 'No se puede registrar pago de un gasto anulado' });
    }
    const paymentAmount = Number(amount || 0);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ error: 'El monto del pago debe ser mayor a cero' });
    }
    const expenseCurrency = String(expense.currency_code || 'PYG').toUpperCase();
    const paymentCurrency = String(currency_code || expenseCurrency).toUpperCase();
    if (paymentCurrency !== expenseCurrency) {
      return res.status(400).json({ error: 'La moneda del pago debe coincidir con la moneda del gasto' });
    }
    const paidAmount = Number(expense.paid_amount || 0);
    const balance = Math.max(0, Number(expense.net_amount ?? expense.amount ?? 0) - paidAmount);
    if (paymentAmount - balance > 0.009) {
      return res.status(400).json({ error: 'El pago no puede superar el saldo pendiente' });
    }
    const [[paymentOrder]] = await pool.query(`
      SELECT *
        FROM admin_expense_payment_orders
       WHERE expense_id = ?
         AND status IN ('aprobada', 'pago_parcial')
       ORDER BY id DESC
       LIMIT 1
    `, [id]);
    if (!paymentOrder) {
      return res.status(409).json({
        error: 'La orden de pago debe estar aprobada antes de registrar el pago',
      });
    }
    const [[orderPaidRow]] = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) AS paid
        FROM admin_expense_payments
       WHERE payment_order_id = ?
         AND status <> 'anulado'
    `, [paymentOrder.id]);
    const orderPaid = Number(orderPaidRow?.paid || 0);
    const orderBalance = Math.max(0, Number(paymentOrder.amount || 0) - orderPaid);
    if (paymentAmount - orderBalance > 0.009) {
      return res.status(400).json({
        error: 'El pago no puede superar el saldo aprobado en la orden de pago',
      });
    }
    const normalizedMethod = String(method || '').trim().toLowerCase();
    const requiresAccount = normalizedMethod && !['efectivo', 'tarjeta'].includes(normalizedMethod);
    if (requiresAccount && !String(account || '').trim()) {
      return res.status(400).json({ error: 'Debe seleccionar la cuenta origen de la empresa' });
    }
    const [result] = await pool.query(
      `INSERT INTO admin_expense_payments
       (expense_id, payment_order_id, payment_date, method, account, reference_number, receipt_type, receipt_number, timbrado_number, notes, amount, currency_code, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        paymentOrder.id,
        payment_date || null,
        method || null,
        account || null,
        reference_number || null,
        receipt_type || null,
        receipt_number || null,
        timbrado_number || null,
        notes || null,
        paymentAmount,
        paymentCurrency,
        status || 'confirmado',
        req.user?.id || null,
      ]
    );
    const nextBalance = Math.max(0, balance - paymentAmount);
    await recalculateSupplierDocument('admin-expense', id, pool);
    const nextOrderPaid = orderPaid + paymentAmount;
    await pool.query(
      `UPDATE admin_expense_payment_orders
          SET status = ?
        WHERE id = ?`,
      [nextOrderPaid + 0.009 >= Number(paymentOrder.amount || 0) ? 'pagada' : 'pago_parcial', paymentOrder.id]
    );
    if (nextBalance <= 0.009) {
      await pool.query(`UPDATE admin_expenses SET status = 'pagado' WHERE id = ?`, [id]);
    } else if (String(expense.status || '').toLowerCase() === 'pagado') {
      await pool.query(`UPDATE admin_expenses SET status = 'pendiente' WHERE id = ?`, [id]);
    }
    // When this administrative expense originated from a commercial
    // commission, mirror the payment in that operation's audit trail.
    try {
      const [commissionRows] = await pool.query(
        `SELECT a.liquidation_id, ci.id AS commission_invoice_id, a.amount
           FROM commission_invoices ci
           JOIN commission_invoice_allocations a ON a.commission_invoice_id = ci.id
          WHERE ci.admin_expense_id = ?`, [id]
      );
      for (const row of commissionRows) {
        const proportionalAmount = Number(expense.amount || 0) > 0
          ? paymentAmount * (Number(row.amount || 0) / Number(expense.amount || 0))
          : 0;
        await pool.query(
          `INSERT INTO commission_audit_events (liquidation_id, commission_invoice_id, event_type, detail, payload_json, actor_user_id)
           VALUES (?, ?, 'payment_registered', ?, ?, ?)`,
          [row.liquidation_id, row.commission_invoice_id, 'Pago de comisión registrado', JSON.stringify({ payment_id: result.insertId, amount: proportionalAmount, currency_code: paymentCurrency }), req.user?.id || null]
        );
      }
    } catch (auditError) {
      if (auditError?.code !== 'ER_NO_SUCH_TABLE') throw auditError;
    }
    res.status(201).json({ id: result.insertId, balance: Number(nextBalance.toFixed(2)) });
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
    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'El monto del gasto debe ser mayor a cero' });
    }
    const classification = await validateExpenseClassification({
      category_id,
      subcategory_id,
      cost_center_id,
    });
    if (classification.error) {
      return res.status(400).json({ error: classification.error });
    }
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
        classification.category_id,
        classification.subcategory_id,
        classification.cost_center_id,
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
        numericAmount,
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
      `SELECT r.*, c.name AS category_name, sc.name AS subcategory_name,
              cc.name AS cost_center_name, org.name AS provider_name, org.razon_social AS provider_razon
         FROM admin_expense_recurrences r
         LEFT JOIN admin_expense_categories c ON c.id = r.category_id
         LEFT JOIN admin_expense_subcategories sc ON sc.id = r.subcategory_id
         LEFT JOIN admin_expense_cost_centers cc ON cc.id = r.cost_center_id
         LEFT JOIN organizations org ON org.id = r.provider_id
        ORDER BY r.active DESC, r.next_run_date ASC, r.id DESC`
    );
    const out = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        provider_name: r.provider_razon || r.provider_name || '',
        next_dates: Number(r.active || 0) ? await getUpcomingRecurrenceDates(r, 6) : [],
      }))
    );
    res.json(out);
  } catch (e) {
    console.error('[admin-expenses] recurrence list error', e);
    res.status(500).json({ error: 'Error listing recurrences' });
  }
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

router.patch('/recurrences/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    if (
      patch.category_id !== undefined ||
      patch.subcategory_id !== undefined ||
      patch.cost_center_id !== undefined
    ) {
      const [[current]] = await pool.query(
        'SELECT category_id, subcategory_id, cost_center_id FROM admin_expense_recurrences WHERE id = ?',
        [id]
      );
      if (!current) return res.status(404).json({ error: 'Recurrencia no encontrada' });
      const classification = await validateExpenseClassification({
        category_id: patch.category_id ?? current.category_id,
        subcategory_id: patch.subcategory_id ?? current.subcategory_id,
        cost_center_id: patch.cost_center_id ?? current.cost_center_id,
      });
      if (classification.error) {
        return res.status(400).json({ error: classification.error });
      }
      patch.category_id = classification.category_id;
      patch.subcategory_id = classification.subcategory_id;
      patch.cost_center_id = classification.cost_center_id;
    }
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

router.post('/categories', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (await findDuplicateMaster('admin_expense_categories', name)) {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    }
    const [[maxOrder]] = await pool.query(
      'SELECT COALESCE(MAX(ord), 0) AS max_ord FROM admin_expense_categories'
    );
    const [result] = await pool.query(
      `INSERT INTO admin_expense_categories (name, ord, active) VALUES (?, ?, 1)`,
      [name, Number(maxOrder?.max_ord || 0) + 10]
    );
    const [[row]] = await pool.query(
      'SELECT * FROM admin_expense_categories WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('[admin-expenses] category create error', e);
    res.status(500).json({ error: 'No se pudo crear la categoría' });
  }
});

router.patch('/categories/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    const [[current]] = await pool.query(
      'SELECT * FROM admin_expense_categories WHERE id = ?',
      [id]
    );
    if (!current) return res.status(404).json({ error: 'Categoría no encontrada' });
    if (current.system_key && patch.active !== undefined && !Number(patch.active)) {
      return res.status(400).json({ error: 'Las categorías base no se pueden desactivar' });
    }
    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim();
      if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
      if (
        await findDuplicateMaster('admin_expense_categories', name, { excludeId: id })
      ) {
        return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
      }
      patch.name = name;
    }
    const fields = ['name', 'active', 'ord'];
    const sets = [];
    const params = [];
    fields.forEach((field) => {
      if (patch[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(patch[field]);
      }
    });
    if (!sets.length) return res.json(current);
    params.push(id);
    await pool.query(
      `UPDATE admin_expense_categories SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    const [[row]] = await pool.query(
      'SELECT * FROM admin_expense_categories WHERE id = ?',
      [id]
    );
    res.json(row);
  } catch (e) {
    console.error('[admin-expenses] category update error', e);
    res.status(500).json({ error: 'No se pudo actualizar la categoría' });
  }
});

router.get('/subcategories', requireAuth, async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM admin_expense_subcategories ORDER BY ord, name'
  );
  res.json(rows);
});

router.post('/subcategories', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const categoryId = Number(req.body?.category_id || 0);
    if (!name || !categoryId) {
      return res.status(400).json({ error: 'Nombre y categoría son obligatorios' });
    }
    if (
      await findDuplicateMaster('admin_expense_subcategories', name, {
        categoryId,
      })
    ) {
      return res.status(409).json({ error: 'Ya existe esa subcategoría en la categoría' });
    }
    const [[maxOrder]] = await pool.query(
      `SELECT COALESCE(MAX(ord), 0) AS max_ord
         FROM admin_expense_subcategories
        WHERE category_id = ?`,
      [categoryId]
    );
    const [result] = await pool.query(
      `INSERT INTO admin_expense_subcategories
       (name, category_id, ord, active)
       VALUES (?, ?, ?, 1)`,
      [name, categoryId, Number(maxOrder?.max_ord || 0) + 10]
    );
    const [[row]] = await pool.query(
      'SELECT * FROM admin_expense_subcategories WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('[admin-expenses] subcategory create error', e);
    res.status(500).json({ error: 'No se pudo crear la subcategoría' });
  }
});

router.patch('/subcategories/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    const [[current]] = await pool.query(
      'SELECT * FROM admin_expense_subcategories WHERE id = ?',
      [id]
    );
    if (!current) return res.status(404).json({ error: 'Subcategoría no encontrada' });
    if (current.system_key && patch.active !== undefined && !Number(patch.active)) {
      return res.status(400).json({ error: 'Las subcategorías base no se pueden desactivar' });
    }
    const targetCategoryId = Number(patch.category_id ?? current.category_id);
    if (
      current.system_key &&
      patch.category_id !== undefined &&
      targetCategoryId !== Number(current.category_id)
    ) {
      return res.status(400).json({
        error: 'Las subcategorías base no se pueden mover a otra categoría',
      });
    }
    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim();
      if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
      if (
        await findDuplicateMaster('admin_expense_subcategories', name, {
          categoryId: targetCategoryId,
          excludeId: id,
        })
      ) {
        return res.status(409).json({ error: 'Ya existe esa subcategoría en la categoría' });
      }
      patch.name = name;
    }
    const fields = ['name', 'active', 'ord', 'category_id'];
    const sets = [];
    const params = [];
    fields.forEach((field) => {
      if (patch[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(patch[field]);
      }
    });
    if (!sets.length) return res.json(current);
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
    res.status(500).json({ error: 'No se pudo actualizar la subcategoría' });
  }
});

router.get('/cost-centers', requireAuth, async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM admin_expense_cost_centers ORDER BY ord, name'
  );
  res.json(rows);
});

router.post('/cost-centers', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (await findDuplicateMaster('admin_expense_cost_centers', name)) {
      return res.status(409).json({ error: 'Ya existe un centro de costo con ese nombre' });
    }
    const [[maxOrder]] = await pool.query(
      'SELECT COALESCE(MAX(ord), 0) AS max_ord FROM admin_expense_cost_centers'
    );
    const [result] = await pool.query(
      `INSERT INTO admin_expense_cost_centers (name, ord, active)
       VALUES (?, ?, 1)`,
      [name, Number(maxOrder?.max_ord || 0) + 10]
    );
    const [[row]] = await pool.query(
      'SELECT * FROM admin_expense_cost_centers WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('[admin-expenses] cost center create error', e);
    res.status(500).json({ error: 'No se pudo crear el centro de costo' });
  }
});

router.patch('/cost-centers/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    const [[current]] = await pool.query(
      'SELECT * FROM admin_expense_cost_centers WHERE id = ?',
      [id]
    );
    if (!current) return res.status(404).json({ error: 'Centro de costo no encontrado' });
    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim();
      if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
      if (
        await findDuplicateMaster('admin_expense_cost_centers', name, {
          excludeId: id,
        })
      ) {
        return res.status(409).json({ error: 'Ya existe un centro de costo con ese nombre' });
      }
      patch.name = name;
    }
    const fields = ['name', 'active', 'ord'];
    const sets = [];
    const params = [];
    fields.forEach((field) => {
      if (patch[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(patch[field]);
      }
    });
    if (!sets.length) return res.json(current);
    params.push(id);
    await pool.query(
      `UPDATE admin_expense_cost_centers SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    const [[row]] = await pool.query(
      'SELECT * FROM admin_expense_cost_centers WHERE id = ?',
      [id]
    );
    res.json(row);
  } catch (e) {
    console.error('[admin-expenses] cost center update error', e);
    res.status(500).json({ error: 'No se pudo actualizar el centro de costo' });
  }
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
    const {
      from_date,
      to_date,
      status,
      currency_code,
      category_id,
      subcategory_id,
      cost_center_id,
      provider_id,
      q,
    } = req.query || {};
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
    if (category_id) {
      where.push('e.category_id = ?');
      params.push(category_id);
    }
    if (subcategory_id) {
      where.push('e.subcategory_id = ?');
      params.push(subcategory_id);
    }
    if (cost_center_id) {
      where.push('e.cost_center_id = ?');
      params.push(cost_center_id);
    }
    if (provider_id) {
      where.push('e.provider_id = ?');
      params.push(provider_id);
    }
    if (q) {
      const like = `%${String(q).trim()}%`;
      where.push(`(
        e.description LIKE ?
        OR e.receipt_number LIKE ?
        OR e.timbrado_number LIKE ?
        OR e.supplier_name LIKE ?
        OR e.supplier_ruc LIKE ?
        OR COALESCE(p.razon_social, p.name) LIKE ?
        OR p.ruc LIKE ?
      )`);
      params.push(like, like, like, like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [byCostCenter] = await pool.query(
      `
      SELECT COALESCE(cc.name, 'Sin centro') AS cost_center_name, e.currency_code, SUM(e.amount) AS total, COUNT(*) AS count
        FROM admin_expenses e
        LEFT JOIN admin_expense_cost_centers cc ON cc.id = e.cost_center_id
        LEFT JOIN organizations p ON p.id = e.provider_id
        LEFT JOIN admin_expense_categories c ON c.id = e.category_id
        ${whereSql}
       GROUP BY COALESCE(cc.name, 'Sin centro'), e.currency_code
       ORDER BY total DESC
      `,
      params
    );

    const [byCategory] = await pool.query(
      `
      SELECT COALESCE(c.name, 'Sin categoria') AS category_name, e.currency_code, SUM(e.amount) AS total, COUNT(*) AS count
        FROM admin_expenses e
        LEFT JOIN organizations p ON p.id = e.provider_id
        LEFT JOIN admin_expense_categories c ON c.id = e.category_id
        ${whereSql}
       GROUP BY COALESCE(c.name, 'Sin categoria'), e.currency_code
       ORDER BY total DESC
      `,
      params
    );

    const [byProvider] = await pool.query(
      `
      SELECT COALESCE(p.razon_social, p.name, e.supplier_name, 'Sin proveedor') AS provider_name,
             e.currency_code,
             SUM(e.amount) AS total,
             COUNT(*) AS count
        FROM admin_expenses e
        LEFT JOIN organizations p ON p.id = e.provider_id
        LEFT JOIN admin_expense_categories c ON c.id = e.category_id
        ${whereSql}
       GROUP BY COALESCE(p.razon_social, p.name, e.supplier_name, 'Sin proveedor'), e.currency_code
       ORDER BY total DESC
       LIMIT 30
      `,
      params
    );

    const [byMonth] = await pool.query(
      `
      SELECT DATE_FORMAT(e.expense_date, '%Y-%m') AS month, e.currency_code, SUM(e.amount) AS total, COUNT(*) AS count
        FROM admin_expenses e
        LEFT JOIN organizations p ON p.id = e.provider_id
        LEFT JOIN admin_expense_categories c ON c.id = e.category_id
        ${whereSql}
       GROUP BY DATE_FORMAT(e.expense_date, '%Y-%m'), e.currency_code
       ORDER BY month DESC
      `,
      params
    );

    res.json({ byCostCenter, byCategory, byProvider, byMonth });
  } catch (e) {
    console.error('[admin-expenses] report error', e);
    res.status(500).json({ error: 'No se pudo cargar el reporte' });
  }
});

router.get('/providers', requireAuth, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, razon_social, name, ruc
     FROM organizations
     WHERE LOWER(tipo_org) IN ('proveedor', 'agente', 'seguro', 'aseguradora', 'despachante', 'transporte', 'ferreteria', 'combustible', 'gasolinera')
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
     WHERE LOWER(tipo_org) IN ('proveedor', 'agente', 'seguro', 'aseguradora', 'despachante', 'transporte', 'ferreteria', 'combustible', 'gasolinera')
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
  const tipoOrg = String(req.body?.tipo_org || req.body?.category || 'Proveedor').trim() || 'Proveedor';
  if (!name) return res.status(400).json({ error: 'name is required' });
  const [result] = await pool.query(
    `INSERT INTO organizations (razon_social, name, ruc, tipo_org, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    [name, name, ruc, tipoOrg]
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


