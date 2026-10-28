import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBankBook, loadBankBookRows } from '../src/services/bankBook.js';

test('book balance uses registered credits and debits, not imported statements', () => {
  const book = buildBankBook('1000.10', [
    { source_type: 'receipt', credit: '200.20', debit: 0 },
    { source_type: 'payment_order', credit: 0, debit: '50.05' },
  ]);
  assert.equal(book.credits, '200.20');
  assert.equal(book.debits, '50.05');
  assert.equal(book.rows[0].balance, '1200.30');
  assert.equal(book.rows[1].balance, '1150.25');
  assert.equal(book.calculated_balance, '1150.25');
});

test('book accepts negative opening balances and rejects ambiguous entries', () => {
  assert.equal(buildBankBook('-50.00', [{ credit: '75.00', debit: 0 }]).calculated_balance, '25.00');
  assert.throws(() => buildBankBook('0', [{ credit: 10, debit: 10 }]));
});

test('receipt and payment order expose every linked operation once', async () => {
  const conn = { async query(sql) {
    if (sql.includes('FROM receipts r WHERE')) return [[{ source_type: 'receipt', source_id: 7,
      movement_date: '2026-10-27', created_at: '2026-10-27', credit: 50, debit: 0,
      document_number: 'REC-7' }]];
    if (sql.includes('FROM ap_payment_order_payments p JOIN')) return [[{ source_type: 'payment_order',
      source_id: 9, order_id: 4, movement_date: '2026-10-27', created_at: '2026-10-27',
      credit: 0, debit: 20, document_number: 'OP-4' }]];
    if (sql.includes('FROM receipts r') && sql.includes('receipt_applications')) return [[
      { receipt_id: 7, operation_type: 'deal', operation_id: 11, operation_reference: 'OP-000011' },
      { receipt_id: 7, operation_type: 'deal', operation_id: 12, operation_reference: 'OP-000012' },
      { receipt_id: 7, operation_type: 'deal', operation_id: 11, operation_reference: 'OP-000011' },
    ]];
    if (sql.includes('FROM ap_payment_order_items oi')) return [[
      { order_id: 4, operation_type: 'service', operation_id: 22, operation_reference: 'SERV-22' },
    ]];
    return [[]];
  } };
  const rows = await loadBankBookRows(conn, { id: 1, alias: 'Banco', account_number: '123', currency_code: 'USD' }, '2026-01-01');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((row) => row.source_type === 'receipt').operation_links, [
    { type: 'deal', id: 11, reference: 'OP-000011' },
    { type: 'deal', id: 12, reference: 'OP-000012' },
  ]);
  assert.deepEqual(rows.find((row) => row.source_type === 'payment_order').operation_links,
    [{ type: 'service', id: 22, reference: 'SERV-22' }]);
});
