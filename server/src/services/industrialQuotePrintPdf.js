import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const PDF_PAGE_W_MM = 340;
const PDF_PAGE_H_MM = 541;
const CONTENT_W_MM = PDF_PAGE_W_MM - 0.2;
const BRAND_BLUE = '#c62828';

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeRichText(value = '') {
  const raw = String(value || '');
  if (!raw) return '';
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<(\/?)(p|br|div|span|ul|ol|li|b|strong|i|em|u)\b[^>]*>/gi, '<$1$2>')
    .replace(/<(?!\/?(?:p|br|div|span|ul|ol|li|b|strong|i|em|u)\b)[^>]+>/gi, '');
}

function decimalsFrom(raw) {
  const match = String(raw ?? '').match(/[.,](\d+)/);
  return match ? match[1].length : 0;
}

function money(value, decimalsHint) {
  if (value === null || value === undefined || value === '') return '0';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const decimals = typeof decimalsHint === 'number' && decimalsHint >= 0 ? decimalsHint : decimalsFrom(value);
  return new Intl.NumberFormat('es-PY', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(numeric);
}

function num(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  if (text.includes('.') && text.includes(',')) {
    return Number(text.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (text.includes(',')) {
    return Number(text.replace(/\./g, '').replace(',', '.')) || 0;
  }
  return Number(text.replace(/,/g, '')) || 0;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function textLines(value = '') {
  return String(value || '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);
}

function listFromText(value = '') {
  const lines = textLines(value);
  if (!lines.length) return '';
  return `<ul class="list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
}

function section(title, body, extraClass = '') {
  if (!String(body || '').trim()) return '';
  return `
    <div class="quote-section avoid-break ${extraClass}">
      <div class="section-title">${escapeHtml(title)}</div>
      <div class="section-body">${body}</div>
    </div>
  `;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function normalizeItem(item = {}, index = 0, currency = 'USD', pricingItem = null) {
  const quantity = pickFirst(item.cantidad, item.quantity, item.qty, pricingItem?.qty, pricingItem?.quantity, 1);
  const qty = num(quantity) || 1;
  const totalSales = Number(
    pickFirst(
      pricingItem?.total_sales,
      pricingItem?.total_ventas,
      pricingItem?.total_sales_usd,
      item.total_sales,
      item.total_ventas,
      item.total_sales_usd,
      0
    )
  );
  const unitPrice = Number(
    pickFirst(
      item.precio,
      item.unit_price,
      pricingItem?.pv_unit,
      pricingItem?.pv_unit_usd,
      pricingItem?.unit_price,
      totalSales && qty ? totalSales / qty : 0
    )
  );
  return {
    line_no: pickFirst(item.line_no, index + 1),
    cantidad: quantity || 1,
    servicio: pickFirst(item.servicio, item.description, item.descripcion, pricingItem?.description, `Item ${index + 1}`),
    observacion: pickFirst(item.observacion, item.observation, item.observations, ''),
    observacion_html: pickFirst(item.observacion_html, item.observation_html, item.description_html, ''),
    moneda: pickFirst(item.moneda, item.currency, currency),
    precio: unitPrice,
    include: item.include !== false,
  };
}

function buildItems(snapshot = {}, inputs = {}, computed = {}) {
  const saved = parseJson(snapshot.industrial_items_json, []);
  if (Array.isArray(saved) && saved.length) {
    return saved.map((item, index) => normalizeItem(item, index, snapshot.moneda_operacion || inputs.operation_currency || 'USD'));
  }

  const rawItems = Array.isArray(inputs.items) ? inputs.items : [];
  const pricingItems = Array.isArray(computed?.oferta?.items)
    ? computed.oferta.items
    : Array.isArray(computed?.resultado?.items)
      ? computed.resultado.items
      : [];
  const source = rawItems.length ? rawItems : pricingItems;
  return source
    .filter((item) => Number(item?.qty || item?.quantity || item?.cantidad || 0) > 0 || String(item?.description || item?.servicio || item?.descripcion || '').trim())
    .map((item, index) => normalizeItem(item, index, inputs.operation_currency || 'USD', pricingItems[index] || null));
}

function resolveChromePath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildHtml({ deal = {}, quote = {}, inputs = {}, computed = {}, documentSnapshot = {}, user = {} } = {}) {
  const snapshot = documentSnapshot || {};
  const currency = String(
    computed?.meta?.operation_currency ||
      inputs.operation_currency ||
      snapshot.moneda_operacion ||
      'USD'
  ).toUpperCase();
  const currencyLabel = currency === 'PYG' || currency === 'GS' ? 'Gs' : 'USD';
  const items = buildItems(snapshot, inputs, computed).filter((item) => item.include !== false);
  const total = items.reduce((sum, item) => sum + (num(item.precio) * (num(item.cantidad) || 1)), 0);
  const totalDecimals = items.reduce((max, item) => Math.max(max, decimalsFrom(item.precio), decimalsFrom(item.cantidad)), 0);
  const customer = pickFirst(snapshot.cliente, quote.client_name, deal.org_name, 'Cliente');
  const contact = pickFirst(snapshot.contacto, deal.contact_name, '-');
  const ref = pickFirst(snapshot.referencia, snapshot.ref, quote.ref_code, deal.reference);
  const date = pickFirst(snapshot.fecha, new Date().toLocaleDateString('es-PY'));
  const terms = {
    condicionVenta: pickFirst(snapshot.condicion_venta, snapshot.condicionVenta),
    formaPago: pickFirst(snapshot.forma_pago, snapshot.formaPago),
    plazoCredito: pickFirst(snapshot.plazo_credito, snapshot.plazoCredito),
    validez: pickFirst(snapshot.validez_oferta, snapshot.validez),
  };
  const observations = pickFirst(snapshot.observaciones, snapshot.comentario);
  const signer = pickFirst(user?.name, quote.created_by_name, 'LIDER GONZALEZ');

  const rows = items.map((item, index) => {
    const unitDecimals = decimalsFrom(item.precio);
    const qtyDecimals = decimalsFrom(item.cantidad);
    const lineTotal = (num(item.cantidad) || 1) * num(item.precio);
    const description = item.observacion_html
      ? sanitizeRichText(item.observacion_html)
      : escapeHtml(item.observacion || '');
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.cantidad || 1)}</td>
        <td>${escapeHtml(item.servicio)}</td>
        <td class="rich-text">${description || '-'}</td>
        <td>${escapeHtml(item.moneda || currency)}</td>
        <td class="right">${money(num(item.precio), unitDecimals)}</td>
        <td class="right">${money(lineTotal, Math.max(unitDecimals, qtyDecimals))}</td>
      </tr>
    `;
  }).join('');

  const includes = listFromText(snapshot.que_incluye);
  const excludes = listFromText(snapshot.que_no_incluye);
  const responsibility = listFromText(snapshot.responsabilidad_cliente);
  const deliveryTerms = listFromText(snapshot.plazos_entrega);
  const productNotes = listFromText(snapshot.observaciones_producto);

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: #fff; color: #0f172a; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; }
        .page { width: ${CONTENT_W_MM}mm; padding-right: 3mm; margin: 0 auto; background: #fff; }
        .avoid-break { break-inside: avoid; page-break-inside: avoid; }
        .quote-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 8px 8px; gap: 16px; }
        .quote-logo { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; letter-spacing: .6px; line-height: 1.05; font-weight: 600; }
        .quote-logo-text { display: inline-flex; align-items: flex-end; gap: 2px; text-transform: uppercase; }
        .quote-logo-grupo { color: #0f172a; }
        .quote-logo-atm { color: #ef4444; }
        .quote-logo-swoosh { position: relative; width: 150px; height: 12px; margin-top: 6px; }
        .quote-logo-swoosh::before { content: ''; position: absolute; left: 0; right: 0; top: 3px; height: 9px; background: #ef4444; border-radius: 0 0 90px 90px; transform: skewX(-12deg); }
        .quote-logo-swoosh::after { content: ''; position: absolute; left: 20px; top: 1px; width: 86px; height: 6px; background: #fff; border-radius: 0 0 40px 40px; transform: skewX(-12deg); opacity: .9; }
        .quote-banner { position: relative; height: 48px; width: 520px; flex: 0 0 auto; }
        .quote-banner-orange { position: absolute; left: 0; top: 0; height: 48px; width: 160px; background: ${BRAND_BLUE}; border-top-right-radius: 40px; border-bottom-right-radius: 40px; }
        .quote-banner-blue { position: absolute; right: 0; top: 0; height: 48px; width: 360px; background: #b71c1c; border-top-left-radius: 40px; border-bottom-left-radius: 40px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; letter-spacing: .08em; }
        .top-info { display: flex; justify-content: space-between; align-items: flex-start; padding: 0 4px; margin-top: 12px; }
        .client { font-size: 16px; }
        .muted { color: #475569; }
        .right { text-align: right; }
        .intro { padding: 0 4px; margin-top: 12px; }
        .title { text-align: center; font-weight: 700; text-decoration: underline; }
        .intro-text { margin-top: 12px; font-size: 11px; color: #1f2937; text-transform: uppercase; }
        .conditions { margin-top: 12px; border: 1px solid #9ca3af; border-radius: 4px; padding: 12px; font-size: 11px; display: grid; grid-template-columns: 1fr 1fr; column-gap: 32px; row-gap: 4px; }
        .section-title { text-transform: uppercase; font-weight: 700; color: #fff; padding: 8px 12px; border-radius: 4px 4px 0 0; background: ${BRAND_BLUE}; }
        .quote-section { padding: 0 16px; margin-top: 16px; }
        .section-body { border-left: 1px solid #d1d5db; border-right: 1px solid #d1d5db; border-bottom: 1px solid #d1d5db; border-radius: 0 0 4px 4px; padding: 12px; white-space: pre-wrap; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; color: #fff; background: ${BRAND_BLUE}; padding: 8px; text-transform: uppercase; }
        td { border-top: 1px solid #e5e7eb; padding: 6px 8px; vertical-align: top; }
        tfoot td { font-weight: 800; padding-top: 8px; padding-bottom: 8px; }
        .costs { padding: 0 4px; margin-top: 16px; }
        .costs table { border-left: 1px solid #d1d5db; border-right: 1px solid #d1d5db; border-bottom: 1px solid #d1d5db; }
        .list { margin: 0 0 0 20px; padding: 0; }
        .rich-text p, .rich-text div { margin: 0 0 4px; }
        .rich-text ul, .rich-text ol { margin: 0 0 4px 18px; padding: 0; }
        .signature { padding: 0 16px; margin: 32px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; font-size: 12px; }
        .signature-title { font-weight: 700; text-transform: uppercase; text-decoration: underline; }
        .signature-name { margin-top: 8px; text-transform: uppercase; }
        .sig-row { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
        .sig-label { min-width: 90px; font-weight: 700; text-transform: uppercase; }
        .sig-line { flex: 1; border-bottom: 1px dotted #334155; height: 0; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="quote-header">
          <div class="quote-logo">
            <div class="quote-logo-text"><span class="quote-logo-grupo">grupo</span><span class="quote-logo-atm">atm</span></div>
            <div class="quote-logo-swoosh"></div>
          </div>
          <div class="quote-banner"><div class="quote-banner-orange"></div><div class="quote-banner-blue">COTIZACION</div></div>
        </div>

        <div class="top-info avoid-break">
          <div class="client">
            <div><strong>${escapeHtml(customer)}</strong></div>
            <div class="muted">Atn. ${escapeHtml(contact || '-')}</div>
          </div>
          <div class="right muted">
            <div>Asuncion ${escapeHtml(date)}</div>
            <div><strong>REF. N° ${escapeHtml(ref)}</strong></div>
          </div>
        </div>

        <div class="intro avoid-break">
          <div class="title">COTIZACION</div>
          <div class="intro-text">
            <div>CON GUSTO LE PRESENTAMOS NUESTRO PRESUPUESTO PARA LOS PRODUCTOS QUE ESTA CONSIDERANDO ADQUIRIR. NOS COMPLACE</div>
            <div>OFRECERLE SOLUCIONES QUE SE ADAPTEN PERFECTAMENTE A SUS NECESIDADES.</div>
            <div>A CONTINUACION, DETALLAMOS LOS PRODUCTOS Y LOS COSTOS SEGUN LOS DETALLES DE SU PEDIDO.</div>
          </div>
          <div class="conditions">
            <div><strong>CONDICION DE VENTA:</strong> ${escapeHtml(terms.condicionVenta || '-')}</div>
            <div><strong>PLAZO DE CREDITO:</strong> ${escapeHtml(terms.plazoCredito || '-')}</div>
            <div><strong>FORMA DE PAGO:</strong> ${escapeHtml(terms.formaPago || '-')}</div>
            <div><strong>VALIDEZ DE LA OFERTA:</strong> ${escapeHtml(terms.validez || '-')}</div>
            <div><strong>COMENTARIO:</strong> ${escapeHtml(observations || '-')}</div>
          </div>
        </div>

        <div class="costs avoid-break">
          <div class="section-title">Detalle de Costos</div>
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Cantidad</th><th>Servicio</th><th>Descripcion</th><th>Moneda</th><th class="right">Precio unit</th><th class="right">Valor</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="7">Sin items</td></tr>'}</tbody>
            <tfoot>
              <tr><td colspan="5" class="right">TOTAL ${escapeHtml(currencyLabel)}</td><td colspan="2" class="right">${money(total, totalDecimals)}</td></tr>
            </tfoot>
          </table>
        </div>

        ${section('Que incluye', includes)}
        ${section('Que no incluye', excludes)}
        ${section('Responsabilidad del cliente', responsibility)}
        ${section('Plazos de entrega', deliveryTerms)}
        ${section('Condicion de pago', escapeHtml(snapshot.condicion_pago || ''))}
        ${section('Tipo de instalacion', escapeHtml(snapshot.tipo_instalacion || ''))}
        ${section('Garantia', escapeHtml(snapshot.garantia || ''))}
        ${section('Observaciones de producto', productNotes)}
        ${observations ? section('Observaciones', escapeHtml(observations)) : ''}
        ${section('Terminos y condiciones', listFromText([
          terms.validez ? `Validez de la oferta: ${terms.validez}` : '',
          terms.condicionVenta ? `Condicion de venta: ${terms.condicionVenta}` : '',
          terms.plazoCredito ? `Plazo de credito: ${terms.plazoCredito}` : '',
          terms.formaPago ? `Forma de pago: ${terms.formaPago}` : '',
        ].filter(Boolean).join('\n')))}

        <div class="signature avoid-break">
          <div>
            <div class="signature-title">Firma de aceptacion</div>
            <div class="signature-name">${escapeHtml(signer)}</div>
            <div class="sig-row"><div class="sig-label">Nombre:</div><div class="sig-line"></div></div>
            <div class="sig-row"><div class="sig-label">Documento nro.:</div><div class="sig-line"></div></div>
            <div class="sig-row"><div class="sig-label">Fecha:</div><div class="sig-line"></div></div>
            <div class="sig-row"><div class="sig-label">Sello:</div><div class="sig-line"></div></div>
          </div>
          <div></div>
        </div>
      </div>
    </body>
  </html>`;
}

export async function buildIndustrialQuotePrintPdfBuffer(payload = {}) {
  const executablePath = resolveChromePath();
  if (!executablePath) {
    throw new Error('Chrome/Edge no encontrado. Define PUPPETEER_EXECUTABLE_PATH o instala Chrome.');
  }
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(payload), { waitUntil: 'networkidle0' });
    return await page.pdf({
      width: `${PDF_PAGE_W_MM}mm`,
      height: `${PDF_PAGE_H_MM}mm`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}
