import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedPaymentOrderUrl } from '../src/utils/paymentOrderNavigation.js';

test('payment order link carries supplier and selected invoices', () => {
  const url = new URL(unifiedPaymentOrderUrl({ supplierId: 12, documentIds: [3, 4] }), 'https://crm.test');
  assert.equal(url.pathname, '/admin-ops/accounts-payable');
  assert.equal(url.searchParams.get('new_order'), '1');
  assert.equal(url.searchParams.get('supplier_id'), '12');
  assert.deepEqual(url.searchParams.getAll('document'), ['operation-expense:3', 'operation-expense:4']);
});

test('payment order link omits invalid document identifiers', () => {
  const url = new URL(unifiedPaymentOrderUrl({ documentIds: [0, null, -1, 7] }), 'https://crm.test');
  assert.equal(url.searchParams.has('supplier_id'), false);
  assert.deepEqual(url.searchParams.getAll('document'), ['operation-expense:7']);
});
