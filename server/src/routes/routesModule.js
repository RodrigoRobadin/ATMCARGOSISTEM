import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';
import { ensureRoutePlanningSchema, orderByNearestNeighbor } from '../services/routePlanning.js';

const router = Router();

function isAdmin(req) {
  return String(req.user?.role || '').toLowerCase() === 'admin';
}

function canViewRoute(req, route) {
  return isAdmin(req) || Number(req.user?.id) === Number(route?.user_id);
}

function parseIds(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function dateOnly(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function timeOnly(value, fallback) {
  const match = String(value || fallback || '').match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}:00` : fallback;
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function minutesFromTime(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(value) {
  const minutes = Math.max(0, Math.trunc(value));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
}

async function fetchLocations(cityIds = []) {
  const placeholders = cityIds.map(() => '?').join(',');
  const mainFilter = cityIds.length ? `AND o.city_id IN (${placeholders})` : '';
  const branchFilter = cityIds.length ? `AND b.city_id IN (${placeholders})` : '';
  const [mainResult, branchResult] = await Promise.all([
    pool.query(`
      SELECT CONCAT('org:', o.id) AS location_key, 'MAIN' AS location_type,
        o.id AS organization_id, NULL AS org_branch_id, o.city_id,
        COALESCE(o.razon_social, o.name) AS organization_name,
        'Casa matriz' AS location_name, o.address, o.phone, o.email,
        o.latitude, o.longitude, o.maps_url,
        c.name AS city_name, c.department, c.latitude AS city_latitude, c.longitude AS city_longitude
      FROM organizations o
      LEFT JOIN cities c ON c.id = o.city_id
      WHERE o.deleted_at IS NULL ${mainFilter}
    `, cityIds),
    pool.query(`
      SELECT CONCAT('branch:', b.id) AS location_key, 'BRANCH' AS location_type,
        o.id AS organization_id, b.id AS org_branch_id, b.city_id,
        COALESCE(o.razon_social, o.name) AS organization_name,
        COALESCE(NULLIF(b.name, ''), 'Sucursal') AS location_name,
        b.address, COALESCE(b.phone, o.phone) AS phone, COALESCE(b.email, o.email) AS email,
        b.latitude, b.longitude, b.maps_url,
        c.name AS city_name, c.department, c.latitude AS city_latitude, c.longitude AS city_longitude
      FROM org_branches b
      INNER JOIN organizations o ON o.id = b.org_id AND o.deleted_at IS NULL
      LEFT JOIN cities c ON c.id = b.city_id
      WHERE 1=1 ${branchFilter}
    `, cityIds),
  ]);
  return [...mainResult[0], ...branchResult[0]].sort((a, b) =>
    String(a.city_name || '').localeCompare(String(b.city_name || ''), 'es') ||
    String(a.organization_name || '').localeCompare(String(b.organization_name || ''), 'es') ||
    String(a.location_name || '').localeCompare(String(b.location_name || ''), 'es')
  );
}
async function enrichCandidates(locations, staleDays) {
  if (!locations.length) return [];
  const orgIds = [...new Set(locations.map((row) => Number(row.organization_id)))];
  const placeholders = orgIds.map(() => '?').join(',');
  const [contacts] = await pool.query(
    `SELECT id, org_id, name, title, phone, email FROM contacts WHERE deleted_at IS NULL AND org_id IN (${placeholders}) ORDER BY name`,
    orgIds
  );
  const [visitStats] = await pool.query(
    `SELECT org_id, org_branch_id, MAX(COALESCE(actual_start, scheduled_at)) AS last_visit_at,
      SUM(status = 'completed') AS completed_visits
     FROM followup_visits WHERE org_id IN (${placeholders})
     GROUP BY org_id, org_branch_id`,
    orgIds
  );
  const [taskStats] = await pool.query(
    `SELECT org_id, SUM(status = 'pending' AND due_at < NOW()) AS overdue_tasks
     FROM followup_tasks WHERE org_id IN (${placeholders}) GROUP BY org_id`,
    orgIds
  );
  const [dealStats] = await pool.query(
    `SELECT org_id, SUM(status = 'open' AND commercial_outcome = 'active') AS open_deals
     FROM deals WHERE org_id IN (${placeholders}) GROUP BY org_id`,
    orgIds
  );
  const contactsByOrg = new Map();
  contacts.forEach((contact) => {
    const list = contactsByOrg.get(Number(contact.org_id)) || [];
    list.push(contact);
    contactsByOrg.set(Number(contact.org_id), list);
  });
  const visitMap = new Map(visitStats.map((row) => [`${row.org_id}:${row.org_branch_id || 0}`, row]));
  const taskMap = new Map(taskStats.map((row) => [Number(row.org_id), Number(row.overdue_tasks || 0)]));
  const dealMap = new Map(dealStats.map((row) => [Number(row.org_id), Number(row.open_deals || 0)]));
  const staleLimit = Date.now() - Number(staleDays || 60) * 86400000;

  return locations.map((location) => {
    const orgId = Number(location.organization_id);
    const visit = visitMap.get(`${orgId}:${Number(location.org_branch_id || 0)}`) || null;
    const locationContacts = contactsByOrg.get(orgId) || [];
    const reasons = [];
    let score = 0;
    if (!visit?.last_visit_at) { score += 40; reasons.push('Nunca visitada'); }
    else if (new Date(visit.last_visit_at).getTime() < staleLimit) { score += 30; reasons.push(`Mas de ${staleDays} dias sin visita`); }
    const overdueTasks = taskMap.get(orgId) || 0;
    const openDeals = dealMap.get(orgId) || 0;
    if (overdueTasks) { score += 20; reasons.push(`${overdueTasks} tarea(s) vencida(s)`); }
    if (openDeals) { score += 15; reasons.push(`${openDeals} operacion(es) abierta(s)`); }
    if (locationContacts.length) { score += 10; reasons.push(`${locationContacts.length} contacto(s)`); }
    if (!Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) reasons.push('Sin coordenadas exactas');
    return {
      ...location,
      latitude: location.latitude === null ? null : Number(location.latitude),
      longitude: location.longitude === null ? null : Number(location.longitude),
      contacts: locationContacts,
      last_visit_at: visit?.last_visit_at || null,
      completed_visits: Number(visit?.completed_visits || 0),
      overdue_tasks: overdueTasks,
      open_deals: openDeals,
      suggestion_score: score,
      suggestion_reasons: reasons,
    };
  }).sort((a, b) => b.suggestion_score - a.suggestion_score || String(a.organization_name).localeCompare(String(b.organization_name), 'es'));
}

async function selectedLocations(stops) {
  const keys = [...new Set((stops || []).map((stop) => String(stop.location_key || '')).filter(Boolean))];
  const all = await fetchLocations([]);
  const locationMap = new Map(all.map((row) => [row.location_key, row]));
  return keys.map((key) => {
    const source = locationMap.get(key);
    if (!source) return null;
    const incoming = (stops || []).find((row) => String(row.location_key) === key) || {};
    return {
      ...source,
      contact_id: incoming.contact_id ? Number(incoming.contact_id) : null,
      planned_date: dateOnly(incoming.planned_date) || null,
      planned_time: incoming.planned_time ? timeOnly(incoming.planned_time, null) : null,
      duration_minutes: Math.max(15, Math.min(480, Number(incoming.duration_minutes || 60))),
      notes: String(incoming.notes || '').trim() || null,
      suggestion_score: Number(incoming.suggestion_score || 0),
      suggestion_reasons: Array.isArray(incoming.suggestion_reasons) ? incoming.suggestion_reasons : [],
    };
  }).filter(Boolean);
}

function scheduleStops(rows, config) {
  const startDate = dateOnly(config.start_date);
  const endDate = dateOnly(config.end_date);
  const dayStart = minutesFromTime(config.workday_start || '08:00');
  const dayEnd = minutesFromTime(config.workday_end || '17:00');
  const travel = Math.max(0, Number(config.travel_buffer_minutes || 0));
  let currentDate = startDate;
  let currentMinute = dayStart;
  const output = [];
  for (const row of rows) {
    const duration = Math.max(15, Number(row.duration_minutes || config.default_visit_minutes || 60));
    if (currentMinute + duration > dayEnd) {
      currentDate = addDays(currentDate, 1);
      currentMinute = dayStart;
    }
    if (!currentDate || currentDate > endDate) {
      output.push({ ...row, planned_date: null, planned_time: null, schedule_error: 'No entra en el rango seleccionado' });
      continue;
    }
    output.push({ ...row, planned_date: currentDate, planned_time: timeFromMinutes(currentMinute), duration_minutes: duration });
    currentMinute += duration + travel;
  }
  return output;
}

async function getRoute(id) {
  const [[route]] = await pool.query(`
    SELECT r.*, z.name AS legacy_zone_name, u.name AS user_name, u.email AS user_email
    FROM routes r
    LEFT JOIN zones z ON z.id = r.zone_id
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.id = ? LIMIT 1`, [id]);
  if (!route) return null;
  const [cities] = await pool.query(`
    SELECT c.*, rc.city_order FROM route_cities rc INNER JOIN cities c ON c.id = rc.city_id
    WHERE rc.route_id = ? ORDER BY rc.city_order, c.name`, [id]);
  const [stops] = await pool.query(`
    SELECT rs.*, o.name AS organization_name, o.razon_social,
      c.name AS city_name, b.name AS branch_name,
      ct.name AS contact_name, ct.phone AS contact_phone, ct.email AS contact_email,
      v.status AS visit_status, v.scheduled_at AS visit_scheduled_at
    FROM route_stops rs
    INNER JOIN organizations o ON o.id = rs.organization_id
    LEFT JOIN org_branches b ON b.id = rs.org_branch_id
    LEFT JOIN cities c ON c.id = rs.city_id
    LEFT JOIN contacts ct ON ct.id = rs.contact_id
    LEFT JOIN followup_visits v ON v.id = rs.visit_id
    WHERE rs.route_id = ? ORDER BY rs.stop_order`, [id]);
  return { ...route, cities, stops: stops.map((stop) => ({ ...stop, suggestion_reasons: typeof stop.suggestion_reasons === 'string' ? JSON.parse(stop.suggestion_reasons || '[]') : (stop.suggestion_reasons || []) })) };
}

router.use(requireAuth, async (_req, _res, next) => {
  try { await ensureRoutePlanningSchema(); next(); } catch (error) { next(error); }
});

router.get('/candidates', async (req, res) => {
  const cityIds = parseIds(req.query.city_ids);
  if (!cityIds.length) return res.json([]);
  const [[settings]] = await pool.query('SELECT stale_visit_days FROM route_planning_settings WHERE id = 1');
  const locations = await fetchLocations(cityIds);
  res.json(await enrichCandidates(locations, Number(settings?.stale_visit_days || 60)));
});

router.post('/plan-preview', async (req, res) => {
  const rows = await selectedLocations(req.body?.stops || []);
  const ordered = req.body?.auto_order === false ? rows : orderByNearestNeighbor(rows);
  const scheduled = scheduleStops(ordered, req.body || {});
  res.json({
    stops: scheduled,
    warnings: scheduled.filter((row) => row.schedule_error).map((row) => `${row.organization_name}: ${row.schedule_error}`)
  });
});

router.get('/coverage', async (req, res) => {
  const cityIds = parseIds(req.query.city_ids);
  const from = dateOnly(req.query.from) || addDays(new Date().toISOString().slice(0, 10), -90);
  const to = dateOnly(req.query.to) || new Date().toISOString().slice(0, 10);
  const userId = Number(req.query.user_id || 0);
  const [[settings]] = await pool.query('SELECT stale_visit_days FROM route_planning_settings WHERE id = 1');
  const staleDays = Number(settings?.stale_visit_days || 60);
  const candidates = await enrichCandidates(await fetchLocations(cityIds), staleDays);
  const visitParams = [from, `${to} 23:59:59`];
  let userFilter = '';
  if (userId) { userFilter = ' AND v.user_id = ?'; visitParams.push(userId); }
  const [periodVisits] = await pool.query(`
    SELECT v.org_id, v.org_branch_id,
      SUM(v.status IN ('scheduled','confirmed','rescheduled')) AS planned,
      SUM(v.status = 'completed') AS completed
    FROM followup_visits v
    WHERE v.scheduled_at BETWEEN ? AND ? ${userFilter}
    GROUP BY v.org_id, v.org_branch_id`, visitParams);
  const periodMap = new Map(periodVisits.map((row) => [`${row.org_id}:${row.org_branch_id || 0}`, row]));
  const staleLimit = Date.now() - staleDays * 86400000;
  const locations = candidates.map((row) => {
    const period = periodMap.get(`${row.organization_id}:${row.org_branch_id || 0}`) || {};
    return { ...row, planned_in_period: Number(period.planned || 0), completed_in_period: Number(period.completed || 0), is_never_visited: !row.last_visit_at, is_stale: !!row.last_visit_at && new Date(row.last_visit_at).getTime() < staleLimit };
  });
  const cityMap = new Map();
  locations.forEach((row) => {
    const key = Number(row.city_id || 0);
    if (!key) return;
    const current = cityMap.get(key) || { city_id: key, city_name: row.city_name, department: row.department, latitude: Number(row.city_latitude), longitude: Number(row.city_longitude), locations: 0, visited: 0, never_visited: 0, stale: 0, planned: 0, completed: 0 };
    current.locations += 1;
    current.visited += row.last_visit_at ? 1 : 0;
    current.never_visited += row.is_never_visited ? 1 : 0;
    current.stale += row.is_stale ? 1 : 0;
    current.planned += row.planned_in_period;
    current.completed += row.completed_in_period;
    cityMap.set(key, current);
  });
  const summary = locations.reduce((acc, row) => {
    acc.locations += 1; acc.visited += row.last_visit_at ? 1 : 0; acc.never_visited += row.is_never_visited ? 1 : 0;
    acc.stale += row.is_stale ? 1 : 0; acc.planned += row.planned_in_period; acc.completed += row.completed_in_period; return acc;
  }, { locations: 0, visited: 0, never_visited: 0, stale: 0, planned: 0, completed: 0 });
  res.json({ from, to, stale_visit_days: staleDays, summary, cities: [...cityMap.values()], locations });
});

router.get('/', async (req, res) => {
  const params = [];
  const where = ['1=1'];
  if (!isAdmin(req)) { where.push('r.user_id = ?'); params.push(Number(req.user?.id)); }
  if (req.query.user_id && isAdmin(req)) { where.push('r.user_id = ?'); params.push(Number(req.query.user_id)); }
  if (req.query.status) { where.push('r.status = ?'); params.push(String(req.query.status)); }
  if (req.query.city_id) { where.push('EXISTS (SELECT 1 FROM route_cities rc2 WHERE rc2.route_id = r.id AND rc2.city_id = ?)'); params.push(Number(req.query.city_id)); }
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  params.push(limit);
  const [rows] = await pool.query(`
    SELECT r.*, z.name AS legacy_zone_name, u.name AS user_name,
      GROUP_CONCAT(DISTINCT c.name ORDER BY rc.city_order SEPARATOR ', ') AS city_names,
      COUNT(DISTINCT rs.id) AS stops_count,
      SUM(rs.status = 'completada') AS completed_stops
    FROM routes r
    LEFT JOIN zones z ON z.id = r.zone_id
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN route_cities rc ON rc.route_id = r.id
    LEFT JOIN cities c ON c.id = rc.city_id
    LEFT JOIN route_stops rs ON rs.route_id = r.id
    WHERE ${where.join(' AND ')}
    GROUP BY r.id, z.name, u.name
    ORDER BY r.start_date DESC, r.created_at DESC LIMIT ?`, params);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const cityIds = parseIds(req.body?.city_ids);
  const startDate = dateOnly(req.body?.start_date);
  const endDate = dateOnly(req.body?.end_date);
  if (!name || !cityIds.length || !startDate || !endDate) return res.status(400).json({ error: 'Nombre, ciudades y rango de fechas son obligatorios.' });
  if (endDate < startDate) return res.status(400).json({ error: 'La fecha final no puede ser anterior a la inicial.' });
  const assignedUserId = isAdmin(req) && req.body?.user_id ? Number(req.body.user_id) : Number(req.user?.id);
  const rows = await selectedLocations(req.body?.stops || []);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(`
      INSERT INTO routes (name, zone_id, user_id, start_date, end_date, workday_start, workday_end, default_visit_minutes, travel_buffer_minutes, status, notes, created_by)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?)`,
      [name, assignedUserId, startDate, endDate, timeOnly(req.body?.workday_start, '08:00:00'), timeOnly(req.body?.workday_end, '17:00:00'), Math.max(15, Number(req.body?.default_visit_minutes || 60)), Math.max(0, Number(req.body?.travel_buffer_minutes || 20)), req.body?.notes || null, Number(req.user?.id)]
    );
    const routeId = result.insertId;
    await connection.query('INSERT INTO route_cities (route_id, city_id, city_order) VALUES ?', [cityIds.map((cityId, index) => [routeId, cityId, index + 1])]);
    if (rows.length) {
      await connection.query(`INSERT INTO route_stops
        (route_id, organization_id, org_branch_id, city_id, contact_id, location_name, address_snapshot, latitude_snapshot, longitude_snapshot, maps_url_snapshot, suggestion_score, suggestion_reasons, stop_order, planned_date, planned_time, duration_minutes, notes)
        VALUES ?`, [rows.map((row, index) => [routeId, row.organization_id, row.org_branch_id || null, row.city_id || null, row.contact_id || null, row.location_name, row.address || null, row.latitude || null, row.longitude || null, row.maps_url || null, row.suggestion_score || 0, JSON.stringify(row.suggestion_reasons || []), index + 1, row.planned_date || null, row.planned_time || null, row.duration_minutes || 60, row.notes || null])]);
    }
    await connection.commit();
    await logAudit({ req, action: 'create', entity: 'route', entityId: routeId, description: `Creo recorrido ${name}` });
    res.status(201).json(await getRoute(routeId));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
});

router.post('/:id/confirm', async (req, res) => {
  const id = Number(req.params.id || 0);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[route]] = await connection.query('SELECT * FROM routes WHERE id = ? FOR UPDATE', [id]);
    if (!route) { await connection.rollback(); return res.status(404).json({ error: 'Recorrido no encontrado.' }); }
    if (!canViewRoute(req, route)) { await connection.rollback(); return res.status(403).json({ error: 'No tienes permiso para confirmar este recorrido.' }); }
    const [stops] = await connection.query('SELECT * FROM route_stops WHERE route_id = ? ORDER BY stop_order FOR UPDATE', [id]);
    if (!stops.length) { await connection.rollback(); return res.status(400).json({ error: 'Agrega al menos una parada.' }); }
    if (stops.some((stop) => !stop.planned_date || !stop.planned_time)) { await connection.rollback(); return res.status(400).json({ error: 'Todas las paradas deben tener fecha y hora.' }); }
    for (const stop of stops) {
      if (stop.visit_id) continue;
      const scheduledAt = `${dateOnly(stop.planned_date)} ${String(stop.planned_time).slice(0, 8)}`;
      const [visitResult] = await connection.query(`INSERT INTO followup_visits
        (user_id, org_id, route_stop_id, org_branch_id, scheduled_at, estimated_duration_min, address, status, objective, preparation_notes, travel_time_min)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
        [route.user_id, stop.organization_id, stop.id, stop.org_branch_id || null, scheduledAt, stop.duration_minutes || route.default_visit_minutes || 60, stop.address_snapshot || null, `Visita del recorrido ${route.name}`, stop.notes || null, route.travel_buffer_minutes || 20]
      );
      if (stop.contact_id) await connection.query('INSERT IGNORE INTO visit_contacts (visit_id, contact_id) VALUES (?, ?)', [visitResult.insertId, stop.contact_id]);
      await connection.query('UPDATE route_stops SET visit_id = ? WHERE id = ?', [visitResult.insertId, stop.id]);
    }
    await connection.query(`UPDATE routes SET status = 'planificado', confirmed_at = COALESCE(confirmed_at, NOW()), confirmed_by = COALESCE(confirmed_by, ?) WHERE id = ?`, [Number(req.user?.id), id]);
    await connection.commit();
    await logAudit({ req, action: 'confirm', entity: 'route', entityId: id, description: `Confirmo recorrido ${route.name}` });
    res.json(await getRoute(id));
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Una parada ya tiene visita vinculada. Recarga el recorrido.' });
    throw error;
  } finally { connection.release(); }
});

router.get('/user/:userId', async (req, res) => {
  if (!isAdmin(req) && Number(req.user?.id) !== Number(req.params.userId)) return res.status(403).json({ error: 'Permiso denegado.' });
  const [rows] = await pool.query('SELECT * FROM routes WHERE user_id = ? ORDER BY start_date DESC', [Number(req.params.userId)]);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const route = await getRoute(Number(req.params.id));
  if (!route) return res.status(404).json({ error: 'Recorrido no encontrado.' });
  if (!canViewRoute(req, route)) return res.status(403).json({ error: 'No tienes permiso para ver este recorrido.' });
  res.json(route);
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id || 0);
  const [[route]] = await pool.query('SELECT * FROM routes WHERE id = ?', [id]);
  if (!route) return res.status(404).json({ error: 'Recorrido no encontrado.' });
  if (!canViewRoute(req, route)) return res.status(403).json({ error: 'No tienes permiso para editar este recorrido.' });
  const fields = [];
  const values = [];
  const allowed = ['name', 'start_date', 'end_date', 'workday_start', 'workday_end', 'default_visit_minutes', 'travel_buffer_minutes', 'notes'];
  for (const field of allowed) if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) { fields.push(`${field} = ?`); values.push(req.body[field] || null); }
  if (isAdmin(req) && req.body?.user_id) { fields.push('user_id = ?'); values.push(Number(req.body.user_id)); }
  const cityIds = req.body?.city_ids ? parseIds(req.body.city_ids) : null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (fields.length) { values.push(id); await connection.query(`UPDATE routes SET ${fields.join(', ')} WHERE id = ?`, values); }
    if (cityIds) {
      if (!cityIds.length) throw new Error('Debe seleccionar al menos una ciudad.');
      await connection.query('DELETE FROM route_cities WHERE route_id = ?', [id]);
      await connection.query('INSERT INTO route_cities (route_id, city_id, city_order) VALUES ?', [cityIds.map((cityId, index) => [id, cityId, index + 1])]);
    }
    await connection.commit();
    await logAudit({ req, action: 'update', entity: 'route', entityId: id, description: `Actualizo recorrido ${route.name}` });
    res.json(await getRoute(id));
  } catch (error) { await connection.rollback(); res.status(400).json({ error: error.message || 'No se pudo actualizar.' }); }
  finally { connection.release(); }
});

router.patch('/:id/status', async (req, res) => {
  const id = Number(req.params.id || 0);
  const status = String(req.body?.status || '');
  const valid = ['borrador', 'planificado', 'en_curso', 'completado', 'cancelado'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Estado invalido.' });
  const [[route]] = await pool.query('SELECT * FROM routes WHERE id = ?', [id]);
  if (!route) return res.status(404).json({ error: 'Recorrido no encontrado.' });
  if (!canViewRoute(req, route)) return res.status(403).json({ error: 'Permiso denegado.' });
  await pool.query('UPDATE routes SET status = ? WHERE id = ?', [status, id]);
  await logAudit({ req, action: 'status', entity: 'route', entityId: id, description: `Cambio recorrido a ${status}` });
  res.json({ status });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id || 0);
  const [[route]] = await pool.query('SELECT * FROM routes WHERE id = ?', [id]);
  if (!route) return res.status(404).json({ error: 'Recorrido no encontrado.' });
  if (!canViewRoute(req, route)) return res.status(403).json({ error: 'Permiso denegado.' });
  const [[linked]] = await pool.query('SELECT COUNT(*) AS total FROM route_stops WHERE route_id = ? AND visit_id IS NOT NULL', [id]);
  if (Number(linked.total || 0)) return res.status(409).json({ error: 'No se puede eliminar un recorrido con visitas creadas. Cancelalo para conservar el historial.' });
  await pool.query('DELETE FROM routes WHERE id = ?', [id]);
  await logAudit({ req, action: 'delete', entity: 'route', entityId: id, description: `Elimino recorrido ${route.name}` });
  res.json({ ok: true });
});

export default router;
