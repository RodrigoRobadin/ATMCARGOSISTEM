import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { pool } from './db.js';

const BRANDING_KEYS = [
  'quote_brand_logo_url',
  'quote_brand_footer_web',
  'quote_brand_footer_address',
  'quote_brand_footer_phone',
  'quote_brand_city',
];

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
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

function formatMoney(value, currencyCode = 'USD') {
  const currency = String(currencyCode || 'USD').toUpperCase();
  const amount = Number(value || 0);
  return amount.toLocaleString('es-PY', {
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  });
}

function formatDateLong(value, city = 'Asuncion') {
  const raw = value ? new Date(value) : new Date();
  if (value && Number.isNaN(raw.getTime())) {
    return `${city} ${String(value)}`;
  }
  const date = Number.isNaN(raw.getTime()) ? new Date() : raw;
  let text = date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  text = text.replace(/\b([a-záéíóúñ])/g, (m) => m.toUpperCase());
  return `${city} ${text}`;
}

function textLines(raw) {
  return String(raw || '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);
}

function renderTextBlock(raw, { numbered = false } = {}) {
  const lines = textLines(raw);
  if (!lines.length) return '<p class="muted">-</p>';
  if (numbered) {
    return `<ol class="content-list numbered">${lines
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('')}</ol>`;
  }
  return `<div class="content-block">${lines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')}</div>`;
}

function normalizeItems(items = [], fallbackCurrency = 'USD') {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const quantity = toNumber(item.quantity ?? item.cantidad ?? 1) || 1;
      const unitPrice = toNumber(item.unit_price ?? item.precio ?? 0);
      const total = toNumber(item.total ?? quantity * unitPrice);
      const currency = String(item.currency || item.moneda || fallbackCurrency || 'USD').toUpperCase();
      return {
        product: item.product || item.servicio || item.name || 'Item',
        quantity,
        unit: item.unit || item.unidad || 'UNIDAD',
        description: item.description || item.observacion || '',
        currency,
        unitPrice,
        total,
      };
    })
    .filter((item) => item.product || item.description || item.total);
}

function buildSubject(reference, items = []) {
  const parts = items.slice(0, 3).map((item) => {
    const qty = Number(item.quantity || 0);
    const name = String(item.product || '').trim();
    if (!name) return '';
    return qty > 0 ? `${qty} ${name}` : name;
  }).filter(Boolean);
  if (!parts.length) return reference ? `REF. N° ${reference}` : 'COTIZACION';
  return reference ? `REF. N° ${reference} / ${parts.join(' + ')}` : parts.join(' + ');
}

function mimeFromExt(filePath) {
  const ext = String(path.extname(filePath) || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

async function readLogoDataUri(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.startsWith('data:image/')) return value;

  const localPath = value.startsWith('/uploads/')
    ? path.resolve(value.replace(/^\/+/, ''))
    : path.isAbsolute(value)
      ? value
      : path.resolve(value);

  if (!fs.existsSync(localPath)) return '';
  const mime = mimeFromExt(localPath);
  const base64 = await fs.promises.readFile(localPath, 'base64');
  return `data:${mime};base64,${base64}`;
}

async function getBranding() {
  const [rows] = await pool.query(
    `SELECT \`key\`, \`value\`
       FROM param_values
      WHERE \`key\` IN (${BRANDING_KEYS.map(() => '?').join(',')})
        AND (\`active\` IS NULL OR \`active\` <> 0)
      ORDER BY \`key\`, \`ord\`, id`,
    BRANDING_KEYS
  );

  const map = {};
  for (const row of rows || []) {
    if (!row?.key || map[row.key] !== undefined) continue;
    map[row.key] = row.value ?? '';
  }

  return {
    logoDataUri: await readLogoDataUri(map.quote_brand_logo_url),
    footerWeb: map.quote_brand_footer_web || 'www.atmcargo.com.py',
    footerAddress: map.quote_brand_footer_address || 'Cptan. Urbieta 175 e/ Av. Mcal. Lopez y Rio de Janeiro Asuncion - Paraguay',
    footerPhone: map.quote_brand_footer_phone || 'Tel. +595 21 490382 / 444706',
    city: map.quote_brand_city || 'Asuncion',
  };
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

function buildHtml(payload, branding) {
  const currencyCode = String(payload.currency_code || payload.total_currency || 'USD').toUpperCase();
  const items = normalizeItems(payload.items, currencyCode);
  const totalAmount = toNumber(
    payload.total_amount ??
      payload.total?.amount ??
      items.reduce((sum, item) => sum + Number(item.total || 0), 0)
  );
  const totalCurrency = String(payload.total_currency || payload.total?.currency || currencyCode).toUpperCase();
  const introText =
    payload.intro_text ||
    'Con gusto le presentamos nuestro presupuesto para los productos que esta considerando adquirir. Nos complace ofrecerle soluciones que se adapten perfectamente a sus necesidades.';
  const subject = payload.subject || buildSubject(payload.reference, items);
  const contactLabel = payload.contact_name ? `Atn. ${payload.contact_name}` : '';

  const rowsHtml = items.length
    ? items
        .map(
          (item, index) => `
          <tr>
            <td class="center">${escapeHtml(index + 1)}</td>
            <td>${escapeHtml(item.product)}</td>
            <td class="center">${escapeHtml(item.quantity)}</td>
            <td class="center">${escapeHtml(item.unit)}</td>
            <td class="small">${escapeHtml(item.description || '-')}</td>
            <td class="center">${escapeHtml(item.currency)}</td>
            <td class="right">${formatMoney(item.unitPrice, item.currency)}</td>
            <td class="right">${formatMoney(item.total, item.currency)}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="8" class="center muted">Sin items</td></tr>`;

  const logoHtml = branding.logoDataUri
    ? `<img src="${branding.logoDataUri}" class="logo-image" alt="Logo"/>`
    : `<div class="logo-fallback"><span class="grupo">grupo</span><span class="atm">atm</span></div>`;

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Cotizacion formal</title>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; }
        .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 8mm 10mm 12mm; page-break-after: always; position: relative; }
        .page:last-child { page-break-after: auto; }
        .header { display: flex; align-items: stretch; justify-content: space-between; gap: 18mm; margin-bottom: 5mm; }
        .logo-box { width: 68mm; display: flex; align-items: center; justify-content: center; padding-top: 2mm; }
        .logo-image { max-width: 100%; max-height: 31mm; object-fit: contain; }
        .logo-fallback { font-size: 22pt; font-weight: 700; letter-spacing: .4px; }
        .logo-fallback .grupo { color: #111; }
        .logo-fallback .atm { color: #e24e31; margin-left: 4px; }
        .title-box { flex: 1; position: relative; height: 34mm; overflow: hidden; margin-top: 1mm; }
        .title-orange { position: absolute; left: 0; top: 0; width: 30%; height: 100%; background: #ef5a2f; border-top-right-radius: 32mm; border-bottom-right-radius: 32mm; }
        .title-blue { position: absolute; right: 0; top: 0; width: 84%; height: 100%; background: #445f84; border-top-left-radius: 32mm; border-bottom-left-radius: 32mm; display: flex; align-items: center; justify-content: center; color: #fff; font-style: italic; font-weight: 700; font-size: 16pt; letter-spacing: .4px; }
        .date-line { text-align: right; font-size: 10pt; margin-bottom: 14mm; }
        .customer { font-size: 11pt; margin-bottom: 1mm; }
        .customer strong { display: block; font-size: 13pt; text-transform: uppercase; }
        .ref-title { text-align: center; font-weight: 700; font-size: 8.6mm; margin: 1mm 0 1mm; text-transform: uppercase; }
        .main-title { text-align: center; font-size: 7mm; font-weight: 700; text-decoration: underline; margin-bottom: 9mm; text-transform: uppercase; }
        .intro { font-size: 10pt; line-height: 1.45; margin-bottom: 6mm; text-transform: uppercase; }
        .conditions { border: 1px solid #9ea6af; padding: 3.5mm 4mm 3mm; margin-bottom: 4mm; }
        .conditions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 12mm; font-size: 10pt; }
        .conditions-row { display: grid; grid-template-columns: 43mm 1fr; gap: 3mm; min-height: 7mm; }
        .conditions-label { font-weight: 700; text-transform: uppercase; }
        .section-title { text-align: center; font-size: 12pt; font-weight: 700; text-decoration: underline; margin: 2.5mm 0 2.5mm; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #445f84; color: #fff; font-size: 9pt; padding: 2.2mm 2mm; text-transform: uppercase; border: 1px solid #7a8796; }
        td { border-bottom: 1px solid #c7cdd4; font-size: 9pt; padding: 1.8mm 2mm; vertical-align: top; }
        td.small { font-size: 8.2pt; line-height: 1.28; text-transform: uppercase; }
        .center { text-align: center; }
        .right { text-align: right; }
        .total-box { border: 1px solid #9ea6af; display: grid; grid-template-columns: 1fr 32mm 34mm; margin-top: 4mm; }
        .total-box div { padding: 2.1mm 3mm; font-size: 10.5pt; font-weight: 700; text-transform: uppercase; }
        .total-box .label { text-align: center; }
        .section-block { margin-bottom: 4mm; page-break-inside: avoid; }
        .section-block h3 { margin: 0 0 1.2mm; font-size: 10.5pt; font-weight: 700; text-transform: uppercase; text-decoration: underline; font-style: italic; }
        .content-block p, .muted { margin: 0 0 1.2mm; font-size: 10pt; line-height: 1.38; text-transform: uppercase; }
        .content-list { margin: 0; padding-left: 5mm; }
        .content-list li { margin: 0 0 1.2mm; font-size: 10pt; line-height: 1.38; text-transform: uppercase; }
        .content-list.numbered { padding-left: 6mm; }
        .footer { position: absolute; left: 10mm; right: 10mm; bottom: 9mm; display: flex; align-items: flex-end; justify-content: space-between; gap: 6mm; }
        .footer-web { font-size: 12pt; font-weight: 700; color: #111; }
        .footer-bar { flex: 1; position: relative; height: 16mm; overflow: hidden; }
        .footer-orange { position: absolute; left: 0; top: 0; width: 26%; height: 100%; background: #ef5a2f; border-top-right-radius: 22mm; border-bottom-right-radius: 22mm; }
        .footer-blue { position: absolute; right: 0; top: 0; width: 76%; height: 100%; background: #445f84; border-top-left-radius: 22mm; border-bottom-left-radius: 22mm; color: #fff; display: flex; flex-direction: column; justify-content: center; padding: 0 8mm; font-size: 9pt; text-align: center; }
        .acceptance { margin-top: 12mm; padding-left: 2mm; }
        .acceptance h2 { font-size: 13pt; font-weight: 700; text-transform: uppercase; text-decoration: underline; margin-bottom: 8mm; }
        .acceptance-row { display: flex; align-items: center; gap: 4mm; margin: 8mm 0; font-size: 11pt; }
        .acceptance-row strong { min-width: 24mm; }
        .acceptance-line { flex: 1; border-bottom: 1px dotted #333; height: 0; }
      </style>
    </head>
    <body>
      <section class="page">
        <div class="header">
          <div class="logo-box">${logoHtml}</div>
          <div class="title-box">
            <div class="title-orange"></div>
            <div class="title-blue">COTIZACION</div>
          </div>
        </div>
        <div class="date-line">${escapeHtml(formatDateLong(payload.date, branding.city))}</div>
        <div class="customer">
          <strong>${escapeHtml(payload.customer_name || 'Cliente')}</strong>
          ${contactLabel ? `<div>${escapeHtml(contactLabel)}</div>` : ''}
        </div>
        <div class="ref-title">${escapeHtml(subject)}</div>
        <div class="main-title">COTIZACION</div>
        <div class="intro">${escapeHtml(introText)}</div>

        <div class="conditions">
          <div class="conditions-grid">
            <div class="conditions-row"><div class="conditions-label">Condicion de venta:</div><div>${escapeHtml(payload.sale_condition || '-')}</div></div>
            <div class="conditions-row"><div class="conditions-label">Plazo de credito:</div><div>${escapeHtml(payload.credit_term || '-')}</div></div>
            <div class="conditions-row"><div class="conditions-label">Forma de pago:</div><div>${escapeHtml(payload.payment_method || '-')}</div></div>
            <div class="conditions-row"><div class="conditions-label">Validez de la oferta:</div><div>${escapeHtml(payload.offer_validity || '-')}</div></div>
            <div class="conditions-row" style="grid-column: 1 / span 2;"><div class="conditions-label">Comentario:</div><div>${escapeHtml(payload.comment || '')}</div></div>
          </div>
        </div>

        <div class="section-title">Productos y servicios</div>
        <table>
          <thead>
            <tr>
              <th style="width: 12mm;">Item</th>
              <th style="width: 25mm;">Producto</th>
              <th style="width: 15mm;">Cantidad</th>
              <th style="width: 22mm;">Unidad de medida</th>
              <th>Descripcion</th>
              <th style="width: 18mm;">Moneda</th>
              <th style="width: 24mm;">Precio unitario</th>
              <th style="width: 24mm;">Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="total-box">
          <div class="label">Total</div>
          <div class="center">${escapeHtml(totalCurrency)}</div>
          <div class="right">${formatMoney(totalAmount, totalCurrency)}</div>
        </div>
      </section>

      <section class="page">
        <div class="header">
          <div class="logo-box">${logoHtml}</div>
          <div class="title-box">
            <div class="title-orange"></div>
            <div class="title-blue">COTIZACION</div>
          </div>
        </div>

        <div class="section-block">
          <h3>Observaciones</h3>
          ${renderTextBlock(payload.observations)}
        </div>
        <div class="section-block">
          <h3>Tipo de instalacion</h3>
          ${renderTextBlock(payload.installation_type)}
        </div>
        <div class="section-block">
          <h3>Condicion de pago</h3>
          ${renderTextBlock(payload.payment_condition)}
        </div>
        <div class="section-block">
          <h3>Tipo de entrega</h3>
          ${renderTextBlock(payload.delivery_type)}
        </div>
        <div class="section-block">
          <h3>Direccion</h3>
          ${renderTextBlock(payload.delivery_address)}
        </div>
        <div class="section-block">
          <h3>Plazo de entrega</h3>
          ${renderTextBlock(payload.delivery_term)}
        </div>
        ${payload.excludes_text ? `
        <div class="section-block">
          <h3>El presupuesto no incluye</h3>
            ${renderTextBlock(payload.excludes_text)}
          </div>
        ` : ''}

        <div class="footer">
          <div class="footer-web">${escapeHtml(branding.footerWeb)}</div>
          <div class="footer-bar">
            <div class="footer-orange"></div>
            <div class="footer-blue">
              <div>${escapeHtml(branding.footerAddress)}</div>
              <div>${escapeHtml(branding.footerPhone)}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="page">
        <div class="header">
          <div class="logo-box">${logoHtml}</div>
          <div class="title-box">
            <div class="title-orange"></div>
            <div class="title-blue">COTIZACION</div>
          </div>
        </div>

        <div class="section-block">
          <h3>Asistencia y garantia</h3>
          ${renderTextBlock(payload.warranty_text)}
        </div>
        <div class="section-block">
          <h3>Responsabilidad del cliente</h3>
          ${renderTextBlock(payload.customer_responsibility)}
        </div>
        <div class="section-block">
          <h3>El presupuesto incluye</h3>
          ${renderTextBlock(payload.includes_text)}
        </div>
      </section>

      <section class="page">
        <div class="header">
          <div class="logo-box">${logoHtml}</div>
          <div class="title-box">
            <div class="title-orange"></div>
            <div class="title-blue">COTIZACION</div>
          </div>
        </div>

        <div class="acceptance">
          <h2>Firma de aceptacion</h2>
          <div class="acceptance-row"><strong>Nombre:</strong><div class="acceptance-line"></div></div>
          <div class="acceptance-row"><strong>Documento nro.:</strong><div class="acceptance-line"></div></div>
          <div class="acceptance-row"><strong>Fecha:</strong><div class="acceptance-line"></div></div>
          <div class="acceptance-row"><strong>Sello:</strong><div class="acceptance-line"></div></div>
        </div>
      </section>
    </body>
  </html>`;
}

export async function buildFormalQuotePdfBuffer(payload = {}) {
  const branding = await getBranding();
  const html = buildHtml(payload, branding);
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
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
