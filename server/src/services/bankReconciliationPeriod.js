function cents(value) {
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result)) throw new Error('Importe de conciliación inválido');
  return result;
}

const money = (value) => (value / 100).toFixed(2);

export function periodEnd(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ''))) {
    throw Object.assign(new Error('Seleccione un mes válido'), { statusCode: 400 });
  }
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function reconcileBankBook(book, clearances, period, bankBalance) {
  let outstandingCredits = 0;
  let outstandingDebits = 0;
  const rows = book.rows.map((row) => {
    const clearedPeriod = clearances.get(`${row.source_type}:${row.source_id}`) || null;
    const cleared = Boolean(clearedPeriod && clearedPeriod <= period);
    if (!cleared) {
      outstandingCredits += cents(row.credit);
      outstandingDebits += cents(row.debit);
    }
    return { ...row, cleared, cleared_period: clearedPeriod };
  });
  const adjustedBank = bankBalance == null ? null
    : cents(bankBalance) + outstandingCredits - outstandingDebits;
  const difference = adjustedBank == null ? null : adjustedBank - cents(book.calculated_balance);
  const expectedBank = cents(book.calculated_balance) - outstandingCredits + outstandingDebits;
  return {
    ...book, rows,
    outstanding_credits: money(outstandingCredits),
    outstanding_debits: money(outstandingDebits),
    outstanding_count: rows.filter((row) => !row.cleared).length,
    expected_bank_balance: money(expectedBank),
    adjusted_bank_balance: adjustedBank == null ? null : money(adjustedBank),
    difference: difference == null ? null : money(difference),
  };
}
import { createHash } from 'node:crypto';


export function bankPeriodFingerprint(opening, bankBalance, rows) {
  return createHash('sha256').update(JSON.stringify({
    opening: [opening.balance_date, opening.amount], bank_balance: bankBalance,
    rows: rows.map((row) => [row.source_type, row.source_id, row.movement_date,
      row.credit, row.debit, row.cleared ? row.cleared_period : null]),
  })).digest('hex');
}
