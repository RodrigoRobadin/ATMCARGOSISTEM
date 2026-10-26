export function formatLocaleNumber(value, decimals = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function parseLocaleNumber(raw, decimals = 2) {
  if (raw == null) return 0;
  const text = String(raw).trim();
  if (!text) return 0;
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : decimals > 0 && /^-?\d+\.\d{1,2}$/.test(text)
      ? text
      : text.replace(/\./g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}
