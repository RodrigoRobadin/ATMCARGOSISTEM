import PDFDocument from 'pdfkit';

const PAGE_W = 595.28; // A4 width in points
const PAGE_H = 841.89; // A4 height in points
const M = 36;
const W = PAGE_W - M * 2;

const COLORS = {
  gray: '#7a7a7a',
  dark: '#111111',
  brand: '#e4552d',
  navy: '#364f6b',
  light: '#f8fafc',
  border: '#d1d5db',
};

function formatDateEs(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-PY', { day: '2-digit', month: 'long', year: 'numeric' });
}

function drawLabelValue(doc, label, value, x, y, w) {
  const labelText = `${label}:`;
  doc.font('Helvetica-Bold').fillColor(COLORS.dark).text(labelText, x, y, { continued: true });
  doc.font('Helvetica').fillColor(COLORS.dark).text(` ${value || ''}`, { width: w - 80 });
  return doc.y;
}

function drawTableHeader(doc, x, y, colWidths) {
  const h = 22;
  doc.save().fillColor(COLORS.gray).rect(x, y, W, h).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text('SERVICIO', x + 6, y + 6, { width: colWidths[0] - 12 });
  doc.text('CANTIDAD', x + colWidths[0], y + 6, { width: colWidths[1], align: 'center' });
  doc.text('UNIDAD DE MEDIDA', x + colWidths[0] + colWidths[1], y + 6, { width: colWidths[2], align: 'center' });
  doc.restore();
  return y + h;
}

function drawTableRow(doc, x, y, colWidths, row) {
  const desc = row.description || '';
  const qty = row.qty ?? 1;
  const unit = row.unit || 'UNIDAD';
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.dark);
  const descHeight = doc.heightOfString(desc, { width: colWidths[0] - 12 });
  const rowH = Math.max(20, descHeight + 6);
  doc.text(desc, x + 6, y + 4, { width: colWidths[0] - 12 });
  doc.text(String(qty), x + colWidths[0], y + 4, { width: colWidths[1], align: 'center' });
  doc.text(String(unit), x + colWidths[0] + colWidths[1], y + 4, {
    width: colWidths[2],
    align: 'center',
  });
  doc.lineWidth(0.5).strokeColor(COLORS.border).moveTo(x, y + rowH).lineTo(x + W, y + rowH).stroke();
  return y + rowH;
}

export async function generateWorkOrderPDF(data, outputStream) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: M });
      doc.pipe(outputStream);

      const pageX = M;
      let y = M;

      // Header logo placeholder
      doc.save();
      doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.dark).text('grupo', pageX, y);
      doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.brand).text(' atm', pageX + 58, y);
      doc.moveTo(pageX, y + 40).lineTo(pageX + 130, y + 40).strokeColor(COLORS.brand).lineWidth(3).stroke();
      doc.restore();

      // Title banner
      const titleW = 260;
      const titleH = 40;
      const titleX = PAGE_W - M - titleW;
      const titleY = y - 4;
      doc.fillColor(COLORS.navy).rect(titleX, titleY, titleW, titleH).fill();
      doc.fillColor(COLORS.brand).circle(titleX, titleY + titleH / 2, 42).fill();
      doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold').text('ORDEN DE TRABAJO', titleX + 24, titleY + 12, {
        width: titleW - 30,
        align: 'center',
      });

      doc.fillColor(COLORS.dark).fontSize(9).font('Helvetica');
      doc.text(`Asunción ${formatDateEs(data.issue_date || new Date())}`, PAGE_W - M - 200, y + 48, { width: 200, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(12).text(`REF.: ${data.reference || ''}`, PAGE_W - M - 200, y + 64, { width: 200, align: 'right' });

      y += 90;

      // Info grid (two columns)
      const colW = (W - 12) / 2;
      let yLeft = y;
      let yRight = y;
      yLeft = drawLabelValue(doc, 'CLIENTE', data.client, pageX, yLeft, colW);
      yLeft = drawLabelValue(doc, 'CONTACTO', data.contact, pageX, yLeft + 4, colW);
      yLeft = drawLabelValue(doc, 'PRIORIDAD', data.priority, pageX, yLeft + 4, colW);

      yRight = drawLabelValue(doc, 'TELEFONO', data.phone, pageX + colW + 12, yRight, colW);
      yRight = drawLabelValue(doc, 'EMAIL', data.email, pageX + colW + 12, yRight + 4, colW);
      yRight = drawLabelValue(doc, 'ENTREGA', data.delivery, pageX + colW + 12, yRight + 4, colW);

      y = Math.max(yLeft, yRight) + 6;
      y = drawLabelValue(doc, 'OBSERVACION', data.observation, pageX, y, W);
      y = drawLabelValue(doc, 'DATO DE CALCOMANIA', data.calcomania, pageX, y + 4, W);
      y = drawLabelValue(doc, 'TECNICOS RESPONSABLES', data.tecnicos_responsables, pageX, y + 4, W);
      y = drawLabelValue(doc, 'DIRECCION', data.address, pageX, y + 4, W);

      y += 10;

      // Section title
      doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.dark).text('PRODUCTOS Y SERVICIOS', pageX, y, {
        width: W,
        align: 'center',
      });
      doc.moveTo(pageX + 200, y + 16).lineTo(pageX + W - 200, y + 16).strokeColor(COLORS.dark).lineWidth(1).stroke();
      y += 22;

      const colWidths = [W * 0.6, W * 0.15, W * 0.25];
      y = drawTableHeader(doc, pageX, y, colWidths);

      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        y = drawTableRow(doc, pageX, y, colWidths, { description: '', qty: '', unit: '' });
      } else {
        for (const it of items) {
          if (y > PAGE_H - 120) {
            doc.addPage();
            y = M;
            y = drawTableHeader(doc, pageX, y, colWidths);
          }
          y = drawTableRow(doc, pageX, y, colWidths, it);
        }
      }

      y += 12;
      doc.moveTo(pageX, y - 6).lineTo(pageX + W, y - 6).strokeColor(COLORS.border).lineWidth(0.8).stroke();
      doc.font('Helvetica-BoldOblique').fontSize(9).fillColor(COLORS.dark).text('OBSERVACIONES', pageX, y);
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.dark)
        .text('Los precios indicados ya incluyen el impuesto al valor agregado (IVA).', pageX, y + 12)
        .text('Esta cotización contempla únicamente los items descriptos en el documento.', pageX, y + 24);
      doc.font('Helvetica-BoldOblique').fontSize(9).text('DIRECCION', pageX, y + 40);
      doc.font('Helvetica').fontSize(8).text(data.address || '', pageX, y + 52);

      const signY = PAGE_H - 90;
      doc.moveTo(PAGE_W - M - 220, signY).lineTo(PAGE_W - M, signY).strokeColor(COLORS.dark).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.dark).text((data.signature || '').toUpperCase(), PAGE_W - M - 220, signY + 4, {
        width: 220,
        align: 'center',
      });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.dark).text(data.signature ? data.signature_phone || '' : 'Firma cliente', PAGE_W - M - 220, signY + 16, {
        width: 220,
        align: 'center',
      });

      doc.end();
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

export default generateWorkOrderPDF;
