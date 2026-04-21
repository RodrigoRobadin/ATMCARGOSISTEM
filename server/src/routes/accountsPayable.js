import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';

const router = Router();

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
  if (module_key && String(module_key) !== 'all') {
    where.push('src.module_key = ?');
    params.push(String(module_key));
  }
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
  const { supplier_q, currency_code, module_key, from_date, to_date, overdue, quick_filter } = query || {};
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
  if (module_key && String(module_key) !== 'all') {
    where.push('src.module_key = ?');
    params.push(String(module_key));
  }
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
        CAST(CASE WHEN e.operation_type = 'service' THEN _utf8mb4'services' COLLATE utf8mb4_unicode_ci WHEN TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) = _utf8mb4'' THEN _utf8mb4'sin-modulo' COLLATE utf8mb4_unicode_ci ELSE TRIM(CAST(bu.key_slug AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) END AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key
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
        CAST(_utf8mb4'admin-purchases' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key
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
        CAST(_utf8mb4'admin-expenses' COLLATE utf8mb4_unicode_ci AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS module_key
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
  requireAnyRole('admin', 'manager', 'finanzas'),
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
  requireAnyRole('admin', 'manager', 'finanzas'),
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
  requireAnyRole('admin', 'manager', 'finanzas'),
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
  requireAnyRole('admin', 'manager', 'finanzas'),
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
  '/vendor-detail/export',
  requireAuth,
  requireAnyRole('admin', 'manager', 'finanzas'),
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
  requireAnyRole('admin', 'manager', 'finanzas'),
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
