export function normalizeDoorPrefix(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);
}

export function nextDoorNumber(references, prefix, minimum = 1) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(\\d{3,})$`);
  return (references || []).reduce((next, row) => {
    const match = pattern.exec(String(row.ref_int || '').toUpperCase());
    return match ? Math.max(next, Number(match[1]) + 1) : next;
  }, Math.max(1, Number(minimum) || 1));
}

export function formatDoorCode(prefix, number) {
  return `${prefix}${String(number).padStart(3, '0')}`;
}
