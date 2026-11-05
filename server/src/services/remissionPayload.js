import { fiscalDateTime } from './factpyClient.js';
import { validSifenLocation } from './sifenGeography.js';

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw Object.assign(new Error(`Falta ${label}`), { statusCode: 400 });
  return text;
}

function code(value, label) {
  required(value, label);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error(`Falta ${label}`), { statusCode: 400 });
  return n;
}

function geographicCode(value, label) {
  const number = code(value, label);
  if (number < 1) throw Object.assign(new Error(`El código de ${label} debe ser mayor a cero`), { statusCode: 400 });
  return number;
}

function transportName(value, label) {
  const text = required(value, label);
  if (text.length < 4 || text.length > 60 || !/\p{L}/u.test(text)) {
    throw Object.assign(new Error(`${label} debe tener entre 4 y 60 caracteres e incluir letras`), { statusCode: 400 });
  }
  return text;
}

function location(value, label) {
  const result = {
    direccion: required(value?.address, `dirección de ${label}`),
    numCasa: required(value?.house_number, `número de casa de ${label}`),
    departamento: geographicCode(value?.department, `departamento de ${label}`),
    distrito: geographicCode(value?.district, `distrito de ${label}`),
    ciudad: geographicCode(value?.city, `ciudad de ${label}`),
    telefono: required(value?.phone, `teléfono de ${label}`),
  };
  if (!validSifenLocation(result.departamento, result.distrito, result.ciudad)) {
    throw Object.assign(new Error(`Departamento, distrito y ciudad de ${label} no coinciden con el catálogo SIFEN`), { statusCode: 400 });
  }
  return result;
}

export function validateRemissionDraft(input) {
  const items = input?.items;
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw Object.assign(new Error('Agregá entre 1 y 100 artículos a entregar'), { statusCode: 400 });
  }
  const cleanItems = items.map((item, index) => {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999999) {
      throw Object.assign(new Error(`Cantidad inválida en el artículo ${index + 1}`), { statusCode: 400 });
    }
    return {
      description: required(item.description, `descripción del artículo ${index + 1}`).slice(0, 255),
      code: required(item.code, `código del artículo ${index + 1}`).slice(0, 50),
      quantity,
      unit_code: code(item.unit_code, `unidad del artículo ${index + 1}`),
    };
  });
  const transport = input.transport || {};
  const vehicle = transport.vehicle || {};
  const carrier = transport.carrier || {};
  const customer = input.customer || {};
  const invoiceId = input.invoice_id ? Number(input.invoice_id) : null;
  if (invoiceId !== null && (!Number.isInteger(invoiceId) || invoiceId < 1)) {
    throw Object.assign(new Error('Factura asociada inválida'), { statusCode: 400 });
  }
  if (Number(carrier.type) === 1) {
    throw Object.assign(new Error('El transportista contribuyente requiere RUC y dígito verificador; este formulario de FactPy Test aún no admite ese caso'), { statusCode: 400 });
  }
  const date = (value, label) => {
    const text = required(value, label);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T12:00:00Z`))) {
      throw Object.assign(new Error(`Fecha inválida: ${label}`), { statusCode: 400 });
    }
    return text;
  };
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 99].includes(Number(input.reason_code)) ||
      ![1, 2, 3, 4, 5].includes(Number(input.issuer_responsible_code)) ||
      ![1, 2].includes(Number(transport.type)) || ![1, 2, 3].includes(Number(transport.modality)) ||
      ![1, 2, 3].includes(Number(transport.responsible))) {
    throw Object.assign(new Error('Código de motivo o transporte inválido'), { statusCode: 400 });
  }
  return {
    invoice_id: invoiceId,
    description: required(input.description, 'motivo descriptivo').slice(0, 255),
    reason_code: code(input.reason_code, 'motivo de remisión'),
    issuer_responsible_code: code(input.issuer_responsible_code, 'responsable de emisión'),
    estimated_km: code(input.estimated_km, 'kilómetros estimados'),
    estimated_invoice_date: invoiceId ? null : date(input.estimated_invoice_date, 'fecha estimada de factura'),
    customer: {
      ruc: required(customer.ruc, 'RUC del destinatario'),
      name: required(customer.name, 'nombre del destinatario'),
      email: String(customer.email || '').trim(),
      ...location(customer, 'destinatario'),
    },
    items: cleanItems,
    transport: {
      type: code(transport.type, 'tipo de transporte'),
      modality: code(transport.modality, 'modalidad'),
      responsible: code(transport.responsible, 'responsable del transporte'),
      departure_date: date(transport.departure_date, 'fecha de salida'),
      delivery_date: date(transport.delivery_date, 'fecha prevista de entrega'),
      origin: location(transport.origin, 'salida'),
      destination: location(transport.destination, 'entrega'),
      vehicle: {
        type: code(vehicle.type, 'tipo de vehículo'),
        make: required(vehicle.make, 'marca del vehículo'),
        document_type: code(vehicle.document_type, 'tipo de identificación del vehículo'),
        number: required(vehicle.number, 'identificación del vehículo'),
      },
      carrier: {
        type: code(carrier.type, 'tipo de transportista'),
        name: transportName(carrier.name, 'Nombre del transportista'),
        document_type: code(carrier.document_type, 'tipo de documento del transportista'),
        document_number: required(carrier.document_number, 'documento del transportista'),
        address: required(carrier.address, 'dirección del transportista'),
        driver_name: transportName(carrier.driver_name, 'Nombre del chofer'),
        driver_document: required(carrier.driver_document, 'documento del chofer'),
        driver_address: required(carrier.driver_address, 'dirección del chofer'),
      },
    },
  };
}

export function buildRemissionPayload(draft, { number, receiptId, securityCode, invoiceCdc = null, printedInvoice = null }) {
  if (!/^\d{3}-\d{3}-\d{7}$/.test(number)) throw new Error('Número fiscal inválido');
  if (invoiceCdc && printedInvoice) throw new Error('La remisión solo puede asociar una factura');
  if (printedInvoice && (!/^\d{3}-\d{3}-\d{7}$/.test(String(printedInvoice.number || '')) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(printedInvoice.issueDate || '')) ||
    !/^\d+$/.test(String(printedInvoice.timbrado || '')))) {
    throw Object.assign(new Error('La factura autoimpresa necesita número, fecha y timbrado válidos'), { statusCode: 400 });
  }
  const [establishment, point, sequence] = number.split('-');
  const t = draft.transport;
  const hasInvoice = Boolean(invoiceCdc || printedInvoice);
  const [printedEstablishment, printedPoint, printedSequence] = printedInvoice?.number?.split('-') || [];
  const associatedDocument = printedInvoice ? {
    remision: true, tipoDocumentoAsoc: '2', establecimientoAsoc: printedEstablishment,
    puntoAsoc: printedPoint, numeroAsoc: printedSequence, tipoDocuemntoIm: '1',
    fechaDocIm: printedInvoice.issueDate, timbradoAsoc: String(printedInvoice.timbrado),
  } : { remision: Boolean(invoiceCdc), tipoDocumentoAsoc: '1', cdcAsociado: invoiceCdc || '' };
  const place = (p) => ({ direccion: p.direccion, numCasa: p.numCasa,
    departamento: p.departamento, distrito: p.distrito, ciudad: p.ciudad, telefono: p.telefono });
  return {
    fecha: fiscalDateTime(),
    documentoAsociado: associatedDocument,
    establecimiento: establishment, punto: point, numero: sequence, descripcion: draft.description,
    tipoDocumento: 7, tipoEmision: 1, tipoTransaccion: 1, receiptid: receiptId,
    condicionPago: 1, moneda: 'PYG', cambio: 0,
    cliente: { ruc: draft.customer.ruc, nombre: draft.customer.name, cpais: 'PRY',
      direccion: draft.customer.direccion, correo: draft.customer.email || undefined,
      numCasa: Number(draft.customer.numCasa), departamento: draft.customer.departamento,
      distrito: draft.customer.distrito, ciudad: draft.customer.ciudad },
    remision: { motivo: draft.reason_code, responsableEmi: draft.issuer_responsible_code,
      kmEstimado: draft.estimated_km, factura: hasInvoice ? 1 : 0,
      ...(!hasInvoice ? { fechaFactura: draft.estimated_invoice_date } : {}) },
    codigoSeguridadAleatorio: securityCode,
    items: draft.items.map((i) => ({ descripcion: i.description, codigo: i.code,
      cantidad: i.quantity, unidadMedida: i.unit_code })),
    transporte: [{ tipoTransporte: t.type, modalidad: t.modality, tipoResponsable: t.responsible,
      iniFechaEstimadaTrans: t.departure_date, finFechaEstimadaTrans: t.delivery_date,
      salida: place(t.origin), entrega: place(t.destination),
      vehiculo: { tipo: t.vehicle.type, marca: t.vehicle.make,
        documentoTipo: t.vehicle.document_type, numeroIden: t.vehicle.number },
      transportista: { tipo: t.carrier.type, nombreTr: t.carrier.name,
        tipoDocumentoTr: t.carrier.document_type, numeroTr: t.carrier.document_number,
        direccionTr: t.carrier.address, nombreCh: t.carrier.driver_name,
        numeroCh: t.carrier.driver_document, direccionCh: t.carrier.driver_address } }],
  };
}

export function normalizeDeliveryItems(items, draftItems) {
  if (!Array.isArray(items) || items.length !== draftItems.length) {
    throw Object.assign(new Error('Revisá los artículos recibidos'), { statusCode: 400 });
  }
  return items.map((item, index) => {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > draftItems[index].quantity) {
      throw Object.assign(new Error(`Cantidad recibida inválida en artículo ${index + 1}`), { statusCode: 400 });
    }
    const conditionStatus = String(item.condition_status || '');
    const conditionDescription = String(item.condition_description || '').trim();
    if (!['buen_estado', 'con_observaciones', 'no_recibido'].includes(conditionStatus) ||
        !conditionDescription || conditionDescription.length > 500) {
      throw Object.assign(new Error(`Describí el estado del artículo ${index + 1} (máximo 500 caracteres)`), { statusCode: 400 });
    }
    if ((conditionStatus === 'no_recibido') !== (quantity === 0)) {
      throw Object.assign(new Error(`Revisá cantidad y estado del artículo ${index + 1}`), { statusCode: 400 });
    }
    if (conditionStatus === 'buen_estado' && quantity !== draftItems[index].quantity) {
      throw Object.assign(new Error(`El artículo ${index + 1} tiene una diferencia de cantidad`), { statusCode: 400 });
    }
    return { code: draftItems[index].code, description: draftItems[index].description,
      quantity, condition_status: conditionStatus, condition_description: conditionDescription };
  });
}
