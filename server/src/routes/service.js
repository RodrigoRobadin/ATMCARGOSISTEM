// server/src/routes/service.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';
import computeQuoteDefault, { computeQuote as computeQuoteNamed } from '../services/quoteEngine.js';
import { buildQuoteXlsxBuffer } from '../services/quoteXlsxTemplate.js';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import generateWorkOrderPDF from '../services/serviceWorkOrderPdfkit.js';

const router = Router();
const computeQuote = computeQuoteNamed || computeQuoteDefault;

const SERVICE_COMPONENT_TYPES = [
  // Mecánicos
  { name: 'Lona PVC flexible', category: 'mecanico' },
  { name: 'Lona isotérmica doble capa', category: 'refrigeracion' },
  { name: 'Guías laterales', category: 'mecanico' },
  { name: 'Guías lisas continuas sin dientes', category: 'mecanico' },
  { name: 'Guías lisas patentadas', category: 'mecanico' },
  { name: 'Guías Rayflex sin cremallera', category: 'mecanico' },
  { name: 'Guías Rayflex', category: 'mecanico' },
  { name: 'Bolsa inferior', category: 'mecanico' },
  { name: 'Bolsa inferior de sellado', category: 'mecanico' },
  { name: 'Sistema tirar/empujar', category: 'mecanico' },
  { name: 'Sistema autorreparable', category: 'mecanico' },
  { name: 'Refuerzos internos', category: 'mecanico' },
  { name: 'Refuerzos horizontales', category: 'mecanico' },
  { name: 'Sellado perimetral', category: 'mecanico' },
  { name: 'Sellado total perimetral', category: 'mecanico' },
  { name: 'Sellado lateral reforzado', category: 'mecanico' },
  { name: 'Sistema resistencia viento 60 km/h', category: 'mecanico' },
  { name: 'Resistencia viento hasta 115 km/h', category: 'mecanico' },
  { name: 'Sistema para presión hasta 300 Pa', category: 'mecanico' },
  { name: 'Sistema presión positiva/negativa hasta 300 Pa', category: 'mecanico' },
  { name: 'Sistema de salida de emergencia (corte en T)', category: 'mecanico' },
  { name: 'Cremallera de recomposición', category: 'mecanico' },
  { name: 'Lona flexible sin barras metálicas', category: 'mecanico' },
  { name: 'Amortiguadores tipo resorte en guías', category: 'mecanico' },
  { name: 'Engranajes acoplados al motor', category: 'mecanico' },
  { name: 'Columnas de aluminio anodizado', category: 'mecanico' },
  { name: 'Perfil compacto higiénico', category: 'mecanico' },
  { name: 'Pantalla UV', category: 'mecanico' },
  { name: 'Llaves de seguridad Clase 4', category: 'mecanico' },
  { name: 'Sistema antiintrusión', category: 'mecanico' },
  { name: 'Zapatos de ajuste', category: 'mecanico' },
  { name: 'Estructura compacta', category: 'mecanico' },
  // Seccional / muelles
  { name: 'Paneles isotérmicos 40mm', category: 'mecanico' },
  { name: 'Gomas de sellado perimetral', category: 'mecanico' },
  { name: 'Ventanas de policarbonato', category: 'mecanico' },
  { name: 'Sistema antiaplastamiento de dedos', category: 'mecanico' },
  { name: 'Dispositivo antirotura de muelles', category: 'mecanico' },
  { name: 'Sistema anticaída', category: 'mecanico' },
  { name: 'Refuerzo interior de paneles', category: 'mecanico' },
  { name: 'Sistema manual / motorizado / automático', category: 'mecanico' },
  { name: 'Opciones vertical / high lift / standard lift', category: 'mecanico' },
  { name: 'Tubos horizontales internos', category: 'mecanico' },
  { name: 'Aislante térmico opcional', category: 'mecanico' },
  { name: 'Sistema manual (cadena)', category: 'mecanico' },
  { name: 'Botonera abrir/parar/cerrar', category: 'electrico' },
  { name: 'Polipasto manual de emergencia', category: 'mecanico' },
  // Eléctricos
  { name: 'Motor alto rendimiento', category: 'electrico' },
  { name: 'Motor incorporado diseño higiénico', category: 'electrico' },
  { name: 'Motor', category: 'electrico' },
  { name: 'Encoder', category: 'electrico' },
  { name: 'Encoder absoluto', category: 'electrico' },
  { name: 'Panel CLP', category: 'electrico' },
  { name: 'Panel CLP con variador', category: 'electrico' },
  { name: 'Variador de frecuencia', category: 'electrico' },
  { name: 'Fotocélulas integradas', category: 'electrico' },
  { name: 'Fotocélulas', category: 'electrico' },
  { name: 'Sensor superior', category: 'electrico' },
  { name: 'Apertura y cierre automáticos temporizados', category: 'electrico' },
  { name: 'Sistema integrado con robots', category: 'electrico' },
  { name: 'Sistema de accionadores', category: 'electrico' },
  // Refrigeración
  { name: 'Sistema de deshielo', category: 'refrigeracion' },
  { name: 'Núcleo aislante térmico', category: 'refrigeracion' },
  { name: 'Solapa superior de sellado', category: 'refrigeracion' },
  { name: 'Solapa superior', category: 'refrigeracion' },
];

const SERVICE_ACTUATOR_TYPES = [
  'Botonera',
  'Botonera sin toque',
  'Radar de movimiento',
  'Control de acceso',
  'Tirador',
  'Control remoto',
  'Lazo de inducción',
];

async function ensureServiceTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_pipeline (
      id INT PRIMARY KEY,
      name VARCHAR(100) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_stages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pipeline_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      order_index INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_component_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      category ENUM('mecanico','electrico','refrigeracion') NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_actuator_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_doors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      placa_id VARCHAR(120) NOT NULL,
      ref_int VARCHAR(120) NULL,
      nro_serie VARCHAR(120) NULL,
      nombre VARCHAR(120) NULL,
      sector VARCHAR(120) NULL,
      marca VARCHAR(120) DEFAULT 'Rayflex',
      modelo VARCHAR(120) NULL,
      dimensiones VARCHAR(120) NULL,
      org_branch_id INT NULL,
      fecha_instalacion DATE NULL,
      fecha_ultimo_mantenimiento DATE NULL,
      notas TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_org (org_id),
      UNIQUE KEY uq_placa (placa_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    await pool.query('ALTER TABLE client_doors ADD COLUMN ref_int VARCHAR(120) NULL');
  } catch (_) {}
  try {
    await pool.query('ALTER TABLE client_doors ADD COLUMN org_branch_id INT NULL');
  } catch (_) {}
  try {
    await pool.query('ALTER TABLE client_doors ADD COLUMN nro_serie VARCHAR(120) NULL');
  } catch (_) {}
  try {
    await pool.query('ALTER TABLE client_doors ADD COLUMN nombre VARCHAR(120) NULL');
  } catch (_) {}
  try {
    await pool.query('ALTER TABLE client_doors ADD COLUMN sector VARCHAR(120) NULL');
  } catch (_) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_door_components (
      door_id INT NOT NULL,
      component_id INT NOT NULL,
      PRIMARY KEY (door_id, component_id),
      FOREIGN KEY (door_id) REFERENCES client_doors(id) ON DELETE CASCADE,
      FOREIGN KEY (component_id) REFERENCES service_component_types(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_door_actuators (
      door_id INT NOT NULL,
      actuator_id INT NOT NULL,
      PRIMARY KEY (door_id, actuator_id),
      FOREIGN KEY (door_id) REFERENCES client_doors(id) ON DELETE CASCADE,
      FOREIGN KEY (actuator_id) REFERENCES service_actuator_types(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_cases (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reference VARCHAR(40) NULL,
      door_id INT NOT NULL,
      org_id INT NOT NULL,
      org_branch_id INT NULL,
      pipeline_id INT NOT NULL,
      stage_id INT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'abierto',
      work_type VARCHAR(30) NULL,
      maintenance_detail TEXT NULL,
      repair_detail TEXT NULL,
      parts_components TEXT NULL,
      parts_actuators TEXT NULL,
      assigned_to INT NULL,
      scheduled_date DATE NULL,
      closed_date DATE NULL,
      work_done TEXT NULL,
      parts_used TEXT NULL,
      cost DECIMAL(15,2) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_stage (stage_id),
      INDEX idx_org (org_id),
      FOREIGN KEY (door_id) REFERENCES client_doors(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_case_doors (
      service_case_id INT NOT NULL,
      door_id INT NOT NULL,
      work_type TEXT NULL,
      maintenance_detail TEXT NULL,
      repair_detail TEXT NULL,
      revision_detail TEXT NULL,
      parts_components TEXT NULL,
      parts_actuators TEXT NULL,
      work_done TEXT NULL,
      parts_used TEXT NULL,
      cost DECIMAL(15,2) NULL,
      PRIMARY KEY (service_case_id, door_id),
      FOREIGN KEY (service_case_id) REFERENCES service_cases(id) ON DELETE CASCADE,
      FOREIGN KEY (door_id) REFERENCES client_doors(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_quotes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_case_id INT NOT NULL,
      ref_code VARCHAR(100),
      revision VARCHAR(50),
      client_name VARCHAR(255),
      status VARCHAR(50) DEFAULT 'draft',
      inputs_json JSON,
      document_snapshot_json JSON,
      computed_json JSON,
      created_by VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_service_quotes_case (service_case_id),
      INDEX idx_case (service_case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_quote_revisions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quote_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      inputs_json JSON,
      document_snapshot_json JSON,
      computed_json JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_quote (quote_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  try {
    await pool.query('ALTER TABLE service_quotes ADD COLUMN document_snapshot_json JSON NULL AFTER inputs_json');
  } catch (_) {}
  try {
    await pool.query('ALTER TABLE service_quote_revisions ADD COLUMN document_snapshot_json JSON NULL AFTER inputs_json');
  } catch (_) {}


  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_case_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_case_id INT NOT NULL,
      action VARCHAR(50) NOT NULL,
      notes TEXT NULL,
      old_stage_id INT NULL,
      new_stage_id INT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_case (service_case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_quote_additions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_case_id INT NOT NULL,
      name VARCHAR(120) NULL,
      status VARCHAR(50) DEFAULT 'draft',
      inputs_json JSON,
      computed_json JSON,
      created_by VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_case (service_case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_case_door_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_case_id INT NOT NULL,
      door_id INT NOT NULL,
      work_type VARCHAR(200) NULL,
      maintenance_detail TEXT NULL,
      repair_detail TEXT NULL,
      parts_components TEXT NULL,
      parts_actuators TEXT NULL,
      work_done TEXT NULL,
      parts_used TEXT NULL,
      cost DECIMAL(15,2) NULL,
      stage_id INT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_case (service_case_id),
      INDEX idx_door (door_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_case_door_parts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_case_id INT NOT NULL,
      door_id INT NOT NULL,
      part_name VARCHAR(200) NOT NULL,
      quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
      unit_cost DECIMAL(15,2) NULL,
      currency VARCHAR(8) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_case (service_case_id),
      INDEX idx_door (door_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_case_custom_fields (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_case_id INT NOT NULL,
      \`key\` VARCHAR(100) NOT NULL,
      value TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_service_case_key (service_case_id, \`key\`),
      INDEX idx_service_case (service_case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    await pool.query('ALTER TABLE service_case_custom_fields MODIFY COLUMN value LONGTEXT NULL');
  } catch (_) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_case_install_costs (
      service_case_id INT PRIMARY KEY,
      real_cost_amount DECIMAL(15,2) NULL,
      real_cost_currency VARCHAR(8) NULL,
      real_cost_exchange_rate DECIMAL(15,6) NULL,
      real_cost_items_json TEXT NULL,
      notes TEXT NULL,
      updated_by INT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (service_case_id) REFERENCES service_cases(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try { await pool.query('ALTER TABLE service_case_install_costs ADD COLUMN real_cost_items_json TEXT NULL'); } catch (_) {}

  // Add reference column if table existed before
  try {
    await pool.query('ALTER TABLE service_cases ADD COLUMN reference VARCHAR(40) NULL');
  } catch (_) {}

  try {
    await pool.query('ALTER TABLE service_cases ADD COLUMN org_branch_id INT NULL');
  } catch (_) {}


  try { await pool.query('ALTER TABLE service_cases ADD COLUMN work_type VARCHAR(30) NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_cases ADD COLUMN maintenance_detail TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_cases ADD COLUMN repair_detail TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_cases ADD COLUMN parts_components TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_cases ADD COLUMN parts_actuators TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors ADD COLUMN work_type TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors MODIFY work_type TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors ADD COLUMN maintenance_detail TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors ADD COLUMN repair_detail TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors ADD COLUMN revision_detail TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors ADD COLUMN parts_components TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors ADD COLUMN parts_actuators TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors ADD COLUMN work_done TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors ADD COLUMN parts_used TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_doors ADD COLUMN cost DECIMAL(15,2) NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN work_type TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history MODIFY work_type TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN maintenance_detail TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN repair_detail TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN revision_detail TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN parts_components TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN parts_actuators TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN work_done TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN parts_used TEXT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN cost DECIMAL(15,2) NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN stage_id INT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_history ADD COLUMN created_by INT NULL'); } catch (_) {}
  try { await pool.query('ALTER TABLE service_case_door_parts ADD COLUMN notes TEXT NULL'); } catch (_) {}
  await pool.query(`INSERT IGNORE INTO service_pipeline (id, name) VALUES (1, 'Service Pipeline')`);

  // Seed stages from pipeline 1 if empty
  const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM service_stages WHERE pipeline_id = 1');
  if (!cnt?.c) {
    const [stages] = await pool.query(
      'SELECT name, order_index FROM stages WHERE pipeline_id = 1 ORDER BY order_index ASC'
    );
    if (Array.isArray(stages) && stages.length) {
      const values = stages.map((s) => [1, s.name, s.order_index]);
      await pool.query('INSERT INTO service_stages (pipeline_id, name, order_index) VALUES ?', [values]);
    }
  }

  // Seed component types
  for (const c of SERVICE_COMPONENT_TYPES) {
    await pool.query(
      'INSERT IGNORE INTO service_component_types (name, category) VALUES (?, ?)',
      [c.name, c.category]
    );
  }
  // Seed actuator types
  for (const a of SERVICE_ACTUATOR_TYPES) {
    await pool.query(
      'INSERT IGNORE INTO service_actuator_types (name) VALUES (?)',
      [a]
    );
  }
  // Cleanup old actuator types not in list
  if (SERVICE_ACTUATOR_TYPES.length) {
    await pool.query(
      `DELETE FROM service_actuator_types WHERE name NOT IN (${SERVICE_ACTUATOR_TYPES.map(() => '?').join(',')})`,
      SERVICE_ACTUATOR_TYPES
    );
  }
}

ensureServiceTables().catch((e) => console.error('[service] init tables', e?.message || e));

// ====== helpers ======
async function getParamValue(key, conn = pool) {
  const [rows] = await conn.query(
    'SELECT `key`, value FROM param_values WHERE `key` = ? ORDER BY ord DESC, id DESC LIMIT 1',
    [key]
  );
  return rows?.[0] || null;
}

async function upsertParam(key, value, conn = pool) {
  try {
    const existing = await getParamValue(key, conn);
    if (existing?.key) {
      await conn.query('UPDATE param_values SET value = ?, active = 1, ord = 0 WHERE `key` = ?', [value, key]);
      return;
    }
  } catch (_) {}
  await conn.query(
    'INSERT INTO param_values (`key`, value, ord, active) VALUES (?, ?, 0, 1)',
    [key, value]
  );
}

function parseLastNumber(ref) {
  const match = String(ref || '').match(/(\d+)(?!.*\d)/);
  if (!match) return NaN;
  return parseInt(match[1], 10);
}

async function nextServiceReference(conn = pool) {
  const paramKey = 'sv_next_reference';
  const legacyKeys = ['op_sv_next_reference', 'service_next_reference'];
  let next = 1;
  const prefix = 'SV-';

  const [[svRow]] = await conn.query(
    "SELECT MAX(CAST(SUBSTRING(reference, 4) AS UNSIGNED)) AS max_ref\n" +
      "FROM service_cases WHERE reference REGEXP '^SV-[0-9]+$'"
  );
  next = Number(svRow?.max_ref || 0) + 1;

  const paramVal = parseInt((await getParamValue(paramKey, conn))?.value || 'NaN', 10);
  if (Number.isFinite(paramVal)) next = Math.max(next, paramVal);
  for (const k of legacyKeys) {
    const v = parseInt((await getParamValue(k, conn))?.value || 'NaN', 10);
    if (Number.isFinite(v)) next = Math.max(next, v);
  }

  if (next < 2) next = 2; // nunca generar SV-000001

  const reference = `${prefix}${String(next).padStart(6, '0')}`;
  try {
    await upsertParam(paramKey, String(next + 1), conn);
  } catch (_) {}

  return reference;
}

function normalizeInputs(body = {}) {
  return body?.inputs || body || {};
}

async function syncServiceCaseBranch(serviceCaseId, orgBranchId) {
  if (!serviceCaseId) return;
  const branchVal = orgBranchId == null || orgBranchId === '' ? null : Number(orgBranchId);
  try {
    await pool.query('UPDATE service_cases SET org_branch_id = ? WHERE id = ?', [branchVal, serviceCaseId]);
  } catch (e) {
    console.error('[service][branch] No se pudo actualizar sucursal:', e?.message || e);
  }
}

function asJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeDocumentSnapshot(value) {
  const parsed = asJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeCurrency(code) {
  const c = String(code || '').toUpperCase();
  if (c === 'GS') return 'PYG';
  return c || 'USD';
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickInstallTotals(computed) {
  const totals = computed?.instalacion?.totals || {};
  return {
    sale_usd: toNumber(totals.installation_total_sale_usd),
    sale_gs: toNumber(totals.installation_total_sale_gs),
    cost_usd: toNumber(totals.installation_total_cost_usd),
    cost_gs: toNumber(totals.installation_total_cost_gs),
  };
}

function pickOfertaTotalUsd(computed) {
  const t = toNumber(computed?.oferta?.totals?.total_sales_usd);
  if (t > 0) return t;
  const items = Array.isArray(computed?.oferta?.items) ? computed.oferta.items : [];
  if (!items.length) return 0;
  return items.reduce((sum, it) => sum + toNumber(it.total_sales), 0);
}

function convertAmount(amount, fromCurrency, toCurrency, rateGsPerUsd = 1) {
  const amt = toNumber(amount);
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  const rate = toNumber(rateGsPerUsd) || 1;
  if (from === to) return amt;
  if (from === 'PYG' && to === 'USD') return amt / rate;
  if (from === 'USD' && to === 'PYG') return amt * rate;
  return amt;
}

async function isServiceCaseInvoiced(serviceCaseId) {
  if (!serviceCaseId) return false;
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS cnt
         FROM invoices
        WHERE status <> 'anulada'
          AND COALESCE(net_total_amount, total_amount, 0) > 0.01
          AND service_case_id = ?`,
      [serviceCaseId]
    );
    return Number(row?.cnt || 0) > 0;
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') return false;
    throw err;
  }
}

async function assertServiceCaseUnlocked(serviceCaseId, res) {
  if (!serviceCaseId) return true;
  const locked = await isServiceCaseInvoiced(serviceCaseId);
  if (locked) {
    res.status(409).json({ error: 'Servicio ya facturado. No se puede modificar.' });
    return false;
  }
  return true;
}

function safeCompute(inputs) {
  try {
    if (!computeQuote) {
      return {
        computed: null,
        compute_error: 'computeQuote no disponible.',
      };
    }
    const computed = computeQuote(inputs);
    return { computed, compute_error: null };
  } catch (e) {
    return {
      computed: null,
      compute_error: e?.message || 'No se pudo calcular.',
    };
  }
}

async function syncServiceQuoteItemsFromDoors(serviceCaseId) {
  const [[quote]] = await pool.query(
    'SELECT id, inputs_json FROM service_quotes WHERE service_case_id = ? LIMIT 1',
    [serviceCaseId]
  );
  if (!quote) return;

  const [doors] = await pool.query(
    `SELECT d.placa_id,
            sd.work_type, sd.maintenance_detail, sd.repair_detail,
            sd.parts_components, sd.parts_actuators, sd.revision_detail,
            sd.door_id
       FROM service_case_doors sd
       JOIN client_doors d ON d.id = sd.door_id
      WHERE sd.service_case_id = ?
      ORDER BY d.id`,
    [serviceCaseId]
  );

  const [partsRows] = await pool.query(
    `SELECT door_id, part_name, quantity, unit_cost, currency
       FROM service_case_door_parts
      WHERE service_case_id = ?
      ORDER BY id ASC`,
    [serviceCaseId]
  );
  const partsByDoor = partsRows.reduce((acc, row) => {
    const key = String(row.door_id);
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const items = [];
  let line = 1;
  const normalizeTypes = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
    return [String(val)];
  };
  const joinList = (val) => {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.join(', ');
    } catch (_) {}
    return typeof val === 'string' ? val : '';
  };
  const joinParts = (doorId) => {
    const list = partsByDoor[String(doorId)] || [];
    if (!list.length) return '';
    return list
      .map((p) => {
        const qty = Number(p.quantity || 1);
        const base = `${p.part_name}${qty ? ` x${qty}` : ''}`;
        if (p.unit_cost != null && p.unit_cost !== '') {
          const curr = p.currency ? String(p.currency).toUpperCase() : 'PYG';
          return `${base} (${curr} ${p.unit_cost})`;
        }
        return base;
      })
      .join(', ');
  };

  for (const d of doors) {
    const placa = d.placa_id || 'Puerta';
    const types = normalizeTypes(d.work_type);
    for (const t of types) {
      let detail = '';
      if (t === 'mantenimiento') detail = d.maintenance_detail || '';
      else if (t === 'reparacion') detail = d.repair_detail || '';
      else if (t === 'revision') detail = d.revision_detail || '';
      else if (t === 'cambio_piezas') {
        const comps = joinList(d.parts_components);
        const acts = joinList(d.parts_actuators);
        const parts = joinParts(d.door_id);
        detail = [comps, acts, parts].filter(Boolean).join(' | ');
      }
      const label =
        t === 'mantenimiento'
          ? 'Mantenimiento'
          : t === 'reparacion'
          ? 'Reparacion'
          : t === 'revision'
          ? 'Revision'
          : 'Cambio de piezas';
      const desc = `${placa} - ${label}${detail ? ` - ${detail}` : ''}`;
      items.push({
        line_no: line++,
        description: desc,
        observation: '',
        qty: 1,
        door_value_usd: 0,
        additional_usd: 0,
        tax_rate: 10,
      });
    }
  }

  if (!items.length) return;

  const inputs = asJson(quote.inputs_json) || {};
  const nextInputs = { ...inputs, items };
  const { computed } = safeCompute(nextInputs);
  await pool.query(
    'UPDATE service_quotes SET inputs_json = ?, computed_json = ? WHERE id = ?',
    [JSON.stringify(nextInputs), computed ? JSON.stringify(computed) : null, quote.id]
  );
}


async function insertServiceHistory(caseId, action, notes = null, oldStageId = null, newStageId = null, userId = null) {
  try {
    await pool.query(
      `INSERT INTO service_case_history (service_case_id, action, notes, old_stage_id, new_stage_id, created_by)
       VALUES (?,?,?,?,?,?)`,
      [caseId, action, notes, oldStageId, newStageId, userId]
    );
  } catch (_) {}
}

async function htmlToPdf(html) {
  const resolveChromePath = () => {
    const envPath =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROME_PATH ||
      process.env.GOOGLE_CHROME_SHIM;
    if (envPath && fs.existsSync(envPath)) return envPath;
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  };
  const executablePath = resolveChromePath();
  if (!executablePath) {
    throw new Error('Chrome/Edge no encontrado. Define PUPPETEER_EXECUTABLE_PATH o instala Chrome.');
  }
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 20, right: 20, bottom: 20, left: 20 } });
  await browser.close();
  return { buffer: pdf };
}
function formatJsonList(raw) {
  if (!raw) return '';
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.join(', ');
  } catch (_) {}
  return String(raw);
}



async function getServiceQuoteById(quoteId) {
  const [[row]] = await pool.query('SELECT * FROM service_quotes WHERE id = ? LIMIT 1', [quoteId]);
  if (!row) return null;
  return {
    id: row.id,
    service_case_id: row.service_case_id,
    inputs: asJson(row.inputs_json) || {},
    document_snapshot: normalizeDocumentSnapshot(row.document_snapshot_json),
    computed: asJson(row.computed_json) || null,
    meta: {
      ref_code: row.ref_code,
      revision: row.revision,
      client_name: row.client_name,
      status: row.status,
      updated_at: row.updated_at,
    },
  };
}

async function getServiceRevisionById(quoteId, revisionId) {
  const [[rev]] = await pool.query(
    'SELECT * FROM service_quote_revisions WHERE id = ? AND quote_id = ? LIMIT 1',
    [revisionId, quoteId]
  );
  if (!rev) return null;
  return {
    id: rev.id,
    name: rev.name,
    inputs: asJson(rev.inputs_json) || {},
    document_snapshot: normalizeDocumentSnapshot(rev.document_snapshot_json),
    computed: asJson(rev.computed_json) || null,
    created_at: rev.created_at,
  };
}

async function listServiceRevisions(quoteId) {
  const [rows] = await pool.query(
    'SELECT id, name, created_at FROM service_quote_revisions WHERE quote_id = ? ORDER BY id DESC',
    [quoteId]
  );
  return rows;
}

async function doorComponents(doorId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.category
       FROM service_door_components dc
       JOIN service_component_types c ON c.id = dc.component_id
      WHERE dc.door_id = ?
      ORDER BY c.category, c.name`,
    [doorId]
  );
  return rows || [];
}

async function doorActuators(doorId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.name
       FROM service_door_actuators da
       JOIN service_actuator_types a ON a.id = da.actuator_id
      WHERE da.door_id = ?
      ORDER BY a.name`,
    [doorId]
  );
  return rows || [];
}

// ====== routes ======
router.get('/component-types', requireAuth, requireAnyRole('admin', 'service'), async (_req, res) => {
  const [rows] = await pool.query('SELECT id, name, category FROM service_component_types ORDER BY category, name');

  const list = (rows || []).map((r) => {
    const computed = asJson(r.last_quote_computed) || null;
    const profit = computed?.operacion?.totals?.profit_total_usd ?? null;
    return { ...r, profit_total_usd: profit };
  });
  res.json(list);
  return;

});

router.get('/actuator-types', requireAuth, requireAnyRole('admin', 'service'), async (_req, res) => {
  const [rows] = await pool.query('SELECT id, name FROM service_actuator_types ORDER BY name');

  const list = (rows || []).map((r) => {
    const computed = asJson(r.last_quote_computed) || null;
    const profit = computed?.operacion?.totals?.profit_total_usd ?? null;
    return { ...r, profit_total_usd: profit };
  });
  res.json(list);
  return;

});

router.get('/stages', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const pid = Number(req.query.pipeline_id || 1);
  const [rows] = await pool.query(
    'SELECT id, name, order_index FROM service_stages WHERE pipeline_id = ? ORDER BY order_index ASC',
    [pid]
  );

  const list = (rows || []).map((r) => {
    const computed = asJson(r.last_quote_computed) || null;
    const profit = computed?.operacion?.totals?.profit_total_usd ?? null;
    return { ...r, profit_total_usd: profit };
  });
  res.json(list);
  return;

});

router.get('/doors', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const orgId = Number(req.query.org_id || 0);
  let sql = `SELECT d.*, o.name AS org_name, o.ruc AS org_ruc,
                    ob.name AS org_branch_name, ob.address AS org_branch_address, ob.city AS org_branch_city, ob.country AS org_branch_country
               FROM client_doors d
               LEFT JOIN organizations o ON o.id = d.org_id
               LEFT JOIN org_branches ob ON ob.id = d.org_branch_id`;
  const params = [];
  if (orgId) {
    sql += ' WHERE d.org_id = ?';
    params.push(orgId);
  }
  sql += ' ORDER BY d.updated_at DESC';
  const [rows] = await pool.query(sql, params);

  const list = (rows || []).map((r) => {
    const computed = asJson(r.last_quote_computed) || null;
    const profit = computed?.operacion?.totals?.profit_total_usd ?? null;
    return { ...r, profit_total_usd: profit };
  });
  res.json(list);
  return;

});

router.get('/doors/:id', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  const [[door]] = await pool.query(
    `SELECT d.*, o.name AS org_name, o.ruc AS org_ruc,
            ob.name AS org_branch_name, ob.address AS org_branch_address, ob.city AS org_branch_city, ob.country AS org_branch_country
       FROM client_doors d
       LEFT JOIN organizations o ON o.id = d.org_id
       LEFT JOIN org_branches ob ON ob.id = d.org_branch_id
      WHERE d.id = ?`,
    [id]
  );
  if (!door) return res.status(404).json({ error: 'Puerta no encontrada' });
  const components = await doorComponents(id);
  const actuators = await doorActuators(id);
  const [history] = await pool.query(
    `SELECT h.*, sc.reference, sc.status, s.name AS stage_name, u.name AS user_name
       FROM service_case_door_history h
       LEFT JOIN service_cases sc ON sc.id = h.service_case_id
       LEFT JOIN service_stages s ON s.id = h.stage_id
       LEFT JOIN users u ON u.id = h.created_by
      WHERE h.door_id = ?
      ORDER BY h.created_at DESC, h.id DESC`,
    [id]
  );
  const [parts] = await pool.query(
    `SELECT p.*, sc.reference, sc.status, s.name AS stage_name, u.name AS user_name
       FROM service_case_door_parts p
       LEFT JOIN service_cases sc ON sc.id = p.service_case_id
       LEFT JOIN service_stages s ON s.id = sc.stage_id
       LEFT JOIN users u ON u.id = p.created_by
      WHERE p.door_id = ?
      ORDER BY p.created_at DESC, p.id DESC`,
    [id]
  );
  let historyRows = history || [];
  if (!historyRows.length) {
    const [fallback] = await pool.query(
      `SELECT scd.*, sc.reference, sc.status, s.name AS stage_name, sc.updated_at AS created_at, sc.id AS service_case_id
         FROM service_case_doors scd
         LEFT JOIN service_cases sc ON sc.id = scd.service_case_id
         LEFT JOIN service_stages s ON s.id = sc.stage_id
        WHERE scd.door_id = ?
        ORDER BY sc.updated_at DESC, sc.id DESC`,
      [id]
    );
    historyRows = fallback || [];
  }
  const timeline = [
    ...(historyRows || []).map((h) => ({
      ...h,
      event_type: "detalle",
      event_date: h.created_at,
    })),
    ...(parts || []).map((p) => ({
      ...p,
      event_type: "piezas",
      event_date: p.created_at,
    })),
  ].sort((a, b) => new Date(b.event_date || 0) - new Date(a.event_date || 0));
  res.json({ door, components, actuators, history: historyRows, parts: parts || [], timeline });
});

// ====== install cost (real) ======
router.get('/cases/:id/install-cost', requireAuth, requireAnyRole('admin', 'service', 'finanzas'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'service_case_id requerido' });
  const [[row]] = await pool.query(
    `SELECT service_case_id, real_cost_amount, real_cost_currency, real_cost_exchange_rate, real_cost_items_json, notes, updated_by, updated_at
       FROM service_case_install_costs
      WHERE service_case_id = ?`,
    [id]
  );
  res.json(row || null);
});

router.put('/cases/:id/install-cost', requireAuth, requireAnyRole('admin', 'service', 'finanzas'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'service_case_id requerido' });
  const {
    real_cost_amount,
    real_cost_currency,
    real_cost_exchange_rate,
    real_cost_items,
    notes,
  } = req.body || {};

  await pool.query(
    `INSERT INTO service_case_install_costs
      (service_case_id, real_cost_amount, real_cost_currency, real_cost_exchange_rate, real_cost_items_json, notes, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      real_cost_amount = VALUES(real_cost_amount),
      real_cost_currency = VALUES(real_cost_currency),
      real_cost_exchange_rate = VALUES(real_cost_exchange_rate),
      real_cost_items_json = VALUES(real_cost_items_json),
      notes = VALUES(notes),
      updated_by = VALUES(updated_by),
      updated_at = CURRENT_TIMESTAMP`,
    [
      id,
      real_cost_amount ?? null,
      real_cost_currency ? String(real_cost_currency).toUpperCase() : null,
      real_cost_exchange_rate ?? null,
      real_cost_items ? JSON.stringify(real_cost_items) : null,
      notes || null,
      req.user?.id || null,
    ]
  );

  const [[row]] = await pool.query(
    `SELECT service_case_id, real_cost_amount, real_cost_currency, real_cost_exchange_rate, real_cost_items_json, notes, updated_by, updated_at
       FROM service_case_install_costs
      WHERE service_case_id = ?`,
    [id]
  );
  res.json(row || null);
});

// ====== service sheet ======
router.get('/sheet', requireAuth, requireAnyRole('admin', 'service', 'finanzas'), async (req, res) => {
  try {
    const { from, to } = req.query || {};
    const params = [];
    let where = `i.service_case_id IS NOT NULL AND i.status <> 'anulada' AND i.status <> 'borrador'`;
    if (from) {
      where += ' AND i.issue_date >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND i.issue_date <= ?';
      params.push(to);
    }

    const [invRows] = await pool.query(
      `SELECT i.id AS invoice_id, i.invoice_number, i.issue_date, i.status, i.currency_code, i.exchange_rate,
              i.total_amount, i.net_total_amount, i.net_balance,
              i.service_case_id, sc.reference, sc.org_id, o.name AS org_name,
              COALESCE(sqr.inputs_json, sq.inputs_json) AS inputs_json,
              COALESCE(sqr.computed_json, sq.computed_json) AS computed_json
         FROM invoices i
         JOIN service_cases sc ON sc.id = i.service_case_id
         LEFT JOIN organizations o ON o.id = sc.org_id
         LEFT JOIN service_quotes sq ON sq.service_case_id = sc.id
         LEFT JOIN (
           SELECT r1.*
             FROM service_quote_revisions r1
             JOIN (
               SELECT quote_id, MAX(id) AS max_id
                 FROM service_quote_revisions
                GROUP BY quote_id
             ) r2
               ON r1.quote_id = r2.quote_id AND r1.id = r2.max_id
         ) sqr ON sqr.quote_id = sq.id
        WHERE ${where}
        ORDER BY i.issue_date DESC, i.id DESC`,
      params
    );

    if (!invRows || invRows.length === 0) return res.json([]);

    const invoiceIds = invRows.map((r) => r.invoice_id);
    const [receiptRows] = await pool.query(
      `SELECT invoice_id, COALESCE(SUM(net_amount),0) AS paid, MAX(currency_code) AS currency_code
         FROM receipts
        WHERE status = 'emitido' AND invoice_id IN (${invoiceIds.map(() => '?').join(',')})
        GROUP BY invoice_id`,
      invoiceIds
    );
    const receiptsByInv = new Map((receiptRows || []).map((r) => [Number(r.invoice_id), r]));

    const caseIds = Array.from(new Set(invRows.map((r) => Number(r.service_case_id))));
    const costRows = caseIds.length
      ? await pool.query(
          `SELECT service_case_id, real_cost_amount, real_cost_currency, real_cost_exchange_rate, notes
             FROM service_case_install_costs
            WHERE service_case_id IN (${caseIds.map(() => '?').join(',')})`,
          caseIds
        )
      : [[], []];
    const costMap = new Map((costRows[0] || []).map((r) => [Number(r.service_case_id), r]));

    const out = invRows.map((row) => {
      const quoteInputs = asJson(row.inputs_json) || {};
      const computed = asJson(row.computed_json) || {};
      const totals = pickInstallTotals(computed);

      const invCurrency = normalizeCurrency(row.currency_code || quoteInputs.operation_currency || 'USD');
      const installRate = toNumber(quoteInputs.exchange_rate_install_gs_per_usd || row.exchange_rate || 1) || 1;
      const opRate = toNumber(quoteInputs.exchange_rate_operation_sell_usd || row.exchange_rate || 1) || 1;

      const ofertaTotalUsd = pickOfertaTotalUsd(computed);
      const servicio_cotizado_usd = ofertaTotalUsd;
      const servicio_cotizado_gs = ofertaTotalUsd * opRate;
      const ofertaItems = Array.isArray(computed?.oferta?.items) ? computed.oferta.items : [];
      const servicio_cotizado_desc = ofertaItems
        .map((it) => String(it.description || "").trim())
        .filter(Boolean)
        .join(" | ");

      const cost_cotizado_usd = totals.cost_usd || (totals.cost_gs ? totals.cost_gs / installRate : 0);
      const cost_cotizado_gs = totals.cost_gs || (totals.cost_usd ? totals.cost_usd * installRate : 0);

      const servicio_cotizado =
        invCurrency === 'PYG' ? servicio_cotizado_gs : servicio_cotizado_usd;
      const cost_cotizado =
        invCurrency === 'PYG' ? cost_cotizado_gs : cost_cotizado_usd;

      const monto_factura = toNumber(row.net_total_amount || row.total_amount || 0);
      const receipt = receiptsByInv.get(Number(row.invoice_id));
      const receiptCurrency = normalizeCurrency(receipt?.currency_code || invCurrency);
      let cobrado = toNumber(receipt?.paid || 0);
      if (receiptCurrency !== invCurrency) {
        cobrado = convertAmount(cobrado, receiptCurrency, invCurrency, row.exchange_rate || installRate || 1);
      }

      const no_cobrado = toNumber(row.net_balance || Math.max(0, monto_factura - cobrado));

      const installItems = Array.isArray(quoteInputs.install_items) ? quoteInputs.install_items : [];

      const real = costMap.get(Number(row.service_case_id)) || {};
      const realItems = asJson(real?.real_cost_items_json) || null;
      const realItemsSumGs = Array.isArray(realItems)
        ? realItems.reduce((sum, it) => sum + toNumber(it.real_cost_gs), 0)
        : null;

      const realCostAmount = real?.real_cost_amount;
      const realCostCurrency = normalizeCurrency(real?.real_cost_currency || invCurrency);
      const realRate = toNumber(real?.real_cost_exchange_rate || installRate || row.exchange_rate || 1) || 1;
      const cost_real = realItemsSumGs != null
        ? convertAmount(realItemsSumGs, 'PYG', invCurrency, realRate)
        : realCostAmount != null
        ? convertAmount(realCostAmount, realCostCurrency, invCurrency, realRate)
        : cost_cotizado;

      const profit_servicio = monto_factura - cost_cotizado;
      const menor_gasto = cost_cotizado - cost_real;

      const issueDate = row.issue_date ? new Date(row.issue_date) : null;
      const month = issueDate
        ? `${issueDate.getFullYear()}-${String(issueDate.getMonth() + 1).padStart(2, '0')}`
        : 'sin-fecha';

      return {
        month,
        invoice_id: row.invoice_id,
        invoice_number: row.invoice_number,
        issue_date: row.issue_date,
        status: row.status,
        currency: invCurrency,
        exchange_rate: row.exchange_rate || installRate || 1,
        install_rate: installRate,
        install_items: installItems,
        service_case_id: row.service_case_id,
        reference: row.reference,
        org_id: row.org_id,
        org_name: row.org_name,
        servicio_cotizado,
        servicio_cotizado_desc,
        servicio_cotizado_usd,
        servicio_cotizado_gs,
        cost_cotizado,
        cost_cotizado_usd,
        cost_cotizado_gs,
        monto_factura,
        cobrado,
        no_cobrado,
        costo_real: cost_real,
        profit_servicio,
        menor_gasto,
        real_cost_amount: real?.real_cost_amount ?? null,
        real_cost_currency: real?.real_cost_currency || null,
        real_cost_exchange_rate: real?.real_cost_exchange_rate || null,
        real_cost_items: realItems,
        real_cost_notes: real?.notes || null,
      };
    });

    res.json(out);
  } catch (e) {
    console.error('[service][sheet] error', e);
    res.status(500).json({ error: 'No se pudo generar la planilla' });
  }
});

router.post('/doors', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const {
    org_id,
    org_branch_id,
    placa_id,
    ref_int,
    nro_serie,
    nombre,
    sector,
    marca,
    modelo,
    dimensiones,
    fecha_instalacion,
    fecha_ultimo_mantenimiento,
    notas,
    component_ids = [],
    actuator_ids = [],
  } = req.body || {};

  if (!org_id || !placa_id) {
    return res.status(400).json({ error: 'org_id y placa_id son requeridos' });
  }

  const [result] = await pool.query(
    `INSERT INTO client_doors
     (org_id, org_branch_id, placa_id, ref_int, nro_serie, nombre, sector, marca, modelo, dimensiones, fecha_instalacion, fecha_ultimo_mantenimiento, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      org_id,
      org_branch_id || null,
      placa_id,
      ref_int || null,
      nro_serie || null,
      nombre || null,
      sector || null,
      marca || 'Rayflex',
      modelo || null,
      dimensiones || null,
      fecha_instalacion || null,
      fecha_ultimo_mantenimiento || null,
      notas || null,
    ]
  );
  const doorId = result.insertId;

  if (Array.isArray(component_ids) && component_ids.length) {
    const values = component_ids.map((cid) => [doorId, Number(cid)]);
    await pool.query(
      'INSERT IGNORE INTO service_door_components (door_id, component_id) VALUES ?',
      [values]
    );
  }

  if (Array.isArray(actuator_ids) && actuator_ids.length) {
    const values = actuator_ids.map((aid) => [doorId, Number(aid)]);
    await pool.query(
      'INSERT IGNORE INTO service_door_actuators (door_id, actuator_id) VALUES ?',
      [values]
    );
  }

  res.status(201).json({ id: doorId });
});

router.put('/doors/:id', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  const {
    org_id,
    org_branch_id,
    placa_id,
    ref_int,
    nro_serie,
    nombre,
    sector,
    marca,
    modelo,
    dimensiones,
    fecha_instalacion,
    fecha_ultimo_mantenimiento,
    notas,
    component_ids = [],
    actuator_ids = [],
  } = req.body || {};

  await pool.query(
    `UPDATE client_doors
        SET org_id = ?, org_branch_id = ?, placa_id = ?, ref_int = ?, nro_serie = ?, nombre = ?, sector = ?, marca = ?, modelo = ?, dimensiones = ?,
            fecha_instalacion = ?, fecha_ultimo_mantenimiento = ?, notas = ?
      WHERE id = ?`,
    [
      org_id,
      org_branch_id || null,
      placa_id,
      ref_int || null,
      nro_serie || null,
      nombre || null,
      sector || null,
      marca || 'Rayflex',
      modelo || null,
      dimensiones || null,
      fecha_instalacion || null,
      fecha_ultimo_mantenimiento || null,
      notas || null,
      id,
    ]
  );

  await pool.query('DELETE FROM service_door_components WHERE door_id = ?', [id]);
  await pool.query('DELETE FROM service_door_actuators WHERE door_id = ?', [id]);

  if (Array.isArray(component_ids) && component_ids.length) {
    const values = component_ids.map((cid) => [id, Number(cid)]);
    await pool.query(
      'INSERT IGNORE INTO service_door_components (door_id, component_id) VALUES ?',
      [values]
    );
  }
  if (Array.isArray(actuator_ids) && actuator_ids.length) {
    const values = actuator_ids.map((aid) => [id, Number(aid)]);
    await pool.query(
      'INSERT IGNORE INTO service_door_actuators (door_id, actuator_id) VALUES ?',
      [values]
    );
  }

  res.json({ ok: true });
});

router.get('/cases', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const pid = Number(req.query.pipeline_id || 1);
  const [rows] = await pool.query(
    `SELECT sc.*, d.placa_id, d.marca, d.modelo, d.fecha_ultimo_mantenimiento,
            o.name AS org_name, s.name AS stage_name,
            ob.name AS org_branch_name, ob.address AS org_branch_address, ob.city AS org_branch_city,
            sq.computed_json AS last_quote_computed,
            sq.inputs_json AS last_quote_inputs,
            COALESCE(sd.door_count, 0) AS door_count
       FROM service_cases sc
       JOIN client_doors d ON d.id = sc.door_id
       LEFT JOIN organizations o ON o.id = sc.org_id
       LEFT JOIN org_branches ob ON ob.id = sc.org_branch_id
       LEFT JOIN service_stages s ON s.id = sc.stage_id
       LEFT JOIN (
         SELECT service_case_id, COUNT(*) AS door_count
           FROM service_case_doors
          GROUP BY service_case_id
       ) sd ON sd.service_case_id = sc.id
       LEFT JOIN (
         SELECT service_case_id, MAX(id) AS last_quote_id
           FROM service_quotes
          GROUP BY service_case_id
       ) q ON q.service_case_id = sc.id
       LEFT JOIN service_quotes sq ON sq.id = q.last_quote_id
      WHERE sc.pipeline_id = ?
      ORDER BY sc.updated_at DESC`,
    [pid]
  );

  const list = (rows || []).map((r) => {
    const computed = asJson(r.last_quote_computed) || null;
    const inputs = asJson(r.last_quote_inputs) || {};
    const opCurrency = String(
      computed?.meta?.operation_currency || inputs.operation_currency || 'USD'
    ).toUpperCase();
    const opRate = Number(
      computed?.meta?.exchange_rate_operation_sell_usd || inputs.exchange_rate_operation_sell_usd || 1
    ) || 1;
    const profit = computed?.operacion?.totals?.profit_total_usd ?? null;
    const isPyg = opCurrency === 'PYG' || opCurrency === 'GS';
    const profitDisplay = Number.isFinite(Number(profit))
      ? (isPyg ? Number(profit) * opRate : Number(profit))
      : null;
    return {
      ...r,
      profit_total_usd: profit,
      profit_total_currency: opCurrency,
      profit_total_display: profitDisplay,
      exchange_rate_operation_sell_usd: opRate,
    };
  });
  res.json(list);
  return;

});

router.post('/cases', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const { door_id, door_ids, scheduled_date, assigned_to, stage_id, org_branch_id } = req.body || {};
  const doorIds = Array.isArray(door_ids) ? door_ids.map((x) => Number(x)).filter(Boolean) : [];
  if (!doorIds.length && !door_id) return res.status(400).json({ error: 'door_ids requerido' });
  if (!doorIds.length && door_id) doorIds.push(Number(door_id));

  const [doors] = await pool.query(
    `SELECT id, org_id, org_branch_id FROM client_doors WHERE id IN (${doorIds.map(() => '?').join(',')})`,
    doorIds
  );
  if (!doors.length) return res.status(404).json({ error: 'Puerta no encontrada' });
  const orgId = doors[0].org_id;
  const mismatch = doors.some((d) => d.org_id !== orgId);
  if (mismatch) return res.status(400).json({ error: 'Todas las puertas deben ser de la misma organización' });

  const [[firstStage]] = await pool.query(
    'SELECT id FROM service_stages WHERE pipeline_id = 1 ORDER BY order_index ASC LIMIT 1'
  );
  const useStage = Number(stage_id || firstStage?.id || 0);

  const reference = await nextServiceReference(pool);
  const primaryDoorId = doors[0].id;
  const branchFromDoors = (() => {
    const vals = doors.map((d) => d.org_branch_id || null);
    const uniq = Array.from(new Set(vals.map((v) => String(v))));
    if (uniq.length === 1 && uniq[0] && uniq[0] !== 'null' && uniq[0] !== 'undefined') {
      return Number(uniq[0]) || null;
    }
    return null;
  })();
  const resolvedBranchId = org_branch_id || branchFromDoors || null;
  const [result] = await pool.query(
    `INSERT INTO service_cases
     (reference, door_id, org_id, org_branch_id, pipeline_id, stage_id, status, assigned_to, scheduled_date)
     VALUES (?, ?, ?, ?, 1, ?, 'abierto', ?, ?)`,
    [reference, primaryDoorId, orgId, resolvedBranchId, useStage, assigned_to || null, scheduled_date || null]
  );
  const caseId = result.insertId;
  const values = doors.map((d) => [caseId, d.id]);
  await pool.query('INSERT IGNORE INTO service_case_doors (service_case_id, door_id) VALUES ?', [values]);
  await insertServiceHistory(caseId, 'creado', null, null, useStage, req.user?.id || null);
  res.status(201).json({ id: caseId });
});

router.get('/cases/search', requireAuth, requireAnyRole('admin', 'service', 'manager'), async (req, res) => {
  const q = String(req.query?.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const [rows] = await pool.query(
    `SELECT sc.id, sc.reference, sc.org_id,
            COALESCE(o.razon_social, o.name) AS org_name,
            o.ruc AS org_ruc
       FROM service_cases sc
       LEFT JOIN organizations o ON o.id = sc.org_id
      WHERE sc.reference LIKE ? OR o.name LIKE ? OR o.razon_social LIKE ? OR o.ruc LIKE ?
      ORDER BY sc.id DESC
      LIMIT 20`,
    [like, like, like, like]
  );
  res.json(rows);
});


router.patch('/cases/:id', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id invalido' });
  if (!(await assertServiceCaseUnlocked(id, res))) return;
  const {
    status,
    assigned_to,
    scheduled_date,
    closed_date,
    work_done,
    parts_used,
    cost,
    org_branch_id,
    door_ids,
    work_type,
    maintenance_detail,
    repair_detail,
    parts_components,
    parts_actuators,
  } = req.body || {};

  await pool.query(
    `UPDATE service_cases
        SET status = COALESCE(?, status),
            assigned_to = COALESCE(?, assigned_to),
            scheduled_date = COALESCE(?, scheduled_date),
            closed_date = COALESCE(?, closed_date),
            work_done = COALESCE(?, work_done),
            parts_used = COALESCE(?, parts_used),
            cost = COALESCE(?, cost),
            org_branch_id = COALESCE(?, org_branch_id),
            work_type = COALESCE(?, work_type),
            maintenance_detail = COALESCE(?, maintenance_detail),
            repair_detail = COALESCE(?, repair_detail),
            parts_components = COALESCE(?, parts_components),
            parts_actuators = COALESCE(?, parts_actuators)
      WHERE id = ?`,
    [
      status ?? null,
      assigned_to ?? null,
      scheduled_date ?? null,
      closed_date ?? null,
      work_done ?? null,
      parts_used ?? null,
      cost ?? null,
      org_branch_id ?? null,
      work_type ?? null,
      maintenance_detail ?? null,
      repair_detail ?? null,
      parts_components ?? null,
      parts_actuators ?? null,
      id,
    ]
  );

  if (Array.isArray(door_ids) && door_ids.length) {
    const ids = door_ids.map((x) => Number(x)).filter(Boolean);
    if (ids.length) {
      const [doors] = await pool.query(
        `SELECT id, org_id FROM client_doors WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      if (doors.length) {
        const orgId = doors[0].org_id;
        const mismatch = doors.some((d) => d.org_id !== orgId);
        if (!mismatch) {
          const values = doors.map((d) => [id, d.id]);
          await pool.query('DELETE FROM service_case_doors WHERE service_case_id = ?', [id]);
          await pool.query('INSERT IGNORE INTO service_case_doors (service_case_id, door_id) VALUES ?', [values]);
          await pool.query('UPDATE service_cases SET door_id = ? WHERE id = ?', [doors[0].id, id]);
        }
      }
    }
  }

  await insertServiceHistory(id, 'actualizado', null, null, null, req.user?.id || null);
  res.json({ ok: true });
});

router.patch('/cases/:id/doors/:doorId', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  const doorId = Number(req.params.doorId || 0);
  if (!id || !doorId) return res.status(400).json({ error: 'id invalido' });
  if (!(await assertServiceCaseUnlocked(id, res))) return;
  const {
    work_type,
    maintenance_detail,
    repair_detail,
    revision_detail,
    parts_components,
    parts_actuators,
    work_done,
    parts_used,
    cost,
  } = req.body || {};

  const [[prev]] = await pool.query(
    `SELECT work_type, maintenance_detail, repair_detail,
            revision_detail, parts_components, parts_actuators, work_done, parts_used, cost
       FROM service_case_doors
      WHERE service_case_id = ? AND door_id = ?`,
    [id, doorId]
  );
  const norm = (v) => (v == null ? '' : String(v));
  const normalizeJsonArray = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return JSON.stringify(v);
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return JSON.stringify(parsed);
      } catch (_) {}
      return v;
    }
    return String(v);
  };
  const normalizeJsonValue = (v) => {
    if (v == null) return null;
    if (Array.isArray(v)) return JSON.stringify(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  };
  const changed =
    norm(prev?.work_type) !== norm(work_type) ||
    norm(prev?.maintenance_detail) !== norm(maintenance_detail) ||
    norm(prev?.repair_detail) !== norm(repair_detail) ||
    norm(prev?.revision_detail) !== norm(revision_detail) ||
    norm(prev?.work_done) !== norm(work_done) ||
    norm(prev?.parts_used) !== norm(parts_used) ||
    norm(prev?.cost) !== norm(cost) ||
    normalizeJsonArray(prev?.parts_components) !== normalizeJsonArray(parts_components) ||
    normalizeJsonArray(prev?.parts_actuators) !== normalizeJsonArray(parts_actuators);

  await pool.query(
    `UPDATE service_case_doors
        SET work_type = COALESCE(?, work_type),
            maintenance_detail = COALESCE(?, maintenance_detail),
            repair_detail = COALESCE(?, repair_detail),
            revision_detail = COALESCE(?, revision_detail),
            parts_components = COALESCE(?, parts_components),
            parts_actuators = COALESCE(?, parts_actuators),
            work_done = COALESCE(?, work_done),
            parts_used = COALESCE(?, parts_used),
            cost = COALESCE(?, cost)
      WHERE service_case_id = ? AND door_id = ?`,
    [
      work_type ?? null,
      maintenance_detail ?? null,
      repair_detail ?? null,
      revision_detail ?? null,
      parts_components ?? null,
      parts_actuators ?? null,
      work_done ?? null,
      parts_used ?? null,
      cost ?? null,
      id,
      doorId,
    ]
  );
  if (changed) {
    await syncServiceQuoteItemsFromDoors(id);
    const [[caseRow]] = await pool.query('SELECT stage_id FROM service_cases WHERE id = ?', [id]);
    await pool.query(
      `INSERT INTO service_case_door_history
        (service_case_id, door_id, work_type, maintenance_detail, repair_detail, revision_detail,
         parts_components, parts_actuators, work_done, parts_used, cost, stage_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        doorId,
        work_type ?? null,
        maintenance_detail ?? null,
        repair_detail ?? null,
        revision_detail ?? null,
        normalizeJsonValue(parts_components),
        normalizeJsonValue(parts_actuators),
        work_done ?? null,
        parts_used ?? null,
        cost ?? null,
        caseRow?.stage_id ?? null,
        req.user?.id || null,
      ]
    );
  }
  res.json({ ok: true });
});

router.get('/cases/:id/doors/:doorId/parts', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  const doorId = Number(req.params.doorId || 0);
  if (!id || !doorId) return res.status(400).json({ error: 'id invalido' });
  const [rows] = await pool.query(
    `SELECT id, service_case_id, door_id, part_name, quantity, unit_cost, currency, notes, created_by, created_at
       FROM service_case_door_parts
      WHERE service_case_id = ? AND door_id = ?
      ORDER BY created_at DESC, id DESC`,
    [id, doorId]
  );
  res.json(rows || []);
});

router.put('/cases/:id/doors/:doorId/parts', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  const doorId = Number(req.params.doorId || 0);
  if (!id || !doorId) return res.status(400).json({ error: 'id invalido' });
  if (!(await assertServiceCaseUnlocked(id, res))) return;
  const parts = Array.isArray(req.body?.parts) ? req.body.parts : [];
  await pool.query('DELETE FROM service_case_door_parts WHERE service_case_id = ? AND door_id = ?', [id, doorId]);
  if (parts.length) {
    const values = parts
      .filter((p) => String(p?.part_name || '').trim())
      .map((p) => [
        id,
        doorId,
        String(p.part_name).trim(),
        Number(p.quantity || 1),
        p.unit_cost != null && p.unit_cost !== '' ? Number(p.unit_cost) : null,
        p.currency ? String(p.currency).toUpperCase() : null,
        p.notes || null,
        req.user?.id || null,
      ]);
    if (values.length) {
      await pool.query(
        `INSERT INTO service_case_door_parts
          (service_case_id, door_id, part_name, quantity, unit_cost, currency, notes, created_by)
         VALUES ?`,
        [values]
      );
    }
  }
  const [rows] = await pool.query(
    `SELECT id, service_case_id, door_id, part_name, quantity, unit_cost, currency, notes, created_by, created_at
       FROM service_case_door_parts
      WHERE service_case_id = ? AND door_id = ?
      ORDER BY created_at DESC, id DESC`,
    [id, doorId]
  );
  res.json(rows || []);
});

router.patch('/cases/:id/stage', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  const stage_id = Number(req.body?.stage_id || 0);
  if (!id || !stage_id) return res.status(400).json({ error: 'Datos inválidos' });
  await pool.query('UPDATE service_cases SET stage_id = ? WHERE id = ?', [stage_id, id]);
  try {
    const [[stageRow]] = await pool.query('SELECT name FROM service_stages WHERE id = ?', [stage_id]);
    const stageName = String(stageRow?.name || '').toLowerCase();
    if (stageName === 'conf a coord') {
      const [doors] = await pool.query(
        `SELECT door_id, work_type, maintenance_detail, repair_detail,
                revision_detail, parts_components, parts_actuators, work_done, parts_used, cost
           FROM service_case_doors
          WHERE service_case_id = ?`,
        [id]
      );
      if (doors.length) {
        const values = doors.map((d) => [
          id,
          d.door_id,
          d.work_type || null,
          d.maintenance_detail || null,
          d.repair_detail || null,
          d.revision_detail || null,
          d.parts_components || null,
          d.parts_actuators || null,
          d.work_done || null,
          d.parts_used || null,
          d.cost || null,
          stage_id,
          req.user?.id || null,
        ]);
        await pool.query(
          `INSERT INTO service_case_door_history
           (service_case_id, door_id, work_type, maintenance_detail, repair_detail, revision_detail,
            parts_components, parts_actuators, work_done, parts_used, cost,
            stage_id, created_by)
           VALUES ?`,
          [values]
        );
      }
    }
  } catch (_) {}
  res.json({ ok: true });
});



// ====== case detail + custom fields ======
router.get('/cases/:id', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id invalido' });
  const [[row]] = await pool.query(
    `SELECT sc.*, o.name AS org_name, o.ruc AS org_ruc,
            d.placa_id, d.nombre, d.sector, d.marca, d.modelo, d.dimensiones,
            d.fecha_instalacion, d.fecha_ultimo_mantenimiento,
            s.name AS stage_name,
            ob.name AS org_branch_name, ob.address AS org_branch_address, ob.city AS org_branch_city,
            q.last_quote_id, q.last_quote_at
       FROM service_cases sc
       LEFT JOIN organizations o ON o.id = sc.org_id
       LEFT JOIN org_branches ob ON ob.id = sc.org_branch_id
       LEFT JOIN client_doors d ON d.id = sc.door_id
       LEFT JOIN service_stages s ON s.id = sc.stage_id
       LEFT JOIN (
         SELECT service_case_id, MAX(id) AS last_quote_id, MAX(updated_at) AS last_quote_at
           FROM service_quotes
          GROUP BY service_case_id
       ) q ON q.service_case_id = sc.id
      WHERE sc.id = ?`,
    [id]
  );
  if (!row) return res.status(404).json({ error: 'Caso no encontrado' });
  const [doors] = await pool.query(
    `SELECT d.id, d.placa_id, d.nombre, d.sector, d.marca, d.modelo, d.dimensiones,
            sd.work_type, sd.maintenance_detail, sd.repair_detail, sd.revision_detail,
            sd.parts_components, sd.parts_actuators, sd.work_done, sd.parts_used, sd.cost
       FROM service_case_doors sd
       JOIN client_doors d ON d.id = sd.door_id
      WHERE sd.service_case_id = ?
      ORDER BY d.id`,
    [id]
  );
  res.json({ case: row, doors });
});

router.get('/cases/:id/custom-fields', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id invalido' });
  const [rows] = await pool.query(
    'SELECT `key`, value FROM service_case_custom_fields WHERE service_case_id = ? ORDER BY `key`',
    [id]
  );

  const list = (rows || []).map((r) => {
    const computed = asJson(r.last_quote_computed) || null;
    const profit = computed?.operacion?.totals?.profit_total_usd ?? null;
    return { ...r, profit_total_usd: profit };
  });
  res.json(list);
  return;

});

router.post('/cases/:id/custom-fields', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id invalido' });
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key requerido' });
  await pool.query(
    `INSERT INTO service_case_custom_fields (service_case_id, ` + '`key`' + `, value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [id, key, value ?? null]
  );
  res.json({ ok: true });
});

// ====== quotes for service ======
router.post('/quotes/preview', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const inputs = normalizeInputs(req.body);
    if (!computeQuote) {
      return res.status(500).json({ error: 'computeQuote no disponible.' });
    }
    const computed = computeQuote(inputs);
    res.json({ inputs, computed });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'No se pudo previsualizar' });
  }
});

router.get('/cases/:caseId/quote', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const caseId = Number(req.params.caseId || 0);
    if (!caseId) return res.status(400).json({ error: 'caseId invalido' });

    const [rows] = await pool.query('SELECT * FROM service_quotes WHERE service_case_id = ? LIMIT 1', [caseId]);
    if (rows.length) {
      const row = rows[0];
      const revisionId = req.query.revision_id ? Number(req.query.revision_id) : null;
      let rev = null;
      if (revisionId) rev = await getServiceRevisionById(row.id, revisionId);
      const inputs = rev?.inputs || asJson(row.inputs_json) || {};
      const document_snapshot = rev?.document_snapshot || normalizeDocumentSnapshot(row.document_snapshot_json);
      const computed = rev?.computed || asJson(row.computed_json) || null;
      return res.json({
        id: row.id,
        service_case_id: row.service_case_id,
        inputs,
        document_snapshot,
        computed,
        meta: {
          revision_id: rev?.id || null,
          revision_name: rev?.name || null,
          ref_code: row.ref_code,
          revision: row.revision,
          client_name: row.client_name,
          status: row.status,
          updated_at: row.updated_at,
        },
      });
    }

    const [[caseRow]] = await pool.query(
      `SELECT sc.id, sc.reference, sc.org_id, sc.org_branch_id, o.name AS org_name
         FROM service_cases sc
         LEFT JOIN organizations o ON o.id = sc.org_id
        WHERE sc.id = ?`,
      [caseId]
    );
    if (!(await assertServiceCaseUnlocked(caseId, res))) return;
    if (!caseRow) return res.status(404).json({ error: 'Caso no encontrado' });

    const inputs = {
      service_case_id: caseId,
      status: 'draft',
      ref_code: caseRow.reference || '',
      client_name: caseRow.org_name || '',
      org_branch_id: caseRow.org_branch_id || null,
    };
    const document_snapshot = null;
    const { computed } = safeCompute(inputs);
    const [result] = await pool.query(
      `INSERT INTO service_quotes (service_case_id, ref_code, revision, client_name, status, created_by, inputs_json, document_snapshot_json, computed_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        caseId,
        inputs.ref_code || null,
        null,
        inputs.client_name || null,
        'draft',
        null,
        JSON.stringify(inputs),
        document_snapshot ? JSON.stringify(document_snapshot) : null,
        computed ? JSON.stringify(computed) : null,
      ]
    );

    if (caseId) {
      await syncServiceCaseBranch(caseId, inputs.org_branch_id);
    }

    res.json({
      id: result.insertId,
      service_case_id: caseId,
      inputs,
      document_snapshot,
      computed,
      meta: { ref_code: inputs.ref_code, client_name: inputs.client_name, status: 'draft' },
    });
  } catch (e) {
    console.error('[service][quote] error:', e);
    res.status(500).json({ error: e?.message || 'No se pudo obtener/crear la cotizacion' });
  }
});

router.get('/quotes/:id', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const revisionId = req.query.revision_id ? Number(req.query.revision_id) : null;
    const [[row]] = await pool.query('SELECT * FROM service_quotes WHERE id = ? LIMIT 1', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    let rev = null;
    if (revisionId) rev = await getServiceRevisionById(row.id, revisionId);
    const inputs = rev?.inputs || asJson(row.inputs_json) || {};
    const document_snapshot = rev?.document_snapshot || normalizeDocumentSnapshot(row.document_snapshot_json);
    const computed = rev?.computed || asJson(row.computed_json) || null;
    res.json({
      id: row.id,
      service_case_id: row.service_case_id,
      inputs,
      document_snapshot,
      computed,
      meta: {
        revision_id: rev?.id || null,
        revision_name: rev?.name || null,
        ref_code: row.ref_code,
        revision: row.revision,
        client_name: row.client_name,
        status: row.status,
        updated_at: row.updated_at,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo obtener la cotizacion' });
  }
});

// ====== additional quotes for service ======
router.get('/cases/:caseId/additional-quotes', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const caseId = Number(req.params.caseId || 0);
    if (!caseId) return res.status(400).json({ error: 'caseId invalido' });
    const [rows] = await pool.query(
      `SELECT id, service_case_id, name, status, updated_at, created_at
         FROM service_quote_additions
        WHERE service_case_id = ?
        ORDER BY id DESC`,
      [caseId]
    );
    res.json(rows || []);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo listar adicionales' });
  }
});

router.post('/cases/:caseId/additional-quotes', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const caseId = Number(req.params.caseId || 0);
    if (!caseId) return res.status(400).json({ error: 'caseId invalido' });
    const [[caseRow]] = await pool.query(
      `SELECT sc.id, sc.reference, sc.org_id, sc.org_branch_id, o.name AS org_name
         FROM service_cases sc
         LEFT JOIN organizations o ON o.id = sc.org_id
        WHERE sc.id = ?`,
      [caseId]
    );
    if (!caseRow) return res.status(404).json({ error: 'Caso no encontrado' });

    const [[cntRow]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM service_quote_additions WHERE service_case_id = ?',
      [caseId]
    );
    const nextNum = Number(cntRow?.cnt || 0) + 1;
    const name = `Adicional #${nextNum}`;
    const [[baseQuoteRow]] = await pool.query(
      'SELECT inputs_json FROM service_quotes WHERE service_case_id = ? LIMIT 1',
      [caseId]
    );
    const baseInputs = asJson(baseQuoteRow?.inputs_json) || {};
    const inputs = {
      service_case_id: caseId,
      status: 'draft',
      ref_code: `${caseRow.reference || ''} AD ${nextNum}`,
      client_name: caseRow.org_name || '',
      org_branch_id: caseRow.org_branch_id || null,
      operation_currency: baseInputs.operation_currency || 'USD',
      exchange_rate_operation_sell_usd: baseInputs.exchange_rate_operation_sell_usd || 1,
      items: [],
    };
    const { computed } = safeCompute(inputs);
    const [result] = await pool.query(
      `INSERT INTO service_quote_additions (service_case_id, name, status, created_by, inputs_json, computed_json)
       VALUES (?,?,?,?,?,?)`,
      [
        caseId,
        name,
        'draft',
        req.user?.name || null,
        JSON.stringify(inputs),
        computed ? JSON.stringify(computed) : null,
      ]
    );
    res.json({ id: result.insertId, name, inputs, computed });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'No se pudo crear adicional' });
  }
});

router.get('/additional-quotes/:id', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const [[row]] = await pool.query('SELECT * FROM service_quote_additions WHERE id = ? LIMIT 1', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    const inputs = asJson(row.inputs_json) || {};
    const computed = asJson(row.computed_json) || null;
    res.json({
      id: row.id,
      service_case_id: row.service_case_id,
      inputs,
      computed,
      meta: {
        name: row.name,
        status: row.status,
        updated_at: row.updated_at,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo obtener el adicional' });
  }
});

router.put('/additional-quotes/:id', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const inputs = normalizeInputs(req.body);
    const { computed, compute_error } = safeCompute(inputs);
    if (compute_error && !computed) return res.status(400).json({ error: compute_error });
    await pool.query(
      `UPDATE service_quote_additions
          SET status = ?, name = COALESCE(?, name), inputs_json = ?, computed_json = ?
        WHERE id = ?`,
      [
        inputs.status || 'draft',
        inputs.name || null,
        JSON.stringify(inputs),
        computed ? JSON.stringify(computed) : null,
        id,
      ]
    );
    res.json({ id, inputs, computed });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo actualizar el adicional' });
  }
});

router.post('/additional-quotes/:id/recalculate', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const [[row]] = await pool.query('SELECT * FROM service_quote_additions WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    const inputs = asJson(row.inputs_json) || {};
    const { computed, compute_error } = safeCompute(inputs);
    if (compute_error && !computed) return res.status(400).json({ error: compute_error });
    await pool.query('UPDATE service_quote_additions SET computed_json=? WHERE id=?', [
      computed ? JSON.stringify(computed) : null,
      id,
    ]);
    res.json({ id, inputs, computed });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo recalcular' });
  }
});

router.post('/quotes', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const inputs = normalizeInputs(req.body);
    const document_snapshot = normalizeDocumentSnapshot(req.body?.document_snapshot);
    const { computed, compute_error } = safeCompute(inputs);
    if (compute_error && !computed) return res.status(400).json({ error: compute_error });

    const serviceCaseId = Number(inputs.service_case_id || 0) || null;
    if (serviceCaseId && !(await assertServiceCaseUnlocked(serviceCaseId, res))) return;
    const [result] = await pool.query(
      `INSERT INTO service_quotes (service_case_id, ref_code, revision, client_name, status, created_by, inputs_json, document_snapshot_json, computed_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        serviceCaseId,
        inputs.ref_code || null,
        inputs.revision || null,
        inputs.client_name || null,
        inputs.status || 'draft',
        inputs.created_by || null,
        JSON.stringify(inputs),
        document_snapshot ? JSON.stringify(document_snapshot) : null,
        computed ? JSON.stringify(computed) : null,
      ]
    );

    res.status(201).json({ id: result.insertId, inputs, document_snapshot, computed });
  } catch (e) {
    console.error('[service][quote][POST] error:', e);
    res.status(500).json({ error: e?.message || 'No se pudo crear la cotizacion' });
  }
});

router.put('/quotes/:id', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const [[row]] = await pool.query('SELECT * FROM service_quotes WHERE id = ? LIMIT 1', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    const hasInputsPayload = hasOwn(req.body, 'inputs');
    const hasDocumentSnapshotPayload = hasOwn(req.body, 'document_snapshot');
    const inputs = hasInputsPayload ? normalizeInputs(req.body) : (asJson(row.inputs_json) || {});
    const document_snapshot = hasDocumentSnapshotPayload
      ? normalizeDocumentSnapshot(req.body?.document_snapshot)
      : normalizeDocumentSnapshot(row.document_snapshot_json);
    const serviceCaseId = Number(inputs.service_case_id || row.service_case_id || 0) || null;
    if (serviceCaseId && !(await assertServiceCaseUnlocked(serviceCaseId, res))) return;
    const { computed, compute_error } = hasInputsPayload
      ? safeCompute(inputs)
      : { computed: asJson(row.computed_json) || null, compute_error: null };

    await pool.query(
      `UPDATE service_quotes
          SET ref_code=?, revision=?, client_name=?, status=?, created_by=?, inputs_json=?, document_snapshot_json=?, computed_json=?
        WHERE id=?`,
      [
        inputs.ref_code || null,
        inputs.revision || null,
        inputs.client_name || null,
        inputs.status || 'draft',
        inputs.created_by || null,
        JSON.stringify(inputs),
        document_snapshot ? JSON.stringify(document_snapshot) : null,
        computed ? JSON.stringify(computed) : null,
        id,
      ]
    );

    if (serviceCaseId) {
      await syncServiceCaseBranch(serviceCaseId, inputs.org_branch_id);
    }

    res.json({ id, inputs, document_snapshot, computed, compute_error: compute_error || null });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'No se pudo actualizar la cotizacion' });
  }
});

router.get('/cases/:id/door-history', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id invalido' });
  const [rows] = await pool.query(
    `SELECT h.*, d.placa_id, d.modelo, u.name AS user_name
       FROM service_case_door_history h
       LEFT JOIN client_doors d ON d.id = h.door_id
       LEFT JOIN users u ON u.id = h.created_by
      WHERE h.service_case_id = ?
      ORDER BY h.id DESC`,
    [id]
  );
  res.json(rows || []);
});

router.post('/quotes/:id/recalculate', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const [[row]] = await pool.query('SELECT * FROM service_quotes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    if (!(await assertServiceCaseUnlocked(row.service_case_id, res))) return;
    if (!(await assertServiceCaseUnlocked(row.service_case_id, res))) return;
    const inputs = asJson(row.inputs_json) || {};
    const { computed, compute_error } = safeCompute(inputs);
    if (compute_error && !computed) return res.status(400).json({ error: compute_error });
    await pool.query('UPDATE service_quotes SET computed_json=? WHERE id=?', [
      computed ? JSON.stringify(computed) : null,
      id,
    ]);
    res.json({ id, inputs, computed });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'No se pudo recalcular' });
  }
});

router.get('/quotes/:id/revisions', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const rows = await listServiceRevisions(id);
  
  const list = (rows || []).map((r) => {
    const computed = asJson(r.last_quote_computed) || null;
    const profit = computed?.operacion?.totals?.profit_total_usd ?? null;
    return { ...r, profit_total_usd: profit };
  });
  res.json(list);
  return;

  } catch (e) {
    res.status(500).json({ error: 'No se pudo listar revisiones' });
  }
});

function formatServiceQuoteRevisionName(seq, createdAt = new Date()) {
  const n = String(Number(seq || 0)).padStart(2, '0');
  const dt = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `REV ${n} - ${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

router.post('/quotes/:id/revisions', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const [[row]] = await pool.query('SELECT * FROM service_quotes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    if (!(await assertServiceCaseUnlocked(row.service_case_id, res))) return;
    const [[meta]] = await pool.query(
      'SELECT COUNT(*) AS total FROM service_quote_revisions WHERE quote_id = ?',
      [id]
    );
    const nextSeq = Number(meta?.total || 0) + 1;
    const name = String(req.body?.name || '').trim() || formatServiceQuoteRevisionName(nextSeq);
    const inputs = asJson(row.inputs_json) || {};
    const document_snapshot = normalizeDocumentSnapshot(row.document_snapshot_json);
    const computed = asJson(row.computed_json) || null;
    const [result] = await pool.query(
      `INSERT INTO service_quote_revisions (quote_id, name, inputs_json, document_snapshot_json, computed_json)
       VALUES (?,?,?,?,?)`,
      [id, name, JSON.stringify(inputs), document_snapshot ? JSON.stringify(document_snapshot) : null, computed ? JSON.stringify(computed) : null]
    );
    const rows = await listServiceRevisions(id);
    res.status(201).json({ id: result.insertId, name, revisions: rows });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo crear la revision' });
  }
});

router.put('/quotes/:id/revisions/:revisionId', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const revisionId = Number(req.params.revisionId || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    if (!revisionId) return res.status(400).json({ error: 'revisionId invalido' });

    const [[row]] = await pool.query('SELECT * FROM service_quotes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    if (!(await assertServiceCaseUnlocked(row.service_case_id, res))) return;

    const [[rev]] = await pool.query(
      'SELECT * FROM service_quote_revisions WHERE id = ? AND quote_id = ? LIMIT 1',
      [revisionId, id]
    );
    if (!rev) return res.status(404).json({ error: 'Revision no encontrada' });

    const hasInputsPayload = hasOwn(req.body, 'inputs');
    const hasDocumentSnapshotPayload = hasOwn(req.body, 'document_snapshot');
    const inputs = hasInputsPayload ? normalizeInputs(req.body) : (asJson(rev.inputs_json) || {});
    const document_snapshot = hasDocumentSnapshotPayload
      ? normalizeDocumentSnapshot(req.body?.document_snapshot)
      : normalizeDocumentSnapshot(rev.document_snapshot_json);
    const { computed, compute_error } = hasInputsPayload
      ? safeCompute(inputs)
      : { computed: asJson(rev.computed_json) || null, compute_error: null };
    if (hasInputsPayload && compute_error && !computed) return res.status(400).json({ error: compute_error });
    const name = String(req.body?.name || rev.name || '').trim() || formatServiceQuoteRevisionName(revisionId, rev.created_at);

    await pool.query(
      `UPDATE service_quote_revisions
          SET name = ?, inputs_json = ?, document_snapshot_json = ?, computed_json = ?
        WHERE id = ? AND quote_id = ?`,
      [
        name,
        JSON.stringify(inputs),
        document_snapshot ? JSON.stringify(document_snapshot) : null,
        computed ? JSON.stringify(computed) : null,
        revisionId,
        id,
      ]
    );

    res.json({ id, revision_id: revisionId, inputs, document_snapshot, computed, compute_error: compute_error || null, name });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'No se pudo actualizar la revision' });
  }
});

router.post('/quotes/:id/duplicate', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const [[row]] = await pool.query('SELECT * FROM service_quotes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });

    const origInputs = asJson(row.inputs_json) || {};
    const origDocumentSnapshot = normalizeDocumentSnapshot(row.document_snapshot_json);
    const origComputed = asJson(row.computed_json) || null;
    const inputs = { ...origInputs };
    delete inputs.service_case_id;

    const [result] = await pool.query(
      `INSERT INTO service_quotes (service_case_id, ref_code, revision, client_name, status, created_by, inputs_json, document_snapshot_json, computed_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        null,
        `${row.ref_code || 'REF'}-COPY`,
        row.revision,
        row.client_name,
        'draft',
        row.created_by,
        JSON.stringify(inputs),
        origDocumentSnapshot ? JSON.stringify(origDocumentSnapshot) : null,
        origComputed ? JSON.stringify(origComputed) : null,
      ]
    );
    res.status(201).json({ id: result.insertId, inputs, document_snapshot: origDocumentSnapshot, computed: origComputed });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'No se pudo duplicar la cotizacion' });
  }
});

router.get('/quotes/:id/export-xlsx', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const [[row]] = await pool.query('SELECT * FROM service_quotes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    const inputs = asJson(row.inputs_json) || {};
    const buffer = await buildQuoteXlsxBuffer(inputs);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=service-quote-${id}.xlsx`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'No se pudo exportar XLSX' });
  }
});


router.get('/cases/:id/history', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id invalido' });
  const [rows] = await pool.query(
    `SELECT h.*, u.name AS user_name
       FROM service_case_history h
       LEFT JOIN users u ON u.id = h.created_by
      WHERE h.service_case_id = ?
      ORDER BY h.id DESC`,
    [id]
  );

  const list = (rows || []).map((r) => {
    const computed = asJson(r.last_quote_computed) || null;
    const profit = computed?.operacion?.totals?.profit_total_usd ?? null;
    return { ...r, profit_total_usd: profit };
  });
  res.json(list);
  return;

});

router.get('/cases/:id/report', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id invalido' });

  const [[row]] = await pool.query(
    `SELECT sc.*, o.name AS org_name, o.ruc AS org_ruc,
            d.placa_id, d.marca, d.modelo, d.dimensiones,
            d.fecha_instalacion, d.fecha_ultimo_mantenimiento,
            s.name AS stage_name
       FROM service_cases sc
       LEFT JOIN organizations o ON o.id = sc.org_id
       LEFT JOIN client_doors d ON d.id = sc.door_id
       LEFT JOIN service_stages s ON s.id = sc.stage_id
      WHERE sc.id = ?`,
    [id]
  );
  if (!row) return res.status(404).send('Caso no encontrado');

  const [doors] = await pool.query(
    `SELECT d.id, d.placa_id, d.marca, d.modelo, d.dimensiones,
            d.fecha_instalacion, d.fecha_ultimo_mantenimiento,
            sd.work_type, sd.maintenance_detail, sd.repair_detail, sd.revision_detail,
            sd.parts_components, sd.parts_actuators, sd.work_done, sd.parts_used, sd.cost
       FROM service_case_doors sd
       JOIN client_doors d ON d.id = sd.door_id
      WHERE sd.service_case_id = ?
      ORDER BY d.id`,
    [id]
  );

  const [history] = await pool.query(
    `SELECT h.*, u.name AS user_name
       FROM service_case_history h
       LEFT JOIN users u ON u.id = h.created_by
      WHERE h.service_case_id = ?
      ORDER BY h.id DESC`,
    [id]
  );

  const toList = (val) => {
    const parsed = asJson(val);
    if (Array.isArray(parsed)) return parsed.join(', ');
    if (typeof val === 'string') return val;
    return '';
  };

    const doorsHtml = (doors || []).map((d) => `
      <div class="card" style="margin-top:10px;">
        <h2>Puerta ${d.placa_id || d.id}</h2>
        <div><b>Modelo:</b> ${d.modelo || ''}</div>
        <div><b>Dimensiones:</b> ${d.dimensiones || ''}</div>
        <div><b>InstalaciÃ³n:</b> ${d.fecha_instalacion || ''}</div>
        <div><b>Ult. mantenimiento puerta:</b> ${d.fecha_ultimo_mantenimiento || ''}</div>
        <div><b>Trabajo a realizar:</b> ${toList(d.work_type) || ''}</div>
        <div><b>Detalle mantenimiento:</b> ${d.maintenance_detail || ''}</div>
        <div><b>Detalle reparaciÃ³n:</b> ${d.repair_detail || ''}</div>
        <div><b>Detalle revisiÃ³n:</b> ${d.revision_detail || ''}</div>
        <div><b>Componentes (cambio piezas):</b> ${toList(d.parts_components) || ''}</div>
        <div><b>Accionadores (cambio piezas):</b> ${toList(d.parts_actuators) || ''}</div>
        <div><b>Trabajo realizado:</b> ${d.work_done || ''}</div>
        <div><b>Repuestos:</b> ${d.parts_used || ''}</div>
        <div><b>Costo:</b> ${d.cost || ''}</div>
      </div>
    `).join('');

  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Informe mantenimiento ${row.reference || row.id}</title>
    <style>
      body { font-family: Arial, sans-serif; color:#111; }
      h1 { font-size: 18px; margin-bottom: 6px; }
      h2 { font-size: 14px; margin: 12px 0 6px; }
      table { width:100%; border-collapse: collapse; font-size: 12px; }
      th, td { border:1px solid #ddd; padding:6px; text-align:left; }
      .muted { color:#666; font-size: 12px; }
      .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .card { border:1px solid #ddd; padding:8px; border-radius:6px; }
    </style>
  </head>
  <body>
    <h1>Informe de mantenimiento - ${row.reference || row.id}</h1>
    <div class="muted">Generado: ${new Date().toISOString().slice(0,10)}</div>

    <div class="grid">
      <div class="card">
        <h2>Cliente</h2>
        <div><b>Nombre:</b> ${row.org_name || ''}</div>
        <div><b>RUC:</b> ${row.org_ruc || ''}</div>
      </div>
      <div class="card">
        <h2>Resumen</h2>
        <div><b>Etapa:</b> ${row.stage_name || ''}</div>
        <div><b>Estado:</b> ${row.status || ''}</div>
        <div><b>Programado:</b> ${row.scheduled_date || ''}</div>
      </div>
    </div>

    <h2>Detalle por puerta</h2>
    ${doorsHtml || '<div class="muted">Sin puertas asociadas</div>'}

    <h2>Historial</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Accion</th><th>Usuario</th><th>Detalle</th></tr></thead>
      <tbody>
        ${(history || []).map(h => `
          <tr>
            <td>${String(h.created_at || '').slice(0,19).replace('T',' ')}</td>
            <td>${h.action || ''}</td>
            <td>${h.user_name || ''}</td>
            <td>${h.notes || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </body>
  </html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/cases/:id/work-order', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id invalido' });

  const [[row]] = await pool.query(
    `SELECT sc.*, o.name AS org_name, o.ruc AS org_ruc, o.phone AS org_phone, o.email AS org_email,
            ob.name AS org_branch_name, ob.address AS org_branch_address, ob.city AS org_branch_city,
            ob.phone AS org_branch_phone, ob.email AS org_branch_email
       FROM service_cases sc
       LEFT JOIN organizations o ON o.id = sc.org_id
       LEFT JOIN org_branches ob ON ob.id = sc.org_branch_id
      WHERE sc.id = ?`,
    [id]
  );
  if (!row) return res.status(404).send('Caso no encontrado');

  const [[quoteRow]] = await pool.query(
    'SELECT inputs_json FROM service_quotes WHERE service_case_id = ? LIMIT 1',
    [id]
  );
  const inputs = asJson(quoteRow?.inputs_json) || {};
  const items = Array.isArray(inputs.items) ? inputs.items : [];

  const [cfs] = await pool.query(
    'SELECT `key`, value FROM service_case_custom_fields WHERE service_case_id = ?',
    [id]
  );
  const cfMap = (cfs || []).reduce((acc, r) => {
    if (r?.key) acc[r.key] = r.value ?? '';
    return acc;
  }, {});

  const contact =
    inputs.contact ||
    inputs.contact_name ||
    inputs.client_contact ||
    '';
  const phone =
    inputs.phone ||
    inputs.phone_number ||
    inputs.contact_phone ||
    row.org_branch_phone ||
    row.org_phone ||
    '';
  const email =
    inputs.email ||
    inputs.contact_email ||
    row.org_branch_email ||
    row.org_email ||
    '';
  const priority = inputs.priority || row.priority || '';
  const delivery = inputs.delivery_date || row.scheduled_date || '';
  const observation = inputs.observation || row.work_done || '';

  const itemsHtml = items.length
    ? items
        .filter((it) => String(it.description || it.servicio || '').trim())
        .map((it) => {
          const qty = Number(it.qty || it.quantity || it.cantidad || 1) || 1;
          const unit = it.unit || it.unidad || 'UNIDAD';
          const desc = it.description || it.servicio || '';
          return `
            <tr>
              <td>${desc}</td>
              <td class="center">${qty}</td>
              <td class="center">${unit}</td>
            </tr>`;
        })
        .join('')
    : `
      <tr>
        <td>&nbsp;</td><td></td><td></td>
      </tr>`;

  const today = new Date().toLocaleDateString('es-PY');

  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Orden de trabajo ${row.reference || row.id}</title>
    <style>
      body { font-family: Arial, sans-serif; color:#111; margin: 0; padding: 24px; }
      .header { display:flex; align-items:center; justify-content:space-between; margin-bottom: 18px; }
      .logo { font-size: 28px; font-weight: 700; letter-spacing: .5px; }
      .brand { color:#d84315; }
      .title { background:#334155; color:#fff; padding:10px 18px; border-radius: 18px 0 0 18px; font-weight:700; }
      .meta { text-align:right; font-size: 12px; }
      .ref { font-size: 18px; font-weight:700; margin-top: 6px; }
      .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 12px; }
      .label { font-weight:700; }
      .section-title { margin: 16px 0 8px; font-weight:700; text-align:center; }
      table { width:100%; border-collapse: collapse; font-size: 12px; }
      th { background:#6b7280; color:#fff; padding:8px; }
      td { border-bottom:1px solid #d1d5db; padding:8px; vertical-align:top; }
      .center { text-align:center; }
      .note { font-size: 11px; margin-top: 6px; }
      .box { border-top:1px solid #d1d5db; margin-top: 14px; padding-top: 8px; font-size: 12px; }
      .sign { margin-top: 26px; text-align:right; font-size: 12px; }
      .line { border-top:1px solid #111; width:220px; display:inline-block; margin-bottom:4px; }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="logo">grupo <span class="brand">atm</span></div>
      <div class="title">ORDEN DE TRABAJO</div>
      <div class="meta">
        <div>Asunción ${today}</div>
        <div class="ref">REF.: ${row.reference || row.id}</div>
      </div>
    </div>

    <div class="grid">
      <div><span class="label">CLIENTE:</span> ${row.org_name || ''}</div>
      <div><span class="label">TELEFONO:</span> ${phone}</div>
      <div><span class="label">CONTACTO:</span> ${contact}</div>
      <div><span class="label">EMAIL:</span> ${email}</div>
      <div><span class="label">PRIORIDAD:</span> ${priority}</div>
      <div><span class="label">ENTREGA:</span> ${delivery}</div>
      <div><span class="label">OBSERVACION:</span> ${observation}</div>
      <div><span class="label">DATO DE CALCOMANIA:</span> ${cfMap.calcomania || ''}</div>
      <div><span class="label">TECNICOS RESPONSABLES:</span> ${cfMap.tecnicos_responsables || ''}</div>
      <div><span class="label">DIRECCION:</span> ${row.org_branch_address || ''}</div>
    </div>

    <div class="section-title">PRODUCTOS Y SERVICIOS</div>
    <table>
      <thead>
        <tr>
          <th>PRODUCTO</th>
          <th>CANTIDAD</th>
          <th>UNIDAD DE MEDIDA</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="box">
      <div class="label">OBSERVACIONES</div>
      <div class="note">Los precios indicados ya incluyen el impuesto al valor agregado (IVA).</div>
      <div class="note">Esta cotización contempla únicamente los items descriptos en el documento.</div>
    </div>

    <div class="sign">
      <div class="line"></div><br/>
      Firma cliente
    </div>
  </body>
  </html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/cases/:id/work-order/pdf', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const [[row]] = await pool.query(
      `SELECT sc.*, o.name AS org_name, o.ruc AS org_ruc, o.phone AS org_phone, o.email AS org_email,
              ob.name AS org_branch_name, ob.address AS org_branch_address, ob.city AS org_branch_city,
              ob.phone AS org_branch_phone, ob.email AS org_branch_email
         FROM service_cases sc
         LEFT JOIN organizations o ON o.id = sc.org_id
         LEFT JOIN org_branches ob ON ob.id = sc.org_branch_id
        WHERE sc.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Caso no encontrado' });

    const [[quoteRow]] = await pool.query(
      'SELECT inputs_json FROM service_quotes WHERE service_case_id = ? LIMIT 1',
      [id]
    );
    const inputs = asJson(quoteRow?.inputs_json) || {};
    const items = Array.isArray(inputs.items) ? inputs.items : [];

    const [cfs] = await pool.query(
      'SELECT `key`, value FROM service_case_custom_fields WHERE service_case_id = ?',
      [id]
    );
    const cfMap = (cfs || []).reduce((acc, r) => {
      if (r?.key) acc[r.key] = r.value ?? '';
      return acc;
    }, {});

    const contact =
      inputs.contact ||
      inputs.contact_name ||
      inputs.client_contact ||
      '';
    const phone =
      inputs.phone ||
      inputs.phone_number ||
      inputs.contact_phone ||
      row.org_branch_phone ||
      row.org_phone ||
      '';
    const email =
      inputs.email ||
      inputs.contact_email ||
      row.org_branch_email ||
      row.org_email ||
      '';
    const priority = inputs.priority || row.priority || '';
    const delivery = inputs.delivery_date || row.scheduled_date || '';
    const observation = inputs.observation || row.work_done || '';

    const pdfItems = items
      .filter((it) => String(it.description || it.servicio || '').trim())
      .map((it) => ({
        description: it.description || it.servicio || '',
        qty: Number(it.qty || it.quantity || it.cantidad || 1) || 1,
        unit: it.unit || it.unidad || 'UNIDAD',
      }));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="service-work-order-${id}.pdf"`);
    await generateWorkOrderPDF(
      {
        reference: row.reference || row.id,
        client: row.org_name || '',
        contact,
        phone,
        email,
        priority,
        delivery,
        observation,
        calcomania: cfMap.calcomania || '',
        tecnicos_responsables: cfMap.tecnicos_responsables || '',
        address: row.org_branch_address || '',
        items: pdfItems,
        issue_date: new Date(),
        signature: cfMap.tecnicos_responsables || '',
        signature_phone: '',
      },
      res
    );
  } catch (e) {
    console.error('[service] work-order pdf error:', e?.message || e, e?.stack || '');
    res.status(500).json({ error: e?.message || 'No se pudo generar el PDF' });
  }
});

router.get('/cases/:id/report/pdf', requireAuth, requireAnyRole('admin', 'service'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id invalido' });

    const [[row]] = await pool.query(
      `SELECT sc.*, o.name AS org_name, o.ruc AS org_ruc,
              d.placa_id, d.marca, d.modelo, d.dimensiones,
              d.fecha_instalacion, d.fecha_ultimo_mantenimiento,
              s.name AS stage_name
         FROM service_cases sc
         LEFT JOIN organizations o ON o.id = sc.org_id
         LEFT JOIN client_doors d ON d.id = sc.door_id
         LEFT JOIN service_stages s ON s.id = sc.stage_id
        WHERE sc.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Caso no encontrado' });

    const [doors] = await pool.query(
      `SELECT d.id, d.placa_id, d.marca, d.modelo, d.dimensiones,
              d.fecha_instalacion, d.fecha_ultimo_mantenimiento,
              sd.work_type, sd.maintenance_detail, sd.repair_detail,
              sd.parts_components, sd.parts_actuators, sd.work_done, sd.parts_used, sd.cost
         FROM service_case_doors sd
         JOIN client_doors d ON d.id = sd.door_id
        WHERE sd.service_case_id = ?
        ORDER BY d.id`,
      [id]
    );

    const [history] = await pool.query(
      `SELECT h.*, u.name AS user_name
         FROM service_case_history h
         LEFT JOIN users u ON u.id = h.created_by
        WHERE h.service_case_id = ?
        ORDER BY h.id DESC`,
      [id]
    );

    const toList = (val) => {
      const parsed = asJson(val);
      if (Array.isArray(parsed)) return parsed.join(', ');
      if (typeof val === 'string') return val;
      return '';
    };

    const doorsHtml = (doors || []).map((d) => `
      <div class="card" style="margin-top:10px;">
        <h2>Puerta ${d.placa_id || d.id}</h2>
        <div><b>Modelo:</b> ${d.modelo || ''}</div>
        <div><b>Dimensiones:</b> ${d.dimensiones || ''}</div>
        <div><b>InstalaciÃ³n:</b> ${d.fecha_instalacion || ''}</div>
        <div><b>Ult. mantenimiento puerta:</b> ${d.fecha_ultimo_mantenimiento || ''}</div>
        <div><b>Trabajo a realizar:</b> ${toList(d.work_type) || ''}</div>
        <div><b>Detalle mantenimiento:</b> ${d.maintenance_detail || ''}</div>
        <div><b>Detalle reparaciÃ³n:</b> ${d.repair_detail || ''}</div>
        <div><b>Detalle revisiÃ³n:</b> ${d.revision_detail || ''}</div>
        <div><b>Componentes (cambio piezas):</b> ${toList(d.parts_components) || ''}</div>
        <div><b>Accionadores (cambio piezas):</b> ${toList(d.parts_actuators) || ''}</div>
        <div><b>Trabajo realizado:</b> ${d.work_done || ''}</div>
        <div><b>Repuestos:</b> ${d.parts_used || ''}</div>
        <div><b>Costo:</b> ${d.cost || ''}</div>
      </div>
    `).join('');

    const html = `<!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Informe mantenimiento ${row.reference || row.id}</title>
      <style>
        body { font-family: Arial, sans-serif; color:#111; }
        h1 { font-size: 18px; margin-bottom: 6px; }
        h2 { font-size: 14px; margin: 12px 0 6px; }
        table { width:100%; border-collapse: collapse; font-size: 12px; }
        th, td { border:1px solid #ddd; padding:6px; text-align:left; }
        .muted { color:#666; font-size: 12px; }
        .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .card { border:1px solid #ddd; padding:8px; border-radius:6px; }
      </style>
    </head>
    <body>
      <h1>Informe de mantenimiento - ${row.reference || row.id}</h1>
      <div class="muted">Generado: ${new Date().toISOString().slice(0,10)}</div>

      <div class="grid">
        <div class="card">
          <h2>Cliente</h2>
          <div><b>Nombre:</b> ${row.org_name || ''}</div>
          <div><b>RUC:</b> ${row.org_ruc || ''}</div>
        </div>
      <div class="card">
        <h2>Resumen</h2>
        <div><b>Etapa:</b> ${row.stage_name || ''}</div>
        <div><b>Estado:</b> ${row.status || ''}</div>
        <div><b>Programado:</b> ${row.scheduled_date || ''}</div>
      </div>
    </div>

    <h2>Detalle por puerta</h2>
    ${doorsHtml || '<div class="muted">Sin puertas asociadas</div>'}

    <h2>Historial</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Accion</th><th>Usuario</th><th>Detalle</th></tr></thead>
        <tbody>
          ${(history || []).map(h => `
            <tr>
              <td>${String(h.created_at || '').slice(0,19).replace('T',' ')}</td>
              <td>${h.action || ''}</td>
              <td>${h.user_name || ''}</td>
              <td>${h.notes || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </body>
    </html>`;

    const { buffer } = await htmlToPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="service-report-${id}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo generar el PDF' });
  }
});


export default router;
