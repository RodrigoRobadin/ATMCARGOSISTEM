export function unifiedPaymentOrderUrl({ supplierId, documentIds = [] } = {}) {
  const params = new URLSearchParams({ new_order: '1' });
  if (Number(supplierId) > 0) params.set('supplier_id', String(supplierId));
  documentIds.filter((id) => Number(id) > 0).forEach((id) => params.append('document', `operation-expense:${id}`));
  return `/admin-ops/accounts-payable?${params.toString()}`;
}
