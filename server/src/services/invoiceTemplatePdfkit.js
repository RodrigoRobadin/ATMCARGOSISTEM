import PDFDocument from 'pdfkit';
import fs from 'fs';

// 290 x 406 mm => puntos (1 mm ~ 2.83465 pt)
const PAGE_W = 290 * 2.83465; // ~822.05 pt
const PAGE_H = 406 * 2.83465; // ~1150.87 pt
const M = 24;
const W = PAGE_W - 2 * M;

const COLORS = {
  navy: '#3F556E',
  gray: '#333333',
  grayLight: '#555555',
  border: '#333333',
};

function fmtGs(n, { decimals = false } = {}) {
  const num = Number(n || 0);
  const opts = {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  };
  return num.toLocaleString('es-PY', opts);
}

function drawBox(doc, { x, y, w, h }) {
  doc.lineWidth(1).strokeColor(COLORS.border).rect(x, y, w, h).stroke();
}

function drawLabelValueRow(doc, { label, value, x, y, wLabel = 120, wValue = 200 }) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.gray).text(label, x, y);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.grayLight)
    .text(value || '-', x + wLabel, y, { width: wValue });
}

function drawHeader(doc, data, y) {
  const header = { x: M, y, w: W, h: 115 };
  drawBox(doc, header);

  // Logo / placeholder
  const logoX = header.x + 10;
  const logoY = header.y + 15;
  if (data.logoPath && fs.existsSync(data.logoPath)) {
    doc.image(data.logoPath, logoX, logoY, { fit: [150, 80], align: 'left', valign: 'center' });
  } else {
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(COLORS.gray)
      .text('grupo atm', logoX, logoY + 20);
  }

  // Centro: datos empresa
  const centerX = header.x + 170;
  const centerW = 260;
  let cy = header.y + 12;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.gray).text(data.issuerName, centerX, cy, {
    width: centerW,
    align: 'center',
  });
  cy += 16;
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.grayLight)
    .text(data.issuerAddress, centerX, cy, { width: centerW, align: 'center' });
  cy += 14;
  doc
    .text(data.issuerPhone, centerX, cy, { width: centerW, align: 'center' });
  cy += 14;
  doc.text(data.issuerCity || 'ASUNCION - PARAGUAY', centerX, cy, { width: centerW, align: 'center' });
  cy += 16;
  doc
    .fontSize(7.5)
    .fillColor(COLORS.grayLight)
    .text(
      data.issuerActivities || '',
      centerX,
      cy,
      { width: centerW, align: 'center' }
    );

  // Derecha: timbrado / factura
  // Calcular columna derecha dinámica para que no desborde
  const rightX = header.x + header.w - 220; // ancho reservado a la derecha
  const colRightW = header.x + header.w - rightX - 12;
  const labW = 120;
  const valW = Math.max(60, colRightW - labW);
  let ry = header.y + 12;
  const labelVal = (lab, val) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.gray)
      .text(lab, rightX, ry, { width: labW, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.grayLight)
      .text(val || '-', rightX + labW, ry, { width: valW, align: 'right', lineBreak: false });
    ry += 14;
  };
  labelVal('RUC:', data.issuerRuc);
  labelVal('TIMBRADO:', data.timbrado);
  labelVal('INICIO DE VIGENCIA:', data.timbradoStart);
  labelVal('FIN DE VIGENCIA:', data.timbradoEnd);

  ry += 8;
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(COLORS.gray)
    .text(data.headerTitle || 'FACTURA NUMERO', rightX, ry, {
      width: colRightW,
      align: 'center',
    });
  ry += 16;
  doc
    .fontSize(14)
    .text(data.invoiceNumber || '', rightX, ry, {
      width: colRightW,
      align: 'center',
    });
}

function drawClientBox(doc, data, y) {
  const box = { x: M, y, w: W, h: 115 };
  drawBox(doc, box);
  const leftX = box.x + 10;
  const rightX = box.x + 340;
  let ly = box.y + 10;
  let ry = box.y + 10;
  drawLabelValueRow(doc, { label: 'FECHA DE EMISION:', value: data.fechaEmision, x: leftX, y: ly });
  drawLabelValueRow(doc, { label: 'HORA:', value: data.hora, x: rightX, y: ry });
  ly += 14; ry += 14;
  drawLabelValueRow(doc, { label: 'RAZON SOCIAL:', value: data.clienteNombre, x: leftX, y: ly });
  drawLabelValueRow(doc, { label: 'RUC:', value: data.clienteRuc, x: rightX, y: ry });
  ly += 14; ry += 14;
  drawLabelValueRow(doc, { label: 'DIRECCION:', value: data.clienteDireccion, x: leftX, y: ly });
  ry += 14;
  drawLabelValueRow(doc, { label: 'FACTURA AFECTADA:', value: data.facturaAfectada, x: rightX, y: ry });
  ry += 14;
  drawLabelValueRow(doc, { label: 'TELEFONO:', value: data.clienteTelefono, x: leftX, y: (ly += 14) });
  drawLabelValueRow(doc, { label: 'CONDICION DE VENTA:', value: data.condicionVenta, x: rightX, y: ry });
  drawLabelValueRow(doc, { label: 'CORREO ELECTRONICO:', value: data.clienteEmail, x: leftX, y: (ly += 14) });
  drawLabelValueRow(doc, { label: 'MONEDA:', value: data.moneda, x: rightX, y: (ry += 14) });
}

function drawReference(doc, data, y) {
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.gray)
    .text(`REF. N° ${data.refNumero || ''} / ${data.refDetalle || ''}`, M, y, {
      width: W,
      align: 'right',
    });
}

function drawTableHeader(doc, y, colX, colW) {
  const headerH1 = 18;
  const headerH2 = 16;
  // Fondo
  doc.save().fillColor(COLORS.navy).rect(M, y, W, headerH1 + headerH2).fill().restore();
  doc.font('Helvetica-Bold').fillColor('white').fontSize(9);
  // Nivel 1
  doc.text('CANTIDAD', colX.qty, y + 5, { width: colW.qty, align: 'center' });
  doc.text('DESCRIPCION', colX.desc, y + 5, { width: colW.desc, align: 'center' });
  doc.text('PRECIO UNITARIO', colX.pu, y + 5, { width: colW.pu, align: 'center' });
  doc.text('VALOR DE VENTA', colX.ex, y + 5, { width: colW.ex + colW.five + colW.ten, align: 'center' });
  // Nivel 2
  const y2 = y + headerH1;
  doc.text('EXENTAS', colX.ex, y2 + 3, { width: colW.ex, align: 'center' });
  doc.text('5 %', colX.five, y2 + 3, { width: colW.five, align: 'center' });
  doc.text('10 %', colX.ten, y2 + 3, { width: colW.ten, align: 'center' });
  return headerH1 + headerH2;
}

function drawItems(doc, items, yStart, colX, colW) {
  let y = yStart;
  const rowH = 22;
  items.forEach((it) => {
    const exentasText = it.taxType === 'EXENTA' ? fmtGs(it.total, { decimals: true }) : '';
    const vat5Text = it.taxType === 'IVA5' ? fmtGs(it.total, { decimals: true }) : '';
    const vat10Text = it.taxType === 'IVA10' ? fmtGs(it.total, { decimals: true }) : '';
    const textY = y + 4;
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray);
    doc.text(it.qty, colX.qty, textY, { width: colW.qty, align: 'center' });
    doc.text(it.description || 'Item', colX.desc, textY, { width: colW.desc });
    doc.text(`USD ${fmtGs(it.unitPrice, { decimals: true })}`, colX.pu, textY, {
      width: colW.pu,
      align: 'right',
    });
    doc.text(exentasText, colX.ex, textY, { width: colW.ex, align: 'right' });
    doc.text(vat5Text, colX.five, textY, { width: colW.five, align: 'right' });
    doc.text(vat10Text, colX.ten, textY, { width: colW.ten, align: 'right' });

    y += rowH;
    doc.strokeColor('#d5d7dc').lineWidth(0.8).moveTo(M, y).lineTo(M + W, y).stroke();
  });
  return y;
}

function drawTotalsBox(doc, data, colX, colW) {
  const box = { x: M, y: 690, w: W, h: 95 };
  drawBox(doc, box);
  let y = box.y + 10;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.gray).text('SUBTOTAL:', box.x + 6, y);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.grayLight);
  doc.text(fmtGs(data.subtotales.exentas, { decimals: true }), colX.ex, y, { width: colW.ex, align: 'right' });
  doc.text(fmtGs(data.subtotales.vat5, { decimals: true }), colX.five, y, { width: colW.five, align: 'right' });
  doc.text(fmtGs(data.subtotales.vat10, { decimals: true }), colX.ten, y, { width: colW.ten, align: 'right' });

  y += 18;
  doc.font('Helvetica-Bold').fillColor(COLORS.gray).text('TOTAL:', box.x + 6, y);
  doc.font('Helvetica').fillColor(COLORS.grayLight).text(`GS ${data.totalEnLetras || ''}`, box.x + 60, y, {
    width: 250,
  });
  doc
    .font('Helvetica-Bold')
    .fillColor(COLORS.gray)
    .text(`USD ${fmtGs(data.totalGeneral, { decimals: true })}`, box.x + box.w - 140, y, {
      width: 130,
      align: 'right',
    });

  y += 22;
  doc.font('Helvetica-Bold').fillColor(COLORS.gray).text('LIQUIDACION DEL IVA', box.x + 6, y);
  doc.font('Helvetica').fillColor(COLORS.grayLight);
  doc.text(`5 %: USD ${fmtGs(data.iva5, { decimals: true })}`, colX.five, y, {
    width: colW.five + 20,
    align: 'left',
  });
  doc.text(`10 %: USD ${fmtGs(data.iva10, { decimals: true })}`, colX.ten - 20, y, {
    width: colW.ten + 60,
    align: 'left',
  });
  doc
    .font('Helvetica-Bold')
    .fillColor(COLORS.gray)
    .text(`TOTAL IVA: USD ${fmtGs(data.ivaTotal, { decimals: true })}`, box.x + box.w - 200, y, {
      width: 190,
      align: 'right',
    });
}

function drawFooter(doc, data) {
  let y = 800;
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.grayLight).text(
    data.footer?.autoimpresor ||
      'Autorizado como Autoimpresor por la SET - Nro. de solicitud ___ de fecha ___ - ORIGINAL',
    M,
    y,
    { width: W }
  );
  y += 12;
  doc
    .fontSize(7)
    .text(
      data.footer?.legal ||
        'Esta factura ha sido generada electrónicamente y cumple con los requisitos vigentes.',
      M,
      y,
      { width: W }
    );
  y += 16;
  // líneas punteadas
  const segments = 4;
  const segWidth = W / segments;
  doc.save().strokeColor('#999').lineWidth(0.5).dash(3, { space: 2 });
  for (let i = 0; i < segments; i++) {
    const sx = M + i * segWidth;
    doc.moveTo(sx, y).lineTo(sx + segWidth - 6, y).stroke();
  }
  doc.restore();
  y += 6;
  const labels = ['FECHA', 'FIRMA Y SELLO', 'ACLARACION', 'DOCUMENTO N°'];
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.gray);
  labels.forEach((lab, idx) => {
    doc.text(lab, M + idx * segWidth, y + 2, { width: segWidth - 6, align: 'center' });
  });
}

function mapItem(it) {
  const qty = Number(it.quantity || it.qty || 0);
  const unitPrice = Number(it.unit_price || it.unitPrice || 0);
  const rate = Number(it.tax_rate ?? it.taxRate ?? 0);
  const base = qty * unitPrice;
  const iva = (rate / 100) * base;
  const total = base + iva;
  let taxType = 'EXENTA';
  if (rate >= 9) taxType = 'IVA10';
  else if (rate >= 4) taxType = 'IVA5';
  return {
    qty: fmtGs(qty, { decimals: false }),
    description: it.description || 'Item',
    unitPrice,
    taxType,
    total,
    base,
    rate,
  };
}

function computeTotals(items) {
  const totals = { exentas: 0, vat5: 0, vat10: 0, iva5: 0, iva10: 0 };
  items.forEach((it) => {
    const base = it.base;
    const iva = (it.rate / 100) * base;
    if (it.taxType === 'IVA10') {
      totals.vat10 += base + iva;
      totals.iva10 += iva;
    } else if (it.taxType === 'IVA5') {
      totals.vat5 += base + iva;
      totals.iva5 += iva;
    } else {
      totals.exentas += base + iva;
    }
  });
  return {
    subtotales: {
      exentas: totals.exentas,
      vat5: totals.vat5,
      vat10: totals.vat10,
    },
    iva5: totals.iva5,
    iva10: totals.iva10,
    ivaTotal: totals.iva5 + totals.iva10,
    totalGeneral: totals.exentas + totals.vat5 + totals.vat10,
  };
}

export async function generateInvoicePDF(data, outputStream) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: M });
      doc.pipe(outputStream);

      // Map items
      const mappedItems = (data.items || []).map(mapItem);
      const totalsCalc = computeTotals(mappedItems);

      // Header
      drawHeader(doc, {
        logoPath: data.logoPath,
        issuerName: data.issuer?.name || 'ATM CARGO S.R.L.',
        issuerAddress: data.issuer?.address || '',
        issuerPhone: data.issuer?.phone || '',
        issuerCity: data.issuer?.city || 'ASUNCION - PARAGUAY',
        issuerActivities: data.issuer?.activities || '',
        issuerRuc: data.issuer?.ruc || '',
        timbrado: data.issuer?.timbrado || '',
        timbradoStart: data.issuer?.timbrado_start || '',
        timbradoEnd: data.issuer?.timbrado_end || '',
        invoiceNumber: data.invoiceNumber || '',
        headerTitle: data.headerTitle || '',
      }, M);

      // Client box
      drawClientBox(doc, {
        fechaEmision: data.fechaEmision,
        hora: data.hora,
        clienteNombre: data.client?.name || '',
        clienteDireccion: data.client?.address || '',
        clienteTelefono: data.client?.phone || '',
        clienteEmail: data.client?.email || '',
        clienteRuc: data.client?.ruc || '',
        condicionVenta: data.condicionVenta || '',
        moneda: data.moneda || 'GS',
      }, M + 115 + 16);

      // Reference
      const refY = M + 115 + 16 + 85 + 22;
      drawReference(doc, { refNumero: data.refNumero, refDetalle: data.refDetalle }, refY);

      // Table
      const tableY = refY + 18;
      const colW = { qty: 70, desc: 205, pu: 100, ex: 60, five: 56, ten: 56 };
      const colX = {
        qty: M,
        desc: M + colW.qty,
        pu: M + colW.qty + colW.desc,
        ex: M + colW.qty + colW.desc + colW.pu,
        five: M + colW.qty + colW.desc + colW.pu + colW.ex,
        ten: M + colW.qty + colW.desc + colW.pu + colW.ex + colW.five,
      };
      const headerHeight = drawTableHeader(doc, tableY, colX, colW);
      const afterItemsY = drawItems(doc, mappedItems, tableY + headerHeight, colX, colW);

      // Totals
      drawTotalsBox(
        doc,
        {
          subtotales: totalsCalc.subtotales,
          totalEnLetras: data.totalEnLetras,
          totalGeneral: totalsCalc.totalGeneral,
          iva5: totalsCalc.iva5,
          iva10: totalsCalc.iva10,
          ivaTotal: totalsCalc.ivaTotal,
        },
        colX,
        colW
      );

      // Footer
      drawFooter(doc, data);

      doc.end();
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

export default generateInvoicePDF;
