import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { buildReport, dateOnly, firstConfirmation } from '../services/confirmedSalesReport.js';

const router = Router();
router.use(requireAuth, requireRole(['admin', 'finanzas']));

function filtersFrom(query) {
  const currentYear = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Asuncion', year: 'numeric',
  }).format(new Date()));
  const year = query.year == null || query.year === '' ? currentYear : Number(query.year);
  const month = String(query.month || '').padStart(query.month ? 2 : 0, '0');
  const business_unit = String(query.business_unit || '');
  const advisor_id = query.advisor_id ? Number(query.advisor_id) : null;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
      (month && !/^(0[1-9]|1[0-2])$/.test(month)) ||
      (business_unit && !['atm-cargo', 'atm-industrial'].includes(business_unit)) ||
      (query.advisor_id && (!Number.isInteger(advisor_id) || advisor_id <= 0))) {
    const error = new Error('Filtros invalidos');
    error.statusCode = 400;
    throw error;
  }
  return {
    year, month, business_unit, advisor_id,
    client: String(query.client || '').trim().slice(0, 100),
    pending: String(query.pending || '') === '1',
  };
}

function batches(values, size = 400) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function rowsForIds(ids, sql) {
  const rows = [];
  for (const batch of batches(ids)) {
    const placeholders = batch.map(() => '?').join(',');
    const [result] = await pool.query(sql.replace('/*IDS*/', placeholders), batch);
    rows.push(...result);
  }
  return rows;
}

export async function loadReport(filters) {
  const [deals] = await pool.query(`
    SELECT d.id, d.reference, d.title, d.advisor_user_id AS advisor_id,
           u.name AS advisor_name, COALESCE(NULLIF(o.razon_social, ''), o.name) AS client_name,
           bu.key_slug AS business_unit_key, bu.name AS business_unit_name
      FROM deals d
      JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN users u ON u.id = d.advisor_user_id
     WHERE bu.key_slug IN ('atm-cargo', 'atm-industrial')
       AND d.reference REGEXP '^OP-[0-9]+$'
  `);
  const ids = deals.map((deal) => Number(deal.id));
  if (!ids.length) return buildReport([], new Map(), filters);

  const [fields, invoices] = await Promise.all([
    rowsForIds(ids, `SELECT id, deal_id, \`key\`, \`value\` FROM deal_custom_fields
      WHERE deal_id IN (/*IDS*/) AND \`key\` IN ('f_confirm', 'confirm_method', 'confirm_file_id') ORDER BY id DESC`),
    rowsForIds(ids, `SELECT id, deal_id, issue_date, invoice_number FROM invoices
      WHERE deal_id IN (/*IDS*/) AND status IN ('emitida', 'pagada', 'pago_parcial') AND issue_date IS NOT NULL
      ORDER BY deal_id, issue_date, id`),
  ]);
  const byDeal = new Map(deals.map((deal) => [Number(deal.id), { ...deal }]));
  for (const field of fields) {
    const deal = byDeal.get(Number(field.deal_id));
    if (deal && deal[field.key] === undefined) deal[field.key] = field.value;
  }
  for (const invoice of invoices) {
    const deal = byDeal.get(Number(invoice.deal_id));
    if (deal && !deal.invoice_id) {
      deal.invoice_id = invoice.id;
      deal.invoice_date = invoice.issue_date;
      deal.invoice_number = invoice.invoice_number;
    }
  }
  const fileIds = Array.from(new Set(deals.map((deal) => Number(byDeal.get(Number(deal.id))?.confirm_file_id))
    .filter((id) => Number.isInteger(id) && id > 0)));
  const validFiles = fileIds.length ? await rowsForIds(fileIds,
    `SELECT id, deal_id FROM deal_files WHERE id IN (/*IDS*/) AND type = 'customer_confirmation'`) : [];
  const fileOwners = new Map(validFiles.map((file) => [Number(file.id), Number(file.deal_id)]));
  for (const deal of byDeal.values()) {
    if (fileOwners.get(Number(deal.confirm_file_id)) !== Number(deal.id)) deal.confirm_file_id = null;
  }
  const confirmedInYear = Array.from(byDeal.values()).filter((deal) => {
    const first = firstConfirmation(deal);
    return first && dateOnly(first.date)?.startsWith(String(filters.year));
  });
  const cargoIds = confirmedInYear.filter((deal) => deal.business_unit_key === 'atm-cargo').map((deal) => Number(deal.id));
  const industrialIds = confirmedInYear.filter((deal) => deal.business_unit_key === 'atm-industrial').map((deal) => Number(deal.id));
  const budgets = new Map();
  if (cargoIds.length) {
    const versions = await rowsForIds(cargoIds,
      `SELECT deal_id, version_number, revision_name, data FROM deal_cost_sheet_versions WHERE deal_id IN (/*IDS*/)
       ORDER BY deal_id, version_number DESC, id DESC`);
    for (const version of versions) if (!budgets.has(Number(version.deal_id))) budgets.set(Number(version.deal_id), version);
    const missing = cargoIds.filter((id) => !budgets.has(id));
    if (missing.length) {
      const legacy = await rowsForIds(missing,
        'SELECT deal_id, data FROM deal_cost_sheets WHERE deal_id IN (/*IDS*/)');
      for (const sheet of legacy) budgets.set(Number(sheet.deal_id), sheet);
    }
  }
  if (industrialIds.length) {
    const quotes = await rowsForIds(industrialIds,
      `SELECT id, deal_id, computed_json, inputs_json FROM quotes WHERE deal_id IN (/*IDS*/) ORDER BY deal_id, id DESC`);
    const quoteByDeal = new Map();
    for (const quote of quotes) if (!quoteByDeal.has(Number(quote.deal_id))) quoteByDeal.set(Number(quote.deal_id), quote);
    const quoteIds = Array.from(quoteByDeal.values()).map((quote) => Number(quote.id));
    const revisions = quoteIds.length ? await rowsForIds(quoteIds,
      `SELECT id, quote_id, name, computed_json, inputs_json FROM quote_revisions
       WHERE quote_id IN (/*IDS*/) ORDER BY quote_id, id DESC`) : [];
    const revisionByQuote = new Map();
    for (const revision of revisions) if (!revisionByQuote.has(Number(revision.quote_id))) revisionByQuote.set(Number(revision.quote_id), revision);
    for (const [dealId, quote] of quoteByDeal) {
      const revision = revisionByQuote.get(Number(quote.id));
      budgets.set(dealId, revision
        ? { data: revision.computed_json, inputs: revision.inputs_json, revision_id: revision.id, revision_name: revision.name }
        : { data: quote.computed_json, inputs: quote.inputs_json });
    }
  }
  return buildReport(confirmedInYear, budgets, filters);
}

function money(value, currency) {
  if (value == null || !['USD', 'PYG'].includes(currency)) return '-';
  return new Intl.NumberFormat('es-PY', {
    minimumFractionDigits: currency === 'PYG' ? 0 : 2,
    maximumFractionDigits: currency === 'PYG' ? 0 : 2,
  }).format(value);
}

function sourceLabel(row) {
  if (row.confirmation.source === 'factura') return `Factura ${row.confirmation.document_number || ''}`.trim();
  return ({ purchase_order: 'Orden de compra', email: 'Correo', other: 'Otro' })[row.confirmation.method] || 'Comprobante';
}

function displayDate(date) {
  return String(date || '').split('-').reverse().join('/');
}

export async function exportExcel(res, report) {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('Resumen');
  summary.addRow(['Informe de ventas confirmadas', report.filters.year]);
  summary.addRow(['Filtros', `Mes: ${report.filters.month || 'Todos'} | Unidad: ${report.filters.business_unit || 'Todas'} | Ejecutivo: ${report.filters.advisor_id || 'Todos'} | Cliente: ${report.filters.client || 'Todos'} | Pendientes: ${report.filters.pending ? 'Si' : 'No'}`]);
  summary.addRow(['Mes', 'Moneda', 'Operaciones', 'Pendientes', 'Compra', 'Venta', 'Profit']);
  for (const month of report.months) summary.addRow([
    month.month, month.currency, month.count, month.pending_count, month.purchase, month.sale, month.profit,
  ]);
  summary.columns = [{ width: 20 }, { width: 14 }, { width: 17 }, { width: 15 }, { width: 18 }, { width: 18 }, { width: 18 }];
  const sheet = workbook.addWorksheet('Operaciones');
  sheet.columns = [
    { header: 'Fecha confirmacion', key: 'date', width: 20 },
    { header: 'Confirmado por', key: 'source', width: 24 },
    { header: 'Referencia', key: 'reference', width: 22 },
    { header: 'Titulo', key: 'title', width: 30 },
    { header: 'Cliente', key: 'client', width: 35 },
    { header: 'Unidad', key: 'unit', width: 22 },
    { header: 'Ejecutivo', key: 'advisor', width: 25 },
    { header: 'Revision', key: 'revision', width: 22 },
    { header: 'Moneda', key: 'currency', width: 12 },
    { header: 'Compra', key: 'purchase', width: 18 },
    { header: 'Venta', key: 'sale', width: 18 },
    { header: 'Profit', key: 'profit', width: 18 },
    { header: 'Estado', key: 'status', width: 22 },
  ];
  for (const row of report.rows) sheet.addRow({
    date: row.confirmation.date, source: sourceLabel(row), reference: row.reference,
    title: row.title, client: row.client_name, unit: row.business_unit_name,
    advisor: row.advisor_name, revision: row.revision || '', currency: row.currency,
    purchase: row.purchase, sale: row.sale, profit: row.profit,
    status: row.complete ? 'Completo' : 'Pendiente de importes',
  });
  sheet.autoFilter = { from: 'A1', to: 'M1' };
  sheet.getRow(1).font = { bold: true };
  for (const row of sheet.getRows(2, report.rows.length) || []) {
    for (const col of [10, 11, 12]) row.getCell(col).numFmt = '#,##0.00;[Red]-#,##0.00';
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="informe-ventas-${report.filters.year}.xlsx"`);
  res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
}

export function exportPdf(res, report) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="informe-ventas-${report.filters.year}.pdf"`);
  const pdf = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 30, bufferPages: true });
  pdf.pipe(res);
  pdf.fontSize(17).font('Helvetica-Bold').text(`Informe de ventas confirmadas ${report.filters.year}`);
  pdf.moveDown(0.3).fontSize(9).font('Helvetica').text(`${report.rows.length} operaciones | Importes presupuestados de la ultima revision | Sin cobros ni gastos administrativos`);
  pdf.text(`Filtros: mes ${report.filters.month || 'todos'} | unidad ${report.filters.business_unit || 'todas'} | ejecutivo ${report.filters.advisor_id || 'todos'} | cliente ${report.filters.client || 'todos'} | pendientes ${report.filters.pending ? 'si' : 'no'}`);
  pdf.moveDown(0.6);
  const totals = new Map();
  for (const month of report.months) {
    const item = totals.get(month.currency) || { count: 0, pending: 0, purchase: 0, sale: 0, profit: 0 };
    item.count += month.count; item.pending += month.pending_count;
    item.purchase += month.purchase; item.sale += month.sale; item.profit += month.profit;
    totals.set(month.currency, item);
  }
  for (const [currency, total] of totals) {
    pdf.text(`${currency}: ${total.count} operaciones (${total.pending} pendientes) | Compra ${money(total.purchase, currency)} | Venta ${money(total.sale, currency)} | Profit ${money(total.profit, currency)}`);
  }
  pdf.moveDown(0.8);
  if (report.months.length) {
    pdf.font('Helvetica-Bold').fontSize(9).text('Resumen mensual');
    pdf.moveDown(0.3);
    const summaryColumns = [['Mes', 100], ['Moneda', 75], ['Operaciones', 90], ['Pendientes', 90], ['Compra', 140], ['Venta', 140], ['Profit', 140]];
    const drawSummary = (values, top, bold = false) => {
      let x = 30;
      pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      summaryColumns.forEach(([, width], index) => {
        pdf.rect(x, top, width, 19).stroke('#cbd5e1');
        pdf.text(String(values[index] ?? ''), x + 3, top + 4, { width: width - 6, height: 12, ellipsis: true, align: index >= 4 ? 'right' : 'left' });
        x += width;
      });
    };
    let summaryY = pdf.y;
    drawSummary(summaryColumns.map(([name]) => name), summaryY, true);
    summaryY += 19;
    for (const month of report.months) {
      if (summaryY + 19 > pdf.page.height - 45) {
        pdf.addPage(); summaryY = 30;
        drawSummary(summaryColumns.map(([name]) => name), summaryY, true);
        summaryY += 19;
      }
      drawSummary([month.month, month.currency, month.count, month.pending_count,
        money(month.purchase, month.currency), money(month.sale, month.currency), money(month.profit, month.currency)], summaryY);
      summaryY += 19;
    }
    pdf.y = summaryY + 12;
  }
  const columns = [
    ['Fecha', 72], ['Confirmacion', 105], ['Referencia', 105], ['Cliente', 170],
    ['Unidad', 85], ['Ejecutivo', 110], ['Revision', 115], ['Mon.', 45],
    ['Compra', 100], ['Venta', 100], ['Profit', 100],
  ];
  const left = 30;
  const rowHeight = 28;
  const drawRow = (values, y, header = false) => {
    let x = left;
    pdf.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8 : 7.5);
    for (let index = 0; index < columns.length; index += 1) {
      const width = columns[index][1];
      pdf.rect(x, y, width, rowHeight).stroke('#cbd5e1');
      pdf.text(String(values[index] ?? ''), x + 3, y + 5, {
        width: width - 6, height: rowHeight - 8, ellipsis: true,
        align: index >= 8 ? 'right' : 'left',
      });
      x += width;
    }
  };
  let y = pdf.y;
  const header = columns.map(([name]) => name);
  if (y + rowHeight > pdf.page.height - 35) {
    pdf.addPage();
    y = 30;
  }
  drawRow(header, y, true);
  y += rowHeight;
  for (const row of report.rows) {
    if (y + rowHeight > pdf.page.height - 35) {
      pdf.addPage(); y = 30; drawRow(header, y, true); y += rowHeight;
    }
    drawRow([
      displayDate(row.confirmation.date), sourceLabel(row), row.reference, row.client_name,
      row.business_unit_name, row.advisor_name, row.revision || 'Pendiente', row.currency,
      money(row.purchase, row.currency), money(row.sale, row.currency),
      row.complete ? money(row.profit, row.currency) : 'Pendiente',
    ], y);
    y += rowHeight;
  }
  pdf.end();
}

router.get('/', async (req, res) => {
  try { res.json(await loadReport(filtersFrom(req.query))); }
  catch (error) {
    console.error('[confirmed-sales-report]', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'No se pudo cargar el informe de ventas' });
  }
});

router.get('/export/:format', async (req, res) => {
  if (!['xlsx', 'pdf'].includes(req.params.format)) return res.status(404).json({ error: 'Formato no disponible' });
  try {
    const report = await loadReport(filtersFrom(req.query));
    if (req.params.format === 'xlsx') await exportExcel(res, report);
    else exportPdf(res, report);
  } catch (error) {
    console.error('[confirmed-sales-report][export]', error);
    if (!res.headersSent) res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'No se pudo exportar el informe' });
    else res.end();
  }
});

export default router;
