import { receiptExpeditionForInvoices } from './receiptExpedition.js';

const PAYMENT_METHODS = {
  efectivo: 1,
  cheque: 2,
  tarjeta: 3,
  transferencia: 5,
  otro: 99,
};

function invalid(message) {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

export function validateFactpyReceiptCurrency(mode, payload) {
  if (mode === 'test' && payload.moneda === 'USD') {
    invalid('FactPy Test mostró en guaraníes un recibo enviado en USD. El cobro se guardó localmente, pero el envío de recibos USD queda suspendido hasta confirmar con FactPy el formato correcto.');
  }
}

export function buildFactpyReceipt({ receipt, invoices, number, receiptId, securityCode, exchangeRate }) {
  if (receipt.status !== 'emitido') invalid('El recibo interno no está vigente');
  if (!/^\d{3}-\d{3}-\d{7}$/.test(number)) invalid('Número de recibo FactPy inválido');
  if (!invoices?.length) invalid('El recibo no tiene facturas asociadas');
  const expedition = receiptExpeditionForInvoices(invoices);
  const [numberEstablishment, numberPoint] = number.split('-');
  if (expedition.establishment !== numberEstablishment || expedition.point !== numberPoint) {
    invalid('El punto del recibo debe coincidir con el de sus facturas');
  }
  const method = PAYMENT_METHODS[String(receipt.payment_method || '').toLowerCase()];
  if (!method) invalid('El método de cobro no se puede enviar a FactPy');
  if (method === 2 && !String(receipt.reference_number || '').trim()) {
    invalid('El cheque necesita un número de referencia');
  }
  const currency = String(receipt.currency_code || '').toUpperCase().replace('GS', 'PYG');
  if (!['PYG', 'USD'].includes(currency)) invalid('Solo se admiten PYG y USD en esta prueba');
  const first = invoices[0];
  const ruc = String(first.customer_doc || first.org_ruc || '').trim();
  const name = String(first.org_razon_social || first.org_name || '').trim();
  if (!ruc || !name) invalid('Completá el RUC y la razón social del cliente');
  const exchange = currency === 'USD' ? Number(exchangeRate || first.exchange_rate) : 0;
  if (currency === 'USD' && (!Number.isFinite(exchange) || exchange <= 0)) {
    invalid('Falta el tipo de cambio de la factura');
  }
  if (invoices.some((row) => row.fiscal_mode !== 'electronic' || row.fiscal_status !== 'approved')) {
    invalid('El recibo FactPy solo admite facturas electrónicas aprobadas');
  }
  if (invoices.some((row) => String(row.currency_code || '').toUpperCase().replace('GS', 'PYG') !== currency)) {
    invalid('Las facturas del recibo deben compartir moneda');
  }
  if (currency === 'USD' && !exchangeRate && invoices.some((row) => Number(row.exchange_rate) !== exchange)) {
    invalid('Cargá el tipo de cambio del cobro; las facturas tienen tipos de cambio distintos');
  }
  const items = invoices.map((row) => {
    const total = Number(row.total_amount);
    const paid = Number(row.amount_applied);
    if (!/^\d{3}-\d{3}-\d{7}$/.test(String(row.invoice_number || '')) ||
        !Number.isFinite(total) || total <= 0 || !Number.isFinite(paid) || paid <= 0 ||
        paid > total + 0.01) invalid(`Revisá la factura ${row.invoice_number || row.id}`);
    return {
      documento: row.invoice_number,
      importeDocumento: total,
      ...(row.due_date ? { vencimientoDocumento: String(row.due_date).slice(0, 10) } : {}),
      importePago: paid,
      metodoPago: method,
      ...(method === 2 ? { numeroCheque: String(receipt.reference_number).trim() } : {}),
    };
  });
  const applied = Math.round(items.reduce((sum, row) => sum + row.importePago, 0) * 100) / 100;
  if (Math.abs(applied - Number(receipt.amount || 0)) > 0.01) invalid('Los importes del recibo no concilian con las facturas');
  const [establishment, point, sequence] = number.split('-');
  const payload = {
    tipoDocumento: 0,
    establecimiento: establishment,
    punto: point,
    numero: sequence,
    fecha: `${String(receipt.issue_date).slice(0, 10)} 12:00:00`,
    receiptid: receiptId,
    concepto: `Cobro de ${items.length} factura${items.length === 1 ? '' : 's'}`,
    codigoSeguridadAleatorio: securityCode,
    moneda: currency,
    ...(currency === 'USD' ? { cambio: exchange, totalGs: Math.round(applied * exchange) } : {}),
    cliente: {
      ruc,
      nombre: name,
      ...(first.customer_email || first.org_email ? { correo: first.customer_email || first.org_email } : {}),
    },
    items,
  };
  if (!/^\d{4}-\d{2}-\d{2} 12:00:00$/.test(payload.fecha)) invalid('Fecha de recibo inválida');
  return payload;
}
