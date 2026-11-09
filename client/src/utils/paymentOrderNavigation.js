export function unifiedPaymentOrderUrl({ supplierId, documentIds = [], sourceType = 'operation-expense' } = {}) {
  const params = new URLSearchParams({ new_order: '1' });
  if (Number(supplierId) > 0) params.set('supplier_id', String(supplierId));
  documentIds.filter((id) => Number(id) > 0).forEach((id) => params.append('document', `${sourceType}:${id}`));
  return `/admin-ops/accounts-payable?${params.toString()}`;
}
