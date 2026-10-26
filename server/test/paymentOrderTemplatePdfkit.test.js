import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import generatePaymentOrderPDF from '../src/services/paymentOrderTemplatePdfkit.js';

function render(data) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    generatePaymentOrderPDF(data, stream).catch(reject);
  });
}

test('shared payment order template handles many documents across pages', async () => {
  const pdf = await render({
    order_number: 'OPU-000001',
    supplier_name: 'Proveedor de prueba',
    currency_code: 'PYG',
    documents_label: 'DOCUMENTOS',
    document_label: 'COMPROBANTE N°',
    invoices: Array.from({ length: 40 }, (_, index) => ({
      receipt_number: `001-001-${String(index + 1).padStart(7, '0')}`,
      invoice_date: '22/10/2026',
      amount: 100000,
    })),
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 2);
});
