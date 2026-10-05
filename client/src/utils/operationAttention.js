const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

export function needsOperationAttention(deal, now = Date.now(), isProspectStage = false) {
  if (!deal || isProspectStage || deal.record_type === 'prospect' || /^PROS-/i.test(deal.reference || '')) {
    return false;
  }
  if (deal.commercial_outcome === 'lost' || deal.has_operation_work == null || Number(deal.has_operation_work) !== 0) {
    return false;
  }
  if (!deal.created_at) return false;
  const createdAt = new Date(deal.created_at).getTime();
  return Number.isFinite(createdAt) && now - createdAt >= FOUR_DAYS_MS;
}
