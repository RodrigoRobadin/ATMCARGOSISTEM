import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptExpeditionForInvoices, nextReceiptNumber } from '../src/services/receiptExpedition.js';

test('receipt uses the establishment and point printed on its invoice', () => {
  assert.deepEqual(receiptExpeditionForInvoices([
    { invoice_number: '001-004-0000012' }, { invoice_number: '001-004-0000013' },
  ]), { establishment: '001', point: '004' });
});

test('one receipt cannot cover invoices from different points', () => {
  assert.throws(() => receiptExpeditionForInvoices([
    { invoice_number: '001-004-0000012' }, { invoice_number: '001-005-0000012' },
  ]), /distintos puntos/);
});

test('each document kind and expedition point can start its receipt numbering at one', () => {
  assert.equal(nextReceiptNumber('001', '001', 0), '001-001-0000001');
  assert.equal(nextReceiptNumber('001', '002', 0), '001-002-0000001');
  assert.equal(nextReceiptNumber('001', '002', 1), '001-002-0000002');
});
