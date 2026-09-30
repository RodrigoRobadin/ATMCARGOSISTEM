import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasQuotedSaleValue, isProtectedCommercialDateKey, paraguayDate, recordFirstQuoteDate,
} from '../src/services/dealCommercialDates.js';

test('dates use Paraguay time and only a positive sale counts as quoted', () => {
  assert.equal(paraguayDate(new Date('2026-09-30T02:00:00Z')), '2026-09-29');
  assert.equal(hasQuotedSaleValue(null), false);
  assert.equal(hasQuotedSaleValue({ oferta: { totals: { total_sales_usd: 0 } } }), false);
  assert.equal(hasQuotedSaleValue({ oferta: { totals: { total_sales_usd: 1500 } } }), true);
  assert.equal(hasQuotedSaleValue({ mobile_summary: { sale_amount: 200 } }), true);
  assert.equal(hasQuotedSaleValue(null, {
    industrial_items_json: JSON.stringify([{ cantidad: 2, precio: 500, include: true }]),
  }), true);
  assert.equal(hasQuotedSaleValue(null, {
    industrial_items_json: JSON.stringify([{ cantidad: 2, precio: 500, include: false }]),
  }), false);
  assert.equal(isProtectedCommercialDateKey('f_cotiz'), true);
  assert.equal(isProtectedCommercialDateKey('f_cierre_aprox'), false);
});

test('first positive quote sets one immutable date and writes audit', async () => {
  const state = { field: null, audit: 0 };
  const conn = {
    async query(sql) {
      if (sql.startsWith('SELECT id FROM deals')) return [[{ id: 7 }]];
      if (sql.includes("`key` = 'f_cotiz'")) return [[state.field && { id: state.field.id, value: state.field.value }].filter(Boolean)];
      if (sql.startsWith('SELECT id FROM deal_custom_fields')) return [[]];
      if (sql.startsWith('INSERT INTO deal_custom_fields')) {
        state.field = { id: 21, deal_id: 7, key: 'f_cotiz', label: 'F. Cotiz', type: 'text', value: paraguayDate() };
        return [{ insertId: 21 }];
      }
      if (sql.startsWith('SELECT * FROM `deal_custom_fields`')) return [[state.field]];
      if (sql.startsWith('INSERT INTO audit_events')) { state.audit += 1; return [{}]; }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const req = { user: { id: 3, name: 'Operador' } };
  const quote = { oferta: { totals: { total_sales_usd: 1000 } } };
  assert.equal(await recordFirstQuoteDate(conn, req, 7, null), false);
  assert.equal(await recordFirstQuoteDate(conn, req, 7, quote), true);
  const firstDate = state.field.value;
  assert.equal(await recordFirstQuoteDate(conn, req, 7, quote), false);
  assert.equal(state.field.value, firstDate);
  assert.equal(state.audit, 1);
});
