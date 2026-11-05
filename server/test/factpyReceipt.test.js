import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFactpyReceipt, validateFactpyReceiptCurrency } from '../src/services/factpyReceipt.js';

const receipt = {
  status: 'emitido', issue_date: '2026-11-02', payment_method: 'transferencia',
  currency_code: 'USD', amount: 12350,
};
const invoice = (number, amount) => ({
  invoice_number: number, total_amount: amount, amount_applied: amount,
  currency_code: 'USD', exchange_rate: 6500, customer_doc: '80000000-1',
  org_name: 'Cliente de prueba', fiscal_mode: 'electronic', fiscal_status: 'approved',
});
const args = {
  receipt, invoices: [invoice('001-004-0000001', 6500), invoice('001-004-0000002', 5850)],
  number: '001-004-0000001', receiptId: 'atm-mock-receipt-1', securityCode: '000000001',
};

test('FactPy receipt keeps each invoice and converts USD using its exchange rate', () => {
  const payload = buildFactpyReceipt(args);
  assert.equal(payload.tipoDocumento, 0);
  assert.equal(payload.items.length, 2);
  assert.deepEqual(payload.items.map((item) => item.documento), ['001-004-0000001', '001-004-0000002']);
  assert.deepEqual(payload.items.map((item) => item.importePago), [6500, 5850]);
  assert.equal(payload.items[0].metodoPago, 5);
  assert.equal(payload.totalGs, 80275000);
});

test('FactPy receipt rejects unapproved, mismatched, cancelled and overpaid data', () => {
  assert.throws(() => buildFactpyReceipt({ ...args, invoices: [{ ...args.invoices[0], fiscal_status: 'rejected' }] }), /aprobadas/);
  assert.throws(() => buildFactpyReceipt({ ...args, invoices: [args.invoices[0], { ...args.invoices[1], invoice_number: '001-005-0000002' }] }), /distintos puntos/);
  assert.throws(() => buildFactpyReceipt({ ...args, invoices: [args.invoices[0], { ...args.invoices[1], exchange_rate: 6400 }] }), /tipo de cambio/);
  assert.equal(buildFactpyReceipt({ ...args, exchangeRate: 6600,
    invoices: [args.invoices[0], { ...args.invoices[1], exchange_rate: 6400 }] }).totalGs, 81510000);
  assert.throws(() => buildFactpyReceipt({ ...args, receipt: { ...receipt, status: 'anulado' } }), /vigente/);
  assert.throws(() => buildFactpyReceipt({ ...args, invoices: [{ ...args.invoices[0], amount_applied: 7000 }] }), /Revisá la factura/);
});

test('FactPy receipt requires a cheque number', () => {
  assert.throws(() => buildFactpyReceipt({ ...args, receipt: { ...receipt, payment_method: 'cheque' } }), /número de referencia/);
});

test('FactPy Test blocks USD receipts until the provider confirms their currency format', () => {
  const payload = buildFactpyReceipt(args);
  assert.throws(() => validateFactpyReceiptCurrency('test', payload), /recibos USD queda suspendido/);
  assert.doesNotThrow(() => validateFactpyReceiptCurrency('mock', payload));
  assert.doesNotThrow(() => validateFactpyReceiptCurrency('test', { ...payload, moneda: 'PYG' }));
});
