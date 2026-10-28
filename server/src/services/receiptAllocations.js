export function normalizeReceiptAllocations(items) {
  if (!Array.isArray(items) || !items.length) {
    throw Object.assign(new Error('Seleccione al menos una factura'), { statusCode: 400 });
  }
  const ids = new Set();
  return items.map((item) => {
    const invoiceId = Number(item?.invoice_id);
    const amount = Number(item?.amount);
    const cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 || ids.has(invoiceId) ||
        !Number.isSafeInteger(cents) || cents <= 0 || Math.abs(amount * 100 - cents) > 0.001) {
      throw Object.assign(new Error('Facturas o importes aplicados inválidos'), { statusCode: 400 });
    }
    ids.add(invoiceId);
    return { invoice_id: invoiceId, cents, amount: (cents / 100).toFixed(2) };
  }).sort((a, b) => a.invoice_id - b.invoice_id);
}

export function sameReceiptCustomer(invoices) {
  const first = invoices[0];
  const orgId = Number(first?.organization_id || 0);
  if (orgId) return invoices.every((invoice) => Number(invoice.organization_id || 0) === orgId);
  const doc = String(first?.customer_doc || '').trim().toUpperCase();
  const type = String(first?.customer_doc_type || '').trim().toUpperCase();
  return Boolean(doc) && invoices.every((invoice) => !invoice.organization_id &&
    String(invoice.customer_doc || '').trim().toUpperCase() === doc &&
    String(invoice.customer_doc_type || '').trim().toUpperCase() === type);
}
