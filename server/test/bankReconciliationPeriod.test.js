import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBankBook } from '../src/services/bankBook.js';
import { bankPeriodFingerprint, periodEnd, reconcileBankBook } from '../src/services/bankReconciliationPeriod.js';

test('reconciliation explains bank difference with pending receipts and payments', () => {
  const book = buildBankBook('1000', [
    { source_type: 'receipt', source_id: 1, credit: '200', debit: 0 },
    { source_type: 'payment_order', source_id: 2, credit: 0, debit: '50' },
  ]);
  const result = reconcileBankBook(book, new Map([['payment_order:2', '2026-10']]), '2026-10', '950');
  assert.equal(result.calculated_balance, '1150.00');
  assert.equal(result.outstanding_credits, '200.00');
  assert.equal(result.outstanding_debits, '0.00');
  assert.equal(result.expected_bank_balance, '950.00');
  assert.equal(result.adjusted_bank_balance, '1150.00');
  assert.equal(result.difference, '0.00');
});

test('later clearing does not change an earlier period and bank fees leave a difference', () => {
  const book = buildBankBook('1000', [{ source_type: 'payment_order', source_id: 2, credit: 0, debit: '50' }]);
  const result = reconcileBankBook(book, new Map([['payment_order:2', '2026-11']]), '2026-10', '990');
  assert.equal(result.outstanding_debits, '50.00');
  assert.equal(result.expected_bank_balance, '1000.00');
  assert.equal(result.difference, '-10.00');
  assert.equal(periodEnd('2028-02'), '2028-02-29');
  assert.throws(() => periodEnd('2026-13'));
});

test('a later clearance does not make a closed earlier month stale', () => {
  const opening = { balance_date: '2026-10-01', amount: '1000.00' };
  const book = buildBankBook('1000', [{ source_type: 'receipt', source_id: 1,
    movement_date: '2026-10-10', credit: '200', debit: 0 }]);
  const october = reconcileBankBook(book, new Map(), '2026-10', '1000.00');
  const afterNovember = reconcileBankBook(book, new Map([['receipt:1', '2026-11']]), '2026-10', '1000.00');
  assert.equal(bankPeriodFingerprint(opening, '1000.00', october.rows),
    bankPeriodFingerprint(opening, '1000.00', afterNovember.rows));
  const changed = buildBankBook('1000', [{ source_type: 'receipt', source_id: 1,
    movement_date: '2026-10-10', credit: '201', debit: 0 }]);
  assert.notEqual(bankPeriodFingerprint(opening, '1000.00', october.rows),
    bankPeriodFingerprint(opening, '1000.00', reconcileBankBook(changed, new Map(), '2026-10', '1000.00').rows));
});
