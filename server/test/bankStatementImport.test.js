import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { assertBankPaymentMatch, normalizeStatement, parseBankAmount, parseBankDate, readStatement } from '../src/services/bankStatementImport.js';

test('reads semicolon CSV and normalizes bank movements', async () => {
  const file = Buffer.from('Fecha;Concepto;Referencia;Debito;Credito\n22/10/2026;Pago proveedor;TR-15;1.234.567,89;\n23/10/2026;Cobro cliente;CO-1;;2.500,00\n');
  const rows = await readStatement(file, 'extracto.csv');
  const movements = normalizeStatement(rows, { date: 0, description: 1, reference: 2, debit: 3, credit: 4 });
  assert.equal(movements[0].date, '2026-10-22');
  assert.equal(movements[0].debit, 123456789);
  assert.equal(movements[1].credit, 250000);
  assert.notEqual(movements[0].fingerprint, movements[1].fingerprint);
});

test('handles signed amounts, Excel dates and repeated legitimate rows', () => {
  assert.equal(parseBankAmount('-1,234.50'), -123450);
  assert.equal(parseBankAmount('1.234,50'), 123450);
  assert.equal(parseBankDate('22/10/2026'), '2026-10-22');
  const rows = [['Date', 'Description', 'Amount'], ['2026-10-22', 'Fee', '-100.00'], ['2026-10-22', 'Fee', '-100.00']];
  const movements = normalizeStatement(rows, { date: 0, description: 1, amount: 2 });
  assert.equal(movements[0].debit, 10000);
  assert.notEqual(movements[0].fingerprint, movements[1].fingerprint);
});

test('reads an Excel statement without changing its values', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Movimientos');
  sheet.addRow(['Fecha', 'Concepto', 'Débito', 'Crédito']);
  sheet.addRow([new Date('2026-10-22T00:00:00Z'), 'Proveedor', 1500.25, null]);
  const rows = await readStatement(Buffer.from(await workbook.xlsx.writeBuffer()), 'extracto.xlsx');
  const [movement] = normalizeStatement(rows, { date: 0, description: 1, debit: 2, credit: 3 });
  assert.equal(movement.date, '2026-10-22');
  assert.equal(movement.debit, 150025);
});

test('rejects ambiguous amounts and impossible dates', () => {
  assert.throws(() => parseBankDate('31/02/2026'));
  assert.throws(() => normalizeStatement([['Date', 'Description', 'Debit', 'Credit'], ['2026-10-22', 'Error', '1', '1']],
    { date: 0, description: 1, debit: 2, credit: 3 }));
});

test('only an exact debit from the same account and currency can reconcile', () => {
  const account = { alias: 'Itaú Gs', account_number: '123', currency_code: 'PYG' };
  const payment = { company_account: 'Itaú Gs', currency_code: 'PYG', amount: 1200 };
  assert.doesNotThrow(() => assertBankPaymentMatch({ debit_amount: 1200 }, payment, account));
  assert.throws(() => assertBankPaymentMatch({ debit_amount: 1199 }, payment, account));
  assert.throws(() => assertBankPaymentMatch({ debit_amount: 1200 }, { ...payment, company_account: 'Otra' }, account));
  assert.throws(() => assertBankPaymentMatch({ debit_amount: 1200 }, { ...payment, currency_code: 'USD' }, account));
  assert.throws(() => assertBankPaymentMatch({ credit_amount: 1200, debit_amount: 0 }, payment, account));
});
