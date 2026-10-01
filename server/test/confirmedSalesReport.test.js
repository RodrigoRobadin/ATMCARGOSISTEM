import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, firstConfirmation, readBudget } from '../src/services/confirmedSalesReport.js';

const baseFilters = { year: 2026, month: '', business_unit: '', advisor_id: null, client: '', pending: false };

function deal(id, overrides = {}) {
  return {
    id, reference: `OP-${id}`, title: '', client_name: 'CLIENTE',
    business_unit_key: 'atm-cargo', business_unit_name: 'ATM Cargo',
    advisor_id: 7, advisor_name: 'Alejo', ...overrides,
  };
}

test('first valid confirmation uses the earlier of proof and issued invoice', () => {
  assert.deepEqual(firstConfirmation({ confirmed_on: '2026-04-04', confirm_file_id: 13, invoice_date: '2026-06-01', invoice_id: 31 }), {
    date: '2026-04-04', source: 'comprobante', method: 'other', document_id: 13,
  });
  assert.equal(firstConfirmation({ confirmed_on: '2026-06-01', confirm_file_id: 13, invoice_date: '2026-04-04', invoice_id: 31 }).source, 'factura');
  assert.equal(firstConfirmation({ confirmed_on: '2026-04-04', confirm_file_id: null, invoice_date: '2026-06-01', invoice_id: 31 }).date, '2026-06-01');
  assert.equal(firstConfirmation({ confirmed_on: '2026-04-04', confirm_file_id: null, invoice_date: null }), null);
});

test('a corrected manual date moves the operation to the corrected month', () => {
  const budgets = new Map([[1, { data: { header: { operationCurrency: 'USD' }, totals: { totalCostos: 60, totalVentas: 100 } }, version_number: 2 }]]);
  const first = buildReport([deal(1, { confirmed_on: '2026-04-04', confirm_file_id: 9 })], budgets, baseFilters);
  const corrected = buildReport([deal(1, { confirmed_on: '2026-05-02', confirm_file_id: 9 })], budgets, baseFilters);
  assert.equal(first.months[0].month, '2026-04');
  assert.equal(corrected.months[0].month, '2026-05');
  assert.equal(corrected.rows[0].profit, 40);
});

test('latest budget updates the same operation without duplicate or invoice-based amounts', () => {
  const operation = deal(2, { confirmed_on: '2026-01-15', confirm_file_id: 20, invoice_date: '2026-03-01', invoice_id: 10 });
  const budget = (purchase, sale, version_number) => new Map([[2, {
    data: { header: { operationCurrency: 'PYG' }, totals: { totalCostos: purchase, totalVentas: sale } }, version_number,
  }]]);
  const oldReport = buildReport([operation], budget(100000, 150000, 1), baseFilters);
  const newReport = buildReport([operation], budget(120000, 180000, 2), baseFilters);
  assert.equal(newReport.rows.length, 1);
  assert.equal(newReport.rows[0].revision, 'DET COS 2');
  assert.equal(newReport.rows[0].confirmation.date, '2026-01-15');
  assert.equal(oldReport.months[0].profit, 50000);
  assert.equal(newReport.months[0].profit, 60000);
});

test('industrial quote budget remains in USD and incomplete values do not inflate totals', () => {
  const complete = deal(3, { business_unit_key: 'atm-industrial', business_unit_name: 'ATM Industrial', invoice_date: '2026-07-01', invoice_id: 30 });
  const incomplete = deal(4, { confirmed_on: '2026-07-02', confirm_file_id: 40 });
  const budgets = new Map([
    [3, { data: { operacion: { totals: { total_buy_usd: 6000, total_sell_usd: 10000 } } }, revision_id: 5, revision_name: 'R5' }],
    [4, { data: { header: { operationCurrency: 'USD' }, totals: { totalVentas: 9000 } }, version_number: 3 }],
  ]);
  const report = buildReport([complete, incomplete], budgets, baseFilters);
  assert.equal(report.rows.length, 2);
  assert.equal(report.months[0].count, 2);
  assert.equal(report.months[0].pending_count, 1);
  assert.equal(report.months[0].sale, 10000);
  assert.equal(report.months[0].purchase, 6000);
  assert.equal(report.months[0].profit, 4000);
  assert.equal(report.rows.find((row) => row.id === 4).profit, null);
  assert.equal(readBudget('atm-industrial', budgets.get(3)).revision, 'R5');
});

test('industrial PYG quotes use the saved exchange rate and unknown currencies remain pending', () => {
  const pyg = readBudget('atm-industrial', { data: {
    meta: { operation_currency: 'PYG', exchange_rate_atm_gs_per_usd: 7500 },
    operacion: { totals: { total_buy_usd: 100, total_sell_usd: 150 } },
  } });
  assert.deepEqual([pyg.currency, pyg.purchase, pyg.sale, pyg.profit, pyg.complete],
    ['PYG', 750000, 1125000, 375000, true]);
  const noRate = readBudget('atm-industrial', { data: {
    meta: { operation_currency: 'PYG' },
    operacion: { totals: { total_buy_usd: 100, total_sell_usd: 150 } },
  } });
  assert.equal(noRate.complete, false);
  assert.equal(noRate.sale, null);
  const legacy = readBudget('atm-industrial', {
    data: { operacion: { totals: { total_buy_usd: 100, total_sell_usd: 150 } } },
    inputs: { operation_currency: 'PYG', exchange_rate_atm_gs_per_usd: 7500 },
  });
  assert.equal(legacy.profit, 375000);
  assert.equal(readBudget('atm-cargo', null).currency, 'SIN MONEDA');
});

test('filters preserve monthly and row reconciliation', () => {
  const deals = [
    deal(5, { confirmed_on: '2026-02-01', confirm_file_id: 5, advisor_id: 7 }),
    deal(6, { confirmed_on: '2026-03-01', confirm_file_id: 6, advisor_id: 8 }),
  ];
  const budgets = new Map(deals.map((row) => [row.id, { data: {
    header: { operationCurrency: 'USD' }, totals: { totalCostos: 1, totalVentas: 3 },
  } }]));
  const report = buildReport(deals, budgets, { ...baseFilters, month: '02', advisor_id: 7 });
  assert.deepEqual(report.rows.map((row) => row.id), [5]);
  assert.equal(report.months[0].profit, report.rows[0].profit);
  assert.equal(buildReport(deals, budgets, { ...baseFilters, pending: true }).rows.length, 0);
});
