import { pool } from './db.js';

let schemaPromise = null;

const CORE_CITIES = [
  ['Asuncion', 'Capital', -25.2637, -57.5759],
  ['San Lorenzo', 'Central', -25.3397, -57.5088],
  ['Ypane', 'Central', -25.4525, -57.5352],
  ['Fernando de la Mora', 'Central', -25.3239, -57.5480],
  ['Luque', 'Central', -25.2670, -57.4872],
  ['Capiata', 'Central', -25.3552, -57.4454],
  ['Lambare', 'Central', -25.3468, -57.6065],
  ['Mariano Roque Alonso', 'Central', -25.2079, -57.5320],
  ['Limpio', 'Central', -25.1661, -57.4856],
  ['Nemby', 'Central', -25.3947, -57.5357],
  ['Villa Elisa', 'Central', -25.3676, -57.5927],
  ['San Antonio', 'Central', -25.4213, -57.5473],
  ['Itaugua', 'Central', -25.3926, -57.3542],
  ['Aregua', 'Central', -25.3125, -57.3847],
  ['J. Augusto Saldivar', 'Central', -25.3908, -57.4171],
  ['Guarambare', 'Central', -25.4934, -57.4587],
  ['Villeta', 'Central', -25.5097, -57.5594],
  ['Nueva Italia', 'Central', -25.6110, -57.4656],
  ['Ita', 'Central', -25.5095, -57.3609],
  ['Ypacarai', 'Central', -25.4078, -57.2889],
  ['Ciudad del Este', 'Alto Parana', -25.5097, -54.6111],
  ['Hernandarias', 'Alto Parana', -25.4068, -54.6384],
  ['Presidente Franco', 'Alto Parana', -25.5638, -54.6107],
  ['Minga Guazu', 'Alto Parana', -25.4924, -54.7606],
  ['Santa Rita', 'Alto Parana', -25.7833, -55.0667],
  ['Encarnacion', 'Itapua', -27.3306, -55.8667],
  ['Cambyreta', 'Itapua', -27.3581, -55.7619],
  ['Hohenau', 'Itapua', -27.0797, -55.6439],
  ['Obligado', 'Itapua', -27.0333, -55.6333],
  ['Coronel Oviedo', 'Caaguazu', -25.4444, -56.4403],
  ['Caaguazu', 'Caaguazu', -25.4710, -56.0160],
  ['Villarrica', 'Guaira', -25.7495, -56.4352],
  ['Caazapa', 'Caazapa', -26.1958, -56.3681],
  ['Pedro Juan Caballero', 'Amambay', -22.5472, -55.7333],
  ['Concepcion', 'Concepcion', -23.4064, -57.4344],
  ['San Pedro de Ycuamandiyu', 'San Pedro', -24.0917, -57.0764],
  ['Salto del Guaira', 'Canindeyu', -24.0625, -54.3069],
  ['Caacupe', 'Cordillera', -25.3858, -57.1422],
  ['Eusebio Ayala', 'Cordillera', -25.3828, -56.9602],
  ['Piribebuy', 'Cordillera', -25.4644, -57.0418],
  ['Paraguari', 'Paraguari', -25.6208, -57.1472],
  ['Carapegua', 'Paraguari', -25.8000, -57.2333],
  ['Pilar', 'Neembucu', -26.8691, -58.2935],
  ['San Juan Bautista', 'Misiones', -26.6700, -57.1458],
  ['Ayolas', 'Misiones', -27.3847, -56.8461],
  ['Filadelfia', 'Boqueron', -22.3394, -60.0316],
  ['Loma Plata', 'Boqueron', -22.3820, -59.8370],
  ['Mariscal Estigarribia', 'Boqueron', -22.0300, -60.6111]
];

async function tryDDL(sql) {
  try {
    await pool.query(sql);
  } catch (error) {
    const ignored = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME']);
    if (!ignored.has(error?.code)) throw error;
  }
}

export function normalizeCityName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export async function ensureRoutePlanningSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS cities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      normalized_name VARCHAR(140) NOT NULL,
      department VARCHAR(120) NULL,
      country_code CHAR(2) NOT NULL DEFAULT 'PY',
      latitude DECIMAL(10,7) NULL,
      longitude DECIMAL(10,7) NULL,
      color VARCHAR(7) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      is_custom TINYINT(1) NOT NULL DEFAULT 0,
      created_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY ux_cities_country_name (country_code, normalized_name),
      INDEX idx_cities_active (active),
      INDEX idx_cities_department (department)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await pool.query(`CREATE TABLE IF NOT EXISTS route_cities (
      route_id INT NOT NULL,
      city_id INT NOT NULL,
      city_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (route_id, city_id),
      INDEX idx_route_cities_city (city_id),
      CONSTRAINT fk_route_cities_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
      CONSTRAINT fk_route_cities_city FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await pool.query(`CREATE TABLE IF NOT EXISTS route_planning_settings (
      id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
      stale_visit_days INT NOT NULL DEFAULT 60,
      updated_by BIGINT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`INSERT IGNORE INTO route_planning_settings (id, stale_visit_days) VALUES (1, 60)`);

    const ddls = [
      `ALTER TABLE organizations ADD COLUMN city_id INT NULL AFTER city`,
      `ALTER TABLE organizations ADD COLUMN maps_url VARCHAR(500) NULL AFTER longitude`,
      `ALTER TABLE organizations ADD INDEX idx_org_city_id (city_id)`,
      `ALTER TABLE org_branches ADD COLUMN city_id INT NULL AFTER city`,
      `ALTER TABLE org_branches ADD INDEX idx_branch_city_id (city_id)`,
      `ALTER TABLE routes MODIFY COLUMN zone_id INT NULL`,
      `ALTER TABLE routes MODIFY COLUMN status ENUM('draft','planned','in_progress','completed','cancelled','borrador','planificado','en_curso','completado','cancelado') DEFAULT 'borrador'`,
      `ALTER TABLE routes ADD COLUMN workday_start TIME NULL DEFAULT '08:00:00' AFTER end_date`,
      `ALTER TABLE routes ADD COLUMN workday_end TIME NULL DEFAULT '17:00:00' AFTER workday_start`,
      `ALTER TABLE routes ADD COLUMN default_visit_minutes INT NOT NULL DEFAULT 60 AFTER workday_end`,
      `ALTER TABLE routes ADD COLUMN travel_buffer_minutes INT NOT NULL DEFAULT 20 AFTER default_visit_minutes`,
      `ALTER TABLE routes ADD COLUMN confirmed_at DATETIME NULL AFTER notes`,
      `ALTER TABLE routes ADD COLUMN confirmed_by BIGINT NULL AFTER confirmed_at`,
      `ALTER TABLE route_stops ADD COLUMN org_branch_id INT NULL AFTER organization_id`,
      `ALTER TABLE route_stops ADD COLUMN city_id INT NULL AFTER org_branch_id`,
      `ALTER TABLE route_stops ADD COLUMN contact_id INT NULL AFTER city_id`,
      `ALTER TABLE route_stops ADD COLUMN location_name VARCHAR(180) NULL AFTER contact_id`,
      `ALTER TABLE route_stops ADD COLUMN address_snapshot VARCHAR(500) NULL AFTER location_name`,
      `ALTER TABLE route_stops ADD COLUMN latitude_snapshot DECIMAL(10,7) NULL AFTER address_snapshot`,
      `ALTER TABLE route_stops ADD COLUMN longitude_snapshot DECIMAL(10,7) NULL AFTER latitude_snapshot`,
      `ALTER TABLE route_stops ADD COLUMN maps_url_snapshot VARCHAR(500) NULL AFTER longitude_snapshot`,
      `ALTER TABLE route_stops ADD COLUMN suggestion_score INT NOT NULL DEFAULT 0 AFTER maps_url_snapshot`,
      `ALTER TABLE route_stops ADD COLUMN suggestion_reasons JSON NULL AFTER suggestion_score`,
      `ALTER TABLE followup_visits ADD COLUMN route_stop_id INT NULL AFTER org_id`,
      `ALTER TABLE followup_visits ADD COLUMN org_branch_id INT NULL AFTER route_stop_id`,
      `ALTER TABLE followup_visits ADD UNIQUE INDEX ux_followup_route_stop (route_stop_id)`
    ];
    for (const ddl of ddls) await tryDDL(ddl);

    await pool.query(`UPDATE routes SET status = CASE status
      WHEN 'draft' THEN 'borrador'
      WHEN 'planned' THEN 'planificado'
      WHEN 'in_progress' THEN 'en_curso'
      WHEN 'completed' THEN 'completado'
      WHEN 'cancelled' THEN 'cancelado'
      ELSE status END`);
    await pool.query(`ALTER TABLE routes MODIFY COLUMN status
      ENUM('borrador','planificado','en_curso','completado','cancelado') DEFAULT 'borrador'`);

    for (const [name, department, latitude, longitude] of CORE_CITIES) {
      await pool.query(
        `INSERT INTO cities (name, normalized_name, department, country_code, latitude, longitude, is_custom)
         VALUES (?, ?, ?, 'PY', ?, ?, 0)
         ON DUPLICATE KEY UPDATE department = COALESCE(cities.department, VALUES(department)),
           latitude = COALESCE(cities.latitude, VALUES(latitude)),
           longitude = COALESCE(cities.longitude, VALUES(longitude))`,
        [name, normalizeCityName(name), department, latitude, longitude]
      );
    }

    await pool.query(`UPDATE organizations o
      INNER JOIN cities c ON c.normalized_name = UPPER(TRIM(o.city))
      SET o.city_id = c.id
      WHERE o.city_id IS NULL AND o.city IS NOT NULL AND TRIM(o.city) <> ''`).catch(() => {});
    await pool.query(`UPDATE org_branches b
      INNER JOIN cities c ON c.normalized_name = UPPER(TRIM(b.city))
      SET b.city_id = c.id
      WHERE b.city_id IS NULL AND b.city IS NOT NULL AND TRIM(b.city) <> ''`).catch(() => {});
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

export function haversineKm(a, b) {
  const lat1 = Number(a?.latitude);
  const lon1 = Number(a?.longitude);
  const lat2 = Number(b?.latitude);
  const lon2 = Number(b?.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function orderByNearestNeighbor(rows) {
  const located = rows.filter((row) => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude)));
  const missing = rows.filter((row) => !located.includes(row));
  if (located.length < 2) return [...located, ...missing];
  const pending = [...located].sort((a, b) => Number(b.suggestion_score || 0) - Number(a.suggestion_score || 0));
  const ordered = [pending.shift()];
  while (pending.length) {
    const current = ordered[ordered.length - 1];
    pending.sort((a, b) => haversineKm(current, a) - haversineKm(current, b));
    ordered.push(pending.shift());
  }
  return [...ordered, ...missing];
}

export default { ensureRoutePlanningSchema, normalizeCityName, haversineKm, orderByNearestNeighbor };
