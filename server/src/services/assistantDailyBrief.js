import { loadCommercialSessions } from './commercialSessions.js';

function asuncionDay(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function briefLine(item) {
  const source = item.source === 'task' ? 'Tarea' : 'Actividad';
  const ref = item.reference ? ` · ${item.reference}` : '';
  return `- ${source}: ${item.title || 'Sin título'}${ref} · ${item.due_at || 'sin fecha'}`;
}

export function formatDailyBrief({ mode, day, tasks, activities, closings = [], events = [], truncated = false, pendingTruncated = false, closingsTruncated = false }) {
  const pending = [...tasks, ...activities].sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  const pendingCount = pendingTruncated ? `al menos ${pending.length}` : String(pending.length);
  const links = new Map();
  for (const item of [...pending, ...closings, ...events]) {
    const id = Number(item.deal_id || 0);
    if (id > 0 && !links.has(id)) links.set(id, { type: 'deal', id, label: item.reference || `Operación ${id}`, href: `/operations/${id}` });
  }

  if (mode === 'morning') {
    const lines = [
      `Prioridades de hoy (${day}) · tareas y actividades asignadas`,
      `Pendientes vencidas o para hoy: ${pendingCount}.`,
      ...pending.slice(0, 10).map(briefLine),
    ];
    if (!pending.length) lines.push('No hay tareas o actividades con fecha vencida o para hoy en este alcance.');
    if (pending.length > 10 || pendingTruncated) lines.push(`Se muestran 10 de ${pendingCount}; abrí Seguimiento para ver el resto.`);
    lines.push(`Cierres estimados vencidos o en los próximos 7 días: ${closingsTruncated ? `al menos ${closings.length}` : closings.length}.`);
    lines.push(...closings.slice(0, 5).map((item) => `- ${item.reference || `Operación ${item.deal_id}`} · ${item.title || 'Sin título'} · ${item.close_date}`));
    if (closings.length > 5) lines.push('Hay más fechas de cierre; revisá el dashboard comercial.');
    return { answer: lines.join('\n'), links: [...links.values()].slice(0, 12) };
  }

  const completedCalls = events.filter((event) => event.kind === 'call' && event.call_status === 'completed').length;
  const isYesterday = mode === 'yesterday';
  const lines = [
    `${isYesterday ? 'Continuación de ayer' : 'Cierre del día'} (${day}) · actividad registrada en tu cartera de Cargo e Industrial`,
    `Registros: ${truncated ? `al menos ${events.length}` : events.length}; llamadas completadas: ${truncated ? `al menos ${completedCalls}` : completedCalls}.`,
    ...events.slice(0, 8).map((event) => `- ${event.title}${event.reference ? ` · ${event.reference}` : ''}${event.occurred_at ? ` · ${String(event.occurred_at).slice(11, 16)}` : ''}`),
    `Pendientes vencidas o hasta ${isYesterday ? 'hoy' : 'mañana'}: ${pendingCount}.`,
    ...pending.slice(0, 8).map(briefLine),
  ];
  if (!events.length) lines.push(`No hay actividad comercial registrada ${isYesterday ? 'ayer' : 'hoy'} en esta cartera.`);
  if (truncated || events.length > 8) lines.push('La lista de actividad está resumida; revisá Sesiones de trabajo para el detalle.');
  if (pending.length > 8 || pendingTruncated) lines.push('Hay más pendientes; revisá Seguimiento para el detalle.');
  return { answer: lines.join('\n'), links: [...links.values()].slice(0, 12) };
}

export async function loadAssistantDailyBrief(db, { mode, userId, now = new Date() }) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Usuario no válido para el resumen diario');
  const day = asuncionDay(now);
  const workDay = mode === 'yesterday' ? addDays(day, -1) : day;
  const dueBefore = mode === 'handoff' ? addDays(day, 2) : addDays(day, 1);
  const [taskRows, activityRows, closingRows, sessions] = await Promise.all([
    db.query(`
      SELECT t.id, t.title, DATE_FORMAT(t.due_at, '%Y-%m-%d %H:%i') AS due_at,
             t.deal_id, d.reference, 'task' AS source
        FROM followup_tasks t
        LEFT JOIN deals d ON d.id = t.deal_id
       WHERE t.user_id = ? AND t.status = 'pending' AND t.due_at < ?
         AND (d.id IS NULL OR d.work_completed_at IS NULL)
       ORDER BY t.due_at, t.id LIMIT 21`, [id, dueBefore]),
    db.query(`
      SELECT a.id, a.subject AS title, DATE_FORMAT(a.due_date, '%Y-%m-%d %H:%i') AS due_at,
             a.deal_id, d.reference, 'activity' AS source
        FROM activities a
        LEFT JOIN deals d ON d.id = a.deal_id
       WHERE COALESCE(a.assigned_to, a.created_by) = ? AND a.done = 0
         AND a.due_date IS NOT NULL AND a.due_date < ?
         AND (d.id IS NULL OR d.work_completed_at IS NULL)
       ORDER BY a.due_date, a.id LIMIT 21`, [id, dueBefore]),
    mode === 'morning' ? db.query(`
      SELECT d.id AS deal_id, d.reference, d.title, LEFT(cf.value, 10) AS close_date
        FROM deals d
        INNER JOIN deal_custom_fields cf ON cf.id = (
          SELECT MAX(cf2.id) FROM deal_custom_fields cf2
           WHERE cf2.deal_id = d.id AND cf2.\`key\` = 'expected_close_date'
        )
       WHERE d.advisor_user_id = ? AND LOWER(COALESCE(d.status, 'open')) = 'open'
         AND d.work_completed_at IS NULL
         AND COALESCE(NULLIF(LOWER(d.commercial_outcome), ''), 'active') = 'active'
         AND cf.value REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
         AND LEFT(cf.value, 10) <= ?
       ORDER BY close_date ASC, d.id DESC LIMIT 11`, [id, addDays(day, 7)]) : Promise.resolve([[]]),
    mode === 'handoff' || mode === 'yesterday'
      ? loadCommercialSessions(db, { from: workDay, to: workDay, advisorUserId: id })
      : Promise.resolve({ events: [], truncated: false }),
  ]);
  const { answer, links } = formatDailyBrief({
    mode, day: workDay, tasks: taskRows[0].slice(0, 20), activities: activityRows[0].slice(0, 20),
    closings: closingRows[0].slice(0, 10),
    closingsTruncated: closingRows[0].length > 10,
    events: sessions.events, truncated: sessions.truncated,
    pendingTruncated: taskRows[0].length > 20 || activityRows[0].length > 20,
  });
  return { day: workDay, mode, answer, links, generated_at: new Date().toISOString() };
}
