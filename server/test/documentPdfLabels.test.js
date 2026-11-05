import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceKind, invoicePdfTitle, receiptPdfTitle, sameInvoiceKind } from '../src/services/documentPdfLabels.js';

test('legacy and electronic invoices have distinct PDF labels', () => {
  assert.equal(invoiceKind(undefined), 'legacy');
  assert.equal(invoicePdfTitle('legacy', 'emitida'), 'FACTURA AUTOIMPRESA NRO');
  assert.equal(invoicePdfTitle('electronic', 'emitida'), 'FACTURA ELECTRONICA NRO');
  assert.equal(invoicePdfTitle('legacy', 'borrador'), 'BORRADOR DE FACTURA AUTOIMPRESA');
});

test('receipt label follows the associated invoices and preserves mixed history', () => {
  assert.equal(receiptPdfTitle(['legacy']), 'RECIBO DE FACTURA AUTOIMPRESA NRO');
  assert.equal(receiptPdfTitle(['electronic', 'electronic']), 'RECIBO DE FACTURA ELECTRONICA NRO');
  assert.equal(receiptPdfTitle(['legacy', 'electronic']), 'RECIBO DE FACTURAS MIXTAS NRO');
  assert.equal(sameInvoiceKind(['legacy', undefined]), true);
  assert.equal(sameInvoiceKind(['electronic', 'electronic']), true);
  assert.equal(sameInvoiceKind(['legacy', 'electronic']), false);
});
