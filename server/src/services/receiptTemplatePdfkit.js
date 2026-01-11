import PDFDocument from 'pdfkit';
import fs from 'fs';

const PAGE_W = 297 * 2.83465;
const PAGE_H = 210 * 2.83465;
const M = 24;
const W = PAGE_W - 2 * M;

const COLORS = {
  navy: '#3F556E',
  gray: '#333333',
  grayLight: '#555555',
  border: '#333333',
};

function fmtGs(n, { decimals = true } = {}) {
  const num = Number(n || 0);
  return num.toLocaleString('es-PY', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}

function drawBox(doc, { x, y, w, h }) {
  doc.lineWidth(1).strokeColor(COLORS.border).rect(x, y, w, h).stroke();
}

function apocope(word) {
  if (!word) return word;
  return word
    .replace(/ VEINTIUNO$/, ' VEINTIUN')
    .replace(/ Y UNO$/, ' Y UN')
    .replace(/ UNO$/, ' UN')
    .replace(/^UNO$/, 'UN');
}

function hundredsToWords(n) {
  const units = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const tens = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const specials = {
    10: 'DIEZ',
    11: 'ONCE',
    12: 'DOCE',
    13: 'TRECE',
    14: 'CATORCE',
    15: 'QUINCE',
    16: 'DIECISEIS',
    17: 'DIECISIETE',
    18: 'DIECIOCHO',
    19: 'DIECINUEVE',
  };
  const hundreds = {
    1: 'CIENTO',
    2: 'DOSCIENTOS',
    3: 'TRESCIENTOS',
    4: 'CUATROCIENTOS',
    5: 'QUINIENTOS',
    6: 'SEISCIENTOS',
    7: 'SETECIENTOS',
    8: 'OCHOCIENTOS',
    9: 'NOVECIENTOS',
  };

  if (n === 0) return '';
  if (n === 100) return 'CIEN';

  const c = Math.floor(n / 100);
  const r = n % 100;
  const t = Math.floor(r / 10);
  const u = r % 10;

  const parts = [];
  if (c > 0) parts.push(hundreds[c]);

  if (r === 0) return parts.join(' ').trim();
  if (specials[r]) {
    parts.push(specials[r]);
    return parts.join(' ').trim();
  }

  if (t === 2 && u > 0) {
    parts.push(`VEINTI${units[u].toLowerCase()}`.toUpperCase());
    return parts.join(' ').trim();
  }

  if (t > 0) parts.push(tens[t]);
  if (u > 0) {
    if (t >= 3) parts.push(`Y ${units[u]}`);
    else if (t === 0) parts.push(units[u]);
    else parts.push(units[u]);
  }
  return parts.join(' ').trim();
}

function numberToWordsEs(num) {
  const n = Math.floor(Number(num || 0));
  if (!Number.isFinite(n) || n <= 0) return 'CERO';

  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const hundreds = n % 1000;

  const parts = [];
  if (millions > 0) {
    if (millions === 1) parts.push('UN MILLON');
    else parts.push(`${apocope(hundredsToWords(millions))} MILLONES`);
  }
  if (thousands > 0) {
    if (thousands === 1) parts.push('MIL');
    else parts.push(`${apocope(hundredsToWords(thousands))} MIL`);
  }
  if (hundreds > 0) parts.push(hundredsToWords(hundreds));

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function drawHeader(doc, data, y) {
  const header = { x: M, y, w: W, h: 120 };
  drawBox(doc, header);

  const logoX = header.x + 12;
  const logoY = header.y + 18;
  if (data.logoPath && fs.existsSync(data.logoPath)) {
    doc.image(data.logoPath, logoX, logoY, { fit: [150, 70], align: 'left', valign: 'center' });
  } else {
    doc.font('Helvetica').fontSize(24).fillColor(COLORS.gray).text('grupo', logoX, logoY + 10);
    doc.font('Helvetica-Bold').fillColor('#D94545').text('atm', logoX + 70, logoY + 10);
  }

  const centerX = header.x + 190;
  const centerW = 260;
  let cy = header.y + 16;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.gray).text(data.issuerName, centerX, cy, {
    width: centerW,
    align: 'center',
  });
  cy += 14;
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.grayLight).text(data.issuerAddress, centerX, cy, {
    width: centerW,
    align: 'center',
  });
  cy += 12;
  doc.text(data.issuerPhone, centerX, cy, { width: centerW, align: 'center' });
  cy += 12;
  doc.text(data.issuerCity || 'ASUNCION - PARAGUAY', centerX, cy, { width: centerW, align: 'center' });
  cy += 14;
  doc.fontSize(6.8).text(data.issuerActivities || '', centerX, cy, { width: centerW, align: 'center' });

  const rightX = header.x + header.w - 220;
  const rightW = 200;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.gray).text('RECIBO NUMERO', rightX, header.y + 30, {
    width: rightW,
    align: 'center',
  });
  doc.font('Helvetica-Bold').fontSize(12).text(data.receiptNumber || '', rightX, header.y + 50, {
    width: rightW,
    align: 'center',
  });
}

function drawTopInfo(doc, data, y) {
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.gray);
  doc.text(data.issuePlaceDate || '', M, y, { width: W / 2 });
  doc.font('Helvetica-Bold').fontSize(12).text(`${data.currency || 'GS'} ${fmtGs(data.amount)}`, M + W / 2, y, {
    width: W / 2,
    align: 'right',
  });
}

function drawBody(doc, data, y) {
  let cy = y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.gray).text(`RECIBIMOS DE ${data.receivedFrom || ''}`, M, cy);
  cy += 20;
  doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(COLORS.gray).text(
    `LA CANTIDAD DE ${data.currency || 'GS'} ${data.amountWords || ''}`,
    M,
    cy,
    { width: W }
  );
  cy += 20;
  doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.gray).text(
    'EN CONCEPTO DE PAGO CORRESPONDIENTE A LAS FACTURAS MAS ABAJO DETALLADAS',
    M,
    cy,
    { width: W }
  );
  return cy + 20;
}

function drawInvoicesTable(doc, data, y) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.gray).text('DETALLE DE FACTURAS', M, y, {
    width: W,
    align: 'center',
  });
  doc.moveTo(M + W / 2 - 90, y + 14).lineTo(M + W / 2 + 90, y + 14).strokeColor(COLORS.gray).stroke();

  const headerY = y + 24;
  const colW = { num: 80, date: 90, curr: 60, amount: 120, type: 190, paid: 120 };
  const colX = {
    num: M,
    date: M + colW.num,
    curr: M + colW.num + colW.date,
    amount: M + colW.num + colW.date + colW.curr,
    type: M + colW.num + colW.date + colW.curr + colW.amount,
    paid: M + colW.num + colW.date + colW.curr + colW.amount + colW.type,
  };

  doc.save().fillColor(COLORS.navy).rect(M, headerY, W, 18).fill().restore();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('white');
  doc.text('NUMERO', colX.num, headerY + 5, { width: colW.num, align: 'center' });
  doc.text('EMISION', colX.date, headerY + 5, { width: colW.date, align: 'center' });
  doc.text('MONEDA', colX.curr, headerY + 5, { width: colW.curr, align: 'center' });
  doc.text('MONTO', colX.amount, headerY + 5, { width: colW.amount, align: 'right' });
  doc.text('TIPO DE PAGO', colX.type, headerY + 5, { width: colW.type, align: 'center' });
  doc.text('PAGO', colX.paid, headerY + 5, { width: colW.paid, align: 'right' });

  let rowY = headerY + 22;
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray);
  (data.invoices || []).forEach((row) => {
    doc.text(row.number || '-', colX.num, rowY, { width: colW.num, align: 'center' });
    doc.text(row.issueDate || '-', colX.date, rowY, { width: colW.date, align: 'center' });
    doc.text(row.currency || data.currency || 'GS', colX.curr, rowY, { width: colW.curr, align: 'center' });
    doc.text(fmtGs(row.amount), colX.amount, rowY, { width: colW.amount, align: 'right' });
    doc.text(row.paymentType || '-', colX.type, rowY, { width: colW.type, align: 'center' });
    doc.text(fmtGs(row.paidAmount), colX.paid, rowY, { width: colW.paid, align: 'right' });
    rowY += 18;
    doc.strokeColor('#d5d7dc').lineWidth(0.8).moveTo(M, rowY).lineTo(M + W, rowY).stroke();
  });
  return rowY + 8;
}

function drawPaymentsFooter(doc, data, y) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.gray).text('DETALLE DE PAGOS', M, y, {
    width: W,
    align: 'center',
  });
  doc.moveTo(M + W / 2 - 80, y + 14).lineTo(M + W / 2 + 80, y + 14).strokeColor(COLORS.gray).stroke();

  const lineY = y + 50;
  const sigX = M + W - 220;
  doc.strokeColor(COLORS.gray).moveTo(sigX, lineY).lineTo(sigX + 190, lineY).stroke();
  doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.gray).text(data.issuedByName || '', sigX, lineY - 14, {
    width: 190,
    align: 'center',
  });
  doc.font('Helvetica-Bold').fontSize(9).text((data.issuedByName || '').toUpperCase(), sigX, lineY + 4, {
    width: 190,
    align: 'center',
  });
}

export async function generateReceiptPDF(data, outputStream) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: M });
      doc.pipe(outputStream);

      const amountWords = data.amountWords || numberToWordsEs(Math.round(data.amount || 0));

      drawHeader(doc, {
        logoPath: data.logoPath,
        issuerName: data.issuer?.name || 'ATM CARGO S.R.L.',
        issuerAddress: data.issuer?.address || '',
        issuerPhone: data.issuer?.phone || '',
        issuerCity: data.issuer?.city || 'ASUNCION - PARAGUAY',
        issuerActivities: data.issuer?.activities || '',
        receiptNumber: data.receiptNumber || '',
      }, M);

      let y = M + 120 + 18;
      drawTopInfo(doc, {
        issuePlaceDate: data.issuePlaceDate,
        amount: data.amount,
        currency: data.currency || 'GS',
      }, y);

      y += 24;
      y = drawBody(doc, {
        receivedFrom: data.receivedFrom,
        amountWords,
        currency: data.currency || 'GS',
      }, y);

      y = drawInvoicesTable(doc, {
        invoices: data.invoices || [],
        currency: data.currency || 'GS',
      }, y + 6);

      drawPaymentsFooter(doc, { issuedByName: data.issuedByName || '' }, y + 8);

      doc.end();
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

export default generateReceiptPDF;
