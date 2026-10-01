const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function dateOnly(value) {
  const text = String(value || '').slice(0, 10);
  if (!datePattern.test(text)) return null;
  const date = new Date(`${text}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

export function firstConfirmation(row) {
  const manualDate = Number(row.confirm_file_id) > 0 ? dateOnly(row.confirmed_on) : null;
  const invoiceDate = dateOnly(row.invoice_date);
  if (!manualDate && !invoiceDate) return null;
  if (manualDate && (!invoiceDate || manualDate <= invoiceDate)) {
    return {
      date: manualDate,
      source: 'comprobante',
      method: row.confirm_method || 'other',
      document_id: Number(row.confirm_file_id),
    };
  }
  return {
    date: invoiceDate,
    source: 'factura',
    method: null,
    document_id: Number(row.invoice_id),
    document_number: row.invoice_number || null,
  };
}

function json(value) {
  if (value && typeof value === 'object') return value;
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function amount(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, currency) {
  const factor = currency === 'PYG' ? 1 : 100;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function readBudget(unit, source) {
  const data = json(source?.data);
  const inputs = json(source?.inputs);
  let currency = 'SIN MONEDA';
  let purchase = null;
  let sale = null;
  let revision = null;
  if (unit === 'atm-cargo') {
    currency = String(data?.header?.operationCurrency || data?.header?.currency || 'SIN MONEDA').toUpperCase();
    purchase = amount(data?.totals?.totalCostos ?? data?.totals?.total_costos);
    sale = amount(data?.totals?.totalVentas ?? data?.totals?.total_ventas);
    revision = source?.revision_name || (source?.version_number ? `DET COS ${source.version_number}` : source ? 'DET COS anterior' : null);
  } else {
    const totals = data?.operacion?.totals || {};
    currency = String(data?.meta?.operation_currency || inputs?.operation_currency || (source ? 'USD' : 'SIN MONEDA')).toUpperCase();
    purchase = amount(totals.total_buy_usd ?? totals.total_buy);
    sale = amount(totals.total_sell_usd ?? data?.oferta?.totals?.total_sales_usd);
    if (currency === 'PYG' || currency === 'GS' || currency === 'GRS') {
      const rate = amount(data?.meta?.exchange_rate_atm_gs_per_usd ?? inputs?.exchange_rate_atm_gs_per_usd);
      purchase = rate > 1 && purchase !== null ? purchase * rate : null;
      sale = rate > 1 && sale !== null ? sale * rate : null;
    }
    revision = source?.revision_id ? (source.revision_name || `Revisión ${source.revision_id}`) : source ? 'Cotización base' : null;
  }
  if (currency === 'GS' || currency === 'GRS') currency = 'PYG';
  const roundedPurchase = purchase === null ? null : round(purchase, currency);
  const roundedSale = sale === null ? null : round(sale, currency);
  const complete = roundedSale !== null && roundedSale > 0 && roundedPurchase !== null && roundedPurchase >= 0 && ['USD', 'PYG'].includes(currency);
  return {
    currency,
    purchase: roundedPurchase,
    sale: roundedSale,
    profit: complete ? round(roundedSale - roundedPurchase, currency) : null,
    complete,
    revision,
  };
}

export function buildReport(deals, budgets, filters) {
  const year = String(filters.year);
  const rowsInYear = deals.flatMap((deal) => {
    const confirmation = firstConfirmation(deal);
    if (!confirmation || !confirmation.date.startsWith(year)) return [];
    const budget = readBudget(deal.business_unit_key, budgets.get(Number(deal.id)));
    return [{
      id: Number(deal.id),
      reference: deal.reference || `#${deal.id}`,
      title: deal.title || '',
      client_name: deal.client_name || '',
      business_unit_key: deal.business_unit_key,
      business_unit_name: deal.business_unit_name,
      advisor_id: Number(deal.advisor_id) || null,
      advisor_name: deal.advisor_name || '',
      confirmation,
      ...budget,
    }];
  });
  const advisors = Array.from(new Map(rowsInYear.filter((row) => row.advisor_id).map((row) => [row.advisor_id, {
    id: row.advisor_id, name: row.advisor_name || `#${row.advisor_id}`,
  }])).values()).sort((a, b) => a.name.localeCompare(b.name));
  const rows = rowsInYear.filter((row) => {
    if (filters.month && row.confirmation.date.slice(5, 7) !== filters.month) return false;
    if (filters.business_unit && row.business_unit_key !== filters.business_unit) return false;
    if (filters.advisor_id && row.advisor_id !== filters.advisor_id) return false;
    if (filters.client && !row.client_name.toLocaleLowerCase('es').includes(filters.client.toLocaleLowerCase('es'))) return false;
    if (filters.pending && row.complete) return false;
    return true;
  }).sort((a, b) => a.confirmation.date.localeCompare(b.confirmation.date) || a.reference.localeCompare(b.reference));
  const monthMap = new Map();
  for (const row of rows) {
    const month = row.confirmation.date.slice(0, 7);
    const key = `${month}|${row.currency}`;
    if (!monthMap.has(key)) monthMap.set(key, {
      month, currency: row.currency, count: 0, pending_count: 0, purchase: 0, sale: 0, profit: 0,
    });
    const total = monthMap.get(key);
    total.count += 1;
    if (!row.complete) total.pending_count += 1;
    else {
      total.purchase = round(total.purchase + row.purchase, row.currency);
      total.sale = round(total.sale + row.sale, row.currency);
      total.profit = round(total.profit + row.profit, row.currency);
    }
  }
  return {
    filters,
    advisors,
    months: Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency)),
    rows,
  };
}
