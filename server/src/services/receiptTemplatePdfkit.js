import PDFDocument from 'pdfkit';
import fs from 'fs';

const PAGE_W = 210 * 2.83465;
const PAGE_H = 297 * 2.83465;
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

  const logoX = header.x + 10;
  const logoY = header.y + 18;
  let logoDrawn = false;
  if (data.logoPath && fs.existsSync(data.logoPath)) {
    try {
      doc.image(data.logoPath, logoX, logoY, { fit: [118, 70], align: 'left', valign: 'center' });
      logoDrawn = true;
    } catch (err) {
      console.warn('[receipt-pdf] logo ignored:', err?.message || err);
    }
  }
  if (!logoDrawn) {
    doc.font('Helvetica').fontSize(24).fillColor(COLORS.gray).text('grupo', logoX, logoY + 10);
    doc.font('Helvetica-Bold').fillColor('#D94545').text('atm', logoX + 70, logoY + 10);
  }

  const logoW = 125;
  const rightW = 140;
  const centerX = header.x + logoW;
  const centerW = header.w - logoW - rightW;
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

  const rightX = header.x + header.w - rightW - 8;
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
  doc.font('Helvetica-Bold').fontSize(12).text(
    (data.currency || 'GS') + ' ' + fmtGs(data.amount),
    M + W / 2,
    y,
    { width: W / 2, align: 'right' }
  );
  return 24;
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
  const tableX = M + 8;
  const tableW = W - 16;
  const colW = {
    num: 70,
    date: 56,
    ref: 76,
    curr: 44,
    amount: 78,
    type: 110,
    paid: tableW - 434,
  };
  const colX = {
    num: tableX,
    date: tableX + colW.num,
    ref: tableX + colW.num + colW.date,
    curr: tableX + colW.num + colW.date + colW.ref,
    amount: tableX + colW.num + colW.date + colW.ref + colW.curr,
    type: tableX + colW.num + colW.date + colW.ref + colW.curr + colW.amount,
    paid: tableX + colW.num + colW.date + colW.ref + colW.curr + colW.amount + colW.type,
  };

  doc.save().fillColor(COLORS.navy).rect(tableX, headerY, tableW, 18).fill().restore();
  doc.font('Helvetica-Bold').fontSize(7.2).fillColor('white');
  doc.text('NUMERO', colX.num + 3, headerY + 5, { width: colW.num - 6, align: 'center' });
  doc.text('EMISION', colX.date + 3, headerY + 5, { width: colW.date - 6, align: 'center' });
  doc.text('REF. OPERACION', colX.ref + 3, headerY + 5, { width: colW.ref - 6, align: 'center' });
  doc.text('MONEDA', colX.curr + 3, headerY + 5, { width: colW.curr - 6, align: 'center' });
  doc.text('MONTO', colX.amount + 3, headerY + 5, { width: colW.amount - 6, align: 'right' });
  doc.text('TIPO DE PAGO', colX.type + 3, headerY + 5, { width: colW.type - 6, align: 'center' });
  doc.text('PAGO', colX.paid + 3, headerY + 5, { width: colW.paid - 6, align: 'right' });

  let rowY = headerY + 22;
  doc.font('Helvetica').fontSize(7.6).fillColor(COLORS.gray);
  (data.invoices || []).forEach((row) => {
    const cells = [
      { value: row.number || '-', x: colX.num, width: colW.num, align: 'center' },
      { value: row.issueDate || '-', x: colX.date, width: colW.date, align: 'center' },
      { value: row.operationReference || '-', x: colX.ref, width: colW.ref, align: 'center' },
      { value: row.currency || data.currency || 'GS', x: colX.curr, width: colW.curr, align: 'center' },
      { value: fmtGs(row.amount), x: colX.amount, width: colW.amount, align: 'right' },
      { value: row.paymentType || '-', x: colX.type, width: colW.type, align: 'center' },
      { value: fmtGs(row.paidAmount), x: colX.paid, width: colW.paid, align: 'right' },
    ];
    const rowHeight = Math.max(
      18,
      ...cells.map((cell) => doc.heightOfString(String(cell.value), { width: cell.width - 6 }) + 8)
    );
    cells.forEach((cell) => {
      doc.text(String(cell.value), cell.x + 3, rowY + 4, {
        width: cell.width - 6,
        height: rowHeight - 6,
        align: cell.align,
      });
    });
    rowY += rowHeight;
    doc.strokeColor('#d5d7dc').lineWidth(0.8).moveTo(tableX, rowY).lineTo(tableX + tableW, rowY).stroke();
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
      y += drawTopInfo(doc, {
        issuePlaceDate: data.issuePlaceDate,
        amount: data.amount,
        grossAmount: data.grossAmount,
        retentionAmount: data.retentionAmount,
        retentionPct: data.retentionPct,
        currency: data.currency || 'GS',
      }, y);
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
