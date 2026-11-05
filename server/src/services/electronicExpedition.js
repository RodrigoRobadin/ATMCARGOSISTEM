export function electronicPointFor({ dealId, serviceCaseId, containerBillingCycleId, businessUnitKey } = {}) {
  if (containerBillingCycleId) {
    throw Object.assign(new Error('Definí el punto de expedición electrónico para Container antes de emitir'), { statusCode: 400 });
  }
  if (serviceCaseId) return '002';
  if (dealId && businessUnitKey === 'atm-cargo') return '001';
  if (dealId && businessUnitKey === 'atm-industrial') return '002';
  throw Object.assign(new Error('No se pudo identificar el módulo para elegir el punto de expedición'), { statusCode: 400 });
}
