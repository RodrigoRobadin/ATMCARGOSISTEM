// server/src/routes/adminFinance.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import ExcelJS from 'exceljs';

const router = Router();

function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function diffDays(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function addDays(d, days) {
  const nd = new Date(d.getTime());
  nd.setDate(nd.getDate() + days);
  return nd;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(from, to) {
  const out = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end) {
    out.push(monthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

async function getParamValue(key) {
  try {
    const [[row]] = await pool.query(
      `SELECT value FROM params WHERE \`key\` = ? AND (active IS NULL OR active <> 0) ORDER BY ord LIMIT 1`,
      [key]
    );
    if (row?.value != null) return row.value;
  } catch {}
  try {
    const [[row]] = await pool.query(
      `SELECT \`value\` FROM param_values WHERE \`key\` = ? AND (active IS NULL OR active <> 0) ORDER BY ord LIMIT 1`,
      [key]
    );
    if (row?.value != null) return row.value;
  } catch {}
  return null;
}

async function buildFinanceData(query) {
  const now = new Date();
  const fromRaw = parseDate(query.from);
  const toRaw = parseDate(query.to);
  const from = fromRaw || startOfMonth(now);
  const to = toRaw || now;

  const businessUnitId = query.business_unit_id ? Number(query.business_unit_id) : null;
  const buFilter = businessUnitId ? 'AND d.business_unit_id = ?' : '';

  const days = diffDays(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));

  const fromStr = toYMD(from);
  const toStr = toYMD(to);
  const prevFromStr = toYMD(prevFrom);
  const prevToStr = toYMD(prevTo);

  const rateRaw = await getParamValue('admin_expense_exchange_rate');
  const rate = Number(rateRaw || 0) || 1;

  const currencyFilter = `(i.currency_code IS NULL OR i.currency_code = '' OR UPPER(i.currency_code) = 'USD')`;

  const [[invRow]] = await pool.query(
    `
    SELECT
      COALESCE(SUM(
        CASE
          WHEN i.status NOT IN ('anulada','borrador')
            THEN COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0)
          ELSE 0
        END
      ),0) AS invoiced
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date BETWEEN ? AND ?
      AND ${currencyFilter}
      ${buFilter}
    `,
    businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
  );

  const [[invPrevRow]] = await pool.query(
    `
    SELECT
      COALESCE(SUM(
        CASE
          WHEN i.status NOT IN ('anulada','borrador')
            THEN COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0)
          ELSE 0
        END
      ),0) AS invoiced
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date BETWEEN ? AND ?
      AND ${currencyFilter}
      ${buFilter}
    `,
    businessUnitId ? [prevFromStr, prevToStr, businessUnitId] : [prevFromStr, prevToStr]
  );

    const [[paidRow]] = await pool.query(
      `
      SELECT COALESCE(SUM(r.net_amount),0) AS paid
      FROM receipts r
      JOIN invoices i ON i.id = r.invoice_id
      LEFT JOIN deals d ON d.id = i.deal_id
      WHERE r.status <> 'anulado'
      AND COALESCE(r.issue_date, DATE(r.created_at)) BETWEEN ? AND ?
      AND (COALESCE(r.currency_code, i.currency_code, 'USD') = 'USD')
      ${buFilter}
      `,
      businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
    );

    const [[paidPrevRow]] = await pool.query(
      `
      SELECT COALESCE(SUM(r.net_amount),0) AS paid
      FROM receipts r
      JOIN invoices i ON i.id = r.invoice_id
      LEFT JOIN deals d ON d.id = i.deal_id
      WHERE r.status <> 'anulado'
      AND COALESCE(r.issue_date, DATE(r.created_at)) BETWEEN ? AND ?
      AND (COALESCE(r.currency_code, i.currency_code, 'USD') = 'USD')
      ${buFilter}
      `,
      businessUnitId ? [prevFromStr, prevToStr, businessUnitId] : [prevFromStr, prevToStr]
    );

  const [[pendingRow]] = await pool.query(
    `
    SELECT COALESCE(SUM(i.net_balance),0) AS pending
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date <= ?
      AND i.status NOT IN ('anulada','borrador')
      AND ${currencyFilter}
      ${buFilter}
    `,
    businessUnitId ? [toStr, businessUnitId] : [toStr]
  );

  const [[pendingPrevRow]] = await pool.query(
    `
    SELECT COALESCE(SUM(i.net_balance),0) AS pending
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date <= ?
      AND i.status NOT IN ('anulada','borrador')
      AND ${currencyFilter}
      ${buFilter}
    `,
    businessUnitId ? [prevToStr, businessUnitId] : [prevToStr]
  );

  const [[expRow]] = await pool.query(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN e.currency_code IS NULL OR e.currency_code = '' OR UPPER(e.currency_code) = 'USD'
          THEN e.amount
        ELSE e.amount / ?
      END
    ),0) AS expenses
    FROM admin_expenses e
    WHERE e.expense_date BETWEEN ? AND ?
    `,
    [rate, fromStr, toStr]
  );

  const [[expPrevRow]] = await pool.query(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN e.currency_code IS NULL OR e.currency_code = '' OR UPPER(e.currency_code) = 'USD'
          THEN e.amount
        ELSE e.amount / ?
      END
    ),0) AS expenses
    FROM admin_expenses e
    WHERE e.expense_date BETWEEN ? AND ?
    `,
    [rate, prevFromStr, prevToStr]
  );

  const invoiced = Number(invRow?.invoiced || 0);
  const paid = Number(paidRow?.paid || 0);
  const pending = Number(pendingRow?.pending || 0);
  const expenses = Number(expRow?.expenses || 0);
  const profit = invoiced - expenses;

  const prevInvoiced = Number(invPrevRow?.invoiced || 0);
  const prevPaid = Number(paidPrevRow?.paid || 0);
  const prevPending = Number(pendingPrevRow?.pending || 0);
  const prevExpenses = Number(expPrevRow?.expenses || 0);
  const prevProfit = prevInvoiced - prevExpenses;

  const labels = monthRange(from, to);

  const [invSeries] = await pool.query(
    `
    SELECT DATE_FORMAT(i.issue_date, '%Y-%m') AS ym,
           COALESCE(SUM(
             CASE
               WHEN i.status NOT IN ('anulada','borrador')
                 THEN COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0)
               ELSE 0
             END
           ),0) AS total
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date BETWEEN ? AND ?
      AND ${currencyFilter}
      ${buFilter}
    GROUP BY ym
    ORDER BY ym
    `,
    businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
  );

    const [paidSeries] = await pool.query(
      `
    SELECT DATE_FORMAT(COALESCE(r.issue_date, DATE(r.created_at)), '%Y-%m') AS ym,
           COALESCE(SUM(r.net_amount),0) AS total
    FROM receipts r
    JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE r.status <> 'anulado'
      AND COALESCE(r.issue_date, DATE(r.created_at)) BETWEEN ? AND ?
      AND (COALESCE(r.currency_code, i.currency_code, 'USD') = 'USD')
      ${buFilter}
    GROUP BY ym
    ORDER BY ym
    `,
      businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
    );

  const [expSeries] = await pool.query(
    `
    SELECT DATE_FORMAT(e.expense_date, '%Y-%m') AS ym,
           COALESCE(SUM(
             CASE
               WHEN e.currency_code IS NULL OR e.currency_code = '' OR UPPER(e.currency_code) = 'USD'
                 THEN e.amount
               ELSE e.amount / ?
             END
           ),0) AS total
    FROM admin_expenses e
    WHERE e.expense_date BETWEEN ? AND ?
    GROUP BY ym
    ORDER BY ym
    `,
    [rate, fromStr, toStr]
  );

  const toSeries = (rows) => {
    const map = new Map((rows || []).map((r) => [r.ym, Number(r.total || 0)]));
    return labels.map((k) => map.get(k) || 0);
  };

  const [pendingItems] = await pool.query(
    `
    SELECT i.id, i.invoice_number, i.issue_date, i.net_balance,
           o.name AS organization_name
    FROM invoices i
    LEFT JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date BETWEEN ? AND ?
      AND i.status NOT IN ('anulada','borrador')
      AND i.net_balance > 0
      AND ${currencyFilter}
      ${buFilter}
    ORDER BY i.net_balance DESC
    LIMIT 10
    `,
    businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
  );

    const [paidItems] = await pool.query(
      `
    SELECT r.id, r.receipt_number, COALESCE(r.issue_date, DATE(r.created_at)) AS issue_date, r.net_amount,
           i.invoice_number, o.name AS organization_name
    FROM receipts r
    JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE r.status <> 'anulado'
      AND COALESCE(r.issue_date, DATE(r.created_at)) BETWEEN ? AND ?
      AND (COALESCE(r.currency_code, i.currency_code, 'USD') = 'USD')
      ${buFilter}
    ORDER BY r.issue_date DESC
    LIMIT 10
    `,
      businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
    );

  const [expenseItems] = await pool.query(
    `
    SELECT e.id, e.expense_date, e.description, e.status, e.currency_code,
           CASE
             WHEN e.currency_code IS NULL OR e.currency_code = '' OR UPPER(e.currency_code) = 'USD'
               THEN e.amount
             ELSE e.amount / ?
           END AS amount_usd,
           COALESCE(e.supplier_name, p.name) AS supplier_name
    FROM admin_expenses e
    LEFT JOIN admin_expense_providers p ON p.id = e.provider_id
    WHERE e.expense_date BETWEEN ? AND ?
    ORDER BY e.expense_date DESC
    LIMIT 10
    `,
    [rate, fromStr, toStr]
  );

  return {
    range: {
      from: fromStr,
      to: toStr,
      prev_from: prevFromStr,
      prev_to: prevToStr,
      days,
    },
    kpi: { invoiced, paid, pending, expenses, profit },
    prev: {
      invoiced: prevInvoiced,
      paid: prevPaid,
      pending: prevPending,
      expenses: prevExpenses,
      profit: prevProfit,
    },
    series: {
      labels,
      invoiced: toSeries(invSeries),
      paid: toSeries(paidSeries),
      expenses: toSeries(expSeries),
    },
    lists: {
      pending: pendingItems || [],
      paid: paidItems || [],
      expenses: expenseItems || [],
    },
    meta: {
      business_unit_id: businessUnitId,
      expenses_scope: 'company',
      exchange_rate: rate,
    },
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const data = await buildFinanceData(req.query);
    res.json(data);
  } catch (e) {
    console.error('[admin-finance]', e?.message || e);
    res.status(500).json({ error: 'No se pudo cargar el dashboard financiero' });
  }
});

router.get('/export', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const data = await buildFinanceData(req.query);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'CRM';
    wb.created = new Date();

    const summary = wb.addWorksheet('Resumen');
    summary.addRow(['Desde', data.range.from, 'Hasta', data.range.to]);
    summary.addRow([]);
    summary.addRow(['KPI', 'Valor USD', 'Periodo anterior USD']);
    summary.addRow(['Facturado', data.kpi.invoiced, data.prev.invoiced]);
    summary.addRow(['Cobrado', data.kpi.paid, data.prev.paid]);
    summary.addRow(['Pendiente', data.kpi.pending, data.prev.pending]);
    summary.addRow(['Gastos', data.kpi.expenses, data.prev.expenses]);
    summary.addRow(['Utilidad', data.kpi.profit, data.prev.profit]);
    summary.addRow([]);
    summary.addRow(['Nota', 'Gastos incluyen toda la empresa (sin filtro de unidad).']);

    const series = wb.addWorksheet('Series');
    series.addRow(['Mes', 'Facturado', 'Cobrado', 'Gastos']);
    data.series.labels.forEach((label, i) => {
      series.addRow([
        label,
        data.series.invoiced[i] || 0,
        data.series.paid[i] || 0,
        data.series.expenses[i] || 0,
      ]);
    });

    const pending = wb.addWorksheet('Pendiente');
    pending.addRow(['Factura', 'Cliente', 'Fecha', 'Saldo']);
    (data.lists.pending || []).forEach((r) => {
      pending.addRow([r.invoice_number, r.organization_name, r.issue_date, r.net_balance]);
    });

    const paid = wb.addWorksheet('Cobros');
    paid.addRow(['Recibo', 'Factura', 'Cliente', 'Fecha', 'Monto']);
    (data.lists.paid || []).forEach((r) => {
      paid.addRow([r.receipt_number, r.invoice_number, r.organization_name, r.issue_date, r.net_amount]);
    });

    const exp = wb.addWorksheet('Gastos');
    exp.addRow(['Fecha', 'Proveedor', 'Detalle', 'Monto USD']);
    (data.lists.expenses || []).forEach((r) => {
      exp.addRow([r.expense_date, r.supplier_name, r.description, r.amount_usd]);
    });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="finance-${data.range.from}_to_${data.range.to}.xlsx"`
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[admin-finance][export]', e?.message || e);
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

export default router;
