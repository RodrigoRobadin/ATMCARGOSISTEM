import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';

const router = Router();

const AP_META_SOURCE_TYPES = new Set(['operation-expense', 'purchase-invoice', 'admin-expense']);
const AP_PRIORITIES = new Set(['normal', 'alta', 'urgente', 'baja']);
const AP_TREASURY_STATUSES = new Set(['pendiente', 'programado', 'retenido']);
const AP_VALIDATION_STATUSES = new Set(['pendiente', 'validada', 'observada']);

const paymentReceiptStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const sourceType = String(req.params?.sourceType || 'payment').replace(/[^a-zA-Z0-9._-]/g, '_');
    const paymentId = String(req.params?.paymentId || '0').replace(/[^a-zA-Z0-9._-]/g, '_');
    const dir = path.resolve('uploads', 'accounts-payable-payments', sourceType, paymentId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const paymentReceiptUpload = multer({ storage: paymentReceiptStorage });

const documentAttachmentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const sourceType = String(req.params?.sourceType || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
    const sourceId = String(req.params?.sourceId || '0').replace(/[^a-zA-Z0-9._-]/g, '_');
    const dir = path.resolve('uploads', 'accounts-payable-documents', sourceType, sourceId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const documentAttachmentUpload = multer({ storage: documentAttachmentStorage });

async function ensureAccountsPayableMetaTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts_payable_document_meta (
        id INT AUTO_INCREMENT PRIMARY KEY,
        source_type VARCHAR(32) NOT NULL,
        source_id INT NOT NULL,
        scheduled_payment_date DATE NULL,
        priority VARCHAR(16) NOT NULL DEFAULT 'normal',
        treasury_status VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        planned_company_account VARCHAR(160) NULL,
        treasury_notes TEXT NULL,
        validation_status VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        validation_notes TEXT NULL,
        validated_by INT NULL,
        validated_at DATETIME NULL,
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ap_document_meta (source_type, source_id),
        INDEX idx_ap_meta_schedule (scheduled_payment_date),
        INDEX idx_ap_meta_status (treasury_status),
        INDEX idx_ap_meta_priority (priority)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts_payable_document_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        source_type VARCHAR(32) NOT NULL,
        source_id INT NOT NULL,
        file_url VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NULL,
        uploaded_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ap_doc_attachment (source_type, source_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounts_payable_document_meta'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const add = [];
    if (!have.has('validated_by')) add.push('ADD COLUMN validated_by INT NULL AFTER validation_notes');
    if (!have.has('validated_at')) add.push('ADD COLUMN validated_at DATETIME NULL AFTER validated_by');
    if (!have.has('treasury_notes')) add.push('ADD COLUMN treasury_notes TEXT NULL AFTER planned_company_account');
    if (add.length) await pool.query(`ALTER TABLE accounts_payable_document_meta ${add.join(', ')}`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts_payable_payment_meta (
        id INT AUTO_INCREMENT PRIMARY KEY,
        source_type VARCHAR(32) NOT NULL,
        payment_id INT NOT NULL,
        receipt_file_url VARCHAR(255) NULL,
        receipt_file_name VARCHAR(255) NULL,
        reconciled TINYINT(1) NOT NULL DEFAULT 0,
        reconciled_at DATETIME NULL,
        reconciled_by INT NULL,
        reconciliation_notes TEXT NULL,
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ap_payment_meta (source_type, payment_id),
        INDEX idx_ap_payment_reconciled (reconciled),
        INDEX idx_ap_payment_reconciled_at (reconciled_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error('[accounts-payable] ensure meta table error', e?.message || e);
  }
}

ensureAccountsPayableMetaTable().catch((err) =>
  console.error('[accounts-payable] init meta table error', err?.message || err)
);

function moduleFilterValues(moduleKey) {
  const raw = String(moduleKey || '').trim().toLowerCase();
  if (!raw || raw === 'all') return [];
  const normalized = raw.replace(/\s+/g, '-');
  const aliases = {
    'atm-cargo': ['atm-cargo', 'cargo', 'atm-cargo-srl'],
    cargo: ['atm-cargo', 'cargo', 'atm-cargo-srl'],
    'atm-industrial': ['atm-industrial', 'industrial'],
    industrial: ['atm-industrial', 'industrial'],
    'atm-container': ['atm-container', 'container'],
    container: ['atm-container', 'container'],
    services: ['services', 'service', 'servicios-y-mantenimiento', 'servicio-tecnico', 'servicio-técnico'],
    service: ['services', 'service', 'servicios-y-mantenimiento', 'servicio-tecnico', 'servicio-técnico'],
    'admin-purchases': ['admin-purchases', 'compras-administrativas'],
    'admin-expenses': ['admin-expenses', 'gastos-administrativos'],
  };
  return Array.from(new Set([normalized, ...(aliases[normalized] || [])]));
}

function appendModuleFilter(where, params, moduleKey) {
  const values = moduleFilterValues(moduleKey);
  if (!values.length) return;
  const placeholders = values.map(() => '?').join(',');
  where.push(`(
    LOWER(COALESCE(src.module_key, '')) IN (${placeholders})
    OR LOWER(REPLACE(COALESCE(src.module_name, ''), ' ', '-')) IN (${placeholders})
  )`);
  params.push(...values, ...values);
}

function sourceFilterValues(sourceType) {
  const raw = String(sourceType || '').trim().toLowerCase();
  if (!raw || raw === 'all') return [];
  const aliases = {
    'operation-expense': ['operation-expense', 'operational-purchases', 'compras-operativas'],
    'operational-purchases': ['operation-expense', 'operational-purchases', 'compras-operativas'],
    'purchase-invoice': ['purchase-invoice', 'admin-purchases', 'compras-administrativas'],
    'admin-purchases': ['purchase-invoice', 'admin-purchases', 'compras-administrativas'],
    'admin-expense': ['admin-expense', 'admin-expenses', 'gastos-administrativos'],
    'admin-expenses': ['admin-expense', 'admin-expenses', 'gastos-administrativos'],
  };
  return Array.from(new Set([raw, ...(aliases[raw] || [])]));
}

function appendSourceFilter(where, params, sourceType) {
  const values = sourceFilterValues(sourceType);
  if (!values.length) return;
  where.push(`LOWER(COALESCE(src.source_type, '')) IN (${values.map(() => '?').join(',')})`);
  params.push(...values);
}

async function fetchAccountsPayableVendorDetail(supplierKey, currencyCode) {
  const [movements] = await pool.query(
    `
    SELECT *
    FROM (
      SELECT
        CAST(COALESCE(CONCAT('org:', e.supplier_id), CONCAT('op-exp:', e.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'')) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(COALESCE(NULLIF(TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(e.invoice_date, e.created_at) AS movement_date,
        CAST(_utf8mb4'factura' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_kind,
        CAST(_utf8mb4'Factura operativa' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_type,
        CAST(CASE WHEN e.operation_type = 'service' THEN _utf8mb4'services' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'sin-modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(CASE WHEN e.operation_type = 'service' THEN _utf8mb4'Servicios y mantenimiento' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'Sin modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(CASE WHEN e.operation_type = 'service' THEN COALESCE(sc.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) ELSE COALESCE(d.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        e.operation_id,
        CAST(COALESCE(e.operation_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(COALESCE(e.receipt_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(COALESCE(NULLIF(TRIM(CAST(e.notes AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), CONCAT(_utf8mb4'Factura ' COLLATE utf8mb4_unicode_ci, COALESCE(CAST(e.receipt_type AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, _utf8mb4'compra' COLLATE utf8mb4_unicode_ci))) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS description,
        COALESCE(e.amount_total, 0) AS debit_amount,
        0 AS credit_amount,
        CAST(COALESCE(e.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_status,
        e.due_date,
        e.id AS invoice_id,
        NULL AS expense_id,
        COALESCE(po2.id, po3.id) AS payment_order_id,
        CAST(COALESCE(po2.order_number, po3.order_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(COALESCE(po2.status, po3.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        NULL AS purchase_order_id,
        CAST(COALESCE(e.condition_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        COALESCE(e.balance, COALESCE(e.amount_total, 0) - COALESCE(e.paid_amount, 0)) AS document_balance,
        e.id AS source_id,
        1 AS sort_order
      FROM operation_expense_invoices e
      LEFT JOIN deals d ON d.id = e.operation_id AND e.operation_type = 'deal'
      LEFT JOIN service_cases sc ON sc.id = e.operation_id AND e.operation_type = 'service'
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
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
      WHERE COALESCE(e.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(CONCAT('org:', e.supplier_id), CONCAT('op-exp:', e.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'')) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(COALESCE(NULLIF(TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(p.payment_date, p.created_at) AS movement_date,
        CAST(_utf8mb4'payment' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_kind,
        CAST(_utf8mb4'Pago operativo' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_type,
        CAST(CASE WHEN e.operation_type = 'service' THEN _utf8mb4'services' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'sin-modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(CASE WHEN e.operation_type = 'service' THEN _utf8mb4'Servicios y mantenimiento' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'Sin modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(CASE WHEN e.operation_type = 'service' THEN COALESCE(sc.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) ELSE COALESCE(d.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        e.operation_id,
        CAST(COALESCE(e.operation_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(COALESCE(e.receipt_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(CONCAT(_utf8mb4'Pago ' COLLATE utf8mb4_unicode_ci, COALESCE(CAST(p.method AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, _utf8mb4'sin metodo' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS description,
        0 AS debit_amount,
        COALESCE(p.amount, 0) AS credit_amount,
        CAST(COALESCE(p.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_status,
        e.due_date,
        e.id AS invoice_id,
        NULL AS expense_id,
        COALESCE(po2.id, po3.id) AS payment_order_id,
        CAST(COALESCE(po2.order_number, po3.order_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(COALESCE(po2.status, po3.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        NULL AS purchase_order_id,
        CAST(COALESCE(e.condition_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        COALESCE(e.balance, COALESCE(e.amount_total, 0) - COALESCE(e.paid_amount, 0)) AS document_balance,
        p.id AS source_id,
        2 AS sort_order
      FROM operation_expense_payments p
      INNER JOIN operation_expense_invoices e ON e.id = p.invoice_id
      LEFT JOIN deals d ON d.id = e.operation_id AND e.operation_type = 'deal'
      LEFT JOIN service_cases sc ON sc.id = e.operation_id AND e.operation_type = 'service'
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
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
      WHERE COALESCE(p.status, '') <> 'anulado'
        AND COALESCE(e.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(CONCAT('org:', po.supplier_id), CONCAT('opg:', po.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(NULLIF(TRIM(CAST(po.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(NULLIF(TRIM(CAST(po.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'') AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(COALESCE(NULLIF(TRIM(CAST(po.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(po.payment_date, po.created_at) AS movement_date,
        CAST(_utf8mb4'payment_order' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_kind,
        CAST(_utf8mb4'Orden de pago' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_type,
        CAST(CASE WHEN po.operation_type = 'service' THEN _utf8mb4'services' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'sin-modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(CASE WHEN po.operation_type = 'service' THEN _utf8mb4'Servicios y mantenimiento' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'Sin modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(CASE WHEN po.operation_type = 'service' THEN COALESCE(sc.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) ELSE COALESCE(d.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        po.operation_id,
        CAST(COALESCE(po.operation_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(COALESCE(po.order_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(COALESCE(NULLIF(TRIM(CAST(po.description AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Seguimiento de orden de pago' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS description,
        0 AS debit_amount,
        0 AS credit_amount,
        CAST(COALESCE(po.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_status,
        NULL AS due_date,
        NULL AS invoice_id,
        NULL AS expense_id,
        po.id AS payment_order_id,
        CAST(COALESCE(po.order_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(COALESCE(po.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        NULL AS purchase_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        0 AS document_balance,
        po.id AS source_id,
        3 AS sort_order
      FROM operation_expense_payment_orders po
      LEFT JOIN deals d ON d.id = po.operation_id AND po.operation_type = 'deal'
      LEFT JOIN service_cases sc ON sc.id = po.operation_id AND po.operation_type = 'service'
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE COALESCE(po.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(CONCAT('org:', pi.supplier_id), CONCAT('purchase:', pi.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'') AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(_utf8mb4'PYG' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(pi.invoice_date, pi.created_at) AS movement_date,
        CAST(_utf8mb4'factura' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_kind,
        CAST(_utf8mb4'Factura administrativa' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_type,
        CAST(_utf8mb4'admin-purchases' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'Compras administrativas' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(COALESCE(po.po_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(COALESCE(pi.supplier_invoice_number, pi.invoice_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(COALESCE(NULLIF(TRIM(CAST(pi.notes AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Factura de compra administrativa' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS description,
        COALESCE(pi.total_amount, 0) AS debit_amount,
        0 AS credit_amount,
        CAST(COALESCE(pi.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_status,
        pi.due_date,
        pi.id AS invoice_id,
        NULL AS expense_id,
        NULL AS payment_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        po.id AS purchase_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        COALESCE(pi.balance, COALESCE(pi.total_amount, 0) - COALESCE(pi.paid_amount, 0)) AS document_balance,
        pi.id AS source_id,
        1 AS sort_order
      FROM purchase_invoices pi
      LEFT JOIN organizations sup ON sup.id = pi.supplier_id
      LEFT JOIN purchase_orders po ON po.id = pi.po_id
      WHERE COALESCE(pi.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(CONCAT('org:', pi.supplier_id), CONCAT('purchase:', pi.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'') AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(_utf8mb4'PYG' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(pp.payment_date, pp.created_at) AS movement_date,
        CAST(_utf8mb4'payment' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_kind,
        CAST(_utf8mb4'Pago administrativo' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_type,
        CAST(_utf8mb4'admin-purchases' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'Compras administrativas' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(COALESCE(po.po_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(COALESCE(pi.supplier_invoice_number, pi.invoice_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(CONCAT(_utf8mb4'Pago ' COLLATE utf8mb4_unicode_ci, COALESCE(CAST(pp.payment_method AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, _utf8mb4'sin metodo' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS description,
        0 AS debit_amount,
        COALESCE(pp.amount, 0) AS credit_amount,
        CAST(COALESCE(pi.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_status,
        pi.due_date,
        pi.id AS invoice_id,
        NULL AS expense_id,
        NULL AS payment_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        po.id AS purchase_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        COALESCE(pi.balance, COALESCE(pi.total_amount, 0) - COALESCE(pi.paid_amount, 0)) AS document_balance,
        pp.id AS source_id,
        2 AS sort_order
      FROM purchase_invoice_payments pp
      INNER JOIN purchase_invoices pi ON pi.id = pp.invoice_id
      LEFT JOIN organizations sup ON sup.id = pi.supplier_id
      LEFT JOIN purchase_orders po ON po.id = pi.po_id
      WHERE COALESCE(pi.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(
          CONCAT('org:', e.provider_id),
          CONCAT(
            'ruc:',
            CASE
              WHEN TRIM(
                COALESCE(
                  CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  _utf8mb4''
                )
              ) = _utf8mb4''
                THEN NULL
              ELSE TRIM(
                COALESCE(
                  CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              )
            END
          ),
          CONCAT(
            'name:',
            CASE
              WHEN TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  _utf8mb4''
                )
              ) = _utf8mb4''
                THEN NULL
              ELSE TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              )
            END
          ),
          CONCAT('admin-exp:', e.id)
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(
          CASE WHEN TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(
          CASE WHEN TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(
          COALESCE(
            CASE WHEN TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
            _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci
          )
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(e.invoice_date, e.expense_date, e.created_at) AS movement_date,
        CAST(_utf8mb4'factura' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_kind,
        CAST(_utf8mb4'Gasto administrativo' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_type,
        CAST(_utf8mb4'admin-expenses' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'Gastos administrativos' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(COALESCE(e.receipt_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(COALESCE(NULLIF(TRIM(CAST(e.description AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Gasto administrativo' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS description,
        COALESCE(e.amount, 0) AS debit_amount,
        0 AS credit_amount,
        CAST(COALESCE(CAST(e.status AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_status,
        e.due_date,
        NULL AS invoice_id,
        e.id AS expense_id,
        NULL AS payment_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        NULL AS purchase_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        COALESCE(e.amount, 0) - (
          SELECT COALESCE(SUM(pay.amount), 0)
          FROM admin_expense_payments pay
          WHERE pay.expense_id = e.id
            AND COALESCE(pay.status, '') <> 'anulado'
        ) AS document_balance,
        e.id AS source_id,
        1 AS sort_order
      FROM admin_expenses e
      LEFT JOIN organizations sup ON sup.id = e.provider_id
      WHERE COALESCE(CAST(e.status AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, '') <> 'anulado'

      UNION ALL

      SELECT
        CAST(COALESCE(
          CONCAT('org:', e.provider_id),
          CONCAT(
            'ruc:',
            CASE
              WHEN TRIM(
                COALESCE(
                  CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  _utf8mb4''
                )
              ) = _utf8mb4''
                THEN NULL
              ELSE TRIM(
                COALESCE(
                  CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              )
            END
          ),
          CONCAT(
            'name:',
            CASE
              WHEN TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  _utf8mb4''
                )
              ) = _utf8mb4''
                THEN NULL
              ELSE TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              )
            END
          ),
          CONCAT('admin-exp:', e.id)
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(
          CASE WHEN TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(
          CASE WHEN TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(
          COALESCE(
            CASE WHEN TRIM(CAST(p.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(p.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
            CASE WHEN TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
            _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci
          )
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(p.payment_date, p.created_at) AS movement_date,
        CAST(_utf8mb4'payment' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_kind,
        CAST(_utf8mb4'Pago gasto administrativo' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_type,
        CAST(_utf8mb4'admin-expenses' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'Gastos administrativos' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(COALESCE(p.receipt_number, e.receipt_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(CONCAT(_utf8mb4'Pago ' COLLATE utf8mb4_unicode_ci, COALESCE(CAST(p.method AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, _utf8mb4'sin metodo' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS description,
        0 AS debit_amount,
        COALESCE(p.amount, 0) AS credit_amount,
        CAST(COALESCE(CAST(p.status AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS movement_status,
        e.due_date,
        NULL AS invoice_id,
        e.id AS expense_id,
        NULL AS payment_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        NULL AS purchase_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        COALESCE(e.amount, 0) - (
          SELECT COALESCE(SUM(pay2.amount), 0)
          FROM admin_expense_payments pay2
          WHERE pay2.expense_id = e.id
            AND COALESCE(pay2.status, '') <> 'anulado'
        ) AS document_balance,
        p.id AS source_id,
        2 AS sort_order
      FROM admin_expense_payments p
      INNER JOIN admin_expenses e ON e.id = p.expense_id
      LEFT JOIN organizations sup ON sup.id = e.provider_id
      WHERE COALESCE(CAST(p.status AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, '') <> 'anulado'
        AND COALESCE(CAST(e.status AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, '') <> 'anulado'
    ) movements
    WHERE movements.supplier_key = ?
      AND movements.currency_code = ?
    ORDER BY movements.movement_date ASC, movements.sort_order ASC, movements.source_id ASC
    `,
    [supplierKey, currencyCode]
  );

  const safeRows = Array.isArray(movements) ? movements : [];
  let runningBalance = 0;
  const rows = safeRows.map((row) => {
    runningBalance += Number(row.debit_amount || 0) - Number(row.credit_amount || 0);
    return {
      ...row,
      running_balance: Number(runningBalance.toFixed(2)),
    };
  });

  const header = rows[0] || null;
  const summary = rows.reduce(
    (acc, row) => {
      acc.total_debit += Number(row.debit_amount || 0);
      acc.total_credit += Number(row.credit_amount || 0);
      if (Number(row.debit_amount || 0) > 0 && row.movement_kind === 'factura') acc.invoice_count += 1;
      if (Number(row.credit_amount || 0) > 0 && row.movement_kind === 'payment') acc.payment_count += 1;
      if (
        row.movement_kind === 'factura' &&
        row.due_date &&
        new Date(row.due_date) < new Date() &&
        row.running_balance > 0.009
      ) {
        acc.overdue_documents += 1;
      }
      return acc;
    },
    {
      total_debit: 0,
      total_credit: 0,
      final_balance: rows.length ? Number(rows[rows.length - 1].running_balance || 0) : 0,
      invoice_count: 0,
      payment_count: 0,
      overdue_documents: 0,
    }
  );

  return {
    supplier: header
      ? {
          supplier_key: supplierKey,
          supplier_name: header.supplier_name,
          supplier_ruc: header.supplier_ruc,
          currency_code: currencyCode,
        }
      : {
          supplier_key: supplierKey,
          supplier_name: null,
          supplier_ruc: null,
          currency_code: currencyCode,
        },
    summary,
    rows,
  };
}

async function fetchAccountsPayableSummary(query = {}) {
  const {
    supplier_q,
    currency_code,
    module_key,
    source_type,
    overdue,
    open_only,
    quick_filter,
    from_date,
    to_date,
  } = query || {};

  const where = [];
  const params = [];

  if (supplier_q) {
    const like = `%${String(supplier_q).trim()}%`;
    where.push('(src.supplier_name LIKE ? OR src.supplier_ruc LIKE ?)');
    params.push(like, like);
  }
  if (currency_code) {
    where.push('src.currency_code = ?');
    params.push(String(currency_code).toUpperCase());
  }
  appendModuleFilter(where, params, module_key);
  appendSourceFilter(where, params, source_type);
  if (from_date) {
    where.push('src.invoice_date >= ?');
    params.push(from_date);
  }
  if (to_date) {
    where.push('src.invoice_date <= ?');
    params.push(to_date);
  }
  if (String(open_only || '') === '1') {
    where.push('src.balance > 0.009');
  }
  if (String(overdue || '') === '1') {
    where.push('src.balance > 0.009 AND src.due_date IS NOT NULL AND src.due_date < CURDATE()');
  }
  if (quick_filter === 'due_today') {
    where.push('src.balance > 0.009 AND src.due_date = CURDATE()');
  } else if (quick_filter === 'due_7d') {
    where.push('src.balance > 0.009 AND src.due_date IS NOT NULL AND src.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)');
  } else if (quick_filter === 'age_90_plus') {
    where.push('src.balance > 0.009 AND src.due_date IS NOT NULL AND src.due_date < DATE_SUB(CURDATE(), INTERVAL 90 DAY)');
  } else if (quick_filter === 'no_due_date') {
    where.push('src.balance > 0.009 AND src.due_date IS NULL');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `
    SELECT
      src.supplier_key,
      MAX(src.supplier_id) AS supplier_id,
      MAX(src.supplier_name) AS supplier_name,
      MAX(src.supplier_ruc) AS supplier_ruc,
      src.currency_code,
      SUM(src.total_amount) AS total_invoiced,
      SUM(src.paid_amount) AS total_paid,
      SUM(src.balance) AS total_balance,
      SUM(CASE WHEN src.balance > 0.009 AND src.due_date IS NOT NULL AND src.due_date < CURDATE() THEN src.balance ELSE 0 END) AS overdue_balance,
      MIN(CASE WHEN src.balance > 0.009 AND src.due_date IS NOT NULL THEN src.due_date ELSE NULL END) AS next_due_date,
      SUM(CASE WHEN src.balance > 0.009 THEN 1 ELSE 0 END) AS open_documents,
      SUM(CASE WHEN src.balance <= 0.009 THEN 1 ELSE 0 END) AS paid_documents,
      SUM(CASE WHEN src.has_payment_order = 1 AND src.balance > 0.009 THEN 1 ELSE 0 END) AS documents_with_payment_order,
      GROUP_CONCAT(
        DISTINCT
        CASE
          WHEN src.operation_reference IS NULL OR TRIM(src.operation_reference) = '' OR src.operation_id IS NULL THEN NULL
          ELSE CONCAT(src.operation_type, '::', src.operation_id, '::', src.operation_reference)
        END
        ORDER BY src.operation_reference
        SEPARATOR '||'
      ) AS reference_targets,
      GROUP_CONCAT(
        DISTINCT
        CASE
          WHEN src.operation_reference IS NULL OR TRIM(src.operation_reference) = '' THEN NULL
          ELSE src.operation_reference
        END
        ORDER BY src.operation_reference
        SEPARATOR ', '
      ) AS reference_list,
      GROUP_CONCAT(DISTINCT src.module_name ORDER BY src.module_name SEPARATOR ', ') AS modules
    FROM (
      SELECT
        CAST(COALESCE(
          CONCAT('org:', e.supplier_id),
          CONCAT(
            'ruc:',
            CASE
              WHEN TRIM(
                COALESCE(
                  CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  _utf8mb4''
                )
              ) = _utf8mb4''
                THEN NULL
              ELSE TRIM(
                COALESCE(
                  CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              )
            END
          ),
          CONCAT(
            'name:',
            CASE
              WHEN TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  _utf8mb4''
                )
              ) = _utf8mb4''
                THEN NULL
              ELSE TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              )
            END
          ),
          CONCAT('op-exp:', e.id)
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        e.supplier_id,
        CAST(COALESCE(
          CASE WHEN TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(
          CASE WHEN TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(
          COALESCE(
            CASE WHEN TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
            _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci
          )
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(e.amount_total, 0) AS total_amount,
        COALESCE(e.paid_amount, 0) AS paid_amount,
        COALESCE(e.balance, COALESCE(e.amount_total, 0) - COALESCE(e.paid_amount, 0)) AS balance,
        e.invoice_date,
        e.due_date,
        e.operation_id AS operation_id,
        CAST(COALESCE(e.operation_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(
          CASE
            WHEN e.operation_type = 'service' THEN COALESCE(sc.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci)
            ELSE COALESCE(d.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci)
          END
          AS CHAR CHARACTER SET utf8mb4
        ) COLLATE utf8mb4_unicode_ci AS operation_reference,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM operation_expense_payment_order_items poi
            INNER JOIN operation_expense_payment_orders po ON po.id = poi.order_id
            WHERE poi.invoice_id = e.id
              AND COALESCE(po.status, '') <> 'anulada'
          ) THEN 1
          ELSE 0
        END AS has_payment_order,
        CAST(
          CASE
            WHEN e.operation_type = 'service' THEN _utf8mb4'services' COLLATE utf8mb4_unicode_ci
            WHEN TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'sin-modulo' COLLATE utf8mb4_unicode_ci
            ELSE TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci)
          END
          AS CHAR CHARACTER SET utf8mb4
        ) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(
          CASE
            WHEN e.operation_type = 'service' THEN _utf8mb4'Servicios y mantenimiento' COLLATE utf8mb4_unicode_ci
            WHEN TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'Sin modulo' COLLATE utf8mb4_unicode_ci
            ELSE TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci)
          END
          AS CHAR CHARACTER SET utf8mb4
        ) COLLATE utf8mb4_unicode_ci AS module_name
        ,CAST(_utf8mb4'operation-expense' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type
      FROM operation_expense_invoices e
      LEFT JOIN deals d ON d.id = e.operation_id AND e.operation_type = 'deal'
      LEFT JOIN service_cases sc ON sc.id = e.operation_id AND e.operation_type = 'service'
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN organizations sup ON sup.id = e.supplier_id
      WHERE COALESCE(e.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(
          CONCAT('org:', pi.supplier_id),
          CONCAT(
            'name:',
            CASE
              WHEN TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  _utf8mb4''
                )
              ) = _utf8mb4''
                THEN NULL
              ELSE TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              )
            END
          ),
          CONCAT('purchase:', pi.id)
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        pi.supplier_id,
        CAST(COALESCE(
          CASE WHEN TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(CASE WHEN TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(_utf8mb4'PYG' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(pi.total_amount, 0) AS total_amount,
        COALESCE(pi.paid_amount, 0) AS paid_amount,
        COALESCE(pi.balance, COALESCE(pi.total_amount, 0) - COALESCE(pi.paid_amount, 0)) AS balance,
        pi.invoice_date,
        pi.due_date,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        0 AS has_payment_order,
        CAST(_utf8mb4'admin-purchases' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'Compras administrativas' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name
        ,CAST(_utf8mb4'purchase-invoice' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type
      FROM purchase_invoices pi
      LEFT JOIN organizations sup ON sup.id = pi.supplier_id
      LEFT JOIN purchase_orders po ON po.id = pi.po_id
      WHERE COALESCE(pi.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(
          CONCAT('org:', e.provider_id),
          CONCAT(
            'ruc:',
            CASE
              WHEN TRIM(
                COALESCE(
                  CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  _utf8mb4''
                )
              ) = _utf8mb4''
                THEN NULL
              ELSE TRIM(
                COALESCE(
                  CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              )
            END
          ),
          CONCAT(
            'name:',
            CASE
              WHEN TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  _utf8mb4''
                )
              ) = _utf8mb4''
                THEN NULL
              ELSE TRIM(
                COALESCE(
                  CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              )
            END
          ),
          CONCAT('admin-exp:', e.id)
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        e.provider_id AS supplier_id,
        CAST(COALESCE(
          CASE WHEN TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(
          CASE WHEN TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
          CASE WHEN TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(
          COALESCE(
            CASE WHEN TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN NULL ELSE TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END,
            _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci
          )
        ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(e.amount, 0) AS total_amount,
        (
          SELECT COALESCE(SUM(pay.amount), 0)
          FROM admin_expense_payments pay
          WHERE pay.expense_id = e.id
            AND COALESCE(pay.status, '') <> 'anulado'
        ) AS paid_amount,
        COALESCE(e.amount, 0) - (
          SELECT COALESCE(SUM(pay.amount), 0)
          FROM admin_expense_payments pay
          WHERE pay.expense_id = e.id
            AND COALESCE(pay.status, '') <> 'anulado'
        ) AS balance,
        COALESCE(e.invoice_date, e.expense_date) AS invoice_date,
        e.due_date,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        0 AS has_payment_order,
        CAST(_utf8mb4'admin-expenses' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'Gastos administrativos' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name
        ,CAST(_utf8mb4'admin-expense' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type
      FROM admin_expenses e
      LEFT JOIN organizations sup ON sup.id = e.provider_id
      WHERE COALESCE(CAST(e.status AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, '') <> 'anulado'
    ) src
    ${whereSql}
    GROUP BY
      src.supplier_key,
      src.currency_code
    ORDER BY supplier_name ASC, src.currency_code ASC
    `,
    params
  );

  const supplierKeys = new Set();
  const totals = {
    suppliers: 0,
    rows: Number(rows?.length || 0),
    open_documents: 0,
    invoiced_by_currency: {},
    paid_by_currency: {},
    balance_by_currency: {},
    overdue_by_currency: {},
  };

  for (const row of rows || []) {
    supplierKeys.add(String(row.supplier_key || ''));
    totals.open_documents += Number(row.open_documents || 0);
    const currency = String(row.currency_code || 'PYG').toUpperCase();
    totals.invoiced_by_currency[currency] =
      (totals.invoiced_by_currency[currency] || 0) + Number(row.total_invoiced || 0);
    totals.paid_by_currency[currency] =
      (totals.paid_by_currency[currency] || 0) + Number(row.total_paid || 0);
    totals.balance_by_currency[currency] =
      (totals.balance_by_currency[currency] || 0) + Number(row.total_balance || 0);
    totals.overdue_by_currency[currency] =
      (totals.overdue_by_currency[currency] || 0) + Number(row.overdue_balance || 0);
  }
  totals.suppliers = supplierKeys.size;

  const openDocuments = await fetchAccountsPayableOpenDocuments(query);
  const dashboard = buildAccountsPayableDashboard(openDocuments);

  return { rows: rows || [], totals, dashboard };
}

async function fetchAccountsPayableOpenDocuments(query = {}) {
  const { supplier_q, currency_code, module_key, source_type, from_date, to_date, overdue, quick_filter } = query || {};
  const where = ['src.balance > 0.009'];
  const params = [];

  if (supplier_q) {
    const like = `%${String(supplier_q).trim()}%`;
    where.push('(src.supplier_name LIKE ? OR src.supplier_ruc LIKE ?)');
    params.push(like, like);
  }
  if (currency_code) {
    where.push('src.currency_code = ?');
    params.push(String(currency_code).toUpperCase());
  }
  appendModuleFilter(where, params, module_key);
  appendSourceFilter(where, params, source_type);
  if (from_date) {
    where.push('src.invoice_date >= ?');
    params.push(from_date);
  }
  if (to_date) {
    where.push('src.invoice_date <= ?');
    params.push(to_date);
  }
  if (String(overdue || '') === '1') {
    where.push('src.due_date IS NOT NULL AND src.due_date < CURDATE()');
  }
  if (quick_filter === 'due_today') {
    where.push('src.due_date = CURDATE()');
  } else if (quick_filter === 'due_7d') {
    where.push('src.due_date IS NOT NULL AND src.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)');
  } else if (quick_filter === 'age_90_plus') {
    where.push('src.due_date IS NOT NULL AND src.due_date < DATE_SUB(CURDATE(), INTERVAL 90 DAY)');
  } else if (quick_filter === 'no_due_date') {
    where.push('src.due_date IS NULL');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `
    SELECT *
    FROM (
      SELECT
        CAST(COALESCE(CONCAT('org:', e.supplier_id), CONCAT('op-exp:', e.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'')) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(COALESCE(NULLIF(TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(e.balance, COALESCE(e.amount_total, 0) - COALESCE(e.paid_amount, 0)) AS balance,
        e.due_date,
        e.invoice_date,
        e.operation_id,
        CAST(COALESCE(e.operation_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(CASE WHEN e.operation_type = 'service' THEN COALESCE(sc.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) ELSE COALESCE(d.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        CAST(COALESCE(e.receipt_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(CASE WHEN e.operation_type = 'service' THEN _utf8mb4'Servicios y mantenimiento' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'Sin modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(CASE WHEN e.operation_type = 'service' THEN _utf8mb4'services' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'sin-modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'operation-expense' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type
      FROM operation_expense_invoices e
      LEFT JOIN deals d ON d.id = e.operation_id AND e.operation_type = 'deal'
      LEFT JOIN service_cases sc ON sc.id = e.operation_id AND e.operation_type = 'service'
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN organizations sup ON sup.id = e.supplier_id
      WHERE COALESCE(e.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(CONCAT('org:', pi.supplier_id), CONCAT('purchase:', pi.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'') AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(_utf8mb4'PYG' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(pi.balance, COALESCE(pi.total_amount, 0) - COALESCE(pi.paid_amount, 0)) AS balance,
        pi.due_date,
        pi.invoice_date,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        CAST(COALESCE(pi.supplier_invoice_number, pi.invoice_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(_utf8mb4'Compras administrativas' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(_utf8mb4'admin-purchases' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'purchase-invoice' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type
      FROM purchase_invoices pi
      LEFT JOIN organizations sup ON sup.id = pi.supplier_id
      WHERE COALESCE(pi.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(CONCAT('org:', e.provider_id), CONCAT('admin-exp:', e.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'')) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(COALESCE(NULLIF(TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(e.amount, 0) - (
          SELECT COALESCE(SUM(pay.amount), 0)
          FROM admin_expense_payments pay
          WHERE pay.expense_id = e.id
            AND COALESCE(pay.status, '') <> 'anulado'
        ) AS balance,
        e.due_date,
        COALESCE(e.invoice_date, e.expense_date) AS invoice_date,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        CAST(COALESCE(e.receipt_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(_utf8mb4'Gastos administrativos' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(_utf8mb4'admin-expenses' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'admin-expense' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type
      FROM admin_expenses e
      LEFT JOIN organizations sup ON sup.id = e.provider_id
      WHERE COALESCE(CAST(e.status AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, _utf8mb4'' COLLATE utf8mb4_unicode_ci) <> _utf8mb4'anulado' COLLATE utf8mb4_unicode_ci
    ) src
    ${whereSql}
    ORDER BY src.due_date ASC, src.supplier_name ASC
    `,
    params
  );
  return rows || [];
}

function buildAccountsPayableDashboard(openDocuments = []) {
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const summary = {
    document_count: 0,
    overdue_count: 0,
    due_today_count: 0,
    upcoming_7d_count: 0,
    due_this_month_count: 0,
    aging_by_currency: {},
    debt_by_module: [],
    upcoming_due: [],
  };

  const ensureCurrency = (currency) => {
    const code = String(currency || 'PYG').toUpperCase();
    if (!summary.aging_by_currency[code]) {
      summary.aging_by_currency[code] = {
        current: 0,
        bucket_0_30: 0,
        bucket_31_60: 0,
        bucket_61_90: 0,
        bucket_90_plus: 0,
        no_due_date: 0,
      };
    }
    return summary.aging_by_currency[code];
  };

  for (const row of openDocuments) {
    const balance = Number(row?.balance || 0);
    if (balance <= 0.009) continue;
    summary.document_count += 1;
    const currencyBucket = ensureCurrency(row?.currency_code);
    const moduleName = String(row?.module_name || 'Sin modulo');
    let moduleBucket = summary.debt_by_module.find((item) => item.module_name === moduleName);
    if (!moduleBucket) {
      moduleBucket = {
        module_name: moduleName,
        open_documents: 0,
        balance_by_currency: {},
      };
      summary.debt_by_module.push(moduleBucket);
    }
    moduleBucket.open_documents += 1;
    const moduleCurrency = String(row?.currency_code || 'PYG').toUpperCase();
    moduleBucket.balance_by_currency[moduleCurrency] =
      (moduleBucket.balance_by_currency[moduleCurrency] || 0) + balance;
    const dueDate = row?.due_date ? new Date(row.due_date) : null;

    if (!dueDate || Number.isNaN(dueDate.getTime())) {
      currencyBucket.no_due_date += balance;
      continue;
    }

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const diffDays = Math.floor((todayStart - dueStart) / msPerDay);

    if (diffDays > 0) {
      summary.overdue_count += 1;
      if (diffDays <= 30) currencyBucket.bucket_0_30 += balance;
      else if (diffDays <= 60) currencyBucket.bucket_31_60 += balance;
      else if (diffDays <= 90) currencyBucket.bucket_61_90 += balance;
      else currencyBucket.bucket_90_plus += balance;
    } else {
      currencyBucket.current += balance;
      const untilDue = Math.floor((dueStart - todayStart) / msPerDay);
      if (untilDue === 0) summary.due_today_count += 1;
      if (untilDue >= 0 && untilDue <= 7) summary.upcoming_7d_count += 1;
      if (dueStart.getFullYear() === todayStart.getFullYear() && dueStart.getMonth() === todayStart.getMonth()) {
        summary.due_this_month_count += 1;
      }
    }
  }

  summary.upcoming_due = openDocuments
    .filter((row) => Number(row?.balance || 0) > 0.009 && row?.due_date)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 10)
    .map((row) => ({
      supplier_name: row.supplier_name,
      supplier_ruc: row.supplier_ruc,
      currency_code: row.currency_code,
      balance: Number(row.balance || 0),
      due_date: row.due_date,
      module_name: row.module_name,
      operation_reference: row.operation_reference || '',
      document_number: row.document_number || '',
      operation_id: row.operation_id || null,
      operation_type: row.operation_type || null,
    }));

  summary.debt_by_module.sort((a, b) => {
    const sum = (bucket) =>
      Object.values(bucket?.balance_by_currency || {}).reduce((acc, value) => acc + Number(value || 0), 0);
    return sum(b) - sum(a);
  });

  return summary;
}

function normalizePayableStatus(row) {
  const balance = Number(row?.balance || 0);
  const paid = Number(row?.paid_amount || 0);
  const dueDate = row?.due_date ? new Date(row.due_date) : null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueStart = dueDate && !Number.isNaN(dueDate.getTime())
    ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
    : null;
  const moduleKey = String(row?.module_key || '');
  const condition = String(row?.condition_type || '').toUpperCase();
  const poStatus = String(row?.payment_order_status || '').toLowerCase();
  const treasuryStatus = String(row?.treasury_status || '').toLowerCase();
  const isCredit = condition === 'CREDITO' || condition === 'CREDIT';
  const isAdminSource = moduleKey === 'admin-purchases' || moduleKey === 'admin-expenses';

  if (balance <= 0.009) return 'pagado';
  if (paid > 0) return 'pago_parcial';
  if (isCredit && !dueStart) return 'bloqueado';
  if (!row?.supplier_ruc && !row?.supplier_id) return 'bloqueado';
  if (!row?.document_number) return 'bloqueado';
  if (!isAdminSource && isCredit) {
    if (!row?.payment_order_id) return 'sin_op';
    if (poStatus === 'pendiente') return 'op_pendiente';
    if (poStatus === 'aprobada' || poStatus === 'pago_parcial') return 'listo_pago';
    if (poStatus === 'pagada') return 'pagado';
  }
  if (treasuryStatus === 'retenido') return 'bloqueado';
  if (treasuryStatus === 'programado' || row?.scheduled_payment_date) return 'programado';
  if (dueStart && dueStart < todayStart) return 'vencido';
  if (dueStart && dueStart.getTime() === todayStart.getTime()) return 'vence_hoy';
  return 'listo_pago';
}

function payableStatusLabel(status) {
  const labels = {
    por_pagar: 'Por pagar',
    vencido: 'Vencido',
    vence_hoy: 'Vence hoy',
    sin_op: 'Sin OP',
    op_pendiente: 'OP pendiente',
    listo_pago: 'Listo para pagar',
    programado: 'Programado',
    pago_parcial: 'Pago parcial',
    pagado: 'Pagado',
    bloqueado: 'Bloqueado',
  };
  return labels[status] || status || '-';
}

function hasSupplierBankData(row) {
  return Boolean(
    row?.supplier_bank_name ||
      row?.supplier_bank_account ||
      row?.supplier_bank_holder ||
      row?.supplier_bank_cci_iban
  );
}

function getDocumentAlertLabels(row) {
  const labels = [];
  const condition = String(row?.condition_type || '').toUpperCase();
  if (!hasSupplierBankData(row) && Number(row?.balance || 0) > 0.009) labels.push('Proveedor sin cuenta bancaria');
  if ((condition === 'CREDITO' || condition === 'CREDIT') && !row?.due_date) labels.push('Credito sin vencimiento');
  if (!row?.document_number) labels.push('Sin numero de comprobante');
  if (!row?.supplier_ruc && !row?.supplier_id) labels.push('Proveedor sin RUC/organizacion');
  if (row?.scheduled_payment_date && !row?.planned_company_account) labels.push('Programado sin cuenta origen');
  if (String(row?.treasury_status || '').toLowerCase() === 'retenido') labels.push('Pago retenido');
  return labels;
}

function normalizeSourceType(sourceType) {
  const raw = String(sourceType || '').trim().toLowerCase();
  if (raw === 'operational-purchases' || raw === 'compras-operativas') return 'operation-expense';
  if (raw === 'admin-purchases') return 'purchase-invoice';
  if (raw === 'admin-expenses') return 'admin-expense';
  return raw;
}

async function fetchAccountsPayablePayments(sourceType, sourceId) {
  const type = normalizeSourceType(sourceType);
  const id = Number(sourceId || 0);
  if (!AP_META_SOURCE_TYPES.has(type) || !id) {
    const error = new Error('Documento invalido');
    error.statusCode = 400;
    throw error;
  }

  if (type === 'operation-expense') {
    const [rows] = await pool.query(
      `
      SELECT
        CAST(_utf8mb4'operation-expense' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type,
        p.id AS payment_id,
        p.invoice_id AS source_id,
        p.payment_date,
        p.amount,
        e.currency_code,
        p.method AS payment_method,
        p.account,
        p.reference_number,
        p.notes,
        p.status,
        p.created_at,
        u.name AS created_by_name,
        meta.receipt_file_url,
        meta.receipt_file_name,
        COALESCE(meta.reconciled, 0) AS reconciled,
        meta.reconciled_at,
        meta.reconciliation_notes,
        ru.name AS reconciled_by_name
      FROM operation_expense_payments p
      INNER JOIN operation_expense_invoices e ON e.id = p.invoice_id
      LEFT JOIN accounts_payable_payment_meta meta
        ON meta.source_type = 'operation-expense' AND meta.payment_id = p.id
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN users ru ON ru.id = meta.reconciled_by
      WHERE p.invoice_id = ? AND COALESCE(p.status, '') <> 'anulado'
      ORDER BY p.payment_date DESC, p.id DESC
      `,
      [id]
    );
    return rows;
  }

  if (type === 'purchase-invoice') {
    const [rows] = await pool.query(
      `
      SELECT
        CAST(_utf8mb4'purchase-invoice' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type,
        p.id AS payment_id,
        p.invoice_id AS source_id,
        p.payment_date,
        p.amount,
        CAST(_utf8mb4'PYG' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        p.payment_method,
        p.account,
        p.reference_number,
        p.notes,
        CAST(_utf8mb4'confirmado' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS status,
        p.created_at,
        u.name AS created_by_name,
        meta.receipt_file_url,
        meta.receipt_file_name,
        COALESCE(meta.reconciled, 0) AS reconciled,
        meta.reconciled_at,
        meta.reconciliation_notes,
        ru.name AS reconciled_by_name
      FROM purchase_invoice_payments p
      LEFT JOIN accounts_payable_payment_meta meta
        ON meta.source_type = 'purchase-invoice' AND meta.payment_id = p.id
      LEFT JOIN users u ON u.id = p.registered_by
      LEFT JOIN users ru ON ru.id = meta.reconciled_by
      WHERE p.invoice_id = ?
      ORDER BY p.payment_date DESC, p.id DESC
      `,
      [id]
    );
    return rows;
  }

  const [rows] = await pool.query(
    `
    SELECT
      CAST(_utf8mb4'admin-expense' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type,
      p.id AS payment_id,
      p.expense_id AS source_id,
      p.payment_date,
      p.amount,
      p.currency_code,
      p.method AS payment_method,
      p.account,
      p.reference_number,
      NULL AS notes,
      p.status,
      p.created_at,
      u.name AS created_by_name,
      meta.receipt_file_url,
      meta.receipt_file_name,
      COALESCE(meta.reconciled, 0) AS reconciled,
      meta.reconciled_at,
      meta.reconciliation_notes,
      ru.name AS reconciled_by_name
    FROM admin_expense_payments p
    LEFT JOIN accounts_payable_payment_meta meta
      ON meta.source_type = 'admin-expense' AND meta.payment_id = p.id
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN users ru ON ru.id = meta.reconciled_by
    WHERE p.expense_id = ? AND COALESCE(p.status, '') <> 'anulado'
    ORDER BY p.payment_date DESC, p.id DESC
    `,
    [id]
  );
  return rows;
}

function buildDocumentDashboard(rows = []) {
  const dashboard = {
    total_documents: rows.length,
    open_documents: 0,
    ready_to_pay: 0,
    blocked_documents: 0,
    scheduled_documents: 0,
    missing_supplier_bank: 0,
    by_status: {},
    balance_by_currency: {},
    overdue_by_currency: {},
    aging_by_currency: {},
  };
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;

  const ensureCurrency = (currency) => {
    const code = String(currency || 'PYG').toUpperCase();
    if (!dashboard.aging_by_currency[code]) {
      dashboard.aging_by_currency[code] = {
        current: 0,
        bucket_0_30: 0,
        bucket_31_60: 0,
        bucket_61_90: 0,
        bucket_90_plus: 0,
        no_due_date: 0,
      };
    }
    return dashboard.aging_by_currency[code];
  };

  for (const row of rows) {
    const status = row.payable_status;
    const balance = Number(row.balance || 0);
    const currency = String(row.currency_code || 'PYG').toUpperCase();
    dashboard.by_status[status] = (dashboard.by_status[status] || 0) + 1;
    if (balance > 0.009) {
      dashboard.open_documents += 1;
      dashboard.balance_by_currency[currency] =
        (dashboard.balance_by_currency[currency] || 0) + balance;
      if (status === 'listo_pago') dashboard.ready_to_pay += 1;
      if (status === 'programado') dashboard.scheduled_documents += 1;
      if (status === 'bloqueado') dashboard.blocked_documents += 1;
      if (!hasSupplierBankData(row)) dashboard.missing_supplier_bank += 1;
      const bucket = ensureCurrency(currency);
      const dueDate = row.due_date ? new Date(row.due_date) : null;
      if (!dueDate || Number.isNaN(dueDate.getTime())) {
        bucket.no_due_date += balance;
      } else {
        const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
        const diffDays = Math.floor((todayStart - dueStart) / msPerDay);
        if (diffDays > 0) {
          dashboard.overdue_by_currency[currency] =
            (dashboard.overdue_by_currency[currency] || 0) + balance;
          if (diffDays <= 30) bucket.bucket_0_30 += balance;
          else if (diffDays <= 60) bucket.bucket_31_60 += balance;
          else if (diffDays <= 90) bucket.bucket_61_90 += balance;
          else bucket.bucket_90_plus += balance;
        } else {
          bucket.current += balance;
        }
      }
    }
  }

  return dashboard;
}

async function fetchAccountsPayableDocuments(query = {}) {
  const {
    supplier_q,
    currency_code,
    module_key,
    source_type,
    status,
    quick_filter,
    open_only,
    overdue,
  } = query || {};
  const where = [];
  const params = [];

  if (supplier_q) {
    const like = `%${String(supplier_q).trim()}%`;
    where.push('(src.supplier_name LIKE ? OR src.supplier_ruc LIKE ? OR src.document_number LIKE ? OR src.operation_reference LIKE ?)');
    params.push(like, like, like, like);
  }
  if (currency_code) {
    where.push('src.currency_code = ?');
    params.push(String(currency_code).toUpperCase());
  }
  appendModuleFilter(where, params, module_key);
  appendSourceFilter(where, params, source_type);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `
    SELECT *
    FROM (
      SELECT
        CAST(COALESCE(CONCAT('org:', e.supplier_id), CONCAT('op-exp:', e.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        e.supplier_id,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'')) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(COALESCE(NULLIF(TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        e.invoice_date,
        e.due_date,
        COALESCE(e.amount_total, 0) AS total_amount,
        COALESCE(e.paid_amount, 0) AS paid_amount,
        COALESCE(e.balance, COALESCE(e.amount_total, 0) - COALESCE(e.paid_amount, 0)) AS balance,
        CAST(COALESCE(e.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_status,
        e.id AS invoice_id,
        NULL AS expense_id,
        e.operation_id,
        CAST(COALESCE(e.operation_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(CASE WHEN e.operation_type = 'service' THEN COALESCE(sc.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) ELSE COALESCE(d.reference, _utf8mb4'' COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        CAST(COALESCE(e.receipt_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(CASE WHEN e.operation_type = 'service' THEN _utf8mb4'services' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'sin-modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(CASE WHEN e.operation_type = 'service' THEN _utf8mb4'Servicios y mantenimiento' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'Sin modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(COALESCE(e.condition_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        COALESCE(po2.id, po3.id) AS payment_order_id,
        CAST(COALESCE(po2.order_number, po3.order_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(COALESCE(po2.status, po3.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        NULL AS purchase_order_id,
        sup.supplier_bank_name, sup.supplier_bank_account, sup.supplier_bank_currency,
        sup.supplier_bank_account_type, sup.supplier_bank_holder, sup.supplier_bank_holder_ruc,
        sup.supplier_bank_cci_iban, sup.supplier_bank_swift,
        apm.scheduled_payment_date,
        CAST(COALESCE(apm.priority, _utf8mb4'normal' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS priority,
        CAST(COALESCE(apm.treasury_status, _utf8mb4'pendiente' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS treasury_status,
        CAST(COALESCE(apm.planned_company_account, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS planned_company_account,
        CAST(COALESCE(apm.treasury_notes, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS treasury_notes,
        CAST(COALESCE(apm.validation_status, _utf8mb4'pendiente' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS validation_status,
        CAST(COALESCE(apm.validation_notes, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS validation_notes,
        apm.validated_at,
        vu.name AS validated_by_name,
        (
          SELECT COUNT(*) FROM operation_expense_attachments att WHERE att.invoice_id = e.id
        ) + (
          SELECT COUNT(*) FROM accounts_payable_document_attachments apatt
          WHERE apatt.source_type = 'operation-expense' AND apatt.source_id = e.id
        ) AS attachment_count,
        apm.updated_at AS meta_updated_at,
        CAST(_utf8mb4'operation-expense' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type
      FROM operation_expense_invoices e
      LEFT JOIN deals d ON d.id = e.operation_id AND e.operation_type = 'deal'
      LEFT JOIN service_cases sc ON sc.id = e.operation_id AND e.operation_type = 'service'
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
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
      LEFT JOIN accounts_payable_document_meta apm
        ON apm.source_type = 'operation-expense' AND apm.source_id = e.id
      LEFT JOIN users vu ON vu.id = apm.validated_by
      WHERE COALESCE(e.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(CONCAT('org:', pi.supplier_id), CONCAT('purchase:', pi.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        pi.supplier_id,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'') AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(_utf8mb4'PYG' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        pi.invoice_date,
        pi.due_date,
        COALESCE(pi.total_amount, 0) AS total_amount,
        COALESCE(pi.paid_amount, 0) AS paid_amount,
        COALESCE(pi.balance, COALESCE(pi.total_amount, 0) - COALESCE(pi.paid_amount, 0)) AS balance,
        CAST(COALESCE(pi.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_status,
        pi.id AS invoice_id,
        NULL AS expense_id,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        CAST(COALESCE(pi.supplier_invoice_number, pi.invoice_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(_utf8mb4'admin-purchases' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'Compras administrativas' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(_utf8mb4'CREDITO' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        NULL AS payment_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        po.id AS purchase_order_id,
        sup.supplier_bank_name, sup.supplier_bank_account, sup.supplier_bank_currency,
        sup.supplier_bank_account_type, sup.supplier_bank_holder, sup.supplier_bank_holder_ruc,
        sup.supplier_bank_cci_iban, sup.supplier_bank_swift,
        apm.scheduled_payment_date,
        CAST(COALESCE(apm.priority, _utf8mb4'normal' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS priority,
        CAST(COALESCE(apm.treasury_status, _utf8mb4'pendiente' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS treasury_status,
        CAST(COALESCE(apm.planned_company_account, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS planned_company_account,
        CAST(COALESCE(apm.treasury_notes, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS treasury_notes,
        CAST(COALESCE(apm.validation_status, _utf8mb4'pendiente' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS validation_status,
        CAST(COALESCE(apm.validation_notes, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS validation_notes,
        apm.validated_at,
        vu.name AS validated_by_name,
        (
          SELECT COUNT(*) FROM accounts_payable_document_attachments apatt
          WHERE apatt.source_type = 'purchase-invoice' AND apatt.source_id = pi.id
        ) AS attachment_count,
        apm.updated_at AS meta_updated_at,
        CAST(_utf8mb4'purchase-invoice' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type
      FROM purchase_invoices pi
      LEFT JOIN organizations sup ON sup.id = pi.supplier_id
      LEFT JOIN purchase_orders po ON po.id = pi.po_id
      LEFT JOIN accounts_payable_document_meta apm
        ON apm.source_type = 'purchase-invoice' AND apm.source_id = pi.id
      LEFT JOIN users vu ON vu.id = apm.validated_by
      WHERE COALESCE(pi.status, '') <> 'anulada'

      UNION ALL

      SELECT
        CAST(COALESCE(CONCAT('org:', e.provider_id), CONCAT('admin-exp:', e.id)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_key,
        e.provider_id AS supplier_id,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.razon_social AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(sup.name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'Proveedor sin nombre' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_name,
        CAST(COALESCE(NULLIF(TRIM(CAST(sup.ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), NULLIF(TRIM(CAST(e.supplier_ruc AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4'')) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_ruc,
        CAST(UPPER(COALESCE(NULLIF(TRIM(CAST(e.currency_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4''), _utf8mb4'PYG' COLLATE utf8mb4_unicode_ci)) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS currency_code,
        COALESCE(e.invoice_date, e.expense_date) AS invoice_date,
        e.due_date,
        COALESCE(e.amount, 0) AS total_amount,
        (
          SELECT COALESCE(SUM(pay.amount), 0)
          FROM admin_expense_payments pay
          WHERE pay.expense_id = e.id
            AND COALESCE(pay.status, '') <> 'anulado'
        ) AS paid_amount,
        COALESCE(e.amount, 0) - (
          SELECT COALESCE(SUM(pay.amount), 0)
          FROM admin_expense_payments pay
          WHERE pay.expense_id = e.id
            AND COALESCE(pay.status, '') <> 'anulado'
        ) AS balance,
        CAST(COALESCE(e.status, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_status,
        NULL AS invoice_id,
        e.id AS expense_id,
        NULL AS operation_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_type,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS operation_reference,
        CAST(COALESCE(e.receipt_number, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS document_number,
        CAST(_utf8mb4'admin-expenses' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key,
        CAST(_utf8mb4'Gastos administrativos' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_name,
        CAST(COALESCE(e.condition_type, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS condition_type,
        NULL AS payment_order_id,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_number,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS payment_order_status,
        NULL AS purchase_order_id,
        sup.supplier_bank_name, sup.supplier_bank_account, sup.supplier_bank_currency,
        sup.supplier_bank_account_type, sup.supplier_bank_holder, sup.supplier_bank_holder_ruc,
        sup.supplier_bank_cci_iban, sup.supplier_bank_swift,
        apm.scheduled_payment_date,
        CAST(COALESCE(apm.priority, _utf8mb4'normal' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS priority,
        CAST(COALESCE(apm.treasury_status, _utf8mb4'pendiente' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS treasury_status,
        CAST(COALESCE(apm.planned_company_account, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS planned_company_account,
        CAST(COALESCE(apm.treasury_notes, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS treasury_notes,
        CAST(COALESCE(apm.validation_status, _utf8mb4'pendiente' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS validation_status,
        CAST(COALESCE(apm.validation_notes, _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS validation_notes,
        apm.validated_at,
        vu.name AS validated_by_name,
        (
          SELECT COUNT(*) FROM admin_expense_attachments att WHERE att.expense_id = e.id
        ) + (
          SELECT COUNT(*) FROM accounts_payable_document_attachments apatt
          WHERE apatt.source_type = 'admin-expense' AND apatt.source_id = e.id
        ) AS attachment_count,
        apm.updated_at AS meta_updated_at,
        CAST(_utf8mb4'admin-expense' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS source_type
      FROM admin_expenses e
      LEFT JOIN organizations sup ON sup.id = e.provider_id
      LEFT JOIN accounts_payable_document_meta apm
        ON apm.source_type = 'admin-expense' AND apm.source_id = e.id
      LEFT JOIN users vu ON vu.id = apm.validated_by
      WHERE COALESCE(CAST(e.status AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, '') <> 'anulado'
    ) src
    ${whereSql}
    ORDER BY src.due_date IS NULL ASC, src.due_date ASC, src.supplier_name ASC, src.invoice_date ASC
    `,
    params
  );

  let normalized = (rows || []).map((row) => ({
    ...row,
    total_amount: Number(row.total_amount || 0),
    paid_amount: Number(row.paid_amount || 0),
    balance: Number(row.balance || 0),
    payable_status: normalizePayableStatus(row),
    supplier_has_bank_account: hasSupplierBankData(row),
  })).map((row) => ({
    ...row,
    alerts: getDocumentAlertLabels(row),
  }));

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const matchesQuickFilter = (row) => {
    const dueDate = row.due_date ? new Date(row.due_date) : null;
    const dueStart = dueDate && !Number.isNaN(dueDate.getTime())
      ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
      : null;
    if (quick_filter === 'due_today') return dueStart?.getTime() === todayStart.getTime();
    if (quick_filter === 'due_7d') {
      if (!dueStart) return false;
      const max = new Date(todayStart);
      max.setDate(max.getDate() + 7);
      return dueStart >= todayStart && dueStart <= max;
    }
    if (quick_filter === 'age_90_plus') {
      if (!dueStart) return false;
      const max = new Date(todayStart);
      max.setDate(max.getDate() - 90);
      return dueStart < max;
    }
    if (quick_filter === 'no_due_date') return !dueStart;
    return true;
  };

  normalized = normalized.filter((row) => {
    const dueDate = row.due_date ? new Date(row.due_date) : null;
    const dueStart = dueDate && !Number.isNaN(dueDate.getTime())
      ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
      : null;
    const isOverdue = dueStart && dueStart < todayStart && Number(row.balance || 0) > 0.009;
    const isDueToday = dueStart && dueStart.getTime() === todayStart.getTime() && Number(row.balance || 0) > 0.009;
    if (String(open_only || '') === '1' && Number(row.balance || 0) <= 0.009) return false;
    if (String(overdue || '') === '1' && !isOverdue) return false;
    if (status === 'vencido') return isOverdue;
    if (status === 'vence_hoy') return isDueToday;
    if (status && status !== 'por_pagar' && row.payable_status !== status) return false;
    if (status === 'por_pagar' && Number(row.balance || 0) <= 0.009) return false;
    return matchesQuickFilter(row);
  });

  const dashboard = buildDocumentDashboard(normalized);
  return { rows: normalized, dashboard };
}

function formatMoney(value, currency = 'PYG') {
  const amount = Number(value || 0);
  const code = String(currency || 'PYG').toUpperCase();
  return `${code} ${amount.toLocaleString('es-PY', {
    minimumFractionDigits: code === 'USD' ? 2 : 0,
    maximumFractionDigits: code === 'USD' ? 2 : 0,
  })}`;
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString('es-PY');
  } catch {
    return String(value);
  }
}

function getToneColors(tone = 'slate') {
  const tones = {
    slate: { fill: '#E2E8F0', text: '#334155' },
    blue: { fill: '#DBEAFE', text: '#1D4ED8' },
    emerald: { fill: '#D1FAE5', text: '#047857' },
    amber: { fill: '#FEF3C7', text: '#B45309' },
    red: { fill: '#FEE2E2', text: '#B91C1C' },
  };
  return tones[tone] || tones.slate;
}

function getExcelToneColors(tone = 'slate') {
  const hex = getToneColors(tone);
  return {
    fill: hex.fill.replace('#', ''),
    text: hex.text.replace('#', ''),
  };
}

function getSummaryIndicators(row) {
  const indicators = [];
  if (Number(row?.overdue_balance || 0) > 0) indicators.push({ label: 'Vencido', tone: 'red' });
  if (Number(row?.total_paid || 0) > 0 && Number(row?.total_balance || 0) > 0) {
    indicators.push({ label: 'Parcial', tone: 'blue' });
  }
  if (Number(row?.documents_with_payment_order || 0) > 0) {
    indicators.push({ label: 'Con OP', tone: 'amber' });
  }
  if (Number(row?.total_balance || 0) <= 0.009) indicators.push({ label: 'Pagado', tone: 'emerald' });
  return indicators;
}

function getMovementStatusMeta(row) {
  const rawStatus = String(row?.movement_status || '').trim();
  const status = rawStatus.toLowerCase();
  const dueDate = row?.due_date ? new Date(row.due_date) : null;
  const isOverdue =
    row?.movement_kind === 'factura' &&
    dueDate &&
    dueDate < new Date() &&
    !status.includes('pagad') &&
    !status.includes('cancel');

  if (row?.movement_kind === 'payment_order') {
    if (status.includes('anulad')) return { label: 'OP anulada', tone: 'red' };
    if (status.includes('aprob')) return { label: 'OP aprobada', tone: 'blue' };
    if (status.includes('pag')) return { label: 'OP pagada', tone: 'emerald' };
    return { label: 'Con OP', tone: 'amber' };
  }

  if (status.includes('anulad')) return { label: 'Anulado', tone: 'red' };
  if (status.includes('parcial')) return { label: 'Parcial', tone: 'blue' };
  if (status.includes('pagad') || status.includes('cancel')) return { label: 'Pagado', tone: 'emerald' };
  if (isOverdue) return { label: 'Vencido', tone: 'red' };
  if (row?.movement_kind === 'payment') return { label: 'Pago aplicado', tone: 'emerald' };
  if (status.includes('pend')) return { label: 'Pendiente', tone: 'amber' };
  return { label: rawStatus || '-', tone: 'slate' };
}

function drawBadgeRow(doc, badges = [], startX, startY) {
  let x = startX;
  const y = startY;
  badges.forEach((badge) => {
    const colors = getToneColors(badge.tone);
    const text = String(badge.label || '');
    const width = Math.max(48, doc.widthOfString(text, { font: 'Helvetica-Bold', size: 8 }) + 18);
    doc.save();
    doc.roundedRect(x, y, width, 18, 9).fill(colors.fill);
    doc.restore();
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(8).text(text, x + 9, y + 5, {
      width: width - 12,
      align: 'center',
    });
    x += width + 6;
  });
  return x;
}

function drawSimpleTable(doc, headers, rows, startY, colWidths) {
  const left = doc.page.margins.left;
  const rowHeight = 22;
  let y = startY;

  const drawRow = (cells, header = false) => {
    let x = left;
    cells.forEach((cell, index) => {
      const width = colWidths[index];
      const cellMeta =
        cell && typeof cell === 'object' && !Array.isArray(cell)
          ? cell
          : { text: String(cell ?? '') };
      const text = String(cellMeta.text ?? '');
      if (!header && cellMeta.fillColor) {
        doc.save();
        doc.rect(x, y, width, rowHeight).fill(cellMeta.fillColor);
        doc.restore();
      }
      doc
        .lineWidth(0.5)
        .strokeColor('#CBD5E1')
        .rect(x, y, width, rowHeight)
        .stroke();
      doc
        .fillColor(header ? '#0F172A' : cellMeta.textColor || '#111827')
        .font(header ? 'Helvetica-Bold' : cellMeta.font || 'Helvetica')
        .fontSize(8)
        .text(text, x + 4, y + 6, {
          width: width - 8,
          ellipsis: true,
        });
      x += width;
    });
    y += rowHeight;
  };

  drawRow(headers, true);
  rows.forEach((row) => {
    if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
      doc.addPage();
      y = doc.page.margins.top;
      drawRow(headers, true);
    }
    drawRow(row, false);
  });
  return y;
}

router.get(
  '/vendor-detail',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      const supplierKey = String(req.query?.supplier_key || '').trim();
      const currencyCode = String(req.query?.currency_code || '').trim().toUpperCase();
      if (!supplierKey || !currencyCode) {
        return res.status(400).json({ error: 'supplier_key y currency_code son requeridos' });
      }
      const detail = await fetchAccountsPayableVendorDetail(supplierKey, currencyCode);
      res.json(detail);
    } catch (e) {
      console.error('[accounts-payable] vendor-detail error', e);
      res.status(500).json({ error: 'Error al obtener el detalle del proveedor' });
    }
  }
);

router.get(
  '/summary',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      const result = await fetchAccountsPayableSummary(req.query || {});
      res.json(result);
    } catch (e) {
      console.error('[accounts-payable] summary error', e);
      res.status(500).json({ error: 'Error al obtener cuentas a pagar' });
    }
  }
);

router.get(
  '/summary/export',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      const result = await fetchAccountsPayableSummary(req.query || {});
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Cuentas a pagar');

      sheet.columns = [
        { header: 'Proveedor', key: 'supplier_name', width: 28 },
        { header: 'RUC', key: 'supplier_ruc', width: 18 },
        { header: 'Moneda', key: 'currency_code', width: 10 },
        { header: 'Facturado', key: 'total_invoiced', width: 16 },
        { header: 'Pagado', key: 'total_paid', width: 16 },
        { header: 'Saldo', key: 'total_balance', width: 16 },
        { header: 'Vencido', key: 'overdue_balance', width: 16 },
        { header: 'Prox. venc.', key: 'next_due_date', width: 14 },
        { header: 'Docs abiertos', key: 'open_documents', width: 14 },
        { header: 'Con OP', key: 'documents_with_payment_order', width: 10 },
        { header: 'Referencias', key: 'reference_list', width: 28 },
        { header: 'Modulos', key: 'modules', width: 36 },
        { header: 'Indicadores', key: 'indicators', width: 24 },
      ];

      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).alignment = { vertical: 'middle' };
      for (const row of result.rows || []) {
        const excelRow = sheet.addRow({
          supplier_name: row.supplier_name,
          supplier_ruc: row.supplier_ruc || '',
          currency_code: row.currency_code,
          total_invoiced: Number(row.total_invoiced || 0),
          total_paid: Number(row.total_paid || 0),
          total_balance: Number(row.total_balance || 0),
          overdue_balance: Number(row.overdue_balance || 0),
          next_due_date: row.next_due_date || '',
          open_documents: Number(row.open_documents || 0),
          documents_with_payment_order: Number(row.documents_with_payment_order || 0),
          reference_list: row.reference_list || '',
          modules: row.modules || '',
          indicators: getSummaryIndicators(row).map((item) => item.label).join(' · '),
        });
        excelRow.alignment = { vertical: 'middle' };
        if (Number(row.overdue_balance || 0) > 0) {
          excelRow.getCell('overdue_balance').font = { bold: true, color: { argb: 'B91C1C' } };
        }
        const indicators = getSummaryIndicators(row);
        if (indicators.length) {
          const colors = getExcelToneColors(indicators[0].tone);
          excelRow.getCell('indicators').font = { bold: true, color: { argb: colors.text } };
          excelRow.getCell('indicators').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: colors.fill },
          };
        }
      }

      ['D', 'E', 'F', 'G'].forEach((col) => {
        sheet.getColumn(col).numFmt = '#,##0.00';
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="cuentas-a-pagar.xlsx"');
      await workbook.xlsx.write(res);
      res.end();
    } catch (e) {
      console.error('[accounts-payable] summary export error', e);
      res.status(500).json({ error: 'Error al exportar cuentas a pagar' });
    }
  }
);

router.get(
  '/summary/pdf',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      const result = await fetchAccountsPayableSummary(req.query || {});
      const doc = new PDFDocument({ size: 'A4', margin: 28, layout: 'landscape' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="cuentas-a-pagar.pdf"');
      doc.pipe(res);

      doc.font('Helvetica-Bold').fontSize(16).text('Cuentas a pagar - Resumen');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`Emitido: ${new Date().toLocaleString('es-PY')}`);
      doc.moveDown(0.8);

      const totalLines = [
        `Proveedores: ${result.totals?.suppliers || 0}`,
        `Docs abiertos: ${result.totals?.open_documents || 0}`,
        `Saldo: ${Object.entries(result.totals?.balance_by_currency || {}).map(([c, v]) => formatMoney(v, c)).join(' | ') || '-'}`,
        `Vencido: ${Object.entries(result.totals?.overdue_by_currency || {}).map(([c, v]) => formatMoney(v, c)).join(' | ') || '-'}`,
      ];
      totalLines.forEach((line) => doc.font('Helvetica').fontSize(9).fillColor('#111827').text(line));
      doc.moveDown(0.8);

      drawSimpleTable(
        doc,
        ['Proveedor', 'RUC', 'Moneda', 'Facturado', 'Pagado', 'Saldo', 'Vencido', 'Prox. venc.', 'Abiertos', 'Referencias', 'Indicadores'],
        (result.rows || []).map((row) => [
          row.supplier_name || '',
          row.supplier_ruc || '',
          row.currency_code || '',
          formatMoney(row.total_invoiced, row.currency_code),
          formatMoney(row.total_paid, row.currency_code),
          formatMoney(row.total_balance, row.currency_code),
          {
            text: formatMoney(row.overdue_balance, row.currency_code),
            textColor: Number(row.overdue_balance || 0) > 0 ? '#B91C1C' : '#111827',
            font: Number(row.overdue_balance || 0) > 0 ? 'Helvetica-Bold' : 'Helvetica',
          },
          formatDate(row.next_due_date),
          String(row.open_documents || 0),
          row.reference_list || '-',
          {
            text: getSummaryIndicators(row).map((item) => item.label).join(' · ') || '-',
            textColor: getSummaryIndicators(row)[0] ? getToneColors(getSummaryIndicators(row)[0].tone).text : '#111827',
            font: getSummaryIndicators(row).length ? 'Helvetica-Bold' : 'Helvetica',
          },
        ]),
        doc.y,
        [120, 60, 45, 70, 70, 70, 70, 60, 45, 120, 95]
      );

      doc.end();
    } catch (e) {
      console.error('[accounts-payable] summary pdf error', e);
      res.status(500).json({ error: 'Error al generar el PDF de cuentas a pagar' });
    }
  }
);

router.get(
  '/documents',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      const result = await fetchAccountsPayableDocuments(req.query || {});
      res.json(result);
    } catch (e) {
      console.error('[accounts-payable] documents error', e);
      res.status(500).json({ error: 'Error al obtener documentos por pagar' });
    }
  }
);

router.patch(
  '/documents/meta',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      await ensureAccountsPayableMetaTable();
      const sourceType = String(req.body?.source_type || '').trim().toLowerCase();
      const sourceId = Number(req.body?.source_id || 0);
      if (!AP_META_SOURCE_TYPES.has(sourceType) || !sourceId) {
        return res.status(400).json({ error: 'Documento invalido para programar pago' });
      }

      const priority = String(req.body?.priority || 'normal').trim().toLowerCase();
      const treasuryStatus = String(req.body?.treasury_status || 'pendiente').trim().toLowerCase();
      if (!AP_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Prioridad invalida' });
      if (!AP_TREASURY_STATUSES.has(treasuryStatus)) {
        return res.status(400).json({ error: 'Estado de tesoreria invalido' });
      }
      const scheduledPaymentDate = req.body?.scheduled_payment_date || null;
      const plannedCompanyAccount = String(req.body?.planned_company_account || '').trim() || null;
      const treasuryNotes = req.body?.treasury_notes == null ? null : String(req.body.treasury_notes || '').trim() || null;
      const validationStatus =
        req.body?.validation_status == null
          ? null
          : String(req.body.validation_status || 'pendiente').trim().toLowerCase();
      if (validationStatus && !AP_VALIDATION_STATUSES.has(validationStatus)) {
        return res.status(400).json({ error: 'Estado documental invalido' });
      }
      const validationNotes = String(req.body?.validation_notes || '').trim() || null;

      await pool.query(
        `
        INSERT INTO accounts_payable_document_meta
          (source_type, source_id, scheduled_payment_date, priority, treasury_status,
           planned_company_account, treasury_notes, validation_status, validation_notes, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          scheduled_payment_date = VALUES(scheduled_payment_date),
          priority = VALUES(priority),
          treasury_status = VALUES(treasury_status),
          planned_company_account = VALUES(planned_company_account),
          treasury_notes = IF(? IS NULL, treasury_notes, VALUES(treasury_notes)),
          validation_status = IF(? IS NULL, validation_status, VALUES(validation_status)),
          validation_notes = IF(? IS NULL, validation_notes, VALUES(validation_notes)),
          updated_by = VALUES(updated_by),
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          sourceType,
          sourceId,
          scheduledPaymentDate,
          priority,
          treasuryStatus,
          plannedCompanyAccount,
          treasuryNotes,
          validationStatus || 'pendiente',
          validationNotes,
          req.user?.id || null,
          treasuryNotes,
          validationStatus,
          validationNotes,
        ]
      );

      const [[row]] = await pool.query(
        `SELECT * FROM accounts_payable_document_meta WHERE source_type = ? AND source_id = ?`,
        [sourceType, sourceId]
      );
      res.json(row);
    } catch (e) {
      console.error('[accounts-payable] document meta error', e);
      res.status(500).json({ error: 'No se pudo guardar la programacion del pago' });
    }
  }
);

router.patch(
  '/documents/validation',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      await ensureAccountsPayableMetaTable();
      const sourceType = normalizeSourceType(req.body?.source_type);
      const sourceId = Number(req.body?.source_id || 0);
      const validationStatus = String(req.body?.validation_status || '').trim().toLowerCase();
      if (!AP_META_SOURCE_TYPES.has(sourceType) || !sourceId) {
        return res.status(400).json({ error: 'Documento invalido' });
      }
      if (!AP_VALIDATION_STATUSES.has(validationStatus)) {
        return res.status(400).json({ error: 'Estado documental invalido' });
      }

      const validationNotes = String(req.body?.validation_notes || '').trim() || null;
      const validatedAt = validationStatus === 'pendiente' ? null : new Date().toISOString().slice(0, 19).replace('T', ' ');
      const validatedBy = validationStatus === 'pendiente' ? null : req.user?.id || null;

      await pool.query(
        `
        INSERT INTO accounts_payable_document_meta
          (source_type, source_id, validation_status, validation_notes,
           validated_by, validated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          validation_status = VALUES(validation_status),
          validation_notes = VALUES(validation_notes),
          validated_by = VALUES(validated_by),
          validated_at = VALUES(validated_at),
          updated_by = VALUES(updated_by),
          updated_at = CURRENT_TIMESTAMP
        `,
        [sourceType, sourceId, validationStatus, validationNotes, validatedBy, validatedAt, req.user?.id || null]
      );

      const [[row]] = await pool.query(
        `SELECT * FROM accounts_payable_document_meta WHERE source_type = ? AND source_id = ?`,
        [sourceType, sourceId]
      );
      res.json(row);
    } catch (e) {
      console.error('[accounts-payable] document validation error', e);
      res.status(500).json({ error: 'No se pudo actualizar la validacion documental' });
    }
  }
);

router.get(
  '/documents/:sourceType/:sourceId/attachments',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      await ensureAccountsPayableMetaTable();
      const sourceType = normalizeSourceType(req.params?.sourceType);
      const sourceId = Number(req.params?.sourceId || 0);
      if (!AP_META_SOURCE_TYPES.has(sourceType) || !sourceId) {
        return res.status(400).json({ error: 'Documento invalido' });
      }
      const [rows] = await pool.query(
        `
        SELECT a.*, u.name AS uploaded_by_name
        FROM accounts_payable_document_attachments a
        LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.source_type = ? AND a.source_id = ?
        ORDER BY a.id DESC
        `,
        [sourceType, sourceId]
      );
      res.json({ rows });
    } catch (e) {
      console.error('[accounts-payable] document attachments list error', e);
      res.status(500).json({ error: 'No se pudieron obtener los adjuntos documentales' });
    }
  }
);

router.post(
  '/documents/:sourceType/:sourceId/attachments',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  documentAttachmentUpload.single('file'),
  async (req, res) => {
    try {
      await ensureAccountsPayableMetaTable();
      const sourceType = normalizeSourceType(req.params?.sourceType);
      const sourceId = Number(req.params?.sourceId || 0);
      if (!AP_META_SOURCE_TYPES.has(sourceType) || !sourceId) {
        return res.status(400).json({ error: 'Documento invalido' });
      }
      if (!req.file) return res.status(400).json({ error: 'file is required' });
      const relUrl = `/uploads/accounts-payable-documents/${sourceType}/${sourceId}/${req.file.filename}`;
      const [result] = await pool.query(
        `
        INSERT INTO accounts_payable_document_attachments
          (source_type, source_id, file_url, file_name, uploaded_by)
        VALUES (?, ?, ?, ?, ?)
        `,
        [sourceType, sourceId, relUrl, req.file.originalname || req.file.filename, req.user?.id || null]
      );
      const [[row]] = await pool.query(
        `SELECT * FROM accounts_payable_document_attachments WHERE id = ?`,
        [result.insertId]
      );
      res.status(201).json(row);
    } catch (e) {
      console.error('[accounts-payable] document attachment upload error', e);
      res.status(500).json({ error: 'No se pudo cargar el adjunto documental' });
    }
  }
);

router.get(
  '/documents/payments',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      await ensureAccountsPayableMetaTable();
      const sourceType = normalizeSourceType(req.query?.source_type);
      const sourceId = Number(req.query?.source_id || 0);
      const rows = await fetchAccountsPayablePayments(sourceType, sourceId);
      res.json({ rows });
    } catch (e) {
      console.error('[accounts-payable] document payments error', e);
      res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Error al obtener pagos del documento' });
    }
  }
);

router.post(
  '/payments/:sourceType/:paymentId/receipt',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  paymentReceiptUpload.single('file'),
  async (req, res) => {
    try {
      await ensureAccountsPayableMetaTable();
      const sourceType = normalizeSourceType(req.params?.sourceType);
      const paymentId = Number(req.params?.paymentId || 0);
      if (!AP_META_SOURCE_TYPES.has(sourceType) || !paymentId) {
        return res.status(400).json({ error: 'Pago invalido' });
      }
      if (!req.file) return res.status(400).json({ error: 'file is required' });

      const relUrl = `/uploads/accounts-payable-payments/${sourceType}/${paymentId}/${req.file.filename}`;
      await pool.query(
        `
        INSERT INTO accounts_payable_payment_meta
          (source_type, payment_id, receipt_file_url, receipt_file_name, updated_by)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          receipt_file_url = VALUES(receipt_file_url),
          receipt_file_name = VALUES(receipt_file_name),
          updated_by = VALUES(updated_by),
          updated_at = CURRENT_TIMESTAMP
        `,
        [sourceType, paymentId, relUrl, req.file.originalname || req.file.filename, req.user?.id || null]
      );
      const [[row]] = await pool.query(
        `SELECT * FROM accounts_payable_payment_meta WHERE source_type = ? AND payment_id = ?`,
        [sourceType, paymentId]
      );
      res.status(201).json(row);
    } catch (e) {
      console.error('[accounts-payable] payment receipt error', e);
      res.status(500).json({ error: 'No se pudo cargar el comprobante de pago' });
    }
  }
);

router.patch(
  '/payments/:sourceType/:paymentId/reconciliation',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      await ensureAccountsPayableMetaTable();
      const sourceType = normalizeSourceType(req.params?.sourceType);
      const paymentId = Number(req.params?.paymentId || 0);
      if (!AP_META_SOURCE_TYPES.has(sourceType) || !paymentId) {
        return res.status(400).json({ error: 'Pago invalido' });
      }
      const reconciled = req.body?.reconciled === false || req.body?.reconciled === 0 || req.body?.reconciled === '0'
        ? 0
        : 1;
      const reconciledAt = reconciled
        ? req.body?.reconciled_at || new Date().toISOString().slice(0, 19).replace('T', ' ')
        : null;
      const notes = String(req.body?.reconciliation_notes || '').trim() || null;

      await pool.query(
        `
        INSERT INTO accounts_payable_payment_meta
          (source_type, payment_id, reconciled, reconciled_at, reconciled_by,
           reconciliation_notes, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          reconciled = VALUES(reconciled),
          reconciled_at = VALUES(reconciled_at),
          reconciled_by = VALUES(reconciled_by),
          reconciliation_notes = VALUES(reconciliation_notes),
          updated_by = VALUES(updated_by),
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          sourceType,
          paymentId,
          reconciled,
          reconciledAt,
          reconciled ? req.user?.id || null : null,
          notes,
          req.user?.id || null,
        ]
      );
      const [[row]] = await pool.query(
        `SELECT * FROM accounts_payable_payment_meta WHERE source_type = ? AND payment_id = ?`,
        [sourceType, paymentId]
      );
      res.json(row);
    } catch (e) {
      console.error('[accounts-payable] payment reconciliation error', e);
      res.status(500).json({ error: 'No se pudo actualizar la conciliacion' });
    }
  }
);

router.get(
  '/documents/export',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      const result = await fetchAccountsPayableDocuments(req.query || {});
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Planilla de pagos');

      sheet.columns = [
        { header: 'Proveedor', key: 'supplier_name', width: 30 },
        { header: 'RUC', key: 'supplier_ruc', width: 18 },
        { header: 'Banco proveedor', key: 'supplier_bank_name', width: 22 },
        { header: 'Cuenta proveedor', key: 'supplier_bank_account', width: 24 },
        { header: 'Titular cuenta', key: 'supplier_bank_holder', width: 24 },
        { header: 'Documento', key: 'document_number', width: 18 },
        { header: 'Fecha factura', key: 'invoice_date', width: 14 },
        { header: 'Vencimiento', key: 'due_date', width: 14 },
        { header: 'Modulo', key: 'module_name', width: 24 },
        { header: 'Operacion', key: 'operation_reference', width: 18 },
        { header: 'Moneda', key: 'currency_code', width: 10 },
        { header: 'Total', key: 'total_amount', width: 14 },
        { header: 'Pagado', key: 'paid_amount', width: 14 },
        { header: 'Saldo', key: 'balance', width: 14 },
        { header: 'Condicion', key: 'condition_type', width: 14 },
        { header: 'OP', key: 'payment_order_number', width: 16 },
        { header: 'Estado OP', key: 'payment_order_status', width: 16 },
        { header: 'Estado pago', key: 'payable_status', width: 18 },
        { header: 'Fecha programada', key: 'scheduled_payment_date', width: 16 },
        { header: 'Prioridad', key: 'priority', width: 12 },
        { header: 'Estado tesoreria', key: 'treasury_status', width: 18 },
        { header: 'Cuenta origen', key: 'company_account', width: 28 },
        { header: 'Referencia pago', key: 'payment_reference', width: 22 },
        { header: 'Alertas', key: 'alerts', width: 38 },
        { header: 'Notas tesoreria', key: 'treasury_notes', width: 38 },
      ];

      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      for (const row of result.rows || []) {
        const excelRow = sheet.addRow({
          supplier_name: row.supplier_name || '',
          supplier_ruc: row.supplier_ruc || '',
          supplier_bank_name: row.supplier_bank_name || '',
          supplier_bank_account: row.supplier_bank_account || '',
          supplier_bank_holder: row.supplier_bank_holder || '',
          document_number: row.document_number || '',
          invoice_date: row.invoice_date || '',
          due_date: row.due_date || '',
          module_name: row.module_name || '',
          operation_reference: row.operation_reference || '',
          currency_code: row.currency_code || '',
          total_amount: Number(row.total_amount || 0),
          paid_amount: Number(row.paid_amount || 0),
          balance: Number(row.balance || 0),
          condition_type: row.condition_type || '',
          payment_order_number: row.payment_order_number || '',
          payment_order_status: row.payment_order_status || '',
          payable_status: payableStatusLabel(row.payable_status),
          scheduled_payment_date: row.scheduled_payment_date || '',
          priority: row.priority || 'normal',
          treasury_status: row.treasury_status || 'pendiente',
          company_account: row.planned_company_account || '',
          payment_reference: '',
          alerts: Array.isArray(row.alerts) ? row.alerts.join(' | ') : '',
          treasury_notes: row.treasury_notes || '',
        });
        excelRow.alignment = { vertical: 'middle' };
        if (!row.supplier_has_bank_account) {
          excelRow.getCell('supplier_bank_account').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FEF3C7' },
          };
        }
        if (row.payable_status === 'bloqueado') {
          excelRow.getCell('payable_status').font = { bold: true, color: { argb: 'B91C1C' } };
        }
        if (row.payable_status === 'programado') {
          excelRow.getCell('scheduled_payment_date').font = { bold: true, color: { argb: '1D4ED8' } };
        }
      }

      ['L', 'M', 'N'].forEach((col) => {
        sheet.getColumn(col).numFmt = '#,##0.00';
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="planilla-de-pagos.xlsx"');
      await workbook.xlsx.write(res);
      res.end();
    } catch (e) {
      console.error('[accounts-payable] documents export error', e);
      res.status(500).json({ error: 'Error al exportar planilla de pagos' });
    }
  }
);

router.get(
  '/vendor-detail/export',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      const supplierKey = String(req.query?.supplier_key || '').trim();
      const currencyCode = String(req.query?.currency_code || '').trim().toUpperCase();
      if (!supplierKey || !currencyCode) {
        return res.status(400).json({ error: 'supplier_key y currency_code son requeridos' });
      }

      const detail = await fetchAccountsPayableVendorDetail(supplierKey, currencyCode);
      const workbook = new ExcelJS.Workbook();

      const summarySheet = workbook.addWorksheet('Resumen');
      summarySheet.addRow(['Proveedor', detail.supplier?.supplier_name || '']);
      summarySheet.addRow(['RUC', detail.supplier?.supplier_ruc || '']);
      summarySheet.addRow(['Moneda', detail.supplier?.currency_code || currencyCode]);
      summarySheet.addRow(['Facturado', Number(detail.summary?.total_debit || 0)]);
      summarySheet.addRow(['Pagado', Number(detail.summary?.total_credit || 0)]);
      summarySheet.addRow(['Saldo final', Number(detail.summary?.final_balance || 0)]);
      summarySheet.addRow(['Facturas', Number(detail.summary?.invoice_count || 0)]);
      summarySheet.addRow(['Pagos', Number(detail.summary?.payment_count || 0)]);
      summarySheet.addRow(['Facturas vencidas', Number(detail.summary?.overdue_documents || 0)]);
      summarySheet.getColumn(1).width = 20;
      summarySheet.getColumn(2).width = 24;
      summarySheet.getRow(1).font = { bold: true };
      ['B4', 'B5', 'B6'].forEach((cellRef) => {
        summarySheet.getCell(cellRef).numFmt = '#,##0.00';
      });
      if (Number(detail.summary?.overdue_documents || 0) > 0) {
        summarySheet.getCell('B9').font = { bold: true, color: { argb: 'B45309' } };
        summarySheet.getCell('B9').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FEF3C7' },
        };
      }

      const sheet = workbook.addWorksheet('Movimientos');
      sheet.columns = [
        { header: 'Fecha', key: 'movement_date', width: 14 },
        { header: 'Tipo', key: 'movement_type', width: 22 },
        { header: 'Modulo', key: 'module_name', width: 24 },
        { header: 'Operacion', key: 'operation_reference', width: 18 },
        { header: 'Documento', key: 'document_number', width: 18 },
        { header: 'Descripcion', key: 'description', width: 36 },
        { header: 'Debe', key: 'debit_amount', width: 14 },
        { header: 'Haber', key: 'credit_amount', width: 14 },
        { header: 'Saldo', key: 'running_balance', width: 14 },
        { header: 'Estado', key: 'movement_status', width: 14 },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).alignment = { vertical: 'middle' };

      for (const row of detail.rows || []) {
        const meta = getMovementStatusMeta(row);
        const excelRow = sheet.addRow({
          movement_date: row.movement_date || '',
          movement_type: row.movement_type || '',
          module_name: row.module_name || '',
          operation_reference: row.operation_reference || '',
          document_number: row.document_number || '',
          description: row.description || '',
          debit_amount: Number(row.debit_amount || 0),
          credit_amount: Number(row.credit_amount || 0),
          running_balance: Number(row.running_balance || 0),
          movement_status:
            row.movement_kind === 'factura' && row.due_date
              ? `${meta.label} · ${formatDate(row.due_date)}`
              : meta.label,
        });
        excelRow.alignment = { vertical: 'middle' };
        const colors = getExcelToneColors(meta.tone);
        excelRow.getCell('movement_status').font = { bold: true, color: { argb: colors.text } };
        excelRow.getCell('movement_status').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colors.fill },
        };
      }

      ['G', 'H', 'I'].forEach((col) => {
        sheet.getColumn(col).numFmt = '#,##0.00';
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="estado-cuenta-proveedor.xlsx"');
      await workbook.xlsx.write(res);
      res.end();
    } catch (e) {
      console.error('[accounts-payable] vendor-detail export error', e);
      res.status(500).json({ error: 'Error al exportar el estado de cuenta' });
    }
  }
);

router.get(
  '/vendor-detail/pdf',
  requireAuth,
  requireAnyRole('admin', 'finanzas'),
  async (req, res) => {
    try {
      const supplierKey = String(req.query?.supplier_key || '').trim();
      const currencyCode = String(req.query?.currency_code || '').trim().toUpperCase();
      if (!supplierKey || !currencyCode) {
        return res.status(400).json({ error: 'supplier_key y currency_code son requeridos' });
      }

      const detail = await fetchAccountsPayableVendorDetail(supplierKey, currencyCode);
      const doc = new PDFDocument({ size: 'A4', margin: 28, layout: 'landscape' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="estado-cuenta-proveedor.pdf"');
      doc.pipe(res);

      doc.font('Helvetica-Bold').fontSize(16).text('Estado de cuenta proveedor');
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(11).text(detail.supplier?.supplier_name || 'Proveedor');
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(
        `RUC: ${detail.supplier?.supplier_ruc || '-'}  |  Moneda: ${detail.supplier?.currency_code || currencyCode}`
      );
      doc.moveDown(0.8);

      [
        `Facturado: ${formatMoney(detail.summary?.total_debit, currencyCode)}`,
        `Pagado: ${formatMoney(detail.summary?.total_credit, currencyCode)}`,
        `Saldo final: ${formatMoney(detail.summary?.final_balance, currencyCode)}`,
        `Facturas: ${detail.summary?.invoice_count || 0}  |  Pagos: ${detail.summary?.payment_count || 0}  |  Vencidas: ${detail.summary?.overdue_documents || 0}`,
      ].forEach((line) => doc.font('Helvetica').fontSize(9).fillColor('#111827').text(line));
      doc.moveDown(0.8);

      drawBadgeRow(
        doc,
        [
          { label: 'Vencido', tone: 'red' },
          { label: 'Parcial', tone: 'blue' },
          { label: 'Pagado', tone: 'emerald' },
          { label: 'Con OP', tone: 'amber' },
        ],
        doc.page.margins.left,
        doc.y
      );
      doc.moveDown(1.2);

      drawSimpleTable(
        doc,
        ['Fecha', 'Tipo', 'Modulo', 'Operacion', 'Documento', 'Debe', 'Haber', 'Saldo', 'Estado'],
        (detail.rows || []).map((row) => [
          formatDate(row.movement_date),
          row.movement_type || '',
          row.module_name || '',
          row.operation_reference || '',
          row.document_number || '',
          Number(row.debit_amount || 0) ? formatMoney(row.debit_amount, currencyCode) : '-',
          Number(row.credit_amount || 0) ? formatMoney(row.credit_amount, currencyCode) : '-',
          formatMoney(row.running_balance, currencyCode),
          (() => {
            const meta = getMovementStatusMeta(row);
            const dueText =
              row.movement_kind === 'factura' && row.due_date ? ` · ${formatDate(row.due_date)}` : '';
            const colors = getToneColors(meta.tone);
            return {
              text: `${meta.label}${dueText}`,
              textColor: colors.text,
              fillColor: colors.fill,
              font: 'Helvetica-Bold',
            };
          })(),
        ]),
        doc.y,
        [65, 90, 95, 70, 80, 75, 75, 75, 60]
      );

      doc.end();
    } catch (e) {
      console.error('[accounts-payable] vendor-detail pdf error', e);
      res.status(500).json({ error: 'Error al generar el PDF del estado de cuenta' });
    }
  }
);

export default router;

