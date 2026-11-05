import { createHash } from 'node:crypto';

const ALLOWED_MODES = new Set(['mock', 'test']);
const MOCK_SCENARIOS = new Set(['approved', 'rejected', 'delayed', 'network_error', 'uncertain']);

export function factpyMode() {
  const mode = String(process.env.FACTPY_MODE || '').toLowerCase();
  return process.env.NODE_ENV === 'production' || !ALLOWED_MODES.has(mode) ? null : mode;
}

export function mockScenario(value) {
  return MOCK_SCENARIOS.has(value) ? value : 'approved';
}

export function canRetryTestDocument(row) {
  if (row?.cdc || row?.kude_url || row?.xml_url) return false;
  return row?.status === 'review' ||
    (row?.status === 'rejected' && /^(?:ERROR - Falta certificado de firma|ERROR - No existe el recordID|JSON inválido: Syntax error)/i.test(String(row.error_message || '')));
}

export function cancellationResult(response) {
  if (response?.status === true) return 'approved';
  if (response?.status === false) return 'rejected';
  return 'review';
}

export function canRetryTestCancellation(event) {
  const message = String(event?.message || '');
  return event?.status === 'review' && (
    message === 'FactPy respondió HTTP 404' ||
    /^Unexpected token '<',[\s\S]*is not valid JSON$/.test(message)
  );
}

export function fiscalDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

function fail(message) {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function mapItems(items, negative = false) {
  if (!items?.length) fail('El documento no tiene ítems');
  return items.map((item, index) => {
    const quantity = Number(item.quantity);
    const gross = Number(item.subtotal);
    const unitPrice = Number(item.unit_price);
    const rate = Number(item.tax_rate);
    if (!item.description?.trim() || !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(unitPrice) || unitPrice <= 0 ||
        !Number.isFinite(gross) || gross <= 0 || ![0, 5, 10].includes(rate)) {
      fail(`Revisá descripción, cantidad, importe e IVA del ítem ${index + 1}`);
    }
    const base = rate ? gross / (1 + rate / 100) : gross;
    const sign = negative ? -1 : 1;
    return {
      descripcion: String(item.description).trim(),
      codigo: String(item.source_item_key || item.id || index + 1).slice(0, 50),
      unidadMedida: 77,
      ivaTasa: rate,
      ivaAfecta: rate ? 1 : 3,
      cantidad: sign * quantity,
      precioUnitario: money(unitPrice),
      precioTotal: sign * money(gross),
      baseGravItem: sign * Number(base.toFixed(8)),
      liqIvaItem: sign * Number((gross - base).toFixed(8)),
    };
  });
}

function commonPayload({ invoice, organization, number, receiptId, securityCode }) {
  const ruc = String(invoice.customer_doc || organization?.ruc || '').trim();
  const name = String(organization?.razon_social || organization?.name || '').trim();
  const currency = String(invoice.currency_code || '').toUpperCase().replace('GS', 'PYG');
  const exchange = Number(invoice.exchange_rate);
  if (!ruc || !name) fail('Completá el RUC y la razón social del cliente');
  if (!['PYG', 'USD'].includes(currency)) fail('Solo se admiten PYG y USD en esta prueba');
  if (currency !== 'PYG' && (!Number.isFinite(exchange) || exchange <= 0)) {
    fail('Falta el tipo de cambio de la factura');
  }
  if (!/^\d{3}-\d{3}-\d{7}$/.test(number)) fail('Número fiscal inválido');
  const [establishment, point, sequence] = number.split('-');
  return {
    fecha: fiscalDateTime(), establecimiento: establishment, punto: point,
    numero: sequence, tipoEmision: 1, receiptid: receiptId,
    moneda: currency, cambio: currency === 'PYG' ? 0 : exchange,
    codigoSeguridadAleatorio: securityCode,
    cliente: {
      ruc, nombre: name, direccion: invoice.customer_address || organization?.address || 'N/A',
      cpais: 'PRY',
      correo: invoice.customer_email || organization?.email || undefined,
      numCasa: 0, diplomatico: false, dncp: 0,
    },
  };
}

export function buildInvoicePayload(args) {
  const { invoice, items } = args;
  const payload = commonPayload(args);
  const transactionType = Number(invoice.fiscal_transaction_type);
  if (![1, 2, 3].includes(transactionType)) fail('Seleccioná el tipo de transacción fiscal');
  const mapped = mapItems(items);
  const total = money(mapped.reduce((sum, item) => sum + item.precioTotal, 0));
  if (Math.abs(total - money(invoice.total_amount)) > 0.02) fail('El total de los ítems no coincide con la factura');
  const totalGs = payload.moneda === 'USD' ? Math.round(total * payload.cambio) : null;
  if (totalGs !== null && (!Number.isSafeInteger(totalGs) || totalGs <= 0)) {
    fail('El total en guaraníes de la factura es inválido');
  }
  const credit = String(invoice.payment_condition || '').toLowerCase() === 'credito';
  const terms = String(invoice.payment_terms || '').trim();
  if (credit && (!terms || terms.length > 10)) fail('El plazo de crédito debe tener entre 1 y 10 caracteres');
  const paymentMethod = Number(invoice.fiscal_payment_method);
  if (!credit && (!Number.isInteger(paymentMethod) || paymentMethod <= 0)) {
    fail('Seleccioná el método de pago para la factura de contado');
  }
  return {
    ...payload, tipoDocumento: 1, tipoTransaccion: transactionType,
    condicionPago: credit ? 2 : 1,
    items: mapped,
    pagos: credit ? [{}] : [{ tipoPago: String(paymentMethod), monto: total }],
    ...(credit ? { credito: { condicionCredito: 1, descripcion: terms } } : {}),
    ...(totalGs !== null ? { totalGs } : {}),
    totalPago: total, totalRedondeo: 0,
  };
}

export function buildCreditNotePayload(args) {
  const { invoice, note, items, invoiceCdc } = args;
  if (!/^\d{44}$/.test(String(invoiceCdc || ''))) fail('La factura asociada no tiene un CDC aprobado');
  const payload = commonPayload(args);
  const mapped = mapItems(items, true);
  const total = money(mapped.reduce((sum, item) => sum + item.precioTotal, 0));
  if (Math.abs(-total - money(note.total_amount)) > 0.02) fail('El total de la nota no coincide con sus ítems');
  const totalGs = payload.moneda === 'USD' ? Math.round(total * payload.cambio) : null;
  if (totalGs !== null && (!Number.isSafeInteger(totalGs) || totalGs >= 0)) {
    fail('El total en guaraníes de la nota es inválido');
  }
  return {
    ...payload, tipoDocumento: 5,
    tipoTransaccion: Number(invoice.fiscal_transaction_type),
    condicionPago: 1,
    descripcion: String(note.reason || 'Nota de crédito'),
    documentoAsociado: { remision: false, tipoDocumentoAsoc: '1', cdcAsociado: invoiceCdc },
    items: mapped, pagos: [{ tipoPago: '1', monto: total }],
    ...(totalGs !== null ? { totalGs } : {}),
    totalPago: total, totalRedondeo: 0,
  };
}

function fakeCdc(receiptId) {
  const hex = createHash('sha256').update(receiptId).digest('hex');
  return (BigInt(`0x${hex}`) % (10n ** 44n)).toString().padStart(44, '0');
}

function checkedUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const trusted = url.hostname === 'factpy.com' || url.hostname.endsWith('.factpy.com');
    return url.protocol === 'https:' && trusted ? url.toString() : null;
  } catch {
    return null;
  }
}

async function postFactpy(path, fields) {
  const url = new URL(path, 'https://api.factpy.com/facturacion-api/');
  if (url.hostname !== 'api.factpy.com' || url.protocol !== 'https:') throw new Error('Destino FactPy inválido');
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const response = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`FactPy respondió HTTP ${response.status}`);
  return response.json();
}

export function createFactpyClient(mode = factpyMode()) {
  if (!mode) throw new Error('FactPy está deshabilitado en este entorno');
  const recordID = process.env.FACTPY_RECORD_ID;
  if (mode === 'test' && !recordID) throw new Error('Falta FACTPY_RECORD_ID');
  return {
    async send(payload, scenario) {
      if (mode === 'mock') {
        if (scenario === 'network_error' || scenario === 'uncertain') throw new Error('Respuesta de red incierta (simulada)');
        return { status: true, cdc: fakeCdc(payload.receiptid) };
      }
      return postFactpy(process.env.FACTPY_SEND_PATH || 'data.php', {
        datajson: JSON.stringify(payload), recordID,
      });
    },
    async check(receiptId, scenario, checks = 0) {
      if (mode === 'mock') {
        if (scenario === 'network_error') return { state: 'review', message: 'No encontrado (simulado)' };
        if (scenario === 'rejected') return { state: 'rejected', message: 'Documento rechazado (simulado)' };
        if (scenario === 'delayed' && checks === 0) return { state: 'processing' };
        return { state: 'approved', cdc: fakeCdc(receiptId) };
      }
      const statusPath = process.env.FACTPY_STATUS_PATH || 'estadoDE.php';
      let rows = await postFactpy(statusPath, {
        datajson: JSON.stringify({ receiptid: [receiptId] }), recordID,
      });
      if (Array.isArray(rows) && rows.some((item) =>
        String(item.receiptid) === receiptId && String(item.estado || '').trim().toLowerCase() === 'no encontrado')) {
        // FactPy documents "receiptid" as the form field for estadoDE.php.
        // A second status lookup is read-only; it never resends the document.
        const documentedRows = await postFactpy(statusPath, {
          receiptid: JSON.stringify({ receiptid: [receiptId] }), recordID,
        });
        if (!Array.isArray(documentedRows)) {
          return { state: 'review', message: 'FactPy no confirmó el estado al consultar con el formato documentado' };
        }
        rows = documentedRows;
      }
      if (!Array.isArray(rows)) {
        const error = String(rows?.error || '');
        const message = /recordid.*datajson/i.test(error)
          ? 'FactPy no recibió recordID y datajson; reiniciá el backend con la configuración Test correcta'
          : /recordid/i.test(error)
            ? 'FactPy rechazó la configuración de empresa Test'
            : 'FactPy devolvió una respuesta inesperada al consultar el estado';
        return { state: 'review', message };
      }
      const row = rows.find((item) => String(item.receiptid) === receiptId);
      if (!row) return { state: 'review', message: 'FactPy devolvió una lista sin el recibo solicitado' };
      const state = String(row.estado || '').trim().toLowerCase();
      if (state === 'aprobado' && /^\d{44}$/.test(String(row.cdc || ''))) {
        return { state: 'approved', cdc: row.cdc, number: row.documento };
      }
      if (state === 'rechazado') return { state: 'rejected', message: row.mensaje || 'Rechazado' };
      if (state === 'no encontrado') return { state: 'review', notFound: true, message: row.mensaje || 'No encontrado' };
      if (state === 'procesando' || !state) return { state: 'processing', message: row.mensaje || null };
      return { state: 'review', message: row.mensaje || row.estado || 'Estado desconocido' };
    },
    async cancel(cdc, reason) {
      if (mode === 'mock') return { status: true, code: 'Evento registrado (simulado)' };
      const eventJsonField = process.env.FACTPY_EVENT_JSON_FIELD || 'datajson';
      if (!['datajson', 'dataJson'].includes(eventJsonField)) {
        throw new Error('FACTPY_EVENT_JSON_FIELD debe ser datajson o dataJson');
      }
      return postFactpy(process.env.FACTPY_EVENT_PATH || 'eventos.php', {
        [eventJsonField]: JSON.stringify({ tipoEvento: 2, cdc, motivo: reason }), recordID,
      });
    },
    links(response) {
      return { kude: checkedUrl(response?.kude), xml: checkedUrl(response?.xmlLink) };
    },
  };
}
