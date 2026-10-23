const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const SOURCE_LIMIT = 501;
const CALL_OUTCOMES = {
  no_contesta: 'No contesta', interesado: 'Interesado', no_interesado: 'No interesado',
  volver_a_llamar: 'Volver a llamar', en_negociacion: 'En negociación',
};

function dayTime(value) {
  return String(value || '').slice(0, 19);
}

function parseDay(value) {
  if (!DATE_RE.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function validateSessionRange(from, to) {
  const first = parseDay(from);
  const last = parseDay(to);
  if (!first || !last || first > last) return 'Selecciona un periodo de fechas valido.';
  if ((last - first) / DAY_MS > 30) return 'El periodo puede abarcar hasta 31 dias.';
  return null;
}

function inRange(timestamp, from, to) {
  const day = dayTime(timestamp).slice(0, 10);
  return day >= from && day <= to;
}

function event(kind, source, row, occurredAt, title, detail = '') {
  return {
    id: `${source}-${row.id}-${occurredAt}`,
    kind,
    occurred_at: dayTime(occurredAt),
    title: String(title || '').trim() || 'Registro comercial',
    detail: String(detail || '').trim().slice(0, 400),
    actor_name: row.actor_name || null,
    deal_id: row.deal_id || null,
    reference: row.reference || null,
    org_name: row.org_name || null,
    organization_id: row.organization_id || null,
    contact_id: row.contact_id || null,
    ...(kind === 'call' ? { call_status: row.status || 'completed', call_outcome: row.outcome || null } : {}),
  };
}

export function normalizeSessionRows(rows, from, to) {
  const events = [
    ...rows.auditDeals.map((row) => event(row.entity === 'deal_file' ? 'file' : 'change', 'audit-deal', row, row.occurred_at, row.description || 'Cambio en operacion')),
    ...rows.auditOrganizations.map((row) => event(row.entity === 'contact' ? 'contact' : 'organization', 'audit-org', row, row.occurred_at, row.description || 'Cambio en cliente')),
    ...rows.activities.map((row) => event('activity', 'activity', row, row.occurred_at,
      row.type === 'note' ? 'Nota registrada' : `${row.type === 'email' ? 'Correo' : row.type === 'call' ? 'Llamada planificada' : 'Actividad'}: ${row.subject || 'Sin titulo'}`, row.notes)),
    ...rows.calls.map((row) => event('call', 'call', row, row.occurred_at, `${!row.status || row.status === 'completed' ? 'Llamada registrada' : 'Llamada sin resultado'}: ${row.subject || 'Sin asunto'}`, [CALL_OUTCOMES[row.outcome] || row.outcome, row.notes].filter(Boolean).join(' · '))),
    ...rows.notes.map((row) => event('note', 'note', row, row.occurred_at, 'Nota de seguimiento', row.content)),
    ...rows.tasks.flatMap((row) => [
      ...(inRange(row.created_at, from, to) ? [event('task', 'task-created', row, row.created_at, `Tarea programada: ${row.title || 'Sin titulo'}`)] : []),
      ...(row.status === 'done' && inRange(row.completed_at, from, to) ? [event('task', 'task-done', row, row.completed_at, `Tarea completada: ${row.title || 'Sin titulo'}`)] : []),
    ]),
    ...rows.quotes.map((row) => event('quote', 'quote', row, row.occurred_at, 'Cotizacion guardada')),
    ...rows.revisions.map((row) => event('quote', 'revision', row, row.occurred_at, `Revision de cotizacion guardada: ${row.name || 'Sin nombre'}`)),
    ...rows.costSheets.map((row) => event('quote', 'cost-sheet', row, row.occurred_at, `Planilla de costos guardada: version ${row.version_number || 1}`)),
  ];
  return events.filter((item) => inRange(item.occurred_at, from, to))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id));
}

export async function loadCommercialSessions(db, { from, to, businessUnit = '', advisorUserId = null }) {
  const scope = ["bu.key_slug IN ('atm-cargo', 'atm-industrial')"];
  const scopeParams = [];
  if (businessUnit) {
    scope.push('bu.key_slug = ?');
    scopeParams.push(businessUnit);
  }
  if (advisorUserId) {
    scope.push('d.advisor_user_id = ?');
    scopeParams.push(advisorUserId);
  }
  const dealScope = scope.join(' AND ');
  const commonJoins = 'JOIN deals d ON d.id = SOURCE_DEAL_ID LEFT JOIN business_units bu ON bu.id = d.business_unit_id LEFT JOIN organizations o ON o.id = d.org_id';
  const dealFields = 'd.id AS deal_id, d.reference, o.name AS org_name';
  const dateWhere = (column) => `${column} >= ? AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`;
  const run = async (sql, extraParams = []) => {
    const [result] = await db.query(sql, [from, to, ...extraParams, ...scopeParams]);
    return result;
  };
  const query = (source, dealId, time, fields, joins = '', extraWhere = '') => run(`
    SELECT ${fields}, ${dealFields}, DATE_FORMAT(${time}, '%Y-%m-%d %H:%i:%s') AS occurred_at
      FROM ${source}
      ${commonJoins.replace('SOURCE_DEAL_ID', dealId)}
      ${joins}
     WHERE ${dateWhere(time)} AND ${dealScope} ${extraWhere}
     ORDER BY ${time} DESC LIMIT ${SOURCE_LIMIT}`);

  const [auditDeals, auditOrganizations, activities, calls, notes, tasks, quotes, revisions, costSheets] = await Promise.all([
    query('audit_events ae', "CASE WHEN ae.root_entity = 'deal' THEN ae.root_entity_id WHEN ae.entity = 'deal' AND ae.root_entity IS NULL THEN ae.entity_id ELSE NULL END", 'ae.created_at',
      'ae.id, ae.entity, ae.description, ae.actor_name'),
    run(`
      SELECT ae.id, ae.entity, ae.description, ae.actor_name,
             DATE_FORMAT(ae.created_at, '%Y-%m-%d %H:%i:%s') AS occurred_at,
             org.id AS organization_id, org.name AS org_name,
             CASE WHEN ae.entity = 'contact' THEN ae.entity_id ELSE NULL END AS contact_id,
             NULL AS deal_id, NULL AS reference
        FROM audit_events ae
        LEFT JOIN contacts c ON c.id = ae.entity_id AND ae.entity = 'contact'
        JOIN organizations org ON org.id = CASE
          WHEN ae.root_entity = 'organization' THEN ae.root_entity_id
          WHEN ae.entity = 'organization' THEN ae.entity_id
          WHEN ae.entity = 'contact' THEN c.org_id ELSE NULL END
       WHERE ${dateWhere('ae.created_at')}
         AND (ae.root_entity = 'organization' OR ae.entity IN ('organization', 'contact'))
         AND EXISTS (
           SELECT 1 FROM deals d LEFT JOIN business_units bu ON bu.id = d.business_unit_id
            WHERE d.org_id = org.id AND ${dealScope}
         )
       ORDER BY ae.created_at DESC LIMIT ${SOURCE_LIMIT}`),
    query('activities a', 'a.deal_id', 'a.created_at', 'a.id, a.type, a.subject, LEFT(a.notes, 400) AS notes, u.name AS actor_name', 'LEFT JOIN users u ON u.id = a.created_by'),
    run(`
      SELECT c.id, c.subject, LEFT(c.notes, 400) AS notes, c.outcome,
             COALESCE(c.status, 'completed') AS status, u.name AS actor_name,
             linked.id AS deal_id, linked.reference, o.name AS org_name,
             o.id AS organization_id, c.contact_id,
             DATE_FORMAT(c.happened_at, '%Y-%m-%d %H:%i:%s') AS occurred_at
        FROM followup_calls c
        LEFT JOIN deals linked ON linked.id = c.deal_id
        LEFT JOIN organizations o ON o.id = COALESCE(c.org_id, linked.org_id)
        LEFT JOIN users u ON u.id = c.user_id
       WHERE ${dateWhere('c.happened_at')}
         AND COALESCE(c.status, 'completed') <> 'invalidated'
         AND EXISTS (
           SELECT 1 FROM deals d
           LEFT JOIN business_units bu ON bu.id = d.business_unit_id
            WHERE (d.id = c.deal_id OR (c.deal_id IS NULL AND d.org_id = c.org_id))
              AND ${dealScope}
         )
       ORDER BY c.happened_at DESC LIMIT ${SOURCE_LIMIT}`),
    query('followup_notes n', 'n.deal_id', 'n.created_at', 'n.id, LEFT(n.content, 400) AS content, u.name AS actor_name', 'LEFT JOIN users u ON u.id = n.user_id'),
    run(`
      SELECT t.id, t.title, t.status, NULL AS actor_name,
             DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
             DATE_FORMAT(t.completed_at, '%Y-%m-%d %H:%i:%s') AS completed_at,
             ${dealFields}
        FROM followup_tasks t
        ${commonJoins.replace('SOURCE_DEAL_ID', 't.deal_id')}
       WHERE (${dateWhere('t.created_at')} OR ${dateWhere('t.completed_at')}) AND ${dealScope}
       ORDER BY GREATEST(t.created_at, COALESCE(t.completed_at, t.created_at)) DESC LIMIT ${SOURCE_LIMIT}`,
      [from, to]),
    query('quotes q', 'q.deal_id', 'q.created_at', 'q.id, u.name AS actor_name', 'LEFT JOIN users u ON u.id = q.created_by'),
    query('quote_revisions r JOIN quotes q ON q.id = r.quote_id', 'q.deal_id', 'r.created_at', 'r.id, r.name, NULL AS actor_name'),
    query('deal_cost_sheet_versions v', 'v.deal_id', 'v.created_at', 'v.id, v.version_number, u.name AS actor_name', 'LEFT JOIN users u ON u.id = v.created_by_user_id'),
  ]);
  const rows = { auditDeals, auditOrganizations, activities, calls, notes, tasks, quotes, revisions, costSheets };
  const truncated = Object.values(rows).some((items) => items.length === SOURCE_LIMIT);
  return { events: normalizeSessionRows(rows, from, to), truncated };
}
