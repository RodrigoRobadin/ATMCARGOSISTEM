import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { getBrandLogoPath } from '../services/brandingAssets.js';

const router = Router();
const DEFAULT_RATE = 0.2;
let schemaReady = null;

const json = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const currency = (value) => String(value || 'PYG').toUpperCase() === 'GS' ? 'PYG' : String(value || 'PYG').toUpperCase();
const isAdmin = (user) => String(user?.role || '').toLowerCase() === 'admin';
const money = (value, code) => `${code} ${number(value).toLocaleString('es-PY', { minimumFractionDigits: code === 'PYG' ? 0 : 2, maximumFractionDigits: code === 'PYG' ? 0 : 2 })}`;
const RUBRO_ORDER = ['PRODUCTO', 'FLETE', 'DESPACHO', 'ADICIONAL', 'FINANCIACION', 'INSTALACION', 'SEGURO', 'DESCUENTO', 'COMISION'];

function commissionAmounts(profit, rate, taxRate) {
  const gross = Math.max(0, number(profit)) * Math.max(0, number(rate));
  const tax = Math.max(0, number(taxRate));
  const net = tax > 0 ? gross / (1 + tax / 100) : gross;
  return { gross, net, iva: gross - net, profitAtm: number(profit) - gross };
}

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commission_liquidations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        operation_id INT NOT NULL,
        business_unit VARCHAR(32) NOT NULL,
        advisor_user_id BIGINT NOT NULL,
        source_type VARCHAR(32) NOT NULL,
        cost_sheet_version_number INT NULL,
        quote_id INT NULL,
        quote_revision_id INT NULL,
        currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
        budgeted_purchase DECIMAL(18,4) NOT NULL DEFAULT 0,
        budgeted_sale DECIMAL(18,4) NOT NULL DEFAULT 0,
        budgeted_profit DECIMAL(18,4) NOT NULL DEFAULT 0,
        commission_rate DECIMAL(8,6) NOT NULL DEFAULT 0.2,
        iva_rate DECIMAL(5,2) NOT NULL DEFAULT 10,
        commission_gross DECIMAL(18,4) NOT NULL DEFAULT 0,
        commission_net DECIMAL(18,4) NOT NULL DEFAULT 0,
        commission_iva DECIMAL(18,4) NOT NULL DEFAULT 0,
        profit_atm DECIMAL(18,4) NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'borrador',
        supplier_org_id INT NULL,
        created_by INT NULL,
        approved_by INT NULL,
        approved_at DATETIME NULL,
        cancelled_by INT NULL,
        cancelled_at DATETIME NULL,
        cancel_reason TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_commission_operation (operation_id),
        INDEX idx_commission_advisor (advisor_user_id),
        INDEX idx_commission_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commission_invoices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        supplier_org_id INT NULL,
        admin_expense_id INT NULL,
        invoice_date DATE NULL,
        receipt_type VARCHAR(32) NULL,
        receipt_number VARCHAR(64) NULL,
        timbrado_number VARCHAR(64) NULL,
        condition_type VARCHAR(16) NULL,
        due_date DATE NULL,
        currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
        amount_gross DECIMAL(18,4) NOT NULL DEFAULT 0,
        amount_net DECIMAL(18,4) NOT NULL DEFAULT 0,
        iva_rate DECIMAL(5,2) NOT NULL DEFAULT 10,
        iva_amount DECIMAL(18,4) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_commission_invoice_expense (admin_expense_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commission_invoice_allocations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        commission_invoice_id INT NOT NULL,
        liquidation_id INT NOT NULL,
        amount DECIMAL(18,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_commission_invoice_liquidation (commission_invoice_id, liquidation_id),
        INDEX idx_commission_allocation_liquidation (liquidation_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commission_audit_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        liquidation_id INT NULL,
        commission_invoice_id INT NULL,
        event_type VARCHAR(48) NOT NULL,
        detail TEXT NULL,
        payload_json JSON NULL,
        actor_user_id BIGINT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_commission_audit_liquidation (liquidation_id),
        INDEX idx_commission_audit_invoice (commission_invoice_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    const [userColumns] = await pool.query(`SHOW COLUMNS FROM users`);
    if (!userColumns.some((column) => column.Field === 'commission_supplier_org_id')) {
      await pool.query(`ALTER TABLE users ADD COLUMN commission_supplier_org_id INT NULL`);
    }
    const [liquidationColumns] = await pool.query(`SHOW COLUMNS FROM commission_liquidations`);
    if (!liquidationColumns.some((column) => column.Field === 'cancelled_by')) {
      await pool.query(`ALTER TABLE commission_liquidations ADD COLUMN cancelled_by INT NULL`);
    }
    if (!liquidationColumns.some((column) => column.Field === 'cancelled_at')) {
      await pool.query(`ALTER TABLE commission_liquidations ADD COLUMN cancelled_at DATETIME NULL`);
    }
    if (!liquidationColumns.some((column) => column.Field === 'cancel_reason')) {
      await pool.query(`ALTER TABLE commission_liquidations ADD COLUMN cancel_reason TEXT NULL`);
    }
  })();
  return schemaReady;
}

async function audit({ liquidationId = null, invoiceId = null, type, detail = null, payload = null, actor = null }) {
  await pool.query(
    `INSERT INTO commission_audit_events (liquidation_id, commission_invoice_id, event_type, detail, payload_json, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [liquidationId, invoiceId, type, detail, payload ? JSON.stringify(payload) : null, actor]
  );
}

async function dealAccess(operationId, user) {
  const [[deal]] = await pool.query(
    `SELECT d.id, d.reference, d.title, d.business_unit_id, d.advisor_user_id, d.org_id,
            bu.key_slug AS business_unit_key, o.name AS client_name, o.razon_social
       FROM deals d
       LEFT JOIN business_units bu ON bu.id = d.business_unit_id
       LEFT JOIN organizations o ON o.id = d.org_id
      WHERE d.id = ? LIMIT 1`, [operationId]
  );
  if (!deal) {
    const error = new Error('Operacion no encontrada'); error.status = 404; throw error;
  }
  if (!isAdmin(user) && Number(deal.advisor_user_id || 0) !== Number(user?.id || 0)) {
    const error = new Error('Permiso denegado'); error.status = 403; throw error;
  }
  return deal;
}

function sourceTotal(value, code, rate) {
  return currency(code) === 'PYG' ? number(value) * (number(rate) || 1) : number(value);
}

function sumRows(rows = [], preferredKeys = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list.reduce((sum, row) => {
    for (const key of preferredKeys) {
      if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return sum + number(row[key]);
    }
    const qty = number(row?.qty || row?.cantidad || 1) || 1;
    const unit = number(row?.unit_price || row?.unit_cost || row?.precio || row?.costo || 0);
    return sum + qty * unit;
  }, 0);
}

function sumCargoGsRows(rows = [], rate = 1, code = 'USD') {
  const total = sumRows(rows, ['total', 'totalGs', 'gs', 'amount']);
  return currency(code) === 'PYG' ? total : total / (number(rate) || 1);
}

function cargoDetailFromData(data = {}, code = 'USD') {
  const header = data.header || {};
  const totals = data.totals || {};
  const rate = number(header.gsRate || header.tc_gs || header.tcGsUsd || header.tipo_cambio_gs || data.gsRate || 1) || 1;
  const rows = [
    { label: 'COMPRA / VENTA AGENTE', buy: sumRows(data.compraRows || data.costoRows || [], ['total', 'totalUsd', 'usd', 'amount']), sell: sumRows(data.ventaRows || [], ['total', 'totalUsd', 'usd', 'amount']) },
    { label: 'COSTOS LOCALES', buy: sumCargoGsRows(data.locProvRows || data.locProvRowsGs || [], rate, code), sell: sumCargoGsRows(data.locCliRows || [], rate, code) },
    { label: 'SEGURO DE CARGA', buy: sumRows(data.segCostoRows || [], ['total', 'totalUsd', 'usd', 'amount']), sell: sumRows(data.segVentaRows || [], ['total', 'totalUsd', 'usd', 'amount']) },
  ].filter((row) => Math.abs(row.buy) > 0.0001 || Math.abs(row.sell) > 0.0001);
  if (!rows.length) rows.push({ label: 'TOTAL OPERACION', buy: number(totals.totalCostos ?? totals.total_costos ?? data.totalCostos), sell: number(totals.totalVentas ?? totals.total_ventas ?? data.totalVentas) });
  return {
    meta: {
      currency_code: code,
      source_label: header.revisionName || header.revision || data.revision_name || 'DET COS',
      exchange_rate: number(header.gsRate || header.tc_gs || header.tcGsUsd || header.tipo_cambio_gs || data.gsRate || 0),
      origin: header.origin || header.origen || '',
      destination: header.destination || header.destino || '',
      merchandise: header.mercaderia || header.commodity || '',
      contact: header.contact || header.contacto || '',
      phone: header.phone || header.telefono || '',
    },
    rows,
    items: [],
  };
}

function industrialDetailFromJson(inputs = {}, computed = {}, code = 'USD') {
  const opRubros = computed?.operacion?.rubros || {};
  const rows = RUBRO_ORDER
    .filter((key) => opRubros[key])
    .map((key) => ({ label: key, buy: number(opRubros[key]?.compra), sell: number(opRubros[key]?.venta), profit: number(opRubros[key]?.profit) }))
    .filter((row) => Math.abs(row.buy) > 0.0001 || Math.abs(row.sell) > 0.0001 || Math.abs(row.profit) > 0.0001);
  const items = [];
  const offerItems = Array.isArray(computed?.oferta?.items) ? computed.oferta.items : [];
  for (const item of offerItems.slice(0, 12)) {
    items.push({
      label: item.description || `Item ${item.line_no || ''}`.trim(),
      buy: number(item.valor_imp || item.door_value_usd || 0),
      sell: number(item.total_sales || item.unit_price || 0),
      note: 'Producto / precio cliente',
    });
  }
  const installItems = Array.isArray(inputs?.install_items) ? inputs.install_items : [];
  for (const item of installItems.filter((it) => it?.description).slice(0, 10)) {
    const qty = number(item.qty || 1) || 1;
    items.push({
      label: item.description,
      buy: qty * number(item.unit_cost_gs || 0),
      sell: qty * number(item.unit_price_gs || 0),
      note: 'Instalacion',
    });
  }
  return {
    meta: {
      currency_code: code,
      source_label: inputs.revision || computed?.meta?.revision || 'Cotizacion industrial',
      exchange_rate: number(computed?.meta?.exchange_rate_atm_gs_per_usd || inputs?.exchange_rate_atm_gs_per_usd || 0),
      origin: inputs.origin || inputs.origen || '',
      destination: inputs.destination || inputs.destino || '',
      merchandise: inputs.merchandise || inputs.mercaderia || '',
      contact: inputs.contact || inputs.contacto || '',
      phone: inputs.phone || inputs.telefono || '',
    },
    rows,
    items,
  };
}

async function loadLiquidationOperationDetail(row) {
  const code = currency(row.currency_code || 'USD');
  if (row.source_type === 'industrial_quote') {
    let source = null;
    if (number(row.quote_revision_id)) {
      const [[revision]] = await pool.query('SELECT name, inputs_json, computed_json FROM quote_revisions WHERE id=? LIMIT 1', [number(row.quote_revision_id)]);
      source = revision;
    }
    if (!source && number(row.quote_id)) {
      const [[quote]] = await pool.query('SELECT revision AS name, inputs_json, computed_json FROM quotes WHERE id=? LIMIT 1', [number(row.quote_id)]);
      source = quote;
    }
    const inputs = json(source?.inputs_json);
    const computed = json(source?.computed_json);
    return industrialDetailFromJson({ ...inputs, revision: source?.name }, computed, code);
  }
  const [[version]] = await pool.query(
    `SELECT revision_name, data FROM deal_cost_sheet_versions
      WHERE deal_id=? ${number(row.cost_sheet_version_number) ? 'AND version_number=?' : ''}
      ORDER BY version_number DESC LIMIT 1`,
    number(row.cost_sheet_version_number) ? [row.operation_id, number(row.cost_sheet_version_number)] : [row.operation_id]
  );
  const data = json(version?.data);
  return cargoDetailFromData({ ...data, revision_name: version?.revision_name }, code);
}

function drawOperationDetailPage(doc, row, detail, logoPath = '') {
  const code = currency(row.currency_code || detail?.meta?.currency_code || 'USD');
  const meta = detail?.meta || {};
  const rows = detail?.rows?.length ? detail.rows : [{ label: 'TOTAL OPERACION', buy: row.budgeted_purchase, sell: row.budgeted_sale, profit: row.budgeted_profit }];
  const byLabel = new Map(rows.map((item) => [String(item.label || '').toUpperCase(), item]));
  const find = (...keys) => {
    for (const key of keys) {
      const direct = byLabel.get(String(key).toUpperCase());
      if (direct) return direct;
      const loose = rows.find((item) => String(item.label || '').toUpperCase().includes(String(key).toUpperCase()));
      if (loose) return loose;
    }
    return { buy: 0, sell: 0, profit: 0 };
  };
  const product = find('PRODUCTO', 'COMPRA / VENTA AGENTE', 'TOTAL OPERACION');
  const flete = find('FLETE');
  const despacho = find('DESPACHO');
  const adicional = find('ADICIONAL');
  const financiacion = find('FINANCIACION');
  const instalacion = find('INSTALACION', 'COSTOS LOCALES');
  const seguro = find('SEGURO');
  const discount = find('DESCUENTO');
  const fmt = (value) => number(value) ? number(value).toLocaleString('es-PY', { minimumFractionDigits: code === 'PYG' ? 0 : 2, maximumFractionDigits: code === 'PYG' ? 0 : 2 }) : '';
  const tc = number(meta.exchange_rate || row.exchange_rate || 0);

  doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });
  const startX = 18;
  const startY = 21;
  const rowH = 10.65;
  const colW = [16, 63, 63, 40, 51, 42, 16, 63, 63, 40, 51, 51];
  const xAt = (col) => startX + colW.slice(0, col).reduce((sum, width) => sum + width, 0);
  const yAt = (excelRow) => startY + (excelRow - 4) * rowH;
  const wSpan = (col, span = 1) => colW.slice(col, col + span).reduce((sum, width) => sum + width, 0);
  const font = (bold = false, size = 5.4, color = '#000000', italic = false) => {
    const face = italic ? (bold ? 'Helvetica-BoldOblique' : 'Helvetica-Oblique') : (bold ? 'Helvetica-Bold' : 'Helvetica');
    return doc.font(face).fontSize(size).fillColor(color);
  };
  const cell = (r, c, span, text = '', opts = {}) => {
    const x = xAt(c);
    const y = yAt(r);
    const w = wSpan(c, span);
    const h = rowH * (opts.rowSpan || 1);
    if (opts.fill) doc.rect(x, y, w, h).fillAndStroke(opts.fill, '#000000');
    else if (opts.border !== false) doc.rect(x, y, w, h).stroke('#000000');
    font(opts.bold, opts.size || 5.4, opts.color || '#000000', opts.italic)
      .text(String(text || ''), x + 1.4, y + 2.3, { width: w - 2.8, align: opts.align || 'left', ellipsis: true });
  };
  const merge = (r, c, span, text, opts = {}) => cell(r, c, span, text, opts);
  const amountCell = (r, c, value, opts = {}) => cell(r, c, 1, fmt(value), { ...opts, align: 'right' });
  const box = (r, c, span, rowSpan = 1, opts = {}) => {
    const x = xAt(c);
    const y = yAt(r);
    const w = wSpan(c, span);
    const h = rowH * rowSpan;
    if (opts.fill) doc.rect(x, y, w, h).fillAndStroke(opts.fill, '#000000');
    else doc.rect(x, y, w, h).stroke('#000000');
  };
  const drawGrid = (fromRow, toRow, fromCol, toCol) => {
    for (let r = fromRow; r <= toRow; r += 1) {
      for (let c = fromCol; c <= toCol; c += 1) cell(r, c, 1, '', { size: 4.8 });
    }
  };

  let logoDrawn = false;
  if (logoPath) {
    try {
      doc.image(logoPath, xAt(1), yAt(2), { fit: [wSpan(1, 3), rowH * 6.5], align: 'left', valign: 'center' });
      logoDrawn = true;
    } catch (err) {
      console.warn('[commissions][operation-final-logo] ignored:', err?.message || err);
    }
  }
  if (!logoDrawn) {
    font(false, 15, '#111827').text('grupo', xAt(1), yAt(3), { width: wSpan(1, 2), align: 'right' });
    font(true, 18, '#d94545').text('atm', xAt(3), yAt(3) - 1, { width: wSpan(3, 1), align: 'left' });
  }

  box(4, 7, 5, 3);
  merge(4, 7, 5, `REF: ${row.reference || '-'}`, { bold: true, align: 'center', size: 12.8, border: false });
  merge(6, 7, 5, row.source_type === 'industrial_quote' ? (row.quote_revision_id ? `REV ${row.quote_revision_id}` : 'REV ACTUAL') : `DET COS ${row.cost_sheet_version_number || ''}`, { bold: true, align: 'center', size: 6.2, border: false, color: '#333333' });
  box(8, 7, 5, 2);
  merge(8, 7, 3, 'ATM', { bold: false, italic: true, align: 'center', size: 9.8, border: false });
  merge(8, 10, 2, 'TER LCL', { bold: false, italic: true, align: 'center', size: 9.8, border: false });
  box(10, 1, 3, 1);
  cell(10, 1, 1, 'MONEDA:', { bold: true, border: false, size: 6.4, align: 'right' });
  cell(10, 2, 1, code, { bold: true, border: false, size: 6.4, align: 'center' });

  box(12, 1, 5, 3);
  cell(12, 1, 1, 'CLIENTE:', { bold: true, border: false, size: 7.2 });
  merge(12, 2, 4, row.client_name || row.title || '', { border: false, size: 6.8 });
  cell(13, 1, 1, 'CONTACTO:', { bold: true, border: false, size: 7.2 });
  merge(13, 2, 4, meta.contact || '', { border: false, size: 6.8 });
  cell(14, 1, 1, 'TELEFONO:', { bold: true, border: false, size: 7.2 });
  merge(14, 2, 4, meta.phone || '', { border: false, size: 6.8 });

  box(12, 7, 5, 5);
  cell(12, 7, 1, 'ORIGEN:', { bold: true, border: false, size: 7.2 });
  merge(12, 8, 3, meta.origin || '', { border: false, size: 6.8 });
  cell(13, 7, 1, 'DESTINO:', { bold: true, border: false, size: 7.2 });
  merge(13, 8, 3, meta.destination || '', { border: false, size: 6.8 });
  cell(14, 7, 1, 'MERC.:', { bold: true, border: false, size: 7.2 });
  merge(14, 8, 3, meta.merchandise || '', { border: false, size: 6.8 });
  cell(15, 7, 1, 'AWB', { bold: true, border: false, size: 7.2 });

  box(16, 1, 3, 4);
  merge(16, 1, 2, 'PUERTA VENDIDA', { bold: true, border: false, size: 7.2 });
  merge(17, 1, 2, 'PESO BRUTO TOTAL', { bold: false, border: false, size: 6.8 });
  cell(17, 3, 1, 'KGS', { border: false, size: 6.8 });
  merge(18, 1, 2, 'PESO VOL. TOTAL', { border: false, size: 6.8 });
  cell(18, 3, 1, 'MT3', { border: false, size: 6.8 });
  merge(19, 1, 2, 'CANT. DE BULTOS', { border: false, size: 6.8 });
  cell(19, 3, 1, 'CAJAS', { border: false, size: 6.8 });

  box(18, 7, 3, 3);
  cell(18, 7, 1, 'VANO', { bold: true, border: false, size: 7.2 });
  cell(19, 7, 1, 'FECHA:', { bold: true, border: false, size: 7.2 });
  cell(20, 7, 1, 'RECIBO:', { bold: true, border: false, size: 7.2 });
  box(18, 10, 2, 2);
  cell(18, 10, 1, 'COMPRA  $', { bold: true, border: false, color: '#0000ff', size: 7.2 });
  amountCell(18, 11, tc, { border: false, bold: true, color: '#0000ff', size: 7.2 });
  cell(19, 10, 1, 'VENTA   $', { bold: true, border: false, color: '#0000ff', size: 7.2 });
  amountCell(19, 11, tc, { border: false, bold: true, color: '#0000ff', size: 7.2 });

  merge(21, 1, 5, meta.source_label || '', { bold: true, border: false });
  drawGrid(22, 36, 1, 5);
  drawGrid(22, 36, 7, 11);
  merge(22, 1, 5, 'COMPRA DEL AGENTE', { bold: true, align: 'center', fill: '#dbeafe', size: 5.8 });
  merge(22, 7, 5, 'VENTA AL CLIENTE', { bold: true, align: 'center', fill: '#dbeafe', size: 5.8 });
  merge(23, 1, 2, 'CARGOS', { bold: true, fill: '#e5e7eb' });
  cell(23, 3, 1, `${code} X KG`, { bold: true, fill: '#e5e7eb', align: 'center' });
  cell(23, 4, 1, 'A PAGAR', { bold: true, fill: '#e5e7eb', align: 'right' });
  cell(23, 5, 1, 'TOTAL', { bold: true, fill: '#e5e7eb', align: 'right' });
  merge(23, 7, 2, 'CARGOS', { bold: true, fill: '#e5e7eb' });
  cell(23, 9, 1, `${code} X KG`, { bold: true, fill: '#e5e7eb', align: 'center' });
  cell(23, 10, 1, 'TOTAL', { bold: true, fill: '#e5e7eb', align: 'right' });
  cell(23, 11, 1, 'PROFIT', { bold: true, fill: '#e5e7eb', align: 'right' });

  const chargeRows = [
    [24, 'PUERTAS COSTO', 'PUERTAS VENTA', product],
    [25, 'FLETE TERRESTRE', 'FLETE TERRESTRE', flete],
    [26, 'DESPACHO ADUANERO', 'DESPACHO ADUANERO', despacho],
    [27, 'ADICIONAL RETENCION', 'DESCUENTO', adicional],
    [28, 'FINANCIACION', 'FINANCIACION', financiacion],
  ];
  chargeRows.forEach(([r, buyLabel, sellLabel, item]) => {
    merge(r, 1, 2, buyLabel);
    amountCell(r, 4, item.buy);
    amountCell(r, 5, item.buy);
    merge(r, 7, 2, sellLabel);
    amountCell(r, 10, sellLabel === 'DESCUENTO' ? discount.sell : item.sell);
    amountCell(r, 11, sellLabel === 'DESCUENTO' ? discount.profit : number(item.sell) - number(item.buy));
  });
  merge(36, 1, 2, 'TOTAL', { bold: true, fill: '#fef08a' });
  cell(36, 3, 1, code, { bold: true, fill: '#fef08a', align: 'center' });
  amountCell(36, 4, number(product.buy) + number(flete.buy) + number(despacho.buy) + number(adicional.buy) + number(financiacion.buy), { bold: true, fill: '#fef08a' });
  amountCell(36, 5, number(product.buy) + number(flete.buy) + number(despacho.buy) + number(adicional.buy) + number(financiacion.buy), { bold: true, fill: '#fef08a' });
  cell(36, 7, 1, 'TOTAL', { bold: true, fill: '#fef08a' });
  cell(36, 9, 1, code, { bold: true, fill: '#fef08a', align: 'center' });
  amountCell(36, 10, number(product.sell) + number(flete.sell) + number(despacho.sell) + number(adicional.sell) + number(financiacion.sell) + number(discount.sell), { bold: true, fill: '#fef08a' });
  amountCell(36, 11, number(product.sell) + number(flete.sell) + number(despacho.sell) + number(adicional.sell) + number(financiacion.sell) + number(discount.sell) - number(product.buy) - number(flete.buy) - number(despacho.buy) - number(adicional.buy) - number(financiacion.buy), { bold: true, fill: '#fef08a' });

  drawGrid(38, 52, 1, 5);
  drawGrid(38, 52, 7, 11);
  merge(38, 1, 11, 'AUTOMASTER', { bold: true, align: 'center', fill: '#fde68a' });
  merge(39, 1, 3, 'COSTOS LOCALES', { bold: true, fill: '#dbeafe' });
  cell(39, 4, 1, 'A PAGAR', { bold: true, fill: '#dbeafe', align: 'right' });
  cell(39, 5, 1, 'TOTAL', { bold: true, fill: '#dbeafe', align: 'right' });
  merge(39, 7, 5, 'GASTOS LOCALES AL CLIENTE', { bold: true, align: 'center', fill: '#dbeafe' });
  merge(40, 1, 2, 'INSTALACION');
  amountCell(40, 4, instalacion.buy);
  amountCell(40, 5, instalacion.buy);
  merge(40, 7, 2, 'INSTALACION');
  amountCell(40, 10, instalacion.sell);
  amountCell(40, 11, number(instalacion.sell) - number(instalacion.buy));
  const itemLines = Array.isArray(detail?.items) ? detail.items.filter((item) => String(item.note || '').toUpperCase().includes('INSTAL')) : [];
  itemLines.slice(0, 10).forEach((item, index) => {
    const r = 41 + index;
    merge(r, 1, 2, item.label || '');
    amountCell(r, 4, item.buy);
    amountCell(r, 5, item.buy);
    merge(r, 7, 2, item.label || '');
    amountCell(r, 10, item.sell);
    amountCell(r, 11, number(item.sell) - number(item.buy));
  });
  merge(51, 1, 3, 'TOTAL', { bold: true, fill: '#fef08a' });
  amountCell(51, 4, instalacion.buy, { bold: true, fill: '#fef08a' });
  amountCell(51, 5, instalacion.buy, { bold: true, fill: '#fef08a' });
  merge(51, 7, 3, 'TOTAL', { bold: true, fill: '#fef08a' });
  amountCell(51, 10, instalacion.sell, { bold: true, fill: '#fef08a' });
  amountCell(51, 11, number(instalacion.sell) - number(instalacion.buy), { bold: true, fill: '#fef08a' });
  amountCell(52, 4, 0);
  amountCell(52, 5, 0);
  cell(52, 9, 1, code, { align: 'center' });
  amountCell(52, 10, 0);
  amountCell(52, 11, 0);

  cell(53, 1, 1, 'BIEN ASEG', { bold: true, border: false });
  drawGrid(54, 59, 1, 5);
  drawGrid(54, 59, 7, 11);
  merge(54, 1, 5, 'SEGURO DE CARGA', { bold: true, align: 'center', fill: '#dbeafe' });
  merge(54, 7, 5, 'SEGURO DE CARGA', { bold: true, align: 'center', fill: '#dbeafe' });
  merge(55, 1, 2, 'SEGURO DE CARGA');
  amountCell(55, 4, seguro.buy);
  amountCell(55, 5, seguro.buy);
  merge(55, 7, 2, 'SEGURO DE CARGA');
  amountCell(55, 10, seguro.sell);
  amountCell(55, 11, number(seguro.sell) - number(seguro.buy));
  merge(59, 1, 3, `TOTAL ${code}`, { bold: true, fill: '#fef08a' });
  amountCell(59, 4, seguro.buy, { bold: true, fill: '#fef08a' });
  amountCell(59, 5, seguro.buy, { bold: true, fill: '#fef08a' });
  merge(59, 7, 3, 'TOTAL', { bold: true, fill: '#fef08a' });
  amountCell(59, 10, seguro.sell, { bold: true, fill: '#fef08a' });
  amountCell(59, 11, number(seguro.sell) - number(seguro.buy), { bold: true, fill: '#fef08a' });

  merge(61, 1, 3, 'TOTAL GENERAL COMPRAS', { bold: true, fill: '#d9d9d9', size: 6.4 });
  amountCell(61, 4, row.budgeted_purchase, { bold: true, fill: '#d9d9d9', size: 6.4 });
  merge(61, 7, 3, 'TOTAL GENERAL VENTAS', { bold: true, fill: '#c6efce', size: 6.4 });
  cell(61, 9, 1, code, { bold: true, fill: '#c6efce', align: 'right', size: 6.4 });
  amountCell(61, 10, row.budgeted_sale, { bold: true, fill: '#ffff00', size: 6.4 });
  amountCell(61, 11, row.budgeted_profit, { bold: true, fill: '#ffffff', size: 6.4 });
  merge(64, 1, 2, 'PROFFIT GENERAL ATM', { bold: true, size: 7, fill: '#ffffff' });
  amountCell(64, 4, row.budgeted_profit, { bold: true, fill: '#ffffff', size: 7 });
  merge(66, 1, 2, 'PROFFIT SERVICIO', { bold: true, size: 7, fill: '#ffffff' });
  amountCell(66, 4, 0, { bold: true, fill: '#ffffff', size: 7 });
  drawGrid(64, 68, 7, 10);
  merge(64, 7, 4, 'DETALLE DE PAGOS', { bold: true, align: 'center', fill: '#e5e7eb' });
  cell(65, 7, 1, '1');
  cell(65, 8, 1, 'AGENTE');
  cell(65, 9, 1, code, { align: 'center' });
  cell(66, 7, 1, '2');
  cell(66, 8, 1, 'RETENCION');
  cell(66, 9, 1, code, { align: 'center' });
  cell(67, 7, 1, '3');
  cell(67, 8, 1, 'GASTOS LOC');
  cell(67, 9, 1, code, { align: 'center' });
  amountCell(67, 10, instalacion.buy);
  merge(68, 1, 2, 'PROFFIT VENDEDOR', { bold: true, size: 7, fill: '#ffffff' });
  amountCell(68, 4, row.commission_net, { bold: true, fill: '#ffffff', size: 7 });
  cell(68, 5, 1, `Comision =${(number(row.commission_rate) * 100).toFixed(0)}%`, { border: false, bold: true, size: 6.2 });
  cell(68, 7, 1, '');
  cell(68, 8, 1, 'SEGURO');
  cell(68, 9, 1, code, { align: 'center' });
  amountCell(68, 10, seguro.buy);
  merge(69, 1, 2, `IVA DESCONTADO ${number(row.iva_rate).toFixed(0)}%`, { bold: true, size: 6.6, fill: '#ffffff' });
  amountCell(69, 4, -number(row.commission_iva), { bold: true, fill: '#ffffff', size: 6.6 });
  cell(69, 5, 1, `Bruta ${fmt(row.commission_gross)}`, { border: false, size: 5.8 });
  merge(70, 1, 2, 'PROFFIT FINAL ATM', { bold: true, size: 7, fill: '#ffffff' });
  amountCell(70, 4, row.profit_atm, { bold: true, fill: '#ffffff', size: 7 });
  cell(72, 1, 1, 'AC', { border: false });
  cell(73, 1, 1, 'FC/RC', { border: false });
}

async function sourceForLiquidation(deal, body = {}) {
  const unit = String(deal.business_unit_key || '').toLowerCase();
  if (unit.includes('industrial') || body.quote_revision_id || body.quote_id) {
    const revisionId = number(body.quote_revision_id);
    const [[row]] = await pool.query(
      `SELECT r.id, r.quote_id, r.name, r.inputs_json, r.computed_json
         FROM quote_revisions r
         JOIN quotes q ON q.id = r.quote_id
        WHERE q.deal_id = ? ${revisionId ? 'AND r.id = ?' : ''}
        ORDER BY r.created_at DESC LIMIT 1`, revisionId ? [deal.id, revisionId] : [deal.id]
    );
    let sourceRow = row;
    if (!sourceRow && !revisionId) {
      const [[baseQuote]] = await pool.query(
        `SELECT id, NULL AS quote_revision_id, revision AS name, inputs_json, computed_json
           FROM quotes WHERE deal_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`,
        [deal.id]
      );
      sourceRow = baseQuote ? { ...baseQuote, quote_id: baseQuote.id, id: null } : null;
    }
    if (!sourceRow) { const error = new Error('No hay cotización industrial disponible'); error.status = 409; throw error; }
    const computed = json(sourceRow.computed_json);
    const inputs = json(sourceRow.inputs_json);
    const code = currency(computed?.meta?.operation_currency || inputs?.operation_currency || 'USD');
    const rate = number(computed?.meta?.exchange_rate_atm_gs_per_usd || inputs?.exchange_rate_atm_gs_per_usd || 1);
    return {
      source_type: 'industrial_quote', quote_id: sourceRow.quote_id, quote_revision_id: sourceRow.id || sourceRow.quote_revision_id || null,
      source_label: sourceRow.name || (sourceRow.id ? `REV ${sourceRow.id}` : 'Cotización actual'), currency_code: code,
      purchase: sourceTotal(computed?.operacion?.totals?.total_buy_usd, code, rate),
      sale: sourceTotal(computed?.operacion?.totals?.total_sell_usd || computed?.oferta?.totals?.total_sales_usd, code, rate),
    };
  }
  const versionNumber = number(body.cost_sheet_version_number);
  const [[row]] = await pool.query(
    `SELECT version_number, revision_name, data FROM deal_cost_sheet_versions
      WHERE deal_id = ? ${versionNumber ? 'AND version_number = ?' : ''}
      ORDER BY version_number DESC LIMIT 1`, versionNumber ? [deal.id, versionNumber] : [deal.id]
  );
  if (!row) { const error = new Error('No hay revision DET COS disponible'); error.status = 409; throw error; }
  const data = json(row.data);
  const totals = data?.totals || {};
  const code = currency(data?.header?.operationCurrency || data?.header?.currency || 'USD');
  return {
    source_type: 'cargo_cost_sheet', cost_sheet_version_number: row.version_number,
    source_label: row.revision_name || `REV ${String(row.version_number).padStart(2, '0')}`, currency_code: code,
    purchase: number(totals.totalCostos ?? totals.total_costos ?? totals.totalCost ?? 0),
    sale: number(totals.totalVentas ?? totals.total_ventas ?? totals.totalVentaCliente ?? 0),
  };
}

function listSql() {
  return `SELECT l.*, d.reference, d.title, COALESCE(o.razon_social, o.name) AS client_name,
                 u.name AS advisor_name, cu.name AS cancelled_by_name,
                 ci.id AS invoice_id, ci.receipt_number, ci.admin_expense_id,
                 COALESCE(a.amount, 0) AS invoiced_total,
                 COALESCE(pay.paid_total, 0) * CASE WHEN ci.amount_gross > 0 THEN COALESCE(a.amount,0) / ci.amount_gross ELSE 0 END AS paid_total
            FROM commission_liquidations l
            JOIN deals d ON d.id = l.operation_id
            LEFT JOIN organizations o ON o.id = d.org_id
            LEFT JOIN users u ON u.id = l.advisor_user_id
            LEFT JOIN users cu ON cu.id = l.cancelled_by
            LEFT JOIN commission_invoice_allocations a ON a.liquidation_id = l.id
            LEFT JOIN commission_invoices ci ON ci.id = a.commission_invoice_id
            LEFT JOIN (SELECT e.id, COALESCE(SUM(p.amount),0) paid_total FROM admin_expenses e LEFT JOIN admin_expense_payments p ON p.expense_id = e.id AND p.status <> 'anulado' GROUP BY e.id) pay ON pay.id = ci.admin_expense_id`;
}

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    await ensureSchema();
    const where = ['1=1']; const params = [];
    if (!isAdmin(req.user)) { where.push('l.advisor_user_id = ?'); params.push(req.user.id); }
    if (req.query.user_id && isAdmin(req.user)) { where.push('l.advisor_user_id = ?'); params.push(number(req.query.user_id)); }
    if (req.query.status) { where.push('l.status = ?'); params.push(req.query.status); }
    if (req.query.business_unit) { where.push('l.business_unit = ?'); params.push(req.query.business_unit); }
    if (req.query.operation_id) { where.push('l.operation_id = ?'); params.push(number(req.query.operation_id)); }
    where.push(`(
      l.status <> 'borrador' OR l.id = (
        SELECT MAX(l2.id) FROM commission_liquidations l2
        WHERE l2.operation_id = l.operation_id
          AND l2.source_type = l.source_type
          AND COALESCE(l2.cost_sheet_version_number, 0) = COALESCE(l.cost_sheet_version_number, 0)
          AND COALESCE(l2.quote_revision_id, 0) = COALESCE(l.quote_revision_id, 0)
          AND l2.status = 'borrador'
      )
    )`);
    const [rows] = await pool.query(`${listSql()} WHERE ${where.join(' AND ')} ORDER BY l.updated_at DESC`, params);
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.id)) grouped.set(row.id, { ...row, invoices: [] });
      if (row.invoice_id) grouped.get(row.id).invoices.push({ id: row.invoice_id, receipt_number: row.receipt_number, admin_expense_id: row.admin_expense_id, allocated_total: number(row.invoiced_total), paid_total: number(row.paid_total) });
    }
    const result = [...grouped.values()].map((row) => {
      const invoiced = (row.invoices || []).reduce((sum, item) => sum + number(item.allocated_total), 0);
      const paid = (row.invoices || []).reduce((sum, item) => sum + number(item.paid_total), 0);
      const status = row.status === 'anulada'
        ? row.status
        : paid > 0.009 && paid + 0.01 >= invoiced ? 'pagada' : paid > 0.009 ? 'pago_parcial' : row.status;
      return { ...row, status, invoiced_total: invoiced, paid_total: paid };
    });
    res.json(result);
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'No se pudo cargar comisiones' }); }
});

router.get('/available-operations', async (req, res) => {
  try {
    await ensureSchema();
    const where = ["COALESCE(d.commercial_outcome, 'active') = 'active'"];
    const params = [];
    if (!isAdmin(req.user)) { where.push('d.advisor_user_id = ?'); params.push(req.user.id); }
    if (req.query.business_unit) { where.push('bu.key_slug = ?'); params.push(req.query.business_unit); }
    const [rows] = await pool.query(
      `SELECT d.id, d.reference, d.title, bu.key_slug AS business_unit, COALESCE(o.razon_social,o.name) AS client_name,
              u.name AS advisor_name
         FROM deals d
         LEFT JOIN business_units bu ON bu.id=d.business_unit_id
         LEFT JOIN organizations o ON o.id=d.org_id
         LEFT JOIN users u ON u.id=d.advisor_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.updated_at DESC LIMIT 500`, params
    );
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message || 'No se pudieron cargar operaciones' }); }
});

router.get('/operation/:operationId', async (req, res) => {
  try {
    await ensureSchema(); await dealAccess(number(req.params.operationId), req.user);
    const [rows] = await pool.query(`${listSql()} WHERE l.operation_id = ? ORDER BY l.created_at DESC`, [number(req.params.operationId)]);
    const ids = rows.map((row) => row.id);
    const [events] = ids.length ? await pool.query(`SELECT e.*, u.name AS actor_name FROM commission_audit_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.liquidation_id IN (${ids.map(() => '?').join(',')}) ORDER BY e.created_at DESC`, ids) : [[]];
    res.json({ rows, events });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'No se pudo cargar la liquidacion' }); }
});

router.post('/operation/:operationId', async (req, res) => {
  try {
    await ensureSchema();
    const deal = await dealAccess(number(req.params.operationId), req.user);
    const source = await sourceForLiquidation(deal, req.body || {});
    const [[existing]] = await pool.query(
      `SELECT * FROM commission_liquidations
        WHERE operation_id = ? AND source_type = ?
          AND COALESCE(cost_sheet_version_number, 0) = COALESCE(?, 0)
          AND COALESCE(quote_revision_id, 0) = COALESCE(?, 0)
          AND status <> 'anulada'
        ORDER BY id DESC LIMIT 1`,
      [deal.id, source.source_type, source.cost_sheet_version_number || null, source.quote_revision_id || null]
    );
    if (existing) return res.json({ ...existing, existing: true });
    const rate = req.body?.commission_rate == null ? DEFAULT_RATE : Math.max(0, number(req.body.commission_rate));
    const ivaRate = [5, 10, 20].includes(number(req.body?.iva_rate)) ? number(req.body.iva_rate) : 10;
    const profit = source.sale - source.purchase;
    const amounts = commissionAmounts(profit, rate, ivaRate);
    const [result] = await pool.query(
      `INSERT INTO commission_liquidations (operation_id,business_unit,advisor_user_id,source_type,cost_sheet_version_number,quote_id,quote_revision_id,currency_code,budgeted_purchase,budgeted_sale,budgeted_profit,commission_rate,iva_rate,commission_gross,commission_net,commission_iva,profit_atm,status,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'borrador',?)`,
      [deal.id, deal.business_unit_key || 'atm-cargo', deal.advisor_user_id, source.source_type, source.cost_sheet_version_number || null, source.quote_id || null, source.quote_revision_id || null, source.currency_code, source.purchase, source.sale, profit, rate, ivaRate, amounts.gross, amounts.net, amounts.iva, amounts.profitAtm, req.user.id]
    );
    await audit({ liquidationId: result.insertId, type: 'created', detail: `Liquidacion creada desde ${source.source_label}`, payload: source, actor: req.user.id });
    const [[created]] = await pool.query('SELECT * FROM commission_liquidations WHERE id=?', [result.insertId]);
    res.status(201).json(created);
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'No se pudo crear la liquidacion' }); }
});

router.patch('/:id', async (req, res) => {
  try {
    await ensureSchema();
    const [[row]] = await pool.query('SELECT * FROM commission_liquidations WHERE id=?', [number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Liquidacion no encontrada' });
    await dealAccess(row.operation_id, req.user);
    if (row.status !== 'borrador') return res.status(409).json({ error: 'Solo se puede editar una liquidacion en borrador' });
    const rate = req.body?.commission_rate == null ? number(row.commission_rate) : Math.max(0, number(req.body.commission_rate));
    const ivaRate = req.body?.iva_rate == null ? number(row.iva_rate) : number(req.body.iva_rate);
    if (![5,10,20].includes(ivaRate)) return res.status(400).json({ error: 'IVA debe ser 5%, 10% o 20%' });
    const values = commissionAmounts(row.budgeted_profit, rate, ivaRate);
    await pool.query(`UPDATE commission_liquidations SET commission_rate=?, iva_rate=?, commission_gross=?, commission_net=?, commission_iva=?, profit_atm=? WHERE id=?`, [rate, ivaRate, values.gross, values.net, values.iva, values.profitAtm, row.id]);
    const changes = [];
    if (Math.abs(number(row.commission_rate) - rate) > 0.000001) changes.push(`Comisión: ${(number(row.commission_rate) * 100).toFixed(2)}% -> ${(rate * 100).toFixed(2)}%`);
    if (number(row.iva_rate) !== ivaRate) changes.push(`IVA: ${number(row.iva_rate)}% -> ${ivaRate}%`);
    await audit({
      liquidationId: row.id,
      type: 'updated',
      detail: changes.join(' | ') || 'Liquidación recalculada',
      payload: {
        previous: { commission_rate: number(row.commission_rate), iva_rate: number(row.iva_rate), commission_net: number(row.commission_net), commission_iva: number(row.commission_iva) },
        next: { commission_rate: rate, iva_rate: ivaRate, commission_net: values.net, commission_iva: values.iva, commission_gross: values.gross },
      },
      actor: req.user.id,
    });
    const [[updated]] = await pool.query('SELECT * FROM commission_liquidations WHERE id=?', [row.id]); res.json(updated);
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'No se pudo actualizar' }); }
});

router.post('/:id/submit', async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT * FROM commission_liquidations WHERE id=?', [number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Liquidacion no encontrada' });
    await dealAccess(row.operation_id, req.user);
    if (row.status !== 'borrador') return res.status(409).json({ error: 'Estado no valido' });
    await pool.query(`UPDATE commission_liquidations SET status='enviada_aprobacion' WHERE id=?`, [row.id]);
    await audit({ liquidationId: row.id, type: 'submitted', detail: 'Enviada a aprobacion', actor: req.user.id }); res.json({ ok: true });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'No se pudo enviar' }); }
});

router.post('/:id/approve', async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo admin puede aprobar' });
    const [[row]] = await pool.query('SELECT * FROM commission_liquidations WHERE id=?', [number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Liquidacion no encontrada' });
    if (row.status !== 'enviada_aprobacion') return res.status(409).json({ error: 'La liquidacion debe estar enviada a aprobacion' });
    await pool.query(`UPDATE commission_liquidations SET status='aprobada_facturar', approved_by=?, approved_at=NOW() WHERE id=?`, [req.user.id, row.id]);
    await audit({ liquidationId: row.id, type: 'approved', detail: 'Aprobada para facturar', actor: req.user.id }); res.json({ ok: true });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'No se pudo aprobar' }); }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    await ensureSchema();
    const [[row]] = await pool.query('SELECT * FROM commission_liquidations WHERE id=?', [number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Liquidacion no encontrada' });
    await dealAccess(row.operation_id, req.user);
    if (!isAdmin(req.user) && Number(row.advisor_user_id || 0) !== Number(req.user?.id || 0)) {
      return res.status(403).json({ error: 'Permiso denegado' });
    }
    if (row.status === 'anulada') return res.status(409).json({ error: 'La liquidacion ya esta anulada' });
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'El motivo de eliminacion es obligatorio' });
    const [[invoiceUse]] = await pool.query(
      `SELECT COUNT(*) AS total FROM commission_invoice_allocations WHERE liquidation_id = ?`,
      [row.id]
    );
    if (number(invoiceUse?.total) > 0) {
      return res.status(409).json({ error: 'Esta liquidacion ya tiene factura asignada. Primero anula o corrige la factura vinculada.' });
    }
    await pool.query(
      `UPDATE commission_liquidations
          SET status='anulada', cancelled_by=?, cancelled_at=NOW(), cancel_reason=?
        WHERE id=?`,
      [req.user.id, reason, row.id]
    );
    await audit({
      liquidationId: row.id,
      type: 'cancelled',
      detail: `Liquidacion eliminada/anulada. Motivo: ${reason}`,
      payload: { previous_status: row.status, reason },
      actor: req.user.id,
    });
    res.json({ ok: true });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'No se pudo eliminar la liquidacion' }); }
});

router.post('/invoices', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureSchema();
    const body = req.body || {}; const allocations = Array.isArray(body.allocations) ? body.allocations : [];
    if (!allocations.length || !number(body.supplier_org_id) || number(body.amount_gross) <= 0) return res.status(400).json({ error: 'Proveedor, total y asignaciones son requeridos' });
    const totalAllocated = allocations.reduce((sum, item) => sum + number(item.amount), 0);
    if (Math.abs(totalAllocated - number(body.amount_gross)) > 0.01) return res.status(400).json({ error: 'Las asignaciones deben coincidir con el total de la factura' });
    const ids = allocations.map((item) => number(item.liquidation_id)).filter(Boolean);
    const [liquidations] = await conn.query(`SELECT * FROM commission_liquidations WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    if (liquidations.length !== ids.length) return res.status(404).json({ error: 'Liquidacion no encontrada' });
    const allocationMap = new Map(allocations.map((item) => [number(item.liquidation_id), number(item.amount)]));
    for (const row of liquidations) {
      await dealAccess(row.operation_id, req.user);
      if (!['aprobada_facturar','facturada','pago_parcial'].includes(row.status)) return res.status(409).json({ error: 'Solo se factura una liquidacion aprobada' });
      const [[previous]] = await conn.query(
        `SELECT COALESCE(SUM(a.amount),0) AS total
           FROM commission_invoice_allocations a
           JOIN commission_invoices ci ON ci.id = a.commission_invoice_id
          WHERE a.liquidation_id = ?`, [row.id]
      );
      if (allocationMap.get(Number(row.id)) > number(row.commission_gross) - number(previous?.total) + 0.01) {
        return res.status(409).json({ error: `La asignacion supera la comisión pendiente de la operación ${row.operation_id}` });
      }
    }
    const ivaRate = [5,10,20].includes(number(body.iva_rate)) ? number(body.iva_rate) : 10;
    const gross = number(body.amount_gross); const net = gross / (1 + ivaRate / 100); const iva = gross - net;
    const [[supplier]] = await conn.query('SELECT id, name, razon_social, ruc FROM organizations WHERE id=?', [number(body.supplier_org_id)]);
    if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });
    await conn.beginTransaction();
    const [[category]] = await conn.query(`SELECT id FROM admin_expense_categories WHERE name='Comisiones comerciales' LIMIT 1`);
    const categoryId = category?.id || (await conn.query(`INSERT INTO admin_expense_categories (name, active) VALUES ('Comisiones comerciales', 1)`))[0].insertId;
    const [expense] = await conn.query(`INSERT INTO admin_expenses (expense_date, category_id, description, invoice_date, supplier_ruc, supplier_name, iva_10, iva_5, iva_exempt, amount, currency_code, tax_rate, receipt_type, receipt_number, timbrado_number, status, created_by) VALUES (CURDATE(), ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`, [categoryId, 'Comisiones comerciales', body.invoice_date || null, supplier.ruc || null, supplier.razon_social || supplier.name, ivaRate === 10 ? iva : 0, ivaRate === 5 ? iva : 0, gross, currency(body.currency_code), ivaRate, body.receipt_type || 'Factura', body.receipt_number || null, body.timbrado_number || null, req.user.id]);
    const [invoice] = await conn.query(`INSERT INTO commission_invoices (supplier_org_id, admin_expense_id, invoice_date, receipt_type, receipt_number, timbrado_number, condition_type, due_date, currency_code, amount_gross, amount_net, iva_rate, iva_amount, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [supplier.id, expense.insertId, body.invoice_date || null, body.receipt_type || 'Factura', body.receipt_number || null, body.timbrado_number || null, body.condition_type || 'CREDITO', body.due_date || null, currency(body.currency_code), gross, net, ivaRate, iva, body.notes || null, req.user.id]);
    for (const allocation of allocations) {
      await conn.query(`INSERT INTO commission_invoice_allocations (commission_invoice_id, liquidation_id, amount) VALUES (?,?,?)`, [invoice.insertId, number(allocation.liquidation_id), number(allocation.amount)]);
      await conn.query(`UPDATE commission_liquidations SET status='facturada', supplier_org_id=? WHERE id=?`, [supplier.id, number(allocation.liquidation_id)]);
      await audit({ liquidationId: number(allocation.liquidation_id), invoiceId: invoice.insertId, type: 'invoice_allocated', detail: `Factura ${body.receipt_number || invoice.insertId} asignada`, payload: allocation, actor: req.user.id });
    }
    await conn.commit(); res.status(201).json({ id: invoice.insertId, admin_expense_id: expense.insertId });
  } catch (error) { await conn.rollback(); res.status(error.status || 500).json({ error: error.message || 'No se pudo registrar la factura' });
  } finally { conn.release(); }
});

router.get('/export/pdf', async (req, res) => {
  try {
    await ensureSchema();
    const where = ["l.status <> 'anulada'"]; const params = [];
    if (!isAdmin(req.user)) { where.push('l.advisor_user_id=?'); params.push(req.user.id); }
    if (req.query.user_id && isAdmin(req.user)) { where.push('l.advisor_user_id=?'); params.push(number(req.query.user_id)); }
    const [rows] = await pool.query(`${listSql()} WHERE ${where.join(' AND ')} ORDER BY u.name, d.reference`, params);
    const logoPath = await getBrandLogoPath('quote_brand_logo_url').catch(() => '');
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition','inline; filename=planilla-comisiones.pdf'); doc.pipe(res);
    const margin = 28;
    const widths = [25, 44, 58, 100, 38, 66, 66, 68, 42, 68, 60, 72, 79];
    const cols = widths.reduce((all, width, index) => { all.push(index ? all[index - 1] + widths[index - 1] : margin); return all; }, []);
    const rowHeight = 21;
    const drawHeader = (name, pageNumber = null) => {
      doc.font('Helvetica-Bold').fillColor('#000000').fontSize(14).text('COMISIONES ATM CARGO', margin, 32, { width: 786, align: 'center' });
      doc.fontSize(9).text('NOMBRE', margin + 70, 58, { width: 72, align: 'center' });
      doc.fillColor('#FF0000').text(name || 'TODOS LOS COMERCIALES', margin + 145, 58, { width: 230, align: 'left' });
      if (pageNumber) doc.fillColor('#666666').font('Helvetica').fontSize(7).text(`Página ${pageNumber}`, 720, 34, { width: 65, align: 'right' });
      const headerY = 82;
      const labels = ['N\u00ba', 'FECHA', 'REF. N\u00ba', 'CLIENTE', 'MONEDA', 'COST. COMP', 'VENTA', 'PROFIT VENTAS', '% COMIS', 'COMISION BRUTA', 'IVA DESCONT.', 'COMISION VEND.', 'PROFIT ATM'];
      labels.forEach((label, index) => {
        const blue = [7, 9, 11, 12].includes(index);
        doc.fillColor(blue ? '#0000FF' : '#000000').font('Helvetica-Bold').fontSize(8)
          .text(label, cols[index] + 2, headerY + 6, { width: widths[index] - 4, align: index === 3 ? 'left' : 'center' });
      });
      doc.strokeColor('#000000').lineWidth(0.6).rect(margin, headerY, 786, rowHeight).stroke();
      let x = margin;
      widths.slice(0, -1).forEach((width) => { x += width; doc.moveTo(x, headerY).lineTo(x, headerY + rowHeight).stroke(); });
      return headerY + rowHeight;
    };
    const selectedName = req.query.user_id && rows[0]?.advisor_name ? rows[0].advisor_name : (isAdmin(req.user) ? 'TODOS LOS COMERCIALES' : req.user?.name);
    let y = drawHeader(selectedName, 1); let page = 1; let rowNumber = 1;
    const totals = {};
    for (const row of rows) {
      if (y + rowHeight > 470) { doc.addPage(); page += 1; y = drawHeader(selectedName, page); }
      const code = row.currency_code || 'PYG';
      totals[code] = totals[code] || { profit: 0, commissionGross: 0, iva: 0, commissionNet: 0, atm: 0 };
      totals[code].profit += number(row.budgeted_profit);
      totals[code].commissionGross += number(row.commission_gross);
      totals[code].iva += number(row.commission_iva);
      totals[code].commissionNet += number(row.commission_net);
      totals[code].atm += number(row.profit_atm);
      const createdDate = row.created_at ? new Date(row.created_at).toLocaleDateString('es-PY') : '-';
      const values = [rowNumber++, createdDate, row.reference || '-', row.client_name || row.title || '-', code, money(row.budgeted_purchase, code), money(row.budgeted_sale, code), money(row.budgeted_profit, code), `${(number(row.commission_rate) * 100).toFixed(2)}%`, money(row.commission_gross, code), `${number(row.iva_rate).toFixed(0)}% - ${money(row.commission_iva, code)}`, money(row.commission_net, code), money(row.profit_atm, code)];
      let x = margin;
      doc.strokeColor('#000000').lineWidth(0.35).rect(margin, y, 786, rowHeight).stroke();
      values.forEach((value, index) => {
        doc.fillColor('#000000').font('Helvetica').fontSize(7.4).text(String(value), x + 2, y + 6, { width: widths[index] - 4, align: index === 3 ? 'left' : 'right', ellipsis: true });
        x += widths[index]; if (index < values.length - 1) doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke();
      });
      y += rowHeight;
    }
    const totalLines = Object.entries(totals);
    const totalHeight = Math.max(rowHeight * 2, totalLines.length * rowHeight * 2);
    const summaryHeight = totalHeight + 18 + 20 + (totalLines.length * 20) + 88;
    if (y + summaryHeight > 565) { doc.addPage(); page += 1; y = drawHeader(selectedName, page); }
    doc.fillColor('#000000').rect(margin + 108, y, 678, totalHeight).fill('#FFFF00').stroke('#000000').stroke();
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8).text('TOTAL', margin + 110, y + 6, { width: 86, align: 'center' });
    totalLines.forEach(([code, total], index) => {
      const lineY = y + 5 + index * rowHeight * 2;
      doc.text(`Profit ventas ${money(total.profit, code)}`, 330, lineY, { width: 145, align: 'right' });
      doc.fillColor('#0000FF').text(`Comision bruta ${money(total.commissionGross, code)}`, 480, lineY, { width: 145, align: 'right' });
      doc.fillColor('#FF0000').text(`IVA descontado ${money(total.iva, code)}`, 630, lineY, { width: 150, align: 'right' });
      doc.fillColor('#0000FF').text(`Comision vendedor ${money(total.commissionNet, code)}`, 480, lineY + rowHeight, { width: 145, align: 'right' });
      doc.fillColor('#000000').text(`Profit ATM ${money(total.atm, code)}`, 630, lineY + rowHeight, { width: 150, align: 'right' });
    });
    y += totalHeight + 18;
    doc.font('Helvetica-Bold').fontSize(8).text('PROMEDIO DE CAMBIO', margin + 110, y, { width: 170 });
    y += 20;
    totalLines.forEach(([code, total]) => { doc.fillColor('#000000').rect(margin + 110, y - 3, 260, 17).fill('#FFFF00').stroke('#000000').stroke(); doc.fillColor('#000000').font('Helvetica-Bold').text(`TOTAL A PAGAR ${code}`, margin + 113, y + 1, { width: 125 }); doc.text(money(total.commissionNet, code), margin + 240, y + 1, { width: 125, align: 'right' }); y += 20; });
    y += 34;
    doc.font('Helvetica').fontSize(8).text('APROBADO POR:', 205, y, { width: 100, align: 'center' }); doc.text('HECHO POR:', 425, y, { width: 100, align: 'center' }); doc.text('PAGADO POR:', 635, y, { width: 100, align: 'center' });
    y += 18;
    doc.font('Helvetica-Bold').text('GTE GENERAL', 205, y, { width: 100, align: 'center' }); doc.text('DPTO COMERCIAL', 425, y, { width: 100, align: 'center' }); doc.text('DPTO ADMINISTRATIVO', 635, y, { width: 120, align: 'center' });
    for (const row of rows) {
      const detail = await loadLiquidationOperationDetail(row).catch(() => null);
      drawOperationDetailPage(doc, row, detail || { rows: [], items: [], meta: { currency_code: row.currency_code } }, logoPath);
    }
    doc.end();
  } catch (error) { res.status(500).json({ error: error.message || 'No se pudo exportar PDF' }); }
});

export default router;
