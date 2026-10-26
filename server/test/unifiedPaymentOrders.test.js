import test from 'node:test';
import assert from 'node:assert/strict';
import { availableCents, cents, duplicateSupplierDocument, validatePaymentMethod, validateSelection } from '../src/services/unifiedPaymentOrders.js';

test('payment order stores only supported planned methods', () => {
  assert.equal(validatePaymentMethod('Transferencia'), 'Transferencia');
  assert.equal(validatePaymentMethod('Tarjeta'), 'Tarjeta');
  assert.throws(() => validatePaymentMethod(''), /método de pago/);
  assert.throws(() => validatePaymentMethod('Criptomoneda'), /método de pago/);
});

test('money is compared in cents and reservations reduce only available balance', () => {
  assert.equal(cents('125.55'), 12555);
  assert.equal(availableCents('200.00', '75.25'), 12475);
  assert.equal(availableCents('10.00', '20.00'), 0);
});

test('a mixed-origin order accepts distinct documents with positive amounts', () => {
  const items = validateSelection([
    { source_type: 'admin-expense', source_id: 3, amount: '50.00' },
    { source_type: 'purchase-invoice', source_id: 4, amount: '100.00' },
    { source_type: 'operation-expense', source_id: 5, amount: '25.25' },
  ]);
  assert.equal(items.length, 3);
  assert.equal(items.reduce((total, item) => total + item.amount, 0), 17525);
});

test('selection rejects duplicates, unsupported sources and invalid amounts', () => {
  assert.throws(() => validateSelection([
    { source_type: 'purchase-invoice', source_id: 4, amount: 1 },
    { source_type: 'purchase-invoice', source_id: 4, amount: 2 },
  ]), /repetido/);
  assert.throws(() => validateSelection([{ source_type: 'other', source_id: 1, amount: 1 }]), /inválido/);
  assert.throws(() => validateSelection([{ source_type: 'admin-expense', source_id: 1, amount: 0 }]), /inválido/);
});

test('same supplier invoice number in another module is flagged', async () => {
  const conn = { query: async () => [[
    { source_type: 'purchase-invoice', source_id: 4 },
    { source_type: 'admin-expense', source_id: 9 },
  ]] };
  const duplicate = await duplicateSupplierDocument(conn, 12, '001-001-123', 'purchase-invoice', 4);
  assert.deepEqual(duplicate, { source_type: 'admin-expense', source_id: 9 });
});
