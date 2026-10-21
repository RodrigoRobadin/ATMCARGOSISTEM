export function expectedCloseMonth(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return date.slice(0, 7);
}

export function forecastOperations(deals, stages) {
  const prospectStageIds = new Set(stages
    .filter((stage) => String(stage.name || '').trim().toLowerCase() === 'prospecto')
    .map((stage) => Number(stage.id)));
  return deals
    .filter((deal) => deal.record_type !== 'prospect' &&
      !prospectStageIds.has(Number(deal.stage_id)) &&
      expectedCloseMonth(deal.expected_close_date))
    .sort((a, b) => String(a.expected_close_date).localeCompare(String(b.expected_close_date)) || Number(a.id) - Number(b.id));
}

export function groupForecastOperations(deals, stages) {
  const groups = new Map();
  for (const deal of forecastOperations(deals, stages)) {
    const month = expectedCloseMonth(deal.expected_close_date);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(deal);
  }
  return [...groups].map(([month, operations]) => ({ month, operations }));
}
