export function receiptExpeditionForInvoices(invoices) {
  if (!Array.isArray(invoices) || !invoices.length) {
    throw Object.assign(new Error('Seleccione al menos una factura'), { statusCode: 400 });
  }
  const parts = invoices.map((invoice) => {
    const match = /^(\d{3})-(\d{3})-\d{7}$/.exec(String(invoice.invoice_number || ''));
    if (!match) {
      throw Object.assign(new Error(`La factura ${invoice.invoice_number || invoice.id} no tiene un número válido`), { statusCode: 400 });
    }
    return { establishment: match[1], point: match[2] };
  });
  const first = parts[0];
  if (parts.some((part) => part.establishment !== first.establishment || part.point !== first.point)) {
    throw Object.assign(new Error('Un recibo no puede mezclar facturas de distintos puntos de expedición; registrá un recibo por punto'), { statusCode: 400 });
  }
  return first;
}

export function nextReceiptNumber(establishment, point, lastNumber) {
  const next = Number(lastNumber) + 1;
  if (!/^\d{3}$/.test(establishment) || !/^\d{3}$/.test(point) ||
      !Number.isSafeInteger(next) || next < 1 || next > 9999999) {
    throw Object.assign(new Error('Numeración de recibos inválida o agotada'), { statusCode: 409 });
  }
  return `${establishment}-${point}-${String(next).padStart(7, '0')}`;
}
