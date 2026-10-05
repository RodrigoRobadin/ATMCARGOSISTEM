const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export function getOperationAttention(deal, now = Date.now(), isProspectStage = false) {
  if (!deal || isProspectStage || deal.record_type === 'prospect' || /^PROS-/i.test(deal.reference || '')) {
    return null;
  }
  if (deal.commercial_outcome === 'lost') return null;

  const nextTaskAt = deal.next_task_due_at ? new Date(deal.next_task_due_at).getTime() : null;
  const overdueCount = Math.max(
    Number(deal.overdue_followup_tasks_count || 0),
    Number.isFinite(nextTaskAt) && nextTaskAt < now ? 1 : 0,
  );
  if (overdueCount > 0) {
    return {
      reason: 'overdue',
      label: overdueCount === 1 ? '1 actividad vencida' : `${overdueCount} actividades vencidas`,
    };
  }

  if (deal.has_operation_work == null || !deal.created_at) return null;
  const createdAt = new Date(deal.created_at).getTime();
  if (!Number.isFinite(createdAt)) return null;

  if (Number(deal.has_operation_work) === 0) {
    return now - createdAt >= FOUR_DAYS_MS
      ? { reason: 'untouched', label: `Sin gestión (${Math.floor((now - createdAt) / (24 * 60 * 60 * 1000))} d)` }
      : null;
  }

  if (!deal.last_operation_work_at) return null;
  const lastWorkAt = new Date(deal.last_operation_work_at).getTime();
  if (!Number.isFinite(lastWorkAt) || Number(deal.future_followup_tasks_count || 0) > 0) return null;
  const inactiveDays = Math.floor((now - lastWorkAt) / (24 * 60 * 60 * 1000));
  return now - lastWorkAt >= FIVE_DAYS_MS
    ? { reason: 'no_followup', label: `Sin próximo seguimiento (${inactiveDays} d)` }
    : null;
}

export function needsOperationAttention(deal, now = Date.now(), isProspectStage = false) {
  return getOperationAttention(deal, now, isProspectStage) !== null;
}
