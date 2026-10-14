import { dateOnly } from './confirmedSalesReport.js';

const issuedStatuses = new Set(['emitida', 'pago_parcial', 'pagada', 'vencida']);

export function addDealSearchStatuses(deals, fields, files, invoices) {
  const valuesByDeal = new Map();
  for (const field of fields) {
    const dealId = Number(field.deal_id);
    if (!valuesByDeal.has(dealId)) valuesByDeal.set(dealId, {});
    const values = valuesByDeal.get(dealId);
    if (values[field.key] === undefined) values[field.key] = field.value;
  }

  const fileOwners = new Map(files.map((file) => [Number(file.id), Number(file.deal_id)]));
  const invoicedIds = new Set(invoices
    .filter((invoice) => issuedStatuses.has(String(invoice.status || '').toLowerCase()) && invoice.issue_date)
    .map((invoice) => Number(invoice.deal_id)));

  return deals.map((deal) => {
    const values = valuesByDeal.get(Number(deal.id)) || {};
    const fileId = Number(values.confirm_file_id || 0);
    const isInvoiced = invoicedIds.has(Number(deal.id));
    const hasCustomerConfirmation = Boolean(
      dateOnly(values.f_confirm) && fileId > 0 && fileOwners.get(fileId) === Number(deal.id)
    );
    return {
      ...deal,
      is_confirmed: hasCustomerConfirmation || isInvoiced,
      is_invoiced: isInvoiced,
    };
  });
}
