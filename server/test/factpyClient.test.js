import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoicePayload, buildCreditNotePayload, createFactpyClient, factpyMode, canRetryTestDocument, canRetryProductionDuplicate, cancellationResult, canRetryTestCancellation } from '../src/services/factpyClient.js';

test('cancellation requires an explicit boolean result from FactPy', () => {
  assert.equal(cancellationResult({ status: true, code: 'Evento registrado correctamente' }), 'approved');
  assert.equal(cancellationResult({ status: false, code: 'CDC inválido' }), 'rejected');
  assert.equal(cancellationResult({ status: 'true' }), 'review');
  assert.equal(cancellationResult({ code: 'Evento registrado correctamente' }), 'review');
  assert.equal(cancellationResult(null), 'review');
});

test('manual event retry is limited to a missing Test endpoint response', () => {
  assert.equal(canRetryTestCancellation({ status: 'review', message: 'FactPy respondió HTTP 404' }), true);
  assert.equal(canRetryTestCancellation({ status: 'review', message: 'Unexpected token \'<\', "<br />\n<b>"... is not valid JSON' }), true);
  assert.equal(canRetryTestCancellation({ status: 'review', message: 'Respuesta de red incierta' }), false);
  assert.equal(canRetryTestCancellation({ status: 'confirmed', message: 'FactPy respondió HTTP 404' }), false);
  assert.equal(canRetryTestCancellation({ status: 'rejected', message: 'FactPy respondió HTTP 404' }), false);
  assert.equal(canRetryTestCancellation(null), false);
});

test('FactPy Test cancellation sends the event and returns its definitive response', async () => {
  const previousFetch = globalThis.fetch;
  const previousRecordId = process.env.FACTPY_RECORD_ID;
  const previousEventPath = process.env.FACTPY_EVENT_PATH;
  const previousEventJsonField = process.env.FACTPY_EVENT_JSON_FIELD;
  try {
    process.env.FACTPY_RECORD_ID = 'test-record';
    delete process.env.FACTPY_EVENT_PATH;
    delete process.env.FACTPY_EVENT_JSON_FIELD;
    let accepted = true;
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).pathname, '/facturacion-api/eventos.php');
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('recordID'), 'test-record');
      assert.deepEqual(JSON.parse(options.body.get('datajson')), {
        tipoEvento: 2, cdc: '1'.repeat(44), motivo: 'Error de prueba',
      });
      assert.equal(options.body.get('dataJson'), null);
      return Response.json({ status: accepted, code: accepted ? 'Evento registrado correctamente' : 'CDC inválido' });
    };
    const client = createFactpyClient('test');
    assert.equal(cancellationResult(await client.cancel('1'.repeat(44), 'Error de prueba')), 'approved');
    accepted = false;
    assert.equal(cancellationResult(await client.cancel('1'.repeat(44), 'Error de prueba')), 'rejected');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRecordId === undefined) delete process.env.FACTPY_RECORD_ID;
    else process.env.FACTPY_RECORD_ID = previousRecordId;
    if (previousEventPath === undefined) delete process.env.FACTPY_EVENT_PATH;
    else process.env.FACTPY_EVENT_PATH = previousEventPath;
    if (previousEventJsonField === undefined) delete process.env.FACTPY_EVENT_JSON_FIELD;
    else process.env.FACTPY_EVENT_JSON_FIELD = previousEventJsonField;
  }
});

test('FactPy Test event path and JSON field can be selected without an automatic retry', async () => {
  const previousFetch = globalThis.fetch;
  const previousRecordId = process.env.FACTPY_RECORD_ID;
  const previousEventPath = process.env.FACTPY_EVENT_PATH;
  const previousEventJsonField = process.env.FACTPY_EVENT_JSON_FIELD;
  try {
    process.env.FACTPY_RECORD_ID = 'test-record';
    process.env.FACTPY_EVENT_PATH = 'evento/';
    process.env.FACTPY_EVENT_JSON_FIELD = 'dataJson';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls += 1;
      assert.equal(new URL(url).pathname, '/facturacion-api/evento/');
      assert.deepEqual(JSON.parse(options.body.get('dataJson')), {
        tipoEvento: 2, cdc: '1'.repeat(44), motivo: 'Error de prueba',
      });
      assert.equal(options.body.get('datajson'), null);
      return Response.json({ status: false, code: 'CDC no existente en el SIFEN' });
    };
    const response = await createFactpyClient('test').cancel('1'.repeat(44), 'Error de prueba');
    assert.equal(cancellationResult(response), 'rejected');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRecordId === undefined) delete process.env.FACTPY_RECORD_ID;
    else process.env.FACTPY_RECORD_ID = previousRecordId;
    if (previousEventPath === undefined) delete process.env.FACTPY_EVENT_PATH;
    else process.env.FACTPY_EVENT_PATH = previousEventPath;
    if (previousEventJsonField === undefined) delete process.env.FACTPY_EVENT_JSON_FIELD;
    else process.env.FACTPY_EVENT_JSON_FIELD = previousEventJsonField;
  }
});

const base = {
  organization: { razon_social: 'Cliente de prueba', ruc: '80012345-6' },
  invoice: { customer_doc: '80012345-6', currency_code: 'PYG', total_amount: 110,
    payment_condition: 'contado', fiscal_transaction_type: 2, fiscal_payment_method: 1 },
  items: [{ description: 'Servicio', quantity: 1, unit_price: 110, subtotal: 110, tax_rate: 10 }],
  number: '001-001-0000001', receiptId: 'atm-mock-invoice-1', securityCode: '123456789',
};

test('electronic invoice maps persisted totals and tax without issuing', () => {
  const payload = buildInvoicePayload(base);
  assert.equal(payload.tipoDocumento, 1);
  assert.equal(payload.totalPago, 110);
  assert.equal(payload.totalGs, undefined);
  assert.equal(payload.items[0].baseGravItem, 100);
  assert.equal(payload.items[0].liqIvaItem, 10);
  assert.equal(payload.receiptid, 'atm-mock-invoice-1');
});

test('USD invoices send totalGs using the saved exchange rate', () => {
  for (const paymentCondition of ['contado', 'credito']) {
    const payload = buildInvoicePayload({ ...base, invoice: {
      ...base.invoice, currency_code: 'USD', exchange_rate: 6000,
      total_amount: 7634.27, payment_condition: paymentCondition, payment_terms: '30 dias',
    }, items: [{ description: 'Puerta rápida', quantity: 1, unit_price: 7634.27,
      subtotal: 7634.27, tax_rate: 10 }] });
    assert.equal(payload.moneda, 'USD');
    assert.equal(payload.cambio, 6000);
    assert.equal(payload.totalPago, 7634.27);
    assert.equal(payload.totalGs, 45805620);
  }
});

test('credit invoice requires a short payment term', () => {
  assert.throws(() => buildInvoicePayload({ ...base, invoice: {
    ...base.invoice, payment_condition: 'credito', payment_terms: 'un plazo demasiado largo',
  } }), /plazo de crédito/);
});

test('credit note requires approved parent CDC and keeps its own amount', () => {
  const note = { total_amount: 55, reason: 'Devolución' };
  const args = { ...base, invoice: { ...base.invoice, total_amount: 110 }, note,
    items: [{ description: 'Devolución parcial', quantity: 1, unit_price: 55, subtotal: 55, tax_rate: 10 }],
    invoiceCdc: '1'.repeat(44) };
  const payload = buildCreditNotePayload(args);
  assert.equal(payload.tipoDocumento, 5);
  assert.equal(payload.condicionPago, 1);
  assert.equal(payload.documentoAsociado.cdcAsociado, '1'.repeat(44));
  assert.equal(payload.totalPago, -55);
  assert.throws(() => buildCreditNotePayload({ ...args, invoiceCdc: null }), /CDC aprobado/);
});

test('USD credit note carries a negative guarani total at the saved exchange rate', () => {
  const payload = buildCreditNotePayload({ ...base,
    invoice: { ...base.invoice, currency_code: 'USD', exchange_rate: 6000, total_amount: 6500 },
    note: { total_amount: 650, reason: 'Descuento parcial' },
    items: [{ description: 'Descuento', quantity: 1, unit_price: 650, subtotal: 650, tax_rate: 10 }],
    invoiceCdc: '1'.repeat(44),
  });
  assert.equal(payload.totalPago, -650);
  assert.equal(payload.totalGs, -3900000);
  assert.deepEqual(payload.pagos, [{ tipoPago: '1', monto: -650 }]);
});

test('mock scenarios allow approval, rejection, delay, and uncertain network outcome', async () => {
  const client = createFactpyClient('mock');
  const payload = buildInvoicePayload(base);
  const sent = await client.send(payload, 'approved');
  assert.equal(sent.status, true);
  assert.equal((await client.check(payload.receiptid, 'approved')).state, 'approved');
  assert.equal((await client.check(payload.receiptid, 'rejected')).state, 'rejected');
  assert.equal((await client.check(payload.receiptid, 'delayed', 0)).state, 'processing');
  assert.equal((await client.check(payload.receiptid, 'delayed', 1)).state, 'approved');
  await assert.rejects(() => client.send(payload, 'uncertain'), /incierta/);
  assert.equal((await client.check(payload.receiptid, 'uncertain')).state, 'approved');
  assert.equal((await client.check(payload.receiptid, 'network_error')).state, 'review');
});

test('FactPy Test status request uses the datajson field accepted by the API', async () => {
  const previousFetch = globalThis.fetch;
  const previousRecordId = process.env.FACTPY_RECORD_ID;
  try {
    process.env.FACTPY_RECORD_ID = 'test-record';
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).pathname, '/facturacion-api/estadoDE.php');
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('recordID'), 'test-record');
      assert.deepEqual(JSON.parse(options.body.get('datajson')), { receiptid: ['test-receipt'] });
      assert.equal(options.body.get('receiptid'), null);
      return Response.json([{ receiptid: 'test-receipt', estado: 'Aprobado', cdc: '1'.repeat(44) }]);
    };
    assert.equal((await createFactpyClient('test').check('test-receipt')).state, 'approved');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRecordId === undefined) delete process.env.FACTPY_RECORD_ID;
    else process.env.FACTPY_RECORD_ID = previousRecordId;
  }
});

test('FactPy Test sends datajson to data.php and identifies missing receipts', async () => {
  const previousFetch = globalThis.fetch;
  const previousRecordId = process.env.FACTPY_RECORD_ID;
  try {
    process.env.FACTPY_RECORD_ID = 'test-record';
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).pathname, '/facturacion-api/data.php');
      assert.equal(options.body.get('recordID'), 'test-record');
      assert.equal(JSON.parse(options.body.get('datajson')).receiptid, base.receiptId);
      assert.equal(options.body.get('dataJson'), null);
      return Response.json({ status: true, cdc: '1'.repeat(44) });
    };
    const client = createFactpyClient('test');
    assert.equal((await client.send(buildInvoicePayload(base))).status, true);
    globalThis.fetch = async () => Response.json([{
      receiptid: base.receiptId, estado: 'No encontrado', mensaje: 'No se encontraron datos',
    }]);
    assert.equal((await client.check(base.receiptId)).notFound, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRecordId === undefined) delete process.env.FACTPY_RECORD_ID;
    else process.env.FACTPY_RECORD_ID = previousRecordId;
  }
});

test('a missing receipt is checked with FactPy documented status field before review', async () => {
  const previousFetch = globalThis.fetch;
  const previousRecordId = process.env.FACTPY_RECORD_ID;
  try {
    process.env.FACTPY_RECORD_ID = 'test-record';
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      assert.equal(options.body.get('recordID'), 'test-record');
      if (calls === 1) {
        assert.deepEqual(JSON.parse(options.body.get('datajson')), { receiptid: ['remission-1'] });
        return Response.json([{ receiptid: 'remission-1', estado: 'No encontrado' }]);
      }
      assert.deepEqual(JSON.parse(options.body.get('receiptid')), { receiptid: ['remission-1'] });
      assert.equal(options.body.get('datajson'), null);
      return Response.json([{ receiptid: 'remission-1', estado: 'Aprobado', cdc: '1'.repeat(44), documento: '001-002-0000002' }]);
    };
    const result = await createFactpyClient('test').check('remission-1');
    assert.equal(calls, 2);
    assert.equal(result.state, 'approved');
    assert.equal(result.number, '001-002-0000002');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRecordId === undefined) delete process.env.FACTPY_RECORD_ID;
    else process.env.FACTPY_RECORD_ID = previousRecordId;
  }
});

test('one-time production check accepts datajson not-found only when alternate format is explicitly unsupported', async () => {
  const previousFetch = globalThis.fetch;
  const previousRecordId = process.env.FACTPY_RECORD_ID;
  const previousMode = process.env.FACTPY_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnabled = process.env.FACTPY_PRODUCTION_ENABLED;
  const previousEstablishment = process.env.FACTPY_ESTABLISHMENT;
  try {
    process.env.FACTPY_RECORD_ID = 'production-record';
    process.env.FACTPY_MODE = 'production';
    process.env.NODE_ENV = 'production';
    process.env.FACTPY_PRODUCTION_ENABLED = '1';
    process.env.FACTPY_ESTABLISHMENT = '001';
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      if (calls % 2 === 1) {
        assert.ok(options.body.get('datajson'));
        return Response.json([{ receiptid: 'atm-production-invoice-117', estado: 'No encontrado' }]);
      }
      assert.ok(options.body.get('receiptid'));
      return Response.json({ error: 'El parámetro recordID y datajson son obligatorios.' });
    };
    const client = createFactpyClient('production');
    assert.equal((await client.check('atm-production-invoice-117')).notFound, undefined);
    assert.equal((await client.check('atm-production-invoice-117', undefined, 0,
      { acceptUnsupportedDocumentedFormat: true })).notFound, true);
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries({ FACTPY_RECORD_ID: previousRecordId, FACTPY_MODE: previousMode,
      NODE_ENV: previousNodeEnv, FACTPY_PRODUCTION_ENABLED: previousEnabled,
      FACTPY_ESTABLISHMENT: previousEstablishment })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('FactPy Test exposes an invalid status request without allowing a resend', async () => {
  const previousFetch = globalThis.fetch;
  const previousRecordId = process.env.FACTPY_RECORD_ID;
  try {
    process.env.FACTPY_RECORD_ID = 'test-record';
    globalThis.fetch = async () => Response.json({ error: 'El parámetro recordID y datajson son obligatorios.' });
    const result = await createFactpyClient('test').check('test-receipt');
    assert.equal(result.state, 'review');
    assert.equal(result.notFound, undefined);
    assert.match(result.message, /recordID y datajson/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRecordId === undefined) delete process.env.FACTPY_RECORD_ID;
    else process.env.FACTPY_RECORD_ID = previousRecordId;
  }
});

test('manual retry permits uncertain and selected configuration failures in Test', () => {
  assert.equal(canRetryTestDocument({ status: 'review' }), true);
  assert.equal(canRetryTestDocument({ status: 'rejected', error_message: 'ERROR - Falta certificado de firma para continuar..' }), true);
  assert.equal(canRetryTestDocument({ status: 'rejected', error_message: 'ERROR - No existe el recordID, verifique!!' }), true);
  assert.equal(canRetryTestDocument({ status: 'rejected', error_message: 'JSON inválido: Syntax error | Log guardado como json_error_2026-10-26_10-31-50.txt' }), true);
  assert.equal(canRetryTestDocument({ status: 'review', cdc: '1'.repeat(44) }), false);
  assert.equal(canRetryTestDocument({ status: 'review', kude_url: 'https://api.factpy.com/kude/example' }), false);
  assert.equal(canRetryTestDocument({ status: 'rejected', error_message: 'XML rechazado por SIFEN' }), false);
  assert.equal(canRetryTestDocument({ status: 'approved' }), false);
});

test('production retry is limited to the explicitly permitted duplicate receipt without fiscal artifacts', () => {
  const row = { environment: 'production', receipt_id: 'atm-production-invoice-117',
    status: 'rejected', attempt_count: 1, error_message: 'ERROR - Documento electrónico duplicado..' };
  assert.equal(canRetryProductionDuplicate(row, row.receipt_id), true);
  assert.equal(canRetryProductionDuplicate(row, 'atm-production-invoice-118'), false);
  assert.equal(canRetryProductionDuplicate({ ...row, status: 'approved' }, row.receipt_id), false);
  assert.equal(canRetryProductionDuplicate({ ...row, attempt_count: 2 }, row.receipt_id), false);
  assert.equal(canRetryProductionDuplicate({ ...row, cdc: '1'.repeat(44) }, row.receipt_id), false);
  assert.equal(canRetryProductionDuplicate({ ...row, error_message: 'XML rechazado' }, row.receipt_id), false);
});

test('production requires an explicit enable flag and complete fiscal configuration', () => {
  const keys = ['FACTPY_MODE', 'NODE_ENV', 'FACTPY_PRODUCTION_ENABLED', 'FACTPY_RECORD_ID', 'FACTPY_ESTABLISHMENT'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.FACTPY_MODE = 'test';
    process.env.NODE_ENV = 'production';
    assert.equal(factpyMode(), null);
    assert.throws(() => createFactpyClient('test'), /deshabilitado/);
    process.env.FACTPY_MODE = 'production';
    delete process.env.FACTPY_PRODUCTION_ENABLED;
    assert.equal(factpyMode(), null);
    process.env.FACTPY_PRODUCTION_ENABLED = '1';
    delete process.env.FACTPY_RECORD_ID;
    assert.equal(factpyMode(), null);
    process.env.FACTPY_RECORD_ID = 'production-record';
    delete process.env.FACTPY_ESTABLISHMENT;
    assert.equal(factpyMode(), null);
    process.env.FACTPY_ESTABLISHMENT = '001';
    assert.equal(factpyMode(), 'production');
    assert.ok(createFactpyClient('production'));
    process.env.NODE_ENV = 'development';
    assert.equal(factpyMode(), null);
    assert.throws(() => createFactpyClient('production'), /deshabilitado/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
