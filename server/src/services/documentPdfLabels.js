export function invoiceKind(fiscalMode) {
  return fiscalMode === 'electronic' ? 'electronic' : 'legacy';
}

export function sameInvoiceKind(fiscalModes) {
  return new Set(fiscalModes.map(invoiceKind)).size <= 1;
}

export function invoicePdfTitle(fiscalMode, status) {
  if (status === 'borrador') return 'BORRADOR DE FACTURA AUTOIMPRESA';
  return invoiceKind(fiscalMode) === 'electronic'
    ? 'FACTURA ELECTRONICA NRO'
    : 'FACTURA AUTOIMPRESA NRO';
}

export function receiptPdfTitle(fiscalModes) {
  const kinds = new Set(fiscalModes.map(invoiceKind));
  if (kinds.size > 1) return 'RECIBO DE FACTURAS MIXTAS NRO';
  return kinds.has('electronic')
    ? 'RECIBO DE FACTURA ELECTRONICA NRO'
    : 'RECIBO DE FACTURA AUTOIMPRESA NRO';
}
