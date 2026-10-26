import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../src/services/quoteEngine.js';

function serviceQuote(rate, items) {
  return computeQuote({
    operation_currency: 'PYG', exchange_rate_atm_gs_per_usd: rate,
    rent_rate: 0, include_customs: false, items,
    install_items: [{ qty: 1, unit_cost_gs: 120000, unit_price_gs: 300000 }],
  });
}

test('service installation sale is distributed across manually priced items with zero base cost', () => {
  const items = [
    { description: 'Trabajo A', qty: 1, door_value_usd: 0, sale_mode: 'manual', sale_price: 100000 },
    { description: 'Trabajo B', qty: 1, door_value_usd: 0, sale_mode: 'manual', sale_price: 200000 },
  ];
  for (const rate of [1, 6500, 7000]) {
    const quote = serviceQuote(rate, items);
    assert.ok(Math.abs(quote.oferta.items[0].instal * rate - 100000) < 0.01);
    assert.ok(Math.abs(quote.oferta.items[1].instal * rate - 200000) < 0.01);
    assert.ok(Math.abs(quote.operacion.totals.total_sell_usd * rate - 600000) < 0.01);
    assert.ok(Math.abs(quote.operacion.totals.profit_total_usd * rate - 480000) < 0.01);
    const rubroSale = Object.values(quote.operacion.rubros).reduce((sum, rubro) => sum + rubro.venta, 0);
    assert.ok(Math.abs((rubroSale - quote.operacion.totals.total_sell_usd) * rate) < 0.01);
  }
});

test('service installation is distributed by quantity when sale prices are not entered yet', () => {
  const quote = serviceQuote(6500, [
    { description: 'Trabajo A', qty: 1, door_value_usd: 0 },
    { description: 'Trabajo B', qty: 2, door_value_usd: 0 },
  ]);
  assert.ok(Math.abs(quote.oferta.items[0].instal * 6500 - 100000) < 0.01);
  assert.ok(Math.abs(quote.oferta.items[1].instal * 6500 - 200000) < 0.01);
  assert.ok(Math.abs(quote.oferta.totals.total_sales_usd * 6500 - 300000) < 0.01);
});

test('USD quotes retain the original proportional split by base item value', () => {
  const quote = computeQuote({
    operation_currency: 'USD', exchange_rate_install_gs_per_usd: 7000,
    rent_rate: 0, include_customs: false,
    items: [
      { description: 'A', qty: 1, door_value_usd: 100 },
      { description: 'B', qty: 1, door_value_usd: 300 },
    ],
    install_items: [{ qty: 1, unit_price_gs: 700000 }],
  });
  assert.equal(quote.oferta.items[0].instal, 25);
  assert.equal(quote.oferta.items[1].instal, 75);
  assert.equal(quote.operacion.totals.total_sell_usd, 500);
});

test('disabling customs removes default charges without changing industrial defaults', () => {
  const inputs = { items: [{ description: 'Equipo', qty: 1, door_value_usd: 100 }] };
  const industrial = computeQuote(inputs);
  const service = computeQuote({ ...inputs, include_customs: false });
  assert.ok(industrial.despacho.totals.customs_total_usd_theoretical > 0);
  assert.equal(service.despacho.totals.customs_total_usd_theoretical, 0);
  assert.equal(service.despacho.totals.customs_total_sale_usd, 0);
  assert.deepEqual(service.despacho.lines, []);
});
