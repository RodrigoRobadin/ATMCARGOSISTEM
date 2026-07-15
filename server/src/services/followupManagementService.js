import { pool } from './db.js';

export const COMMERCIAL_ROLES = new Set([
  'admin',
  'venta',
  'ventas',
  'vendedor',
  'seller',
  'sales',
  'commercial',
  'comercial',
]);

export const CALL_OUTCOMES = new Set([
  'no_contesta',
  'interesado',
  'no_interesado',
  'volver_a_llamar',
  'en_negociacion',
]);

export const OUTCOMES_REQUIRING_TASK = new Set([
  'interesado',
  'volver_a_llamar',
  'en_negociacion',
]);

let schemaReadyPromise = null;

async function columnExists(tableName, columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(row?.total || 0) > 0;
}

async function ensureColumn(tableName, columnName, definition) {
  if (await columnExists(tableName, columnName)) return;
  await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
}

export async function ensureFollowupManagementSchema() {
  if (schemaReadyPromise) return schemaReadyPromise;
  schemaReadyPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followup_calls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        org_id INT NULL,
        contact_id INT NULL,
        deal_id INT NULL,
        subject VARCHAR(255),
        notes TEXT,
        happened_at DATETIME NOT NULL,
        duration_min INT DEFAULT 0,
        outcome VARCHAR(40) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), INDEX (org_id), INDEX (contact_id), INDEX (deal_id), INDEX (happened_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followup_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        org_id INT NULL,
        contact_id INT NULL,
        deal_id INT NULL,
        title VARCHAR(255) NOT NULL,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'pending',
        due_at DATETIME NOT NULL,
        completed_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), INDEX (org_id), INDEX (contact_id), INDEX (deal_id), INDEX (status), INDEX (due_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS followup_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        org_id INT NULL,
        contact_id INT NULL,
        deal_id INT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), INDEX (org_id), INDEX (contact_id), INDEX (deal_id), INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await ensureColumn('followup_calls', 'status', "VARCHAR(32) NOT NULL DEFAULT 'completed'");
    await ensureColumn('followup_calls', 'source', "VARCHAR(20) NOT NULL DEFAULT 'legacy'");
    await ensureColumn('followup_calls', 'phone_number', 'VARCHAR(80) NULL');
    await ensureColumn('followup_calls', 'started_at', 'DATETIME NULL');
    await ensureColumn('followup_calls', 'completed_at', 'DATETIME NULL');
    await ensureColumn('followup_calls', 'invalidated_at', 'DATETIME NULL');
    await ensureColumn('followup_calls', 'invalidation_reason', 'VARCHAR(500) NULL');
    await ensureColumn('followup_calls', 'updated_at', 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await ensureColumn('followup_calls', 'updated_by', 'BIGINT NULL');

    await ensureColumn('followup_tasks', 'call_id', 'INT NULL');
    await ensureColumn('followup_tasks', 'reminder_minutes', 'INT NOT NULL DEFAULT 30');
    await ensureColumn('followup_tasks', 'updated_at', 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await ensureColumn('followup_tasks', 'updated_by', 'BIGINT NULL');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_push_devices (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        expo_push_token VARCHAR(255) NOT NULL,
        platform VARCHAR(20) NULL,
        device_name VARCHAR(120) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        last_seen_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_push_token (expo_push_token),
        INDEX idx_push_user (user_id, active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followup_push_deliveries (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        task_id INT NOT NULL,
        device_id BIGINT NOT NULL,
        reminder_stage VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        provider_message_id VARCHAR(255) NULL,
        error_message VARCHAR(500) NULL,
        sent_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_task_device_stage (task_id, device_id, reminder_stage),
        INDEX idx_push_delivery_task (task_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        action VARCHAR(50) NOT NULL,
        entity VARCHAR(50) NOT NULL,
        entity_id BIGINT NULL,
        description VARCHAR(255) NULL,
        meta JSON NULL,
        ip VARCHAR(64) NULL,
        ua VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_entity (entity, entity_id),
        INDEX idx_user (user_id, created_at),
        INDEX idx_time (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        org_id INT NULL,
        deal_id INT NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        due_at DATETIME NULL,
        last_activity_at DATETIME NULL,
        days_without_activity INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_id), INDEX (org_id), INDEX (deal_id), INDEX (type),
        UNIQUE KEY uq_user_org_type (user_id, org_id, type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });
  return schemaReadyPromise;
}

export function isAdmin(req) {
  return String(req.user?.role || '').toLowerCase() === 'admin';
}

export function canUseFollowupManagement(req) {
  return COMMERCIAL_ROLES.has(String(req.user?.role || '').toLowerCase());
}

export function requireFollowupManagementRole(req, res, next) {
  if (!canUseFollowupManagement(req)) {
    return res.status(403).json({ error: 'Permiso denegado' });
  }
  next();
}

export function normalizeDateTime(value) {
  if (!value) return null;
  const raw = String(value).trim().replace('T', ' ');
  if (!raw) return null;
  return raw.length === 16 ? `${raw}:00` : raw.slice(0, 19);
}

export function cleanText(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

export async function insertFollowupAudit(conn, req, {
  action,
  entity,
  entityId,
  description,
  before = null,
  after = null,
  meta = null,
}) {
  const ip = String(req.ip || req.headers?.['x-forwarded-for'] || '').slice(0, 64);
  const ua = String(req.headers?.['user-agent'] || '').slice(0, 255);
  const auditMeta = { before, after, ...(meta || {}) };
  await conn.query(
    `INSERT INTO audit_events
       (user_id, action, entity, entity_id, description, meta, ip, ua)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(req.user?.id || 0) || null,
      action,
      entity,
      entityId || null,
      cleanText(description, 255) || null,
      JSON.stringify(auditMeta),
      ip,
      ua,
    ]
  );
}

export async function getManagedCall(conn, callId, lock = false) {
  const [[row]] = await conn.query(
    `SELECT c.*, o.name AS org_name, ct.name AS contact_name, d.reference AS deal_reference,
            u.name AS user_name, u.email AS user_email
       FROM followup_calls c
       LEFT JOIN organizations o ON o.id = c.org_id
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN deals d ON d.id = c.deal_id
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = ?
      LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
    [callId]
  );
  return row || null;
}

export function assertCallAccess(req, call) {
  if (!call) return { status: 404, error: 'Llamada no encontrada' };
  if (!isAdmin(req) && Number(call.user_id) !== Number(req.user?.id)) {
    return { status: 403, error: 'Permiso denegado' };
  }
  return null;
}

export async function upsertTaskForCall(conn, req, call, taskInput = {}) {
  const title = cleanText(taskInput.title || taskInput.task_title, 255);
  const dueAt = normalizeDateTime(taskInput.due_at || taskInput.task_due);
  if (!title || !dueAt) return null;
  const priority = ['low', 'medium', 'high'].includes(taskInput.priority) ? taskInput.priority : 'medium';
  const reminderMinutes = Math.max(0, Math.min(Number(taskInput.reminder_minutes ?? 30) || 30, 10080));
  const [[existing]] = await conn.query(
    `SELECT * FROM followup_tasks WHERE call_id = ? AND status <> 'canceled' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [call.id]
  );
  if (existing) {
    await conn.query(
      `UPDATE followup_tasks
          SET title = ?, due_at = ?, priority = ?, reminder_minutes = ?, status = 'pending',
              completed_at = NULL, updated_by = ?
        WHERE id = ?`,
      [title, dueAt, priority, reminderMinutes, Number(req.user?.id || 0), existing.id]
    );
    return existing.id;
  }
  const [ins] = await conn.query(
    `INSERT INTO followup_tasks
       (user_id, org_id, contact_id, deal_id, call_id, title, priority, status, due_at, reminder_minutes, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      call.user_id,
      call.org_id || null,
      call.contact_id || null,
      call.deal_id || null,
      call.id,
      title,
      priority,
      dueAt,
      reminderMinutes,
      Number(req.user?.id || 0),
    ]
  );
  return ins.insertId;
}

ensureFollowupManagementSchema().catch((error) => {
  console.error('[followup-management] schema error:', error?.message || error);
});

