export function normalizeBankTransfer(input, fromAccount, toAccount) {
  const fromId = Number(input.from_account_param_id);
  const toId = Number(input.to_account_param_id);
  if (!Number.isSafeInteger(fromId) || !Number.isSafeInteger(toId) || fromId <= 0 || toId <= 0 || fromId === toId) {
    throw Object.assign(new Error('Seleccione dos cuentas diferentes'), { statusCode: 400 });
  }
  if (fromAccount.currency_code !== toAccount.currency_code) {
    throw Object.assign(new Error('Las cuentas deben tener la misma moneda'), { statusCode: 400 });
  }
  const date = String(input.movement_date || '');
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw Object.assign(new Error('Fecha de transferencia inválida'), { statusCode: 400 });
  }
  const amount = String(input.amount ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    throw Object.assign(new Error('Importe de transferencia inválido'), { statusCode: 400 });
  }
  const reference = String(input.reference_number || '').trim();
  const observations = String(input.observations || '').trim();
  if (reference.length > 160 || observations.length > 500) {
    throw Object.assign(new Error('Referencia u observación demasiado larga'), { statusCode: 400 });
  }
  return { fromId, toId, date, amount, reference, observations,
    currency: fromAccount.currency_code };
}
