import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRemissionPayload, normalizeDeliveryItems, validateRemissionDraft } from '../src/services/remissionPayload.js';

const place = { address: 'Av. Central 10', house_number: '10', phone: '021123456',
  department: 1, district: 1, city: 1 };
const input = {
  description: 'Entrega de puertas', reason_code: 1, issuer_responsible_code: 1,
  estimated_km: 12, estimated_invoice_date: '2026-11-30',
  customer: { ...place, ruc: '8000000-1', name: 'Cliente SA' },
  items: [{ description: 'Puerta', code: 'P1', quantity: 2, unit_code: 77 }],
  transport: { type: 1, modality: 1, responsible: 1,
    departure_date: '2026-11-05', delivery_date: '2026-11-05',
    origin: place, destination: place,
    vehicle: { type: 1, make: 'Toyota', document_type: 2, number: 'ABC123' },
    carrier: { type: 2, name: 'Transportes', document_type: 1, document_number: '123456',
      address: 'Av. Central', driver_name: 'Juan', driver_document: '123456', driver_address: 'Av. Central' } },
};

test('remission maps goods and transport without invoice amounts', () => {
  const draft = validateRemissionDraft(input);
  const payload = buildRemissionPayload(draft, { number: '001-002-0000001', receiptId: 'test-1', securityCode: '123456789' });
  assert.equal(payload.tipoDocumento, 7);
  assert.equal(payload.remision.factura, 0);
  assert.equal(payload.items[0].cantidad, 2);
  assert.equal(payload.items[0].precioUnitario, undefined);
  assert.equal(payload.transporte[0].entrega.ciudad, 1);
});

test('remission can associate an approved invoice CDC', () => {
  const draft = validateRemissionDraft({ ...input, invoice_id: 9 });
  const payload = buildRemissionPayload(draft, { number: '001-001-0000002', receiptId: 'test-2',
    securityCode: '123456789', invoiceCdc: '1'.repeat(44) });
  assert.equal(payload.remision.factura, 1);
  assert.equal(payload.documentoAsociado.cdcAsociado, '1'.repeat(44));
  assert.equal(payload.remision.fechaFactura, undefined);
});

test('remission can associate an issued printed invoice without inventing a CDC', () => {
  const draft = validateRemissionDraft({ ...input, invoice_id: 121 });
  const payload = buildRemissionPayload(draft, { number: '001-002-0000003', receiptId: 'test-3',
    securityCode: '123456789', printedInvoice: {
      number: '001-005-0000003', issueDate: '2026-10-27', timbrado: '18954219',
    } });
  assert.equal(payload.remision.factura, 1);
  assert.equal(payload.remision.fechaFactura, undefined);
  assert.deepEqual(payload.documentoAsociado, {
    remision: true, tipoDocumentoAsoc: '2', establecimientoAsoc: '001', puntoAsoc: '005',
    numeroAsoc: '0000003', tipoDocuemntoIm: '1', fechaDocIm: '2026-10-27',
    timbradoAsoc: '18954219',
  });
  assert.equal(payload.documentoAsociado.cdcAsociado, undefined);
});

test('printed invoice association requires its saved tax stamp', () => {
  const draft = validateRemissionDraft({ ...input, invoice_id: 121 });
  assert.throws(() => buildRemissionPayload(draft, { number: '001-002-0000003',
    receiptId: 'test-3', securityCode: '123456789', printedInvoice: {
      number: '001-005-0000003', issueDate: '2026-10-27', timbrado: '',
    } }), /timbrado válidos/);
});

test('missing geographic code does not silently become zero', () => {
  assert.throws(() => validateRemissionDraft({ ...input,
    customer: { ...input.customer, city: '' } }), /ciudad de destinatario/);
});

test('zero department at delivery is rejected before a fiscal number is reserved', () => {
  assert.throws(() => validateRemissionDraft({ ...input, transport: { ...input.transport,
    destination: { ...place, department: 0 } } }), /departamento de entrega/);
});

test('geographic codes must belong to the same department and district', () => {
  assert.throws(() => validateRemissionDraft({ ...input, transport: { ...input.transport,
    destination: { ...place, department: 12 } } }), /no coinciden con el catálogo SIFEN/);
});

test('invalid carrier and driver names are rejected before fiscal numbering', () => {
  assert.throws(() => validateRemissionDraft({ ...input, transport: { ...input.transport,
    carrier: { ...input.transport.carrier, name: '1' } } }), /Nombre del transportista/);
  assert.throws(() => validateRemissionDraft({ ...input, transport: { ...input.transport,
    carrier: { ...input.transport.carrier, driver_name: '1' } } }), /Nombre del chofer/);
});

test('contributor carriers cannot be sent without RUC support', () => {
  assert.throws(() => validateRemissionDraft({ ...input, transport: { ...input.transport,
    carrier: { ...input.transport.carrier, type: 1 } } }), /requiere RUC y dígito verificador/);
});

test('delivery preserves an editable good-condition description per item', () => {
  const draft = validateRemissionDraft(input);
  const rows = normalizeDeliveryItems([{ quantity: 2, condition_status: 'buen_estado',
    condition_description: 'Entregado en buen estado, embalaje intacto' }], draft.items);
  assert.equal(rows[0].condition_description, 'Entregado en buen estado, embalaje intacto');
  assert.equal(rows[0].code, 'P1');
});

test('missing or damaged goods cannot be recorded as received in good condition', () => {
  const draft = validateRemissionDraft(input);
  assert.throws(() => normalizeDeliveryItems([{ quantity: 1, condition_status: 'buen_estado',
    condition_description: 'Entregado en buen estado' }], draft.items), /diferencia de cantidad/);
  assert.throws(() => normalizeDeliveryItems([{ quantity: 0, condition_status: 'con_observaciones',
    condition_description: 'No llegó' }], draft.items), /cantidad y estado/);
});
