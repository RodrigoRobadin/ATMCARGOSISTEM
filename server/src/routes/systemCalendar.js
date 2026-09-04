import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

const EVENT_TYPES = new Set([
  'followup_task',
  'commercial_visit',
  'route_visit',
  'manufacturing_start',
  'factory_departure',
  'paraguay_arrival',
  'installation',
  'service_visit',
]);

function dateOnly(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function parseTypes(value) {
  const requested = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => EVENT_TYPES.has(item));
  return new Set(requested.length ? requested : EVENT_TYPES);
}

function addMinutes(value, minutes) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setMinutes(date.getMinutes() + Number(minutes || 0));
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function daysBetween(from, to) {
  if (!from || !to) return 0;
  const start = new Date(`${dateOnly(from)}T12:00:00`);
  const end = new Date(`${dateOnly(to)}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function paraguayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function optionalQuery(sql, params, warnings, source) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  } catch (error) {
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) {
      warnings.push(`${source}: fuente no disponible`);
      return [];
    }
    throw error;
  }
}

router.use(requireAuth);

router.get('/events', async (req, res) => {
  try {
    const from = dateOnly(req.query.from);
    const to = dateOnly(req.query.to);
    if (!from || !to) return res.status(400).json({ error: 'Los parametros from y to son obligatorios.' });
    if (to < from) return res.status(400).json({ error: 'El rango de fechas no es valido.' });

    const types = parseTypes(req.query.types);
    const fromDateTime = `${from} 00:00:00`;
    const toDateTime = `${to} 23:59:59`;
    const events = [];
    const warnings = [];

    if (types.has('followup_task')) {
      const rows = await optionalQuery(
        `SELECT t.id, t.title, t.status, t.priority,
                DATE_FORMAT(t.due_at, '%Y-%m-%dT%H:%i:%s') AS starts_at,
                t.org_id, t.deal_id, o.name AS org_name, d.reference AS deal_reference,
                u.id AS user_id, u.name AS user_name
           FROM followup_tasks t
           LEFT JOIN organizations o ON o.id = t.org_id
           LEFT JOIN deals d ON d.id = t.deal_id
           LEFT JOIN users u ON u.id = t.user_id
          WHERE t.due_at BETWEEN ? AND ?
          ORDER BY t.due_at`,
        [fromDateTime, toDateTime], warnings, 'Tareas'
      );
      rows.forEach((row) => events.push({
        id: `followup-task:${row.id}`,
        source_id: row.id,
        type: 'followup_task',
        title: row.title || 'Tarea de seguimiento',
        starts_at: row.starts_at,
        ends_at: null,
        status: row.status || 'pending',
        organization: row.org_name || null,
        reference: row.deal_reference || null,
        responsible: row.user_name || null,
        user_id: row.user_id || null,
        detail: row.priority ? `Prioridad ${row.priority}` : null,
        source_url: '/followup-management?tab=agenda',
      }));
    }

    if (types.has('commercial_visit') || types.has('route_visit')) {
      const rows = await optionalQuery(
        `SELECT v.id, v.route_stop_id, v.status, v.objective, v.address,
                v.estimated_duration_min,
                DATE_FORMAT(v.scheduled_at, '%Y-%m-%dT%H:%i:%s') AS starts_at,
                o.name AS org_name, u.id AS user_id, u.name AS user_name,
                r.id AS route_id, r.name AS route_name
           FROM followup_visits v
           LEFT JOIN organizations o ON o.id = v.org_id
           LEFT JOIN users u ON u.id = v.user_id
           LEFT JOIN route_stops rs ON rs.id = v.route_stop_id
           LEFT JOIN routes r ON r.id = rs.route_id
          WHERE v.scheduled_at BETWEEN ? AND ?
          ORDER BY v.scheduled_at`,
        [fromDateTime, toDateTime], warnings, 'Visitas comerciales'
      );
      rows.forEach((row) => {
        const type = row.route_stop_id ? 'route_visit' : 'commercial_visit';
        if (!types.has(type)) return;
        events.push({
          id: `${type}:${row.id}`,
          source_id: row.id,
          type,
          title: row.route_name || row.objective || (type === 'route_visit' ? 'Parada de recorrido' : 'Visita comercial'),
          starts_at: row.starts_at,
          ends_at: addMinutes(row.starts_at, row.estimated_duration_min || 60),
          status: row.status || 'scheduled',
          organization: row.org_name || null,
          responsible: row.user_name || null,
          user_id: row.user_id || null,
          location: row.address || null,
          reference: row.route_id ? `Recorrido #${row.route_id}` : null,
          source_url: row.route_id ? '/followup-management?tab=routes' : '/followup-management?tab=visits',
        });
      });
    }

    const logisticsTypes = [...types].filter((type) => [
      'manufacturing_start', 'factory_departure', 'paraguay_arrival', 'installation',
    ].includes(type));
    if (logisticsTypes.length) {
      const placeholders = logisticsTypes.map(() => '?').join(',');
      const rows = await optionalQuery(
        `SELECT m.id, m.milestone_key, m.notes,
                DATE_FORMAT(m.expected_date, '%Y-%m-%d') AS expected_date,
                DATE_FORMAT(m.actual_date, '%Y-%m-%d') AS actual_date,
                d.id AS deal_id, d.reference, d.title, o.name AS org_name
           FROM industrial_logistics_milestones m
           INNER JOIN deals d ON d.id = m.deal_id
           LEFT JOIN organizations o ON o.id = d.org_id
          WHERE m.expected_date BETWEEN ? AND ?
            AND m.milestone_key IN (${placeholders})
          ORDER BY m.expected_date, m.id`,
        [from, to, ...logisticsTypes], warnings, 'Logistica industrial'
      );
      const labels = {
        manufacturing_start: 'Inicio de fabricación',
        factory_departure: 'Salida de fábrica',
        paraguay_arrival: 'Llegada a Paraguay',
        installation: 'Instalación',
      };
      rows.forEach((row) => {
        const delayDays = daysBetween(row.expected_date, row.actual_date);
        const overdue = !row.actual_date && row.expected_date < paraguayDate();
        events.push({
          id: `industrial-logistics:${row.id}`,
          source_id: row.id,
          type: row.milestone_key,
          title: labels[row.milestone_key] || 'Hito logistico',
          starts_at: `${row.expected_date}T12:00:00`,
          ends_at: null,
          all_day: true,
          status: row.actual_date ? 'completed' : (overdue ? 'overdue' : 'planned'),
          organization: row.org_name || null,
          reference: row.reference || null,
          detail: row.title || null,
          notes: row.notes || null,
          planned_date: row.expected_date,
          actual_date: row.actual_date || null,
          delayed: Boolean(row.actual_date && row.actual_date > row.expected_date),
          delay_days: row.actual_date && row.actual_date > row.expected_date ? delayDays : 0,
          source_url: `/operations/${row.deal_id}/industrial?tab=logistica-cobros`,
        });
      });
    }

    const serviceCaseIds = new Set();
    if (types.has('service_visit')) {
      const rows = await optionalQuery(
        `SELECT v.id, v.service_case_id, v.status, v.notes,
                DATE_FORMAT(v.scheduled_start_at, '%Y-%m-%dT%H:%i:%s') AS starts_at,
                DATE_FORMAT(v.scheduled_end_at, '%Y-%m-%dT%H:%i:%s') AS ends_at,
                sc.reference, o.name AS org_name, b.name AS branch_name, b.address AS branch_address,
                c.name AS contact_name, u.id AS user_id, u.name AS user_name
           FROM service_visits v
           INNER JOIN service_cases sc ON sc.id = v.service_case_id
           LEFT JOIN organizations o ON o.id = sc.org_id
           LEFT JOIN org_branches b ON b.id = v.org_branch_id
           LEFT JOIN contacts c ON c.id = v.contact_id
           LEFT JOIN users u ON u.id = v.lead_technician_id
          WHERE v.scheduled_start_at BETWEEN ? AND ?
          ORDER BY v.scheduled_start_at`,
        [fromDateTime, toDateTime], warnings, 'Servicios tecnicos'
      );
      rows.forEach((row) => {
        serviceCaseIds.add(Number(row.service_case_id));
        events.push({
          id: `service-visit:${row.id}`,
          source_id: row.id,
          type: 'service_visit',
          title: 'Servicio técnico',
          starts_at: row.starts_at,
          ends_at: row.ends_at || null,
          status: row.status || 'programada',
          organization: row.org_name || null,
          reference: row.reference || null,
          responsible: row.user_name || null,
          user_id: row.user_id || null,
          location: [row.branch_name, row.branch_address].filter(Boolean).join(' - ') || null,
          detail: row.contact_name ? `Contacto: ${row.contact_name}` : null,
          notes: row.notes || null,
          source_url: `/service/cases/${row.service_case_id}?tab=visitas`,
        });
      });

      const legacyRows = await optionalQuery(
        `SELECT sc.id AS service_case_id, sc.reference, sc.status,
                DATE_FORMAT(sc.scheduled_date, '%Y-%m-%d') AS scheduled_date,
                o.name AS org_name, b.name AS branch_name, b.address AS branch_address,
                u.id AS user_id, u.name AS user_name
           FROM service_cases sc
           LEFT JOIN organizations o ON o.id = sc.org_id
           LEFT JOIN org_branches b ON b.id = sc.org_branch_id
           LEFT JOIN users u ON u.id = sc.assigned_to
          WHERE sc.scheduled_date BETWEEN ? AND ?
          ORDER BY sc.scheduled_date`,
        [from, to], warnings, 'Servicios programados anteriores'
      );
      legacyRows.forEach((row) => {
        if (serviceCaseIds.has(Number(row.service_case_id))) return;
        events.push({
          id: `service-legacy:${row.service_case_id}`,
          source_id: row.service_case_id,
          type: 'service_visit',
          title: 'Servicio técnico',
          starts_at: `${row.scheduled_date}T08:00:00`,
          ends_at: `${row.scheduled_date}T17:00:00`,
          all_day: true,
          status: row.status || 'programada',
          organization: row.org_name || null,
          reference: row.reference || null,
          responsible: row.user_name || null,
          user_id: row.user_id || null,
          location: [row.branch_name, row.branch_address].filter(Boolean).join(' - ') || null,
          detail: 'Programacion anterior de servicio',
          source_url: `/service/cases/${row.service_case_id}?tab=visitas`,
        });
      });
    }

    events.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)) || String(a.title).localeCompare(String(b.title), 'es'));
    res.json({ events, warnings });
  } catch (error) {
    console.error('[system-calendar] No se pudieron cargar los eventos:', error);
    res.status(500).json({ error: error?.message || 'No se pudo cargar el calendario general.' });
  }
});

export default router;
