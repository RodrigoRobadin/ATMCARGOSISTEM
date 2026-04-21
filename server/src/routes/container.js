import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import generateContainerContractPDF from '../services/containerContractTemplatePdfkit.js';

const router = Router();
const CONTAINER_BU_KEY = 'atm-container';

const serviceAttachmentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { serviceId } = req.params;
    const dir = path.resolve('uploads', 'container-services', String(serviceId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const serviceUpload = multer({ storage: serviceAttachmentStorage });

function safeParseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeLegalReps(jsonRaw, fallbackName = null, fallbackDoc = null) {
  const source = Array.isArray(jsonRaw) ? jsonRaw : safeParseJsonArray(jsonRaw);
  const parsed = source
    .map((row) => ({
      name: row?.name || '',
      doc: row?.doc || '',
      role: row?.role || '',
    }))
    .filter((row) => row.name || row.doc || row.role);
  if (parsed.length) return parsed;
  if (fallbackName || fallbackDoc) {
    return [{ name: fallbackName || '', doc: fallbackDoc || '', role: '' }];
  }
  return [];
}

ensureContainerSchema().catch((err) =>
  console.error('init container schema', err?.message || err)
);

async function ensureContainerSchema() {
  await pool.query(
    `
      INSERT INTO business_units (key_slug, name, parent_id)
      SELECT ?, ?, NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM business_units WHERE key_slug = ? LIMIT 1
      )
    `,
    [CONTAINER_BU_KEY, 'ATM CONTAINER', CONTAINER_BU_KEY]
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS container_operation_details (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_id INT NOT NULL,
      provider_id INT NULL,
      lessor_org_id INT NULL,
      delivery_location VARCHAR(255) NULL,
      request_summary TEXT NULL,
      internal_status VARCHAR(40) NOT NULL DEFAULT 'pendiente',
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_container_operation_details_deal (deal_id),
      INDEX idx_container_operation_provider (provider_id),
      INDEX idx_container_operation_lessor (lessor_org_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS container_units (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_id INT NOT NULL,
      container_no VARCHAR(64) NULL,
      container_type VARCHAR(32) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pendiente_confirmacion',
      delivered_at DATE NULL,
      removed_at DATE NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_container_units_deal (deal_id),
      INDEX idx_container_units_status (status),
      INDEX idx_container_units_container_no (container_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS container_contracts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_id INT NOT NULL,
      contract_no VARCHAR(64) NULL,
      revision_no INT NOT NULL DEFAULT 1,
      status VARCHAR(32) NOT NULL DEFAULT 'borrador',
      lessor_org_id INT NULL,
      lessee_org_id INT NULL,
      lessor_legal_rep_name VARCHAR(160) NULL,
      lessor_legal_rep_doc VARCHAR(64) NULL,
      lessor_legal_reps_json LONGTEXT NULL,
      lessee_legal_rep_name VARCHAR(160) NULL,
      lessee_legal_rep_doc VARCHAR(64) NULL,
      lessee_legal_reps_json LONGTEXT NULL,
      renewed_from_contract_id INT NULL,
      renewal_no INT NOT NULL DEFAULT 0,
      effective_from DATE NULL,
      effective_to DATE NULL,
      minimum_term_months INT NOT NULL DEFAULT 3,
      payment_due_day INT NOT NULL DEFAULT 5,
      preventive_notice_hours INT NOT NULL DEFAULT 48,
      payment_intimation_days INT NOT NULL DEFAULT 8,
      review_after_months INT NOT NULL DEFAULT 3,
      review_notice_days INT NOT NULL DEFAULT 15,
      replacement_value_usd DECIMAL(15,2) NOT NULL DEFAULT 21000,
      inspection_notice_hours INT NOT NULL DEFAULT 24,
      insurance_required TINYINT(1) NOT NULL DEFAULT 1,
      jurisdiction_text VARCHAR(255) NULL,
      late_fee_daily_pct DECIMAL(8,3) NOT NULL DEFAULT 0.233,
      late_fee_monthly_pct DECIMAL(8,3) NOT NULL DEFAULT 7.000,
      late_fee_annual_pct DECIMAL(8,3) NOT NULL DEFAULT 27.070,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      title VARCHAR(255) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_container_contracts_deal (deal_id),
      INDEX idx_container_contracts_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const [contractCols] = await pool.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'container_contracts'
  `);
  const contractColSet = new Set((contractCols || []).map((row) => row.COLUMN_NAME));
  if (!contractColSet.has('lessor_legal_reps_json')) {
    await pool.query(`
      ALTER TABLE container_contracts
      ADD COLUMN lessor_legal_reps_json LONGTEXT NULL AFTER lessor_legal_rep_doc
    `);
  }
  if (!contractColSet.has('lessee_legal_reps_json')) {
    await pool.query(`
      ALTER TABLE container_contracts
      ADD COLUMN lessee_legal_reps_json LONGTEXT NULL AFTER lessee_legal_rep_doc
    `);
  }
  if (!contractColSet.has('minimum_term_months')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN minimum_term_months INT NOT NULL DEFAULT 3 AFTER lessee_legal_reps_json`);
  }
  if (!contractColSet.has('renewed_from_contract_id')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN renewed_from_contract_id INT NULL AFTER lessee_legal_reps_json`);
  }
  if (!contractColSet.has('renewal_no')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN renewal_no INT NOT NULL DEFAULT 0 AFTER renewed_from_contract_id`);
  }
  if (!contractColSet.has('effective_from')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN effective_from DATE NULL AFTER renewal_no`);
  }
  if (!contractColSet.has('effective_to')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN effective_to DATE NULL AFTER effective_from`);
  }
  if (!contractColSet.has('payment_due_day')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN payment_due_day INT NOT NULL DEFAULT 5 AFTER minimum_term_months`);
  }
  if (!contractColSet.has('preventive_notice_hours')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN preventive_notice_hours INT NOT NULL DEFAULT 48 AFTER payment_due_day`);
  }
  if (!contractColSet.has('payment_intimation_days')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN payment_intimation_days INT NOT NULL DEFAULT 8 AFTER preventive_notice_hours`);
  }
  if (!contractColSet.has('review_after_months')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN review_after_months INT NOT NULL DEFAULT 3 AFTER payment_intimation_days`);
  }
  if (!contractColSet.has('review_notice_days')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN review_notice_days INT NOT NULL DEFAULT 15 AFTER review_after_months`);
  }
  if (!contractColSet.has('replacement_value_usd')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN replacement_value_usd DECIMAL(15,2) NOT NULL DEFAULT 21000 AFTER review_notice_days`);
  }
  if (!contractColSet.has('inspection_notice_hours')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN inspection_notice_hours INT NOT NULL DEFAULT 24 AFTER replacement_value_usd`);
  }
  if (!contractColSet.has('insurance_required')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN insurance_required TINYINT(1) NOT NULL DEFAULT 1 AFTER inspection_notice_hours`);
  }
  if (!contractColSet.has('jurisdiction_text')) {
    await pool.query(`ALTER TABLE container_contracts ADD COLUMN jurisdiction_text VARCHAR(255) NULL AFTER insurance_required`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS container_contract_units (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contract_id INT NOT NULL,
      container_unit_id INT NOT NULL,
      monthly_rent_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      line_order INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_container_contract_units_contract (contract_id),
      INDEX idx_container_contract_units_unit (container_unit_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const [contractUnitCols] = await pool.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'container_contract_units'
  `);
  const contractUnitColSet = new Set((contractUnitCols || []).map((row) => row.COLUMN_NAME));
  if (!contractUnitColSet.has('monthly_rent_amount')) {
    await pool.query(`ALTER TABLE container_contract_units ADD COLUMN monthly_rent_amount DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER container_unit_id`);
  }
  if (!contractUnitColSet.has('currency_code')) {
    await pool.query(`ALTER TABLE container_contract_units ADD COLUMN currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG' AFTER monthly_rent_amount`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS container_contract_lines (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contract_id INT NOT NULL,
      line_type VARCHAR(32) NULL,
      description VARCHAR(255) NOT NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      line_order INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_container_contract_lines_contract (contract_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS container_contract_revisions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contract_id INT NOT NULL,
      revision_no INT NOT NULL,
      name VARCHAR(160) NULL,
      snapshot_json LONGTEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_container_contract_revisions_contract (contract_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS container_service_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_id INT NOT NULL,
      container_unit_id INT NOT NULL,
      service_type VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pendiente',
      performed_at DATE NULL,
      technician_name VARCHAR(160) NULL,
      description TEXT NULL,
      report_text LONGTEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_container_service_logs_deal (deal_id),
      INDEX idx_container_service_logs_unit (container_unit_id),
      INDEX idx_container_service_logs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS container_service_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_log_id INT NOT NULL,
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NULL,
      mime_type VARCHAR(120) NULL,
      file_url VARCHAR(500) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_container_service_attachments_service (service_log_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS container_billing_cycles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contract_id INT NOT NULL,
      deal_id INT NOT NULL,
      container_unit_id INT NULL,
      cycle_label VARCHAR(20) NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      due_date DATE NOT NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
      status VARCHAR(24) NOT NULL DEFAULT 'pendiente',
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_container_billing_contract_unit_cycle (contract_id, container_unit_id, cycle_label),
      INDEX idx_container_billing_contract (contract_id),
      INDEX idx_container_billing_deal (deal_id),
      INDEX idx_container_billing_unit (container_unit_id),
      INDEX idx_container_billing_status (status),
      INDEX idx_container_billing_due_date (due_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const [billingCols] = await pool.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'container_billing_cycles'
  `);
  const billingColSet = new Set((billingCols || []).map((row) => row.COLUMN_NAME));
  if (!billingColSet.has('invoice_id')) {
    await pool.query(`ALTER TABLE container_billing_cycles ADD COLUMN invoice_id INT NULL AFTER status`);
  }
  if (!billingColSet.has('container_unit_id')) {
    await pool.query(`ALTER TABLE container_billing_cycles ADD COLUMN container_unit_id INT NULL AFTER deal_id`);
    await pool.query(`
      UPDATE container_billing_cycles bc
      INNER JOIN (
        SELECT ccu.contract_id, MIN(ccu.container_unit_id) AS container_unit_id, COUNT(*) AS total_units
        FROM container_contract_units ccu
        GROUP BY ccu.contract_id
      ) one_unit ON one_unit.contract_id = bc.contract_id AND one_unit.total_units = 1
      SET bc.container_unit_id = one_unit.container_unit_id
      WHERE bc.container_unit_id IS NULL
    `);
  }
  if (!billingColSet.has('invoiced_at')) {
    await pool.query(`ALTER TABLE container_billing_cycles ADD COLUMN invoiced_at DATETIME NULL AFTER invoice_id`);
  }
  if (!billingColSet.has('invoiced_by')) {
    await pool.query(`ALTER TABLE container_billing_cycles ADD COLUMN invoiced_by INT NULL AFTER invoiced_at`);
  }
  if (!billingColSet.has('tax_rate')) {
    await pool.query(`ALTER TABLE container_billing_cycles ADD COLUMN tax_rate DECIMAL(6,2) NOT NULL DEFAULT 10 AFTER currency_code`);
  }
  try {
    await pool.query(`ALTER TABLE container_billing_cycles DROP INDEX uq_container_billing_contract_cycle`);
  } catch (_err) {}
  try {
    await pool.query(`ALTER TABLE container_billing_cycles ADD UNIQUE KEY uq_container_billing_contract_unit_cycle (contract_id, container_unit_id, cycle_label)`);
  } catch (_err) {}
  try {
    await pool.query(`ALTER TABLE container_billing_cycles ADD INDEX idx_container_billing_unit (container_unit_id)`);
  } catch (_err) {}
}

async function getContainerBusinessUnitId() {
  await ensureContainerSchema();
  const [[row]] = await pool.query(
    'SELECT id FROM business_units WHERE key_slug = ? LIMIT 1',
    [CONTAINER_BU_KEY]
  );
  return row?.id || null;
}

async function getContainerDeal(dealId) {
  const [[row]] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.org_id,
        d.contact_id,
        d.stage_id,
        d.pipeline_id,
        d.business_unit_id,
        bu.key_slug AS business_unit_key,
        cod.id AS container_detail_id,
        cod.provider_id,
        provider.name AS provider_name,
        cod.lessor_org_id,
        lessor.name AS lessor_name,
        cod.delivery_location,
        cod.request_summary,
        cod.internal_status,
        cod.notes
      FROM deals d
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN container_operation_details cod ON cod.deal_id = d.id
      LEFT JOIN organizations provider ON provider.id = cod.provider_id
      LEFT JOIN organizations lessor ON lessor.id = cod.lessor_org_id
      WHERE d.id = ?
      LIMIT 1
    `,
    [dealId]
  );

  if (!row) return null;
  if (String(row.business_unit_key || '').toLowerCase() !== CONTAINER_BU_KEY) {
    return null;
  }
  return row;
}

async function listDealUnits(dealId) {
  const [rows] = await pool.query(
    `
      SELECT id, deal_id, container_no, container_type, status, delivered_at, removed_at, notes, created_at, updated_at
      FROM container_units
      WHERE deal_id = ?
      ORDER BY id ASC
    `,
    [dealId]
  );
  return rows || [];
}

async function getContractFull(contractId, { revisionId = null } = {}) {
  const [[contract]] = await pool.query(
    `
      SELECT
        c.*,
        lessor.name AS lessor_name,
        lessor.ruc AS lessor_ruc,
        lessor.address AS lessor_address,
        lessor.city AS lessor_city,
        lessee.name AS lessee_name,
        lessee.ruc AS lessee_ruc,
        lessee.address AS lessee_address,
        lessee.city AS lessee_city,
        parent.contract_no AS renewed_from_contract_no,
        d.reference AS deal_reference,
        d.title AS deal_title,
        d.org_id AS deal_org_id
      FROM container_contracts c
      INNER JOIN deals d ON d.id = c.deal_id
      LEFT JOIN organizations lessor ON lessor.id = c.lessor_org_id
      LEFT JOIN organizations lessee ON lessee.id = c.lessee_org_id
      LEFT JOIN container_contracts parent ON parent.id = c.renewed_from_contract_id
      WHERE c.id = ?
      LIMIT 1
    `,
    [contractId]
  );
  if (!contract) return null;

  if (revisionId) {
    const [[revision]] = await pool.query(
      'SELECT * FROM container_contract_revisions WHERE id = ? AND contract_id = ? LIMIT 1',
      [revisionId, contractId]
    );
    if (revision?.snapshot_json) {
      const snapshot = JSON.parse(revision.snapshot_json);
      const normalizedContract = snapshot?.contract || {};
      normalizedContract.lessor_legal_reps = normalizeLegalReps(
        normalizedContract.lessor_legal_reps_json,
        normalizedContract.lessor_legal_rep_name,
        normalizedContract.lessor_legal_rep_doc
      );
      normalizedContract.lessee_legal_reps = normalizeLegalReps(
        normalizedContract.lessee_legal_reps_json,
        normalizedContract.lessee_legal_rep_name,
        normalizedContract.lessee_legal_rep_doc
      );
      return {
        ...snapshot,
        contract: { ...normalizedContract, id: contract.id, revision_snapshot_id: revision.id },
        revision,
      };
    }
  }

  const [units] = await pool.query(
    `
      SELECT
        ccu.id,
        ccu.container_unit_id,
        ccu.monthly_rent_amount,
        ccu.currency_code,
        ccu.line_order,
        cu.container_no,
        cu.container_type,
        cu.status,
        cu.delivered_at,
        cu.removed_at,
        cu.notes
      FROM container_contract_units ccu
      INNER JOIN container_units cu ON cu.id = ccu.container_unit_id
      WHERE ccu.contract_id = ?
      ORDER BY ccu.line_order ASC, ccu.id ASC
    `,
    [contractId]
  );

  const [lines] = await pool.query(
    `
      SELECT id, line_type, description, amount, currency_code, line_order
      FROM container_contract_lines
      WHERE contract_id = ?
      ORDER BY line_order ASC, id ASC
    `,
    [contractId]
  );

  const normalizedContract = {
    ...contract,
    lessor_legal_reps: normalizeLegalReps(
      contract.lessor_legal_reps_json,
      contract.lessor_legal_rep_name,
      contract.lessor_legal_rep_doc
    ),
    lessee_legal_reps: normalizeLegalReps(
      contract.lessee_legal_reps_json,
      contract.lessee_legal_rep_name,
      contract.lessee_legal_rep_doc
    ),
  };

  return { contract: normalizedContract, units: units || [], lines: lines || [] };
}

async function upsertContractGraph(contractId, payload) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const header = payload?.contract || payload || {};
    const units = Array.isArray(payload?.units) ? payload.units : [];
    const lines = Array.isArray(payload?.lines) ? payload.lines : [];
    const lessorLegalReps = normalizeLegalReps(
      header.lessor_legal_reps_json,
      header.lessor_legal_rep_name,
      header.lessor_legal_rep_doc
    );
    const lesseeLegalReps = normalizeLegalReps(
      header.lessee_legal_reps_json,
      header.lessee_legal_rep_name,
      header.lessee_legal_rep_doc
    );
    const lessorPrimary = lessorLegalReps[0] || {};
    const lesseePrimary = lesseeLegalReps[0] || {};

    const headerFields = [];
    const headerParams = [];
    const pushField = (field, value) => {
      if (value !== undefined) {
        headerFields.push(`${field} = ?`);
        headerParams.push(value);
      }
    };

    pushField('contract_no', header.contract_no || null);
    pushField('revision_no', header.revision_no || 1);
    pushField('status', header.status || 'borrador');
    pushField('lessor_org_id', header.lessor_org_id || null);
    pushField('lessee_org_id', header.lessee_org_id || null);
    pushField('lessor_legal_rep_name', lessorPrimary.name || header.lessor_legal_rep_name || null);
    pushField('lessor_legal_rep_doc', lessorPrimary.doc || header.lessor_legal_rep_doc || null);
    pushField('lessor_legal_reps_json', JSON.stringify(lessorLegalReps));
    pushField('lessee_legal_rep_name', lesseePrimary.name || header.lessee_legal_rep_name || null);
    pushField('lessee_legal_rep_doc', lesseePrimary.doc || header.lessee_legal_rep_doc || null);
    pushField('lessee_legal_reps_json', JSON.stringify(lesseeLegalReps));
    pushField('renewed_from_contract_id', header.renewed_from_contract_id || null);
    pushField('renewal_no', Number(header.renewal_no ?? 0) || 0);
    pushField('effective_from', header.effective_from || null);
    pushField('effective_to', header.effective_to || null);
    pushField('minimum_term_months', Number(header.minimum_term_months ?? 3) || 3);
    pushField('payment_due_day', Number(header.payment_due_day ?? 5) || 5);
    pushField('preventive_notice_hours', Number(header.preventive_notice_hours ?? 48) || 48);
    pushField('payment_intimation_days', Number(header.payment_intimation_days ?? 8) || 8);
    pushField('review_after_months', Number(header.review_after_months ?? 3) || 3);
    pushField('review_notice_days', Number(header.review_notice_days ?? 15) || 15);
    pushField('replacement_value_usd', Number(header.replacement_value_usd ?? 21000) || 21000);
    pushField('inspection_notice_hours', Number(header.inspection_notice_hours ?? 24) || 24);
    pushField('insurance_required', header.insurance_required === undefined ? 1 : Number(Boolean(header.insurance_required)));
    pushField('jurisdiction_text', header.jurisdiction_text || 'Tribunales del Departamento Central');
    pushField('late_fee_daily_pct', header.late_fee_daily_pct ?? 0.233);
    pushField('late_fee_monthly_pct', header.late_fee_monthly_pct ?? 7);
    pushField('late_fee_annual_pct', header.late_fee_annual_pct ?? 27.07);
    pushField('currency_code', header.currency_code || 'PYG');
    pushField('title', header.title || null);
    pushField('notes', header.notes || null);

    if (headerFields.length) {
      headerParams.push(contractId);
      await conn.query(
        `UPDATE container_contracts SET ${headerFields.join(', ')} WHERE id = ?`,
        headerParams
      );
    }

    await conn.query('DELETE FROM container_contract_units WHERE contract_id = ?', [contractId]);
    await conn.query('DELETE FROM container_contract_lines WHERE contract_id = ?', [contractId]);

    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      if (!unit?.container_unit_id) continue;
      await conn.query(
        `INSERT INTO container_contract_units (contract_id, container_unit_id, monthly_rent_amount, currency_code, line_order)
         VALUES (?, ?, ?, ?, ?)`,
        [
          contractId,
          unit.container_unit_id,
          Number(unit.monthly_rent_amount || 0) || 0,
          unit.currency_code || header.currency_code || 'PYG',
          index + 1,
        ]
      );
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line?.description) continue;
      await conn.query(
        `INSERT INTO container_contract_lines (contract_id, line_type, description, amount, currency_code, line_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          contractId,
          line.line_type || null,
          line.description,
          Number(line.amount || 0) || 0,
          line.currency_code || header.currency_code || 'PYG',
          index + 1,
        ]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function addMonths(dateLike, months) {
  const date = new Date(dateLike);
  const day = date.getDate();
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, maxDay));
  return next;
}

function startOfDay(dateLike) {
  const d = new Date(dateLike);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(dateLike, days) {
  const d = startOfDay(dateLike);
  d.setDate(d.getDate() + days);
  return d;
}

function toSqlDate(dateLike) {
  return startOfDay(dateLike).toISOString().slice(0, 10);
}

function clampDueDate(year, monthIndex, day) {
  const maxDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(Number(day || 1), 1), maxDay));
}

async function getBillingSeeds(contractId) {
  const [[contract]] = await pool.query(
    `
      SELECT
        c.id,
        c.deal_id,
        c.contract_no,
        c.status,
        c.currency_code,
        c.payment_due_day,
        c.effective_from,
        c.effective_to,
        d.reference,
        d.title,
        client.name AS client_name,
        provider.name AS provider_name
      FROM container_contracts c
      INNER JOIN deals d ON d.id = c.deal_id
      LEFT JOIN organizations client ON client.id = d.org_id
      LEFT JOIN container_operation_details cod ON cod.deal_id = d.id
      LEFT JOIN organizations provider ON provider.id = cod.provider_id
      WHERE c.id = ?
      LIMIT 1
    `,
    [contractId]
  );
  if (!contract) return null;

  const [[lineInfo]] = await pool.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(line_type, '')) = 'alquiler' THEN amount ELSE 0 END), 0) AS rent_amount,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM container_contract_lines
      WHERE contract_id = ?
    `,
    [contractId]
  );

  const [[initialInvoice]] = await pool.query(
    `
      SELECT id, invoice_number, issue_date
      FROM invoices
      WHERE deal_id = ?
        AND container_billing_cycle_id IS NULL
        AND status <> 'anulada'
      ORDER BY issue_date ASC, id ASC
      LIMIT 1
    `,
    [contract.deal_id]
  );

  const [contractUnitsRaw] = await pool.query(
    `
      SELECT
        ccu.container_unit_id,
        ccu.monthly_rent_amount,
        ccu.currency_code,
        cu.container_no,
        cu.container_type,
        cu.delivered_at
      FROM container_contract_units ccu
      INNER JOIN container_units cu ON cu.id = ccu.container_unit_id
      WHERE ccu.contract_id = ?
      ORDER BY ccu.line_order ASC, cu.id ASC
    `,
    [contractId]
  );
  const seenUnitIds = new Set();
  const contractUnits = (contractUnitsRaw || []).filter((row) => {
    const key = Number(row?.container_unit_id || 0);
    if (!key || seenUnitIds.has(key)) return false;
    seenUnitIds.add(key);
    return true;
  });

  const seeds = [];
  const singleUnitFallbackAmount = contractUnits.length === 1
    ? Number(lineInfo?.rent_amount || lineInfo?.total_amount || 0)
    : 0;
  for (const unit of contractUnits || []) {
    const [[unitLastCycle]] = await pool.query(
      `
        SELECT id, cycle_label, period_start, period_end, due_date
        FROM container_billing_cycles
        WHERE contract_id = ? AND container_unit_id = ?
        ORDER BY period_start DESC, id DESC
        LIMIT 1
      `,
      [contractId, unit.container_unit_id]
    );
    const [[legacyLastCycle]] = await pool.query(
      `
        SELECT id, cycle_label, period_start, period_end, due_date
        FROM container_billing_cycles
        WHERE contract_id = ? AND container_unit_id IS NULL
        ORDER BY period_start DESC, id DESC
        LIMIT 1
      `,
      [contractId]
    );
    seeds.push({
      ...contract,
      container_unit_id: unit.container_unit_id,
      container_no: unit.container_no || null,
      container_type: unit.container_type || null,
      first_delivered_at: unit?.delivered_at || null,
      rent_amount: Number(unit?.monthly_rent_amount || 0) || singleUnitFallbackAmount,
      unit_currency_code: unit?.currency_code || contract.currency_code || 'PYG',
      total_amount: Number(lineInfo?.total_amount || 0),
      last_cycle: unitLastCycle || legacyLastCycle || null,
      initial_invoice_id: initialInvoice?.id || null,
      initial_invoice_number: initialInvoice?.invoice_number || null,
      initial_invoice_date: initialInvoice?.issue_date || null,
      first_month_included: Boolean(initialInvoice?.id),
    });
  }
  return seeds;
}

function buildNextBillingCycle(seed) {
  const hasPreviousCycle = Boolean(seed?.last_cycle?.period_start);
  const baseDateRaw = seed?.first_delivered_at || seed?.effective_from || new Date();
  const firstPeriodStart = startOfDay(baseDateRaw);
  const periodStart = hasPreviousCycle
    ? addMonths(seed.last_cycle.period_start, 1)
    : seed?.first_month_included
      ? addMonths(firstPeriodStart, 1)
      : firstPeriodStart;
  const periodEnd = addDays(addMonths(periodStart, 1), -1);
  const dueDate = clampDueDate(periodStart.getFullYear(), periodStart.getMonth(), seed?.payment_due_day || 5);
  return {
    cycle_label: `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`,
    period_start: toSqlDate(periodStart),
    period_end: toSqlDate(periodEnd),
    due_date: toSqlDate(dueDate),
    amount: Number(seed?.rent_amount || seed?.total_amount || 0),
    currency_code: seed?.unit_currency_code || seed?.currency_code || 'PYG',
    tax_rate: 10,
    container_unit_id: seed?.container_unit_id || null,
  };
}

function billingPeriodsOverlap(startA, endA, startB, endB) {
  const a1 = startOfDay(startA);
  const a2 = startOfDay(endA);
  const b1 = startOfDay(startB);
  const b2 = startOfDay(endB);
  return a1 <= b2 && b1 <= a2;
}

async function computeDealAlerts({ dealId = null } = {}) {
  const where = dealId ? 'WHERE c.deal_id = ?' : '';
  const [contracts] = await pool.query(
    `
      SELECT
        c.id AS contract_id,
        c.deal_id,
        c.contract_no,
        c.status,
        c.currency_code,
        c.effective_from,
        c.effective_to,
        c.payment_due_day,
        c.late_fee_daily_pct,
        c.late_fee_monthly_pct,
        c.late_fee_annual_pct,
        d.reference,
        d.title,
        cu.id AS unit_id,
        cu.container_no,
        cu.container_type,
        cu.delivered_at
      FROM container_contracts c
      INNER JOIN deals d ON d.id = c.deal_id
      LEFT JOIN container_contract_units ccu ON ccu.contract_id = c.id
      LEFT JOIN container_units cu ON cu.id = ccu.container_unit_id
      ${where}
      ORDER BY c.id DESC, cu.id ASC
    `,
    dealId ? [dealId] : []
  );

  const today = startOfDay(new Date());
  const alerts = [];

  for (const row of contracts || []) {
    const baseDateRaw = row?.effective_from || row?.delivered_at;
    if (!baseDateRaw) continue;
    if (['anulado', 'cerrado'].includes(String(row.status || '').toLowerCase())) continue;

    const baseDate = startOfDay(baseDateRaw);
    const effectiveTo = row?.effective_to ? startOfDay(row.effective_to) : null;

    if (effectiveTo) {
      const daysToContractEnd = Math.round((effectiveTo.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      if ([30, 15, 7, 3, 1, 0].includes(daysToContractEnd) || daysToContractEnd < 0) {
        alerts.push({
          alert_type: daysToContractEnd < 0 ? 'contrato_vencido' : daysToContractEnd === 0 ? 'contrato_vence_hoy' : `contrato_vence_en_${daysToContractEnd}`,
          contract_id: row.contract_id,
          deal_id: row.deal_id,
          reference: row.reference,
          title: row.title,
          contract_no: row.contract_no,
          unit_id: row.unit_id,
          container_no: row.container_no,
          container_type: row.container_type,
          due_date: effectiveTo.toISOString().slice(0, 10),
          days_left: daysToContractEnd,
          message: daysToContractEnd < 0
            ? `Contrato ${row.contract_no || '-'} vencido hace ${Math.abs(daysToContractEnd)} dia(s)`
            : daysToContractEnd === 0
              ? `Contrato ${row.contract_no || '-'} vence hoy`
              : `Contrato ${row.contract_no || '-'} vence en ${daysToContractEnd} dia(s)`,
        });
      }
    }

    let cycleDate = baseDate;
    while (addMonths(cycleDate, 1) <= today) {
      cycleDate = addMonths(cycleDate, 1);
    }

    const isOverdue = cycleDate < today;
    const daysDiff = Math.round((cycleDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

    let alertType = null;
    if (isOverdue) {
      alertType = 'mora_activa';
    } else if ([15, 10, 5, 3, 1, 0].includes(daysDiff)) {
      alertType = daysDiff === 0 ? 'vence_hoy' : `vence_en_${daysDiff}`;
    }
    if (!alertType) continue;

    alerts.push({
      alert_type: alertType,
      contract_id: row.contract_id,
      deal_id: row.deal_id,
      reference: row.reference,
      title: row.title,
      contract_no: row.contract_no,
      unit_id: row.unit_id,
      container_no: row.container_no,
      container_type: row.container_type,
      due_date: cycleDate.toISOString().slice(0, 10),
      days_left: isOverdue ? -Math.round((today.getTime() - cycleDate.getTime()) / (24 * 60 * 60 * 1000)) : daysDiff,
      message: isOverdue
        ? `Contrato ${row.contract_no || '-'} con mora referencial para ${row.container_no || 'contenedor'}: ${row.late_fee_daily_pct || 0.233}% diario, ${row.late_fee_monthly_pct || 7}% mensual, tope ${row.late_fee_annual_pct || 27.07}% anual`
        : daysDiff === 0
          ? `Contrato ${row.contract_no || '-'} vence hoy`
          : `Contrato ${row.contract_no || '-'} vence en ${daysDiff} dia(s)`,
    });
  }

  return alerts;
}

router.get('/master', requireAuth, async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT
      cu.id,
      cu.deal_id,
      d.reference,
      d.title,
      cu.container_no,
      cu.container_type,
      cu.status,
      cu.delivered_at,
      cu.removed_at,
      provider.name AS provider_name,
      org.name AS client_name
    FROM container_units cu
    INNER JOIN deals d ON d.id = cu.deal_id
    LEFT JOIN container_operation_details cod ON cod.deal_id = d.id
    LEFT JOIN organizations provider ON provider.id = cod.provider_id
    LEFT JOIN organizations org ON org.id = d.org_id
    ORDER BY cu.updated_at DESC, cu.id DESC
  `);
  res.json(rows || []);
});


router.post('/deals/:dealId/contracts', requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  const detail = await getContainerDeal(dealId);
  if (!detail) return res.status(404).json({ error: 'Operacion ATM CONTAINER no encontrada' });

  const requestedUnitIds = Array.isArray(req.body?.unit_ids)
    ? req.body.unit_ids.map((value) => Number(value)).filter(Boolean)
    : [];
  const selectedUnits = requestedUnitIds.length
    ? (await listDealUnits(dealId)).filter((row) => requestedUnitIds.includes(Number(row.id)))
    : [];

  const [[countRow]] = await pool.query(
    'SELECT COUNT(*) AS total FROM container_contracts WHERE deal_id = ?',
    [dealId]
  );
  const nextIndex = Number(countRow?.total || 0) + 1;
  const defaultContractNo = `CTR-${String(detail.reference || dealId).replace(/[^A-Z0-9-]/gi, '')}-${String(nextIndex).padStart(2, '0')}`;
  const currencyCode = req.body?.currency_code || 'PYG';
  const title = req.body?.title || `Contrato ${detail.reference || ''}`.trim() || 'Contrato ATM CONTAINER';

  const [insertResult] = await pool.query(
    `
      INSERT INTO container_contracts (
        deal_id, contract_no, revision_no, status, lessor_org_id, lessee_org_id,
        currency_code, title
      )
      VALUES (?, ?, 1, 'borrador', ?, ?, ?, ?)
    `,
    [
      dealId,
      req.body?.contract_no || defaultContractNo,
      detail.lessor_org_id || null,
      detail.org_id || null,
      currencyCode,
      title,
    ]
  );

  const contractId = Number(insertResult?.insertId || 0);
  await upsertContractGraph(contractId, {
    contract: {
      contract_no: req.body?.contract_no || defaultContractNo,
      revision_no: 1,
      status: 'borrador',
      lessor_org_id: detail.lessor_org_id || null,
      lessee_org_id: detail.org_id || null,
      currency_code: currencyCode,
      title,
      minimum_term_months: 3,
      payment_due_day: 5,
      preventive_notice_hours: 48,
      payment_intimation_days: 8,
      review_after_months: 3,
      review_notice_days: 15,
      replacement_value_usd: 21000,
      inspection_notice_hours: 24,
      insurance_required: 1,
      jurisdiction_text: 'Tribunales del Departamento Central',
      late_fee_daily_pct: 0.233,
      late_fee_monthly_pct: 7,
      late_fee_annual_pct: 27.07,
    },
    units: selectedUnits.map((row, index) => ({
      container_unit_id: row.id,
      monthly_rent_amount: 0,
      currency_code: currencyCode,
      line_order: index + 1,
    })),
    lines: [
      { line_type: 'alquiler', description: 'Alquiler', amount: 0, currency_code: currencyCode, line_order: 1 },
      { line_type: 'flete', description: 'Flete', amount: 0, currency_code: currencyCode, line_order: 2 },
      { line_type: 'garantia', description: 'Garantia', amount: 0, currency_code: currencyCode, line_order: 3 },
    ],
  });

  const created = await getContractFull(contractId);
  res.status(201).json(created);
});

router.get('/contracts/:id', requireAuth, async (req, res) => {
  const contractId = Number(req.params.id);
  const revisionId = Number(req.query?.revision_id || 0) || null;
  if (!contractId) return res.status(400).json({ error: 'Contrato invalido' });

  const contract = await getContractFull(contractId, { revisionId });
  if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });

  const detail = await getContainerDeal(contract.contract?.deal_id);
  if (!detail) return res.status(404).json({ error: 'Operacion ATM CONTAINER no encontrada' });

  res.json(contract);
});

router.put('/contracts/:id', requireAuth, async (req, res) => {
  const contractId = Number(req.params.id);
  if (!contractId) return res.status(400).json({ error: 'Contrato invalido' });

  const existing = await getContractFull(contractId);
  if (!existing) return res.status(404).json({ error: 'Contrato no encontrado' });

  const detail = await getContainerDeal(existing.contract?.deal_id);
  if (!detail) return res.status(404).json({ error: 'Operacion ATM CONTAINER no encontrada' });

  await upsertContractGraph(contractId, req.body || {});
  const updated = await getContractFull(contractId);
  res.json(updated);
});

router.get('/contracts/:id/revisions', requireAuth, async (req, res) => {
  const contractId = Number(req.params.id);
  if (!contractId) return res.status(400).json({ error: 'Contrato invalido' });

  const existing = await getContractFull(contractId);
  if (!existing) return res.status(404).json({ error: 'Contrato no encontrado' });

  const [rows] = await pool.query(
    `
      SELECT id, contract_id, revision_no, name, created_by, created_at
      FROM container_contract_revisions
      WHERE contract_id = ?
      ORDER BY revision_no DESC, id DESC
    `,
    [contractId]
  );
  res.json(rows || []);
});

router.post('/contracts/:id/revisions', requireAuth, async (req, res) => {
  const contractId = Number(req.params.id);
  if (!contractId) return res.status(400).json({ error: 'Contrato invalido' });

  const existing = await getContractFull(contractId);
  if (!existing) return res.status(404).json({ error: 'Contrato no encontrado' });

  const [[maxRow]] = await pool.query(
    'SELECT COALESCE(MAX(revision_no), 0) AS max_revision_no FROM container_contract_revisions WHERE contract_id = ?',
    [contractId]
  );
  const nextRevisionNo = Number(maxRow?.max_revision_no || existing.contract?.revision_no || 0) + 1;

  const snapshot = await getContractFull(contractId);
  const [insertResult] = await pool.query(
    `
      INSERT INTO container_contract_revisions (contract_id, revision_no, name, snapshot_json, created_by)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      contractId,
      nextRevisionNo,
      req.body?.name || `Revision ${nextRevisionNo}`,
      JSON.stringify(snapshot),
      req.user?.id || null,
    ]
  );

  await pool.query('UPDATE container_contracts SET revision_no = ? WHERE id = ?', [nextRevisionNo, contractId]);
  const [[row]] = await pool.query(
    'SELECT id, contract_id, revision_no, name, created_by, created_at FROM container_contract_revisions WHERE id = ? LIMIT 1',
    [insertResult.insertId]
  );
  res.status(201).json(row);
});

router.post('/contracts/:id/renewals', requireAuth, async (req, res) => {
  const contractId = Number(req.params.id);
  if (!contractId) return res.status(400).json({ error: 'Contrato invalido' });

  const existing = await getContractFull(contractId);
  if (!existing) return res.status(404).json({ error: 'Contrato no encontrado' });

  const detail = await getContainerDeal(existing.contract?.deal_id);
  if (!detail) return res.status(404).json({ error: 'Operacion ATM CONTAINER no encontrada' });

  const nextRenewalNo = Number(existing.contract?.renewal_no || 0) + 1;
  const nextEffectiveFrom = existing.contract?.effective_to
    ? toSqlDate(addDays(existing.contract.effective_to, 1))
    : null;

  const [insertResult] = await pool.query(
    `
      INSERT INTO container_contracts (
        deal_id, contract_no, revision_no, status, lessor_org_id, lessee_org_id,
        lessor_legal_rep_name, lessor_legal_rep_doc, lessor_legal_reps_json,
        lessee_legal_rep_name, lessee_legal_rep_doc, lessee_legal_reps_json,
        renewed_from_contract_id, renewal_no, effective_from, effective_to,
        minimum_term_months, payment_due_day, preventive_notice_hours, payment_intimation_days,
        review_after_months, review_notice_days, replacement_value_usd, inspection_notice_hours,
        insurance_required, jurisdiction_text, late_fee_daily_pct, late_fee_monthly_pct,
        late_fee_annual_pct, currency_code, title, notes
      )
      VALUES (?, ?, 1, 'borrador', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      existing.contract.deal_id,
      existing.contract.contract_no,
      existing.contract.lessor_org_id || null,
      existing.contract.lessee_org_id || null,
      existing.contract.lessor_legal_rep_name || null,
      existing.contract.lessor_legal_rep_doc || null,
      JSON.stringify(existing.contract.lessor_legal_reps || []),
      existing.contract.lessee_legal_rep_name || null,
      existing.contract.lessee_legal_rep_doc || null,
      JSON.stringify(existing.contract.lessee_legal_reps || []),
      existing.contract.id,
      nextRenewalNo,
      nextEffectiveFrom,
      null,
      Number(existing.contract.minimum_term_months ?? 3) || 3,
      Number(existing.contract.payment_due_day ?? 5) || 5,
      Number(existing.contract.preventive_notice_hours ?? 48) || 48,
      Number(existing.contract.payment_intimation_days ?? 8) || 8,
      Number(existing.contract.review_after_months ?? 3) || 3,
      Number(existing.contract.review_notice_days ?? 15) || 15,
      Number(existing.contract.replacement_value_usd ?? 21000) || 21000,
      Number(existing.contract.inspection_notice_hours ?? 24) || 24,
      existing.contract.insurance_required === undefined ? 1 : Number(Boolean(existing.contract.insurance_required)),
      existing.contract.jurisdiction_text || 'Tribunales del Departamento Central',
      existing.contract.late_fee_daily_pct ?? 0.233,
      existing.contract.late_fee_monthly_pct ?? 7,
      existing.contract.late_fee_annual_pct ?? 27.07,
      existing.contract.currency_code || 'PYG',
      existing.contract.title || null,
      existing.contract.notes || null,
    ]
  );

  const renewalId = Number(insertResult?.insertId || 0);
  await upsertContractGraph(renewalId, {
    contract: {
      contract_no: existing.contract.contract_no,
      status: 'borrador',
      renewed_from_contract_id: existing.contract.id,
      renewal_no: nextRenewalNo,
      effective_from: nextEffectiveFrom,
      effective_to: null,
      lessor_org_id: existing.contract.lessor_org_id || null,
      lessee_org_id: existing.contract.lessee_org_id || detail.org_id || null,
      currency_code: existing.contract.currency_code || 'PYG',
      title: existing.contract.title || null,
      notes: existing.contract.notes || null,
      minimum_term_months: existing.contract.minimum_term_months ?? 3,
      payment_due_day: existing.contract.payment_due_day ?? 5,
      preventive_notice_hours: existing.contract.preventive_notice_hours ?? 48,
      payment_intimation_days: existing.contract.payment_intimation_days ?? 8,
      review_after_months: existing.contract.review_after_months ?? 3,
      review_notice_days: existing.contract.review_notice_days ?? 15,
      replacement_value_usd: existing.contract.replacement_value_usd ?? 21000,
      inspection_notice_hours: existing.contract.inspection_notice_hours ?? 24,
      insurance_required: existing.contract.insurance_required ?? 1,
      jurisdiction_text: existing.contract.jurisdiction_text || 'Tribunales del Departamento Central',
      late_fee_daily_pct: existing.contract.late_fee_daily_pct ?? 0.233,
      late_fee_monthly_pct: existing.contract.late_fee_monthly_pct ?? 7,
      late_fee_annual_pct: existing.contract.late_fee_annual_pct ?? 27.07,
      lessor_legal_reps: existing.contract.lessor_legal_reps || [],
      lessee_legal_reps: existing.contract.lessee_legal_reps || [],
    },
    units: (existing.units || []).map((row, index) => ({
      container_unit_id: row.container_unit_id,
      monthly_rent_amount: Number(row.monthly_rent_amount || 0) || 0,
      currency_code: row.currency_code || existing.contract.currency_code || 'PYG',
      line_order: index + 1,
    })),
    lines: (existing.lines || []).map((row, index) => ({
      line_type: row.line_type,
      description: row.description,
      amount: Number(row.amount || 0) || 0,
      currency_code: row.currency_code || existing.contract.currency_code || 'PYG',
      line_order: index + 1,
    })),
  });

  await pool.query('UPDATE container_contracts SET status = ? WHERE id = ?', ['renovado', existing.contract.id]);
  const renewal = await getContractFull(renewalId);
  res.status(201).json(renewal);
});

router.patch('/contracts/:id/status', requireAuth, async (req, res) => {
  const contractId = Number(req.params.id);
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!contractId) return res.status(400).json({ error: 'Contrato invalido' });
  if (!['borrador', 'emitido', 'vigente', 'vencido', 'renovado', 'cerrado', 'anulado'].includes(status)) {
    return res.status(400).json({ error: 'Estado invalido' });
  }

  const existing = await getContractFull(contractId);
  if (!existing) return res.status(404).json({ error: 'Contrato no encontrado' });

  await pool.query('UPDATE container_contracts SET status = ? WHERE id = ?', [status, contractId]);
  const updated = await getContractFull(contractId);
  res.json(updated);
});

router.get('/deals/:dealId', requireAuth, async (req, res) => {
  const detail = await getContainerDeal(Number(req.params.dealId));
  if (!detail) return res.status(404).json({ error: 'Operación ATM CONTAINER no encontrada' });
  res.json(detail);
});

router.put('/deals/:dealId', requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  if (!dealId) return res.status(400).json({ error: 'dealId inválido' });

  const containerBuId = await getContainerBusinessUnitId();
  await pool.query(
    'UPDATE deals SET business_unit_id = ? WHERE id = ? AND (business_unit_id IS NULL OR business_unit_id = ?)',
    [containerBuId, dealId, containerBuId]
  );

  const current = await getContainerDeal(dealId);
  if (!current) {
    return res.status(404).json({ error: 'Operación ATM CONTAINER no encontrada' });
  }

  const {
    provider_id = null,
    lessor_org_id = null,
    delivery_location = null,
    request_summary = null,
    internal_status = null,
    notes = null,
  } = req.body || {};

  await pool.query(
    `
      INSERT INTO container_operation_details (
        deal_id, provider_id, lessor_org_id, delivery_location, request_summary, internal_status, notes
      )
      VALUES (?, ?, ?, ?, ?, COALESCE(?, 'pendiente'), ?)
      ON DUPLICATE KEY UPDATE
        provider_id = VALUES(provider_id),
        lessor_org_id = VALUES(lessor_org_id),
        delivery_location = VALUES(delivery_location),
        request_summary = VALUES(request_summary),
        internal_status = COALESCE(VALUES(internal_status), internal_status),
        notes = VALUES(notes)
    `,
    [
      dealId,
      provider_id || null,
      lessor_org_id || null,
      delivery_location || null,
      request_summary || null,
      internal_status || null,
      notes || null,
    ]
  );

  const updated = await getContainerDeal(dealId);
  res.json(updated);
});

router.get('/deals/:dealId/units', requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  const detail = await getContainerDeal(dealId);
  if (!detail) return res.status(404).json({ error: 'Operación ATM CONTAINER no encontrada' });

  const [rows] = await pool.query(
    `
      SELECT id, deal_id, container_no, container_type, status, delivered_at, removed_at, notes, created_at, updated_at
      FROM container_units
      WHERE deal_id = ?
      ORDER BY id ASC
    `,
    [dealId]
  );
  res.json(rows || []);
});

router.post('/deals/:dealId/units', requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  const detail = await getContainerDeal(dealId);
  if (!detail) return res.status(404).json({ error: 'Operación ATM CONTAINER no encontrada' });

  const {
    container_no = null,
    container_type = null,
    status = 'pendiente_confirmacion',
    delivered_at = null,
    removed_at = null,
    notes = null,
  } = req.body || {};

  const [result] = await pool.query(
    `
      INSERT INTO container_units (
        deal_id, container_no, container_type, status, delivered_at, removed_at, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      dealId,
      container_no || null,
      container_type || null,
      status || 'pendiente_confirmacion',
      delivered_at || null,
      removed_at || null,
      notes || null,
    ]
  );

  const [[row]] = await pool.query(
    `
      SELECT id, deal_id, container_no, container_type, status, delivered_at, removed_at, notes, created_at, updated_at
      FROM container_units
      WHERE id = ?
    `,
    [result.insertId]
  );
  res.status(201).json(row);
});

router.put('/units/:id', requireAuth, async (req, res) => {
  const unitId = Number(req.params.id);
  if (!unitId) return res.status(400).json({ error: 'id inválido' });

  const [[existing]] = await pool.query(
    `
      SELECT cu.id, cu.deal_id
      FROM container_units cu
      INNER JOIN deals d ON d.id = cu.deal_id
      INNER JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE cu.id = ? AND bu.key_slug = ?
      LIMIT 1
    `,
    [unitId, CONTAINER_BU_KEY]
  );
  if (!existing) return res.status(404).json({ error: 'Contenedor no encontrado' });

  const {
    container_no,
    container_type,
    status,
    delivered_at,
    removed_at,
    notes,
  } = req.body || {};

  const fields = [];
  const params = [];
  if (container_no !== undefined) {
    fields.push('container_no = ?');
    params.push(container_no || null);
  }
  if (container_type !== undefined) {
    fields.push('container_type = ?');
    params.push(container_type || null);
  }
  if (status !== undefined) {
    fields.push('status = ?');
    params.push(status || 'pendiente_confirmacion');
  }
  if (delivered_at !== undefined) {
    fields.push('delivered_at = ?');
    params.push(delivered_at || null);
  }
  if (removed_at !== undefined) {
    fields.push('removed_at = ?');
    params.push(removed_at || null);
  }
  if (notes !== undefined) {
    fields.push('notes = ?');
    params.push(notes || null);
  }

  if (!fields.length) return res.status(400).json({ error: 'Sin cambios' });

  params.push(unitId);
  await pool.query(`UPDATE container_units SET ${fields.join(', ')} WHERE id = ?`, params);

  const [[row]] = await pool.query(
    `
      SELECT id, deal_id, container_no, container_type, status, delivered_at, removed_at, notes, created_at, updated_at
      FROM container_units
      WHERE id = ?
    `,
    [unitId]
  );
  res.json(row);
});

router.delete('/units/:id', requireAuth, async (req, res) => {
  const unitId = Number(req.params.id);
  if (!unitId) return res.status(400).json({ error: 'id inválido' });
  await pool.query('DELETE FROM container_units WHERE id = ?', [unitId]);
  res.json({ ok: true });
});

router.get('/deals/:dealId/contracts', requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  const detail = await getContainerDeal(dealId);
  if (!detail) return res.status(404).json({ error: 'Operación ATM CONTAINER no encontrada' });

  const [rows] = await pool.query(
    `
      SELECT
        c.id,
        c.deal_id,
        c.contract_no,
        c.revision_no,
        c.renewed_from_contract_id,
        c.renewal_no,
        c.effective_from,
        c.effective_to,
        c.status,
        c.currency_code,
        c.title,
        c.updated_at,
        parent.contract_no AS renewed_from_contract_no,
        (
          SELECT COUNT(*)
          FROM container_contract_units ccu
          WHERE ccu.contract_id = c.id
        ) AS unit_count,
        (
          SELECT COALESCE(SUM(amount), 0)
          FROM container_contract_lines ccl
          WHERE ccl.contract_id = c.id
        ) AS total_amount
      FROM container_contracts c
      LEFT JOIN container_contracts parent ON parent.id = c.renewed_from_contract_id
      WHERE c.deal_id = ?
      ORDER BY c.updated_at DESC, c.id DESC
    `,
    [dealId]
  );

  res.json(rows || []);
});

router.get('/contracts', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();

  const where = [`bu.key_slug = ?`];
  const params = [CONTAINER_BU_KEY];

  if (status) {
    where.push('c.status = ?');
    params.push(status);
  }

  if (q) {
    where.push(`(
      c.contract_no LIKE ?
      OR d.reference LIKE ?
      OR d.title LIKE ?
      OR client.name LIKE ?
      OR provider.name LIKE ?
      OR EXISTS (
        SELECT 1
        FROM container_contract_units ccu2
        INNER JOIN container_units cu2 ON cu2.id = ccu2.container_unit_id
        WHERE ccu2.contract_id = c.id
          AND (
            cu2.container_no LIKE ?
            OR cu2.container_type LIKE ?
          )
      )
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like);
  }

  const [rows] = await pool.query(
    `
      SELECT
        c.id,
        c.deal_id,
        c.contract_no,
        c.revision_no,
        c.renewed_from_contract_id,
        c.renewal_no,
        c.effective_from,
        c.effective_to,
        c.status,
        c.currency_code,
        c.title,
        c.updated_at,
        parent.contract_no AS renewed_from_contract_no,
        d.reference,
        d.title AS deal_title,
        client.name AS client_name,
        provider.name AS provider_name,
        lessor.name AS lessor_name,
        (
          SELECT COUNT(*)
          FROM container_contract_units ccu
          WHERE ccu.contract_id = c.id
        ) AS unit_count,
        (
          SELECT COALESCE(SUM(ccl.amount), 0)
          FROM container_contract_lines ccl
          WHERE ccl.contract_id = c.id
        ) AS total_amount,
        (
          SELECT GROUP_CONCAT(CONCAT(COALESCE(cu.container_no, 'SIN NUMERO'), ' ', COALESCE(cu.container_type, '')) SEPARATOR ' | ')
          FROM container_contract_units ccu
          INNER JOIN container_units cu ON cu.id = ccu.container_unit_id
          WHERE ccu.contract_id = c.id
        ) AS containers_label
      FROM container_contracts c
      INNER JOIN deals d ON d.id = c.deal_id
      INNER JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN organizations client ON client.id = d.org_id
      LEFT JOIN container_operation_details cod ON cod.deal_id = d.id
      LEFT JOIN organizations provider ON provider.id = cod.provider_id
      LEFT JOIN organizations lessor ON lessor.id = c.lessor_org_id
      LEFT JOIN container_contracts parent ON parent.id = c.renewed_from_contract_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.updated_at DESC, c.id DESC
    `,
    params
  );

  res.json(rows || []);
});


router.post('/contracts/:id/billing/generate', requireAuth, async (req, res) => {
  const contractId = Number(req.params.id);
  if (!contractId) return res.status(400).json({ error: 'Contrato invalido' });

  const contract = await getContractFull(contractId);
  if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });

  const seeds = await getBillingSeeds(contractId);
  if (!seeds || !seeds.length) {
    return res.status(400).json({ error: 'El contrato no tiene contenedores vinculados.' });
  }

  const createdIds = [];
  const skipped = [];

  for (const seed of seeds) {
    if (!seed.first_delivered_at) {
      skipped.push({
        container_unit_id: seed.container_unit_id,
        container_no: seed.container_no || null,
        reason: 'Primero debes registrar la entrega real del contenedor para iniciar la mensualidad.',
      });
      continue;
    }
    if (!(Number(seed.rent_amount || 0) > 0)) {
      skipped.push({
        container_unit_id: seed.container_unit_id,
        container_no: seed.container_no || null,
        reason: 'Define el monto mensual del contenedor dentro del contrato.',
      });
      continue;
    }

    const nextCycle = buildNextBillingCycle(seed);
    if (seed.first_month_included && seed.first_delivered_at) {
      const firstCoveredStart = toSqlDate(seed.first_delivered_at);
      const firstCoveredEnd = toSqlDate(addDays(addMonths(seed.first_delivered_at, 1), -1));
      if (
        billingPeriodsOverlap(
          nextCycle.period_start,
          nextCycle.period_end,
          firstCoveredStart,
          firstCoveredEnd
        )
      ) {
        skipped.push({
          container_unit_id: seed.container_unit_id,
          container_no: seed.container_no || null,
          reason: `El primer periodo ya fue cubierto por la factura inicial ${seed.initial_invoice_number || ''}`.trim(),
        });
        continue;
      }
    }

    const [[existingCycle]] = await pool.query(
      `SELECT id
         FROM container_billing_cycles
        WHERE contract_id = ?
          AND container_unit_id <=> ?
          AND (period_start = ? OR cycle_label = ?)
        LIMIT 1`,
      [contractId, seed.container_unit_id || null, nextCycle.period_start, nextCycle.cycle_label]
    );
    if (existingCycle) {
      skipped.push({
        container_unit_id: seed.container_unit_id,
        container_no: seed.container_no || null,
        reason: 'Ese ciclo mensual ya fue generado para el contenedor.',
      });
      continue;
    }

    try {
      const [result] = await pool.query(
        `
          INSERT INTO container_billing_cycles (
            contract_id, deal_id, container_unit_id, cycle_label, period_start, period_end, due_date,
            amount, currency_code, tax_rate, status, notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)
        `,
        [
          contractId,
          seed.deal_id,
          seed.container_unit_id || null,
          nextCycle.cycle_label,
          nextCycle.period_start,
          nextCycle.period_end,
          nextCycle.due_date,
          nextCycle.amount,
          nextCycle.currency_code,
          nextCycle.tax_rate,
          seed.first_month_included && !seed.last_cycle
            ? `Primer mes cubierto por factura inicial ${seed.initial_invoice_number || ''}`.trim()
            : null,
        ]
      );
      createdIds.push(Number(result.insertId));
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY') {
        skipped.push({
          container_unit_id: seed.container_unit_id,
          container_no: seed.container_no || null,
          reason: 'Ese ciclo mensual ya existe para el contenedor.',
        });
        continue;
      }
      throw err;
    }
  }

  if (!createdIds.length) {
    return res.status(400).json({
      error: skipped[0]?.reason || 'No se generaron mensualidades nuevas.',
      skipped,
    });
  }

  const [rows] = await pool.query(
    `
      SELECT
        bc.*, c.contract_no, inv.invoice_number, inv.status AS invoice_status,
        TRIM(CONCAT(
          COALESCE(cu_bill.container_no, ''),
          CASE
            WHEN cu_bill.container_no IS NOT NULL AND cu_bill.container_no <> '' AND cu_bill.container_type IS NOT NULL AND cu_bill.container_type <> '' THEN ' · '
            ELSE ''
          END,
          COALESCE(cu_bill.container_type, '')
        )) AS containers_label
      FROM container_billing_cycles bc
      INNER JOIN container_contracts c ON c.id = bc.contract_id
      LEFT JOIN invoices inv ON inv.id = bc.invoice_id
      LEFT JOIN container_units cu_bill ON cu_bill.id = bc.container_unit_id
      WHERE bc.id IN (${createdIds.map(() => '?').join(',')})
      ORDER BY bc.period_start DESC, bc.id DESC
    `,
    createdIds
  );

  res.status(201).json({ created: rows || [], skipped });
});

router.get('/billing', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();

  const where = [`bu.key_slug = ?`];
  const params = [CONTAINER_BU_KEY];

  if (status) {
    where.push('bc.status = ?');
    params.push(status);
  }

  if (q) {
    where.push(`(
      bc.cycle_label LIKE ?
      OR c.contract_no LIKE ?
      OR d.reference LIKE ?
      OR d.title LIKE ?
      OR client.name LIKE ?
      OR provider.name LIKE ?
      OR EXISTS (
        SELECT 1
        FROM container_contract_units ccu2
        INNER JOIN container_units cu2 ON cu2.id = ccu2.container_unit_id
        WHERE ccu2.contract_id = c.id
          AND (
            cu2.container_no LIKE ?
            OR cu2.container_type LIKE ?
          )
      )
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like);
  }

  const [rows] = await pool.query(
    `
      SELECT
        bc.*,
        c.contract_no,
        inv.invoice_number,
        inv.status AS invoice_status,
        (
          SELECT i2.id
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_id,
        (
          SELECT i2.invoice_number
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_number,
        (
          SELECT i2.status
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_status,
        (
          SELECT i2.canceled_by_credit_note_id
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_credit_note_id,
        d.reference,
        d.title,
        client.name AS client_name,
        provider.name AS provider_name,
        CASE
          WHEN bc.container_unit_id IS NOT NULL THEN TRIM(CONCAT(
            COALESCE(cu_bill.container_no, ''),
            CASE
              WHEN cu_bill.container_no IS NOT NULL AND cu_bill.container_no <> '' AND cu_bill.container_type IS NOT NULL AND cu_bill.container_type <> '' THEN ' · '
              ELSE ''
            END,
            COALESCE(cu_bill.container_type, '')
          ))
          ELSE (
            SELECT GROUP_CONCAT(
              TRIM(CONCAT(
                COALESCE(cu.container_no, ''),
                CASE
                  WHEN cu.container_no IS NOT NULL AND cu.container_no <> '' AND cu.container_type IS NOT NULL AND cu.container_type <> '' THEN ' · '
                  ELSE ''
                END,
                COALESCE(cu.container_type, '')
              ))
              ORDER BY ccu.line_order ASC, cu.id ASC
              SEPARATOR ' | '
            )
            FROM container_contract_units ccu
            INNER JOIN container_units cu ON cu.id = ccu.container_unit_id
            WHERE ccu.contract_id = bc.contract_id
          )
        END AS containers_label
      FROM container_billing_cycles bc
      INNER JOIN container_contracts c ON c.id = bc.contract_id
      LEFT JOIN invoices inv ON inv.id = bc.invoice_id
      LEFT JOIN container_units cu_bill ON cu_bill.id = bc.container_unit_id
      INNER JOIN deals d ON d.id = bc.deal_id
      INNER JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN organizations client ON client.id = d.org_id
      LEFT JOIN container_operation_details cod ON cod.deal_id = d.id
      LEFT JOIN organizations provider ON provider.id = cod.provider_id
      WHERE ${where.join(' AND ')}
      ORDER BY bc.due_date DESC, bc.id DESC
    `,
    params
  );

  res.json(rows || []);
});

router.get('/billing/:id', requireAuth, async (req, res) => {
  const billingId = Number(req.params.id);
  if (!billingId) return res.status(400).json({ error: 'Registro invalido' });

  const [[row]] = await pool.query(
    `
      SELECT
        bc.*,
        c.contract_no,
        c.lessor_org_id,
        c.lessee_org_id,
        inv.invoice_number,
        inv.status AS invoice_status,
        (
          SELECT i2.id
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_id,
        (
          SELECT i2.invoice_number
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_number,
        (
          SELECT i2.status
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_status,
        (
          SELECT i2.canceled_by_credit_note_id
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_credit_note_id,
        d.reference,
        d.title,
        d.org_id AS organization_id,
        bu.key_slug AS business_unit_key,
        client.name AS client_name,
        client.ruc AS client_ruc,
        client.email AS client_email,
        client.address AS client_address,
        provider.name AS provider_name,
        CASE
          WHEN bc.container_unit_id IS NOT NULL THEN TRIM(CONCAT(
            COALESCE(cu_bill.container_no, ''),
            CASE
              WHEN cu_bill.container_no IS NOT NULL AND cu_bill.container_no <> '' AND cu_bill.container_type IS NOT NULL AND cu_bill.container_type <> '' THEN ' · '
              ELSE ''
            END,
            COALESCE(cu_bill.container_type, '')
          ))
          ELSE (
            SELECT GROUP_CONCAT(
              TRIM(CONCAT(
                COALESCE(cu.container_no, ''),
                CASE
                  WHEN cu.container_no IS NOT NULL AND cu.container_no <> '' AND cu.container_type IS NOT NULL AND cu.container_type <> '' THEN ' · '
                  ELSE ''
                END,
                COALESCE(cu.container_type, '')
              ))
              ORDER BY ccu.line_order ASC, cu.id ASC
              SEPARATOR ' | '
            )
            FROM container_contract_units ccu
            INNER JOIN container_units cu ON cu.id = ccu.container_unit_id
            WHERE ccu.contract_id = bc.contract_id
          )
        END AS containers_label
      FROM container_billing_cycles bc
      INNER JOIN container_contracts c ON c.id = bc.contract_id
      LEFT JOIN invoices inv ON inv.id = bc.invoice_id
      LEFT JOIN container_units cu_bill ON cu_bill.id = bc.container_unit_id
      INNER JOIN deals d ON d.id = bc.deal_id
      INNER JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN organizations client ON client.id = d.org_id
      LEFT JOIN container_operation_details cod ON cod.deal_id = d.id
      LEFT JOIN organizations provider ON provider.id = cod.provider_id
      WHERE bc.id = ?
      LIMIT 1
    `,
    [billingId]
  );

  if (!row) return res.status(404).json({ error: 'Mensualidad no encontrada' });
  res.json(row);
});

router.get('/deals/:dealId/billing', requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  const detail = await getContainerDeal(dealId);
  if (!detail) return res.status(404).json({ error: 'Operacion ATM CONTAINER no encontrada' });

  const [rows] = await pool.query(
    `
      SELECT
        bc.*,
        c.contract_no,
        inv.invoice_number,
        inv.status AS invoice_status,
        (
          SELECT i2.id
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_id,
        (
          SELECT i2.invoice_number
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_number,
        (
          SELECT i2.status
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_status,
        (
          SELECT i2.canceled_by_credit_note_id
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_credit_note_id,
        CASE
          WHEN bc.container_unit_id IS NOT NULL THEN TRIM(CONCAT(
            COALESCE(cu_bill.container_no, ''),
            CASE
              WHEN cu_bill.container_no IS NOT NULL AND cu_bill.container_no <> '' AND cu_bill.container_type IS NOT NULL AND cu_bill.container_type <> '' THEN ' · '
              ELSE ''
            END,
            COALESCE(cu_bill.container_type, '')
          ))
          ELSE (
            SELECT GROUP_CONCAT(
              TRIM(CONCAT(
                COALESCE(cu.container_no, ''),
                CASE
                  WHEN cu.container_no IS NOT NULL AND cu.container_no <> '' AND cu.container_type IS NOT NULL AND cu.container_type <> '' THEN ' · '
                  ELSE ''
                END,
                COALESCE(cu.container_type, '')
              ))
              ORDER BY ccu.line_order ASC, cu.id ASC
              SEPARATOR ' | '
            )
            FROM container_contract_units ccu
            INNER JOIN container_units cu ON cu.id = ccu.container_unit_id
            WHERE ccu.contract_id = bc.contract_id
          )
        END AS containers_label
      FROM container_billing_cycles bc
      INNER JOIN container_contracts c ON c.id = bc.contract_id
      LEFT JOIN invoices inv ON inv.id = bc.invoice_id
      LEFT JOIN container_units cu_bill ON cu_bill.id = bc.container_unit_id
      WHERE bc.deal_id = ?
      ORDER BY bc.due_date DESC, bc.id DESC
    `,
    [dealId]
  );

  res.json(rows || []);
});

router.patch('/billing/:id/status', requireAuth, async (req, res) => {
  const billingId = Number(req.params.id);
  const status = String(req.body?.status || '').trim().toLowerCase();
  const notes = req.body?.notes;

  if (!billingId) return res.status(400).json({ error: 'Registro invalido' });
  if (!['pendiente', 'facturado', 'cobrado', 'anulado'].includes(status)) {
    return res.status(400).json({ error: 'Estado invalido' });
  }

  const [[existing]] = await pool.query(
    'SELECT id, invoice_id FROM container_billing_cycles WHERE id = ? LIMIT 1',
    [billingId]
  );
  if (!existing) return res.status(404).json({ error: 'Mensualidad no encontrada' });
  if ((status === 'facturado' || status === 'cobrado') && !existing.invoice_id) {
    return res.status(400).json({ error: 'Primero debes generar la factura desde Administracion.' });
  }

  const params = [status];
  let sql = 'UPDATE container_billing_cycles SET status = ?';
  if (notes !== undefined) {
    sql += ', notes = ?';
    params.push(notes || null);
  }
  sql += ', updated_at = CURRENT_TIMESTAMP WHERE id = ?';
  params.push(billingId);
  await pool.query(sql, params);

  const [[row]] = await pool.query(
    `
      SELECT
        bc.*,
        c.contract_no,
        inv.invoice_number,
        inv.status AS invoice_status,
        (
          SELECT i2.id
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_id,
        (
          SELECT i2.invoice_number
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_number,
        (
          SELECT i2.status
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_invoice_status,
        (
          SELECT i2.canceled_by_credit_note_id
          FROM invoices i2
          WHERE i2.container_billing_cycle_id = bc.id
          ORDER BY i2.created_at DESC, i2.id DESC
          LIMIT 1
        ) AS latest_credit_note_id,
        d.reference,
        d.title,
        client.name AS client_name,
        provider.name AS provider_name,
        CASE
          WHEN bc.container_unit_id IS NOT NULL THEN TRIM(CONCAT(
            COALESCE(cu_bill.container_no, ''),
            CASE
              WHEN cu_bill.container_no IS NOT NULL AND cu_bill.container_no <> '' AND cu_bill.container_type IS NOT NULL AND cu_bill.container_type <> '' THEN ' · '
              ELSE ''
            END,
            COALESCE(cu_bill.container_type, '')
          ))
          ELSE (
            SELECT GROUP_CONCAT(
              TRIM(CONCAT(
                COALESCE(cu.container_no, ''),
                CASE
                  WHEN cu.container_no IS NOT NULL AND cu.container_no <> '' AND cu.container_type IS NOT NULL AND cu.container_type <> '' THEN ' · '
                  ELSE ''
                END,
                COALESCE(cu.container_type, '')
              ))
              ORDER BY ccu.line_order ASC, cu.id ASC
              SEPARATOR ' | '
            )
            FROM container_contract_units ccu
            INNER JOIN container_units cu ON cu.id = ccu.container_unit_id
            WHERE ccu.contract_id = bc.contract_id
          )
        END AS containers_label
      FROM container_billing_cycles bc
      INNER JOIN container_contracts c ON c.id = bc.contract_id
      LEFT JOIN invoices inv ON inv.id = bc.invoice_id
      INNER JOIN deals d ON d.id = bc.deal_id
      LEFT JOIN organizations client ON client.id = d.org_id
      LEFT JOIN container_operation_details cod ON cod.deal_id = d.id
      LEFT JOIN organizations provider ON provider.id = cod.provider_id
      LEFT JOIN container_units cu_bill ON cu_bill.id = bc.container_unit_id
      WHERE bc.id = ?
      LIMIT 1
    `,
    [billingId]
  );

  res.json(row || null);
});

router.get('/contracts/:id/pdf', requireAuth, async (req, res) => {
  const contract = await getContractFull(Number(req.params.id), {
    revisionId: req.query.revision_id ? Number(req.query.revision_id) : null,
  });
  if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });

  const fileName = `contrato-container-${contract.contract?.contract_no || contract.contract?.id || 'sin-numero'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=\"${fileName}\"`);
  await generateContainerContractPDF(contract, res);
});

router.get('/deals/:dealId/services', requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  const detail = await getContainerDeal(dealId);
  if (!detail) return res.status(404).json({ error: 'Operación ATM CONTAINER no encontrada' });

  const [rows] = await pool.query(
    `
      SELECT
        s.*,
        cu.container_no,
        cu.container_type,
        (
          SELECT COUNT(*)
          FROM container_service_attachments a
          WHERE a.service_log_id = s.id
        ) AS attachment_count
      FROM container_service_logs s
      INNER JOIN container_units cu ON cu.id = s.container_unit_id
      WHERE s.deal_id = ?
      ORDER BY COALESCE(s.performed_at, DATE(s.created_at)) DESC, s.id DESC
    `,
    [dealId]
  );
  res.json(rows || []);
});

router.post('/deals/:dealId/services', requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  const detail = await getContainerDeal(dealId);
  if (!detail) return res.status(404).json({ error: 'Operación ATM CONTAINER no encontrada' });

  const {
    container_unit_id,
    service_type,
    status = 'pendiente',
    performed_at = null,
    technician_name = null,
    description = null,
    report_text = null,
  } = req.body || {};

  if (!container_unit_id || !service_type) {
    return res.status(400).json({ error: 'container_unit_id y service_type son obligatorios' });
  }

  const [result] = await pool.query(
    `
      INSERT INTO container_service_logs (
        deal_id, container_unit_id, service_type, status, performed_at,
        technician_name, description, report_text, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      dealId,
      Number(container_unit_id),
      service_type,
      status,
      performed_at || null,
      technician_name || null,
      description || null,
      report_text || null,
      req.user?.id || null,
    ]
  );

  const [[row]] = await pool.query(
    `
      SELECT
        s.*,
        cu.container_no,
        cu.container_type,
        0 AS attachment_count
      FROM container_service_logs s
      INNER JOIN container_units cu ON cu.id = s.container_unit_id
      WHERE s.id = ?
      LIMIT 1
    `,
    [result.insertId]
  );
  res.status(201).json(row);
});

router.put('/services/:id', requireAuth, async (req, res) => {
  const serviceId = Number(req.params.id);
  const {
    container_unit_id,
    service_type,
    status,
    performed_at,
    technician_name,
    description,
    report_text,
  } = req.body || {};

  const fields = [];
  const params = [];
  const pushField = (field, value) => {
    if (value !== undefined) {
      fields.push(`${field} = ?`);
      params.push(value);
    }
  };

  pushField('container_unit_id', container_unit_id || null);
  pushField('service_type', service_type);
  pushField('status', status);
  pushField('performed_at', performed_at || null);
  pushField('technician_name', technician_name || null);
  pushField('description', description || null);
  pushField('report_text', report_text || null);

  if (!fields.length) return res.status(400).json({ error: 'Sin cambios' });

  params.push(serviceId);
  await pool.query(`UPDATE container_service_logs SET ${fields.join(', ')} WHERE id = ?`, params);

  const [[row]] = await pool.query(
    `
      SELECT
        s.*,
        cu.container_no,
        cu.container_type,
        (
          SELECT COUNT(*)
          FROM container_service_attachments a
          WHERE a.service_log_id = s.id
        ) AS attachment_count
      FROM container_service_logs s
      INNER JOIN container_units cu ON cu.id = s.container_unit_id
      WHERE s.id = ?
      LIMIT 1
    `,
    [serviceId]
  );
  res.json(row);
});

router.delete('/services/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM container_service_attachments WHERE service_log_id = ?', [Number(req.params.id)]);
  await pool.query('DELETE FROM container_service_logs WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

router.get('/services/:id/attachments', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `
      SELECT id, service_log_id, filename, original_name, mime_type, file_url, created_at
      FROM container_service_attachments
      WHERE service_log_id = ?
      ORDER BY id DESC
    `,
    [Number(req.params.id)]
  );
  res.json(rows || []);
});

router.post('/services/:serviceId/attachments', requireAuth, serviceUpload.array('files', 10), async (req, res) => {
  const serviceId = Number(req.params.serviceId);
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) return res.status(400).json({ error: 'No se recibieron archivos' });

  for (const file of files) {
    await pool.query(
      `
        INSERT INTO container_service_attachments (
          service_log_id, filename, original_name, mime_type, file_url
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        serviceId,
        file.filename,
        file.originalname,
        file.mimetype,
        `/uploads/container-services/${serviceId}/${file.filename}`,
      ]
    );
  }

  const [rows] = await pool.query(
    `
      SELECT id, service_log_id, filename, original_name, mime_type, file_url, created_at
      FROM container_service_attachments
      WHERE service_log_id = ?
      ORDER BY id DESC
    `,
    [serviceId]
  );
  res.status(201).json(rows || []);
});

router.get('/deals/:dealId/alerts', requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  const detail = await getContainerDeal(dealId);
  if (!detail) return res.status(404).json({ error: 'Operación ATM CONTAINER no encontrada' });
  const alerts = await computeDealAlerts({ dealId });
  res.json(alerts);
});

router.get('/alerts', requireAuth, async (_req, res) => {
  const alerts = await computeDealAlerts();
  res.json(alerts);
});

export default router;
