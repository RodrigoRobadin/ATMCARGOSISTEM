import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBankTransfer } from '../src/services/bankTransfers.js';
import { buildBankBook } from '../src/services/bankBook.js';

const from = { currency_code: 'USD' };
const to = { currency_code: 'USD' };

test('transfer creates equal opposite book effects without company-wide cash movement', () => {
  const transfer = normalizeBankTransfer({ from_account_param_id: 1, to_account_param_id: 2,
    movement_date: '2026-10-27', amount: '125.50', observations: 'Reserva' }, from, to);
  const outgoing = buildBankBook('200.00', [{ credit: 0, debit: transfer.amount }]);
  const incoming = buildBankBook('100.00', [{ credit: transfer.amount, debit: 0 }]);
  assert.equal(outgoing.calculated_balance, '74.50');
  assert.equal(incoming.calculated_balance, '225.50');
  assert.equal(Number(outgoing.calculated_balance) + Number(incoming.calculated_balance), 300);
  assert.equal(transfer.observations, 'Reserva');
});

test('transfer rejects same account, mixed currencies and invalid amounts', () => {
  const base = { from_account_param_id: 1, to_account_param_id: 2, movement_date: '2026-10-27', amount: '1.00' };
  assert.throws(() => normalizeBankTransfer({ ...base, to_account_param_id: 1 }, from, to));
  assert.throws(() => normalizeBankTransfer(base, from, { currency_code: 'PYG' }));
  assert.throws(() => normalizeBankTransfer({ ...base, amount: '0' }, from, to));
  assert.throws(() => normalizeBankTransfer({ ...base, movement_date: '2026-02-30' }, from, to));
});
