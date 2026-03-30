import PDFDocument from 'pdfkit';

export async function generatePaymentOrderPDF(data, outputStream) {
  const doc = new PDFDocument({ size: 'A4', margin: 28 });
  doc.pipe(outputStream);

  const {
    order_number,
    supplier_name,
    payment_method,
    payment_date,
    invoice_number,
    amount,
    currency_code,
    condition_type,
    description,
    observations,
    operation_reference,
    invoices,
  } = data || {};
  const invoiceList = Array.isArray(invoices) ? invoices : [];
  const firstInvoice = invoiceList[0];
  const factNumber =
    invoice_number || (invoiceList.length === 1 ? firstInvoice?.receipt_number : '-') || '-';
  const amountFromInvoices = invoiceList.length
    ? invoiceList.reduce((sum, it) => sum + Number(it.amount || 0), 0)
    : Number(amount || 0);

  const bg = '#ffffff';
  const black = '#111827';
  const muted = '#9ca3af';

  const pageW = doc.page.width;
  const pageH = doc.page.height;

  // Fondo blanco
  doc.rect(0, 0, pageW, pageH).fill(bg);

  // Titulo
  doc.fillColor(black).fontSize(22).font('Helvetica-Bold').text('ORDEN', 32, 32);
  doc.fillColor(black).fontSize(22).font('Helvetica-Bold').text('DE PAGO', 32, 58);

  // Saludo
  doc.fillColor(black).fontSize(10).font('Helvetica').text('Estimados miembros de administracion', 32, 96);
  doc.fillColor(black).fontSize(10).text('Favor provisionar', 32, 130);
  doc.fillColor(black).fontSize(10).text('pago segun los sgtes', 32, 144);
  doc.fillColor(black).fontSize(10).text('detalles:', 32, 158);

  const rows = [
    ['REF N°', order_number || '-'],
    ['PROVEEDOR', supplier_name || '-'],
    ['FORMA DE PAGO', payment_method || '-'],
    ['FECHA DE PAGO', payment_date || '-'],
    ['FACT N°', factNumber],
    ['MONTO', `${currency_code || 'PYG'} ${amountFromInvoices.toLocaleString('es-ES')}`],
    ['CONDICION DE COMPRA', condition_type || '-'],
    ['SERVICIO CONTRATADO', description || '-'],
    ['OBSERVACIONES', observations || '-'],
  ];

  const startX = 32;
  let y = 200;
  const colW = [150, pageW - 64 - 150];
  const rowH = 24;

  rows.forEach(([label, value], idx) => {
    const isObs = idx === rows.length - 1;
    const h = isObs ? 70 : rowH;
    doc
      .rect(startX, y, colW[0] + colW[1], h)
      .strokeColor(muted)
      .lineWidth(0.6)
      .stroke();
    doc.fillColor(black).fontSize(9).font('Helvetica-Bold').text(label, startX + 8, y + 6, {
      width: colW[0] - 16,
    });
    doc.fillColor(black).fontSize(9).font('Helvetica').text(value || '-', startX + colW[0] + 8, y + 6, {
      width: colW[1] - 16,
      height: h - 12,
    });
    y += h;
  });

  if (invoiceList.length) {
    const tableX = 32;
    let ty = y + 12;
    doc.fillColor(black).fontSize(9).font('Helvetica-Bold').text('FACTURAS', tableX, ty);
    ty += 14;
    const colWidths = [200, 120, pageW - 64 - 200 - 120];
    const headerH = 18;
    doc
      .rect(tableX, ty, colWidths[0] + colWidths[1] + colWidths[2], headerH)
      .strokeColor(muted)
      .lineWidth(0.6)
      .stroke();
    doc.fillColor(black).fontSize(8).font('Helvetica-Bold').text('FACTURA', tableX + 6, ty + 5, { width: colWidths[0] - 12 });
    doc.fillColor(black).fontSize(8).font('Helvetica-Bold').text('FECHA', tableX + colWidths[0] + 6, ty + 5, { width: colWidths[1] - 12 });
    doc.fillColor(black).fontSize(8).font('Helvetica-Bold').text('MONTO', tableX + colWidths[0] + colWidths[1] + 6, ty + 5, { width: colWidths[2] - 12 });
    ty += headerH;

    invoiceList.forEach((it) => {
      const rowH = 16;
      doc
        .rect(tableX, ty, colWidths[0] + colWidths[1] + colWidths[2], rowH)
        .strokeColor(muted)
        .lineWidth(0.4)
        .stroke();
      doc.fillColor(black).fontSize(8).font('Helvetica').text(it.receipt_number || it.invoice_id || '-', tableX + 6, ty + 4, {
        width: colWidths[0] - 12,
      });
      doc.fillColor(black).fontSize(8).font('Helvetica').text(it.invoice_date || '-', tableX + colWidths[0] + 6, ty + 4, {
        width: colWidths[1] - 12,
      });
      doc.fillColor(black).fontSize(8).font('Helvetica').text(
        `${currency_code || 'PYG'} ${Number(it.amount || 0).toLocaleString('es-ES')}`,
        tableX + colWidths[0] + colWidths[1] + 6,
        ty + 4,
        { width: colWidths[2] - 12 }
      );
      ty += rowH;
    });
    y = ty + 8;
  }

  if (operation_reference) {
    doc.fillColor(black).fontSize(8).text(`Operacion: ${operation_reference}`, 32, pageH - 40);
  }

  doc.end();
}

export default generatePaymentOrderPDF;
