import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceCollectionError, normalizeReceiptAllocations, sameReceiptCustomer } from '../src/services/receiptAllocations.js';

test('receipt allocations are unique, positive and monetary', () => {
  assert.deepEqual(normalizeReceiptAllocations([
    { invoice_id: 3, amount: '12.50' }, { invoice_id: 1, amount: 4 },
  ]).map(({ invoice_id, amount }) => [invoice_id, amount]), [[1, '4.00'], [3, '12.50']]);
  for (const rows of [[], [{ invoice_id: 1, amount: 0 }],
    [{ invoice_id: 1, amount: 1.001 }],
    [{ invoice_id: 1, amount: 1 }, { invoice_id: 1, amount: 2 }]]) {
    assert.throws(() => normalizeReceiptAllocations(rows));
  }
});

test('a receipt cannot mix organizations or unidentified customers', () => {
  assert.equal(sameReceiptCustomer([{ organization_id: 4 }, { organization_id: 4 }]), true);
  assert.equal(sameReceiptCustomer([{ organization_id: 4 }, { organization_id: 5 }]), false);
  assert.equal(sameReceiptCustomer([{ customer_doc: '123', customer_doc_type: 'RUC' },
    { customer_doc: '123', customer_doc_type: 'RUC' }]), true);
  assert.equal(sameReceiptCustomer([{ customer_doc: '' }, { customer_doc: '' }]), false);
});

test('receipts require an issued invoice and fiscal approval for electronic invoices', () => {
  for (const status of ['borrador', 'anulada', 'pagada']) {
    assert.match(invoiceCollectionError({ status, fiscal_mode: 'legacy' }), /no está disponible/);
  }
  for (const fiscalStatus of [null, 'sending', 'processing', 'review', 'rejected', 'cancelled']) {
    assert.match(invoiceCollectionError({ status: 'emitida', fiscal_mode: 'electronic' }, fiscalStatus), /aprobación fiscal/);
  }
  assert.equal(invoiceCollectionError({ status: 'emitida', fiscal_mode: 'electronic' }, 'approved'), null);
  assert.equal(invoiceCollectionError({ status: 'pago_parcial', fiscal_mode: 'electronic' }, 'approved'), null);
  assert.equal(invoiceCollectionError({ status: 'emitida', fiscal_mode: 'legacy' }, null), null);
});
