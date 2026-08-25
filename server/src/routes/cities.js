import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';
import { ensureRoutePlanningSchema, normalizeCityName } from '../services/routePlanning.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function isAdmin(req) {
  return String(req.user?.role || '').toLowerCase() === 'admin';
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores pueden modificar ciudades o ubicaciones.' });
  next();
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

router.use(requireAuth, async (_req, _res, next) => {
  try {
    await ensureRoutePlanningSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res) => {
  const includeInactive = isAdmin(req) && String(req.query.include_inactive || '') === '1';
  const [rows] = await pool.query(`
    SELECT c.*,
      (SELECT COUNT(*) FROM organizations o WHERE o.city_id = c.id AND o.deleted_at IS NULL) +
      (SELECT COUNT(*) FROM org_branches b WHERE b.city_id = c.id) AS locations_count
    FROM cities c
    ${includeInactive ? '' : 'WHERE c.active = 1'}
    ORDER BY c.country_code, c.department, c.name
  `);
  res.json(rows);
});

router.post('/', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const department = String(req.body?.department || '').trim() || null;
  const countryCode = String(req.body?.country_code || 'PY').trim().toUpperCase().slice(0, 2);
  if (!name) return res.status(400).json({ error: 'El nombre de la ciudad es obligatorio.' });
  try {
    const [result] = await pool.query(
      `INSERT INTO cities (name, normalized_name, department, country_code, latitude, longitude, color, active, is_custom, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      [name, normalizeCityName(name), department, countryCode, numberOrNull(req.body?.latitude), numberOrNull(req.body?.longitude), req.body?.color || null, req.user?.id || null]
    );
    const [[row]] = await pool.query('SELECT * FROM cities WHERE id = ?', [result.insertId]);
    await logAudit({ req, action: 'create', entity: 'city', entityId: row.id, description: `Creo ciudad ${row.name}` });
    res.status(201).json(row);
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'La ciudad ya existe.' });
    throw error;
  }
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id || 0);
  const [[current]] = await pool.query('SELECT * FROM cities WHERE id = ?', [id]);
  if (!current) return res.status(404).json({ error: 'Ciudad no encontrada.' });
  const next = {
    name: req.body?.name !== undefined ? String(req.body.name || '').trim() : current.name,
    department: req.body?.department !== undefined ? String(req.body.department || '').trim() || null : current.department,
    country_code: req.body?.country_code !== undefined ? String(req.body.country_code || 'PY').toUpperCase().slice(0, 2) : current.country_code,
    latitude: req.body?.latitude !== undefined ? numberOrNull(req.body.latitude) : current.latitude,
    longitude: req.body?.longitude !== undefined ? numberOrNull(req.body.longitude) : current.longitude,
    color: req.body?.color !== undefined ? req.body.color || null : current.color,
    active: req.body?.active !== undefined ? (req.body.active ? 1 : 0) : current.active,
  };
  if (!next.name) return res.status(400).json({ error: 'El nombre de la ciudad es obligatorio.' });
  await pool.query(
    `UPDATE cities SET name = ?, normalized_name = ?, department = ?, country_code = ?, latitude = ?, longitude = ?, color = ?, active = ? WHERE id = ?`,
    [next.name, normalizeCityName(next.name), next.department, next.country_code, next.latitude, next.longitude, next.color, next.active, id]
  );
  const [[row]] = await pool.query('SELECT * FROM cities WHERE id = ?', [id]);
  await logAudit({ req, action: 'update', entity: 'city', entityId: id, description: `Actualizo ciudad ${row.name}`, meta: { before: current, after: row } });
  res.json(row);
});

router.get('/settings/current', async (_req, res) => {
  const [[row]] = await pool.query('SELECT stale_visit_days, updated_at FROM route_planning_settings WHERE id = 1');
  res.json(row || { stale_visit_days: 60 });
});

router.patch('/settings/current', requireAdmin, async (req, res) => {
  const days = Math.max(1, Math.min(3650, Math.trunc(Number(req.body?.stale_visit_days || 60))));
  await pool.query('UPDATE route_planning_settings SET stale_visit_days = ?, updated_by = ? WHERE id = 1', [days, req.user?.id || null]);
  await logAudit({ req, action: 'update', entity: 'route_settings', entityId: 1, description: 'Actualizo antiguedad de visitas', meta: { stale_visit_days: days } });
  res.json({ stale_visit_days: days });
});

router.get('/locations/export', requireAdmin, async (_req, res) => {
  const [mainResult, branchResult] = await Promise.all([
    pool.query(`
      SELECT 'MAIN' AS location_type, o.id AS organization_id, NULL AS branch_id,
        COALESCE(o.razon_social, o.name) AS organization_name, 'Casa matriz' AS location_name,
        o.address, o.city AS current_city, o.city_id, c.name AS normalized_city,
        COALESCE(c.department, o.department) AS department, o.country,
        o.maps_url, o.latitude, o.longitude,
        (SELECT COUNT(*) FROM contacts ct WHERE ct.org_id = o.id AND ct.deleted_at IS NULL) AS contacts_count
      FROM organizations o
      LEFT JOIN cities c ON c.id = o.city_id
      WHERE o.deleted_at IS NULL
    `),
    pool.query(`
      SELECT 'BRANCH' AS location_type, o.id AS organization_id, b.id AS branch_id,
        COALESCE(o.razon_social, o.name) AS organization_name, COALESCE(b.name, 'Sucursal') AS location_name,
        b.address, b.city AS current_city, b.city_id, c.name AS normalized_city,
        c.department, b.country, b.maps_url, b.latitude, b.longitude,
        (SELECT COUNT(*) FROM contacts ct WHERE ct.org_id = o.id AND ct.deleted_at IS NULL) AS contacts_count
      FROM org_branches b
      INNER JOIN organizations o ON o.id = b.org_id AND o.deleted_at IS NULL
      LEFT JOIN cities c ON c.id = b.city_id
    `),
  ]);
  const rows = [...mainResult[0], ...branchResult[0]].sort((a, b) =>
    String(a.organization_name || '').localeCompare(String(b.organization_name || ''), 'es') ||
    String(a.location_type || '').localeCompare(String(b.location_type || ''), 'es') ||
    String(a.location_name || '').localeCompare(String(b.location_name || ''), 'es')
  );  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Ubicaciones');
  sheet.columns = [
    ['Tipo ubicacion', 'location_type', 16], ['ID organizacion', 'organization_id', 16], ['ID sucursal', 'branch_id', 14],
    ['Organizacion', 'organization_name', 32], ['Ubicacion', 'location_name', 24], ['Direccion', 'address', 36],
    ['Ciudad actual', 'current_city', 20], ['ID ciudad', 'city_id', 12], ['Ciudad normalizada', 'normalized_city', 22],
    ['Departamento', 'department', 20], ['Pais', 'country', 14], ['Google Maps', 'maps_url', 38],
    ['Latitud', 'latitude', 16], ['Longitud', 'longitude', 16], ['Contactos', 'contacts_count', 12]
  ].map(([header, key, width]) => ({ header, key, width }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'O1' };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ubicaciones-organizaciones.xlsx"');
  res.end(Buffer.from(buffer));
});

async function parseLocationWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('El archivo no contiene hojas.');
  const headers = {};
  sheet.getRow(1).eachCell((cell, column) => {
    const normalized = normalizeCityName(cell.value).replace(/\s+/g, '_');
    headers[normalized] = column;
  });
  const col = (...names) => names.map((name) => headers[normalizeCityName(name).replace(/\s+/g, '_')]).find(Boolean);
  const columns = {
    type: col('TIPO UBICACION', 'LOCATION_TYPE'), orgId: col('ID ORGANIZACION', 'ORGANIZATION_ID'), branchId: col('ID SUCURSAL', 'BRANCH_ID'),
    cityId: col('ID CIUDAD', 'CITY_ID'), city: col('CIUDAD NORMALIZADA', 'NORMALIZED_CITY'), department: col('DEPARTAMENTO', 'DEPARTMENT'),
    country: col('PAIS', 'COUNTRY'), mapsUrl: col('GOOGLE MAPS', 'MAPS_URL'), latitude: col('LATITUD', 'LATITUDE'), longitude: col('LONGITUD', 'LONGITUDE')
  };
  if (!columns.type || !columns.orgId) throw new Error('Faltan las columnas Tipo ubicacion o ID organizacion.');
  const [cities] = await pool.query('SELECT id, name, normalized_name, department FROM cities');
  const cityById = new Map(cities.map((city) => [Number(city.id), city]));
  const cityByName = new Map(cities.map((city) => [city.normalized_name, city]));
  const output = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const value = (column) => column ? row.getCell(column).value : null;
    const type = String(value(columns.type) || 'MAIN').trim().toUpperCase();
    const organizationId = Number(value(columns.orgId) || 0);
    const branchId = numberOrNull(value(columns.branchId));
    const requestedCityId = numberOrNull(value(columns.cityId));
    const requestedCityName = String(value(columns.city) || '').trim();
    const city = (requestedCityId && cityById.get(requestedCityId)) || cityByName.get(normalizeCityName(requestedCityName));
    const errors = [];
    if (!['MAIN', 'BRANCH'].includes(type)) errors.push('Tipo de ubicacion invalido');
    if (!organizationId) errors.push('ID de organizacion invalido');
    if (type === 'BRANCH' && !branchId) errors.push('ID de sucursal requerido');
    if (!city) errors.push('Ciudad no encontrada en el catalogo');
    const latitude = numberOrNull(value(columns.latitude));
    const longitude = numberOrNull(value(columns.longitude));
    if ((latitude === null) !== (longitude === null)) errors.push('Latitud y longitud deben cargarse juntas');
    output.push({
      row_number: rowNumber, status: errors.length ? 'error' : 'ok', errors,
      location_type: type, organization_id: organizationId, branch_id: branchId,
      city_id: city?.id || null, city_name: city?.name || requestedCityName,
      department: String(value(columns.department) || city?.department || '').trim() || null,
      country: String(value(columns.country) || 'Paraguay').trim() || null,
      maps_url: String(value(columns.mapsUrl) || '').trim() || null,
      latitude, longitude
    });
  });
  return output.filter((row) => row.organization_id || row.branch_id || row.city_name);
}

router.post('/locations/import-preview', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe seleccionar un archivo Excel.' });
  try {
    const rows = await parseLocationWorkbook(req.file.buffer);
    res.json({ rows, valid: rows.filter((row) => row.status === 'ok').length, errors: rows.filter((row) => row.status === 'error').length });
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudo leer el archivo.' });
  }
});

router.post('/locations/import-apply', requireAdmin, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.filter((row) => row?.status === 'ok') : [];
  if (!rows.length) return res.status(400).json({ error: 'No hay filas validas para aplicar.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let updated = 0;
    for (const row of rows) {
      const [[city]] = await connection.query('SELECT id, name, department FROM cities WHERE id = ? AND active = 1', [Number(row.city_id)]);
      if (!city) throw new Error(`Ciudad invalida en fila ${row.row_number || '-'}`);
      if (row.location_type === 'BRANCH') {
        const [result] = await connection.query(
          `UPDATE org_branches SET city_id = ?, city = ?, country = ?, maps_url = ?, latitude = ?, longitude = ? WHERE id = ? AND org_id = ?`,
          [city.id, city.name, row.country || 'Paraguay', row.maps_url || null, numberOrNull(row.latitude), numberOrNull(row.longitude), Number(row.branch_id), Number(row.organization_id)]
        );
        if (!result.affectedRows) throw new Error(`Sucursal no encontrada en fila ${row.row_number || '-'}`);
      } else {
        const [result] = await connection.query(
          `UPDATE organizations SET city_id = ?, city = ?, department = ?, country = ?, maps_url = ?, latitude = ?, longitude = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
          [city.id, city.name, row.department || city.department || null, row.country || 'Paraguay', row.maps_url || null, numberOrNull(row.latitude), numberOrNull(row.longitude), Number(row.organization_id)]
        );
        if (!result.affectedRows) throw new Error(`Organizacion no encontrada en fila ${row.row_number || '-'}`);
      }
      updated += 1;
    }
    await connection.commit();
    await logAudit({ req, action: 'bulk_update', entity: 'organization_location', description: `Actualizo ${updated} ubicaciones desde Excel`, meta: { updated } });
    res.json({ updated });
  } catch (error) {
    await connection.rollback();
    res.status(400).json({ error: error.message || 'No se pudieron aplicar las ubicaciones.' });
  } finally {
    connection.release();
  }
});

export default router;
