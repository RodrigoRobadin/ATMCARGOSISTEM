// server/src/services/audit.js
import { pool } from './db.js';

/**
 * Inicializa auditoría sin tumbar el server si falla la DB.
 * Crea la tabla audit_events si no existe.
 * IMPORTANTE: NO importar nada desde "./routes/..." aquí.
 */
export async function bootstrapAudit() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        actor_name VARCHAR(255) NULL,
        action  VARCHAR(50)  NOT NULL,
        entity  VARCHAR(50)  NOT NULL,
        entity_id BIGINT NULL,
        root_entity VARCHAR(50) NULL,
        root_entity_id BIGINT NULL,
        description VARCHAR(255) NULL,
        meta JSON NULL,
        ip  VARCHAR(64)  NULL,
        ua  VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_entity (entity, entity_id),
        INDEX idx_audit_root (root_entity, root_entity_id, id),
        INDEX idx_user   (user_id, created_at),
        INDEX idx_time   (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[audit] audit_events OK');
  } catch (e) {
    console.warn('[audit] no se pudo inicializar audit_events:', e?.message || e);
  }
}

/**
 * Registra un evento de auditoría.
 */
export async function logAudit({
  req, userId, action, entity, entityId, description = '', meta = null,
}) {
  try {
    const uid = userId ?? (req?.user?.id ?? null);
    const ip  = (req?.ip || req?.headers?.['x-forwarded-for'] || '').toString().slice(0, 64);
    const ua  = (req?.headers?.['user-agent'] || '').toString().slice(0, 255);

    await pool.query(
      `INSERT INTO audit_events (user_id, action, entity, entity_id, description, meta, ip, ua)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid, action, entity, entityId ?? null, description, meta ? JSON.stringify(meta) : null, ip, ua]
    );
  } catch (e) {
    console.error('AUDIT LOG ERROR:', e?.message || e);
  }
}

export default { bootstrapAudit, logAudit };

const OMIT_FIELDS = new Set(['created_at', 'updated_at']);
const sanitize = (row) => Object.fromEntries(Object.entries(row || {}).filter(([key]) =>
  !OMIT_FIELDS.has(key) && !/(password|secret|token|credential)/i.test(key)
));

export function auditDiff(before, after) {
  const oldRow = sanitize(before);
  const newRow = sanitize(after);
  const changes = {};
  for (const key of new Set([...Object.keys(oldRow), ...Object.keys(newRow)])) {
    const previous = oldRow[key] ?? null;
    const next = newRow[key] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next)) changes[key] = { before: previous, after: next };
  }
  return changes;
}

// Use the mutation connection so a failed audit insert rolls back the change.
export async function recordAuditChange(conn, {
  req, action, entity, entityId, rootEntity = entity, rootEntityId = entityId,
  before = null, after = null, description = '', details = null,
}) {
  const changes = auditDiff(before, after);
  if (!Object.keys(changes).length && !['merge', 'convert'].includes(action)) return false;
  const userId = req?.user?.id ?? null;
  let actorName = req?.user?.name || null;
  if (!actorName && userId) {
    const [[user]] = await conn.query('SELECT name FROM users WHERE id = ?', [userId]);
    actorName = user?.name || `Usuario #${userId}`;
  }
  actorName ||= 'Sistema';
  await conn.query(
    `INSERT INTO audit_events
      (user_id, actor_name, action, entity, entity_id, root_entity, root_entity_id, description, meta, ip, ua)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, actorName, action, entity, entityId ?? null, rootEntity, rootEntityId ?? null,
      description, JSON.stringify({ changes, ...(details ? { details } : {}) }),
      String(req?.ip || '').slice(0, 64), String(req?.headers?.['user-agent'] || '').slice(0, 255)]
  );
  return true;
}

const AUDIT_TABLES = {
  deal: 'deals', organization: 'organizations', contact: 'contacts',
  service_case: 'service_cases', service_case_custom_field: 'service_case_custom_fields',
  branch: 'org_branches', deal_custom_field: 'deal_custom_fields',
  contact_custom_field: 'person_custom_fields', deal_file: 'deal_files',
  mobile_attachment: 'mobile_attachments',
  service_file: 'service_field_files',
};

export async function auditSnapshot(conn, entity, id, lock = false) {
  const table = AUDIT_TABLES[entity];
  if (!table) throw new Error(`Entidad de auditoria no soportada: ${entity}`);
  const [[row]] = await conn.query(
    `SELECT * FROM \`${table}\` WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return row || null;
}

export async function auditedRowMutation(pool, {
  req, action, entity, entityId, rootEntity = entity, rootEntityId,
  description = '', run,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const before = entityId ? await auditSnapshot(conn, entity, entityId, true) : null;
    const result = await run(conn, before);
    const id = entityId || result?.insertId;
    const after = id ? await auditSnapshot(conn, entity, id) : null;
    await recordAuditChange(conn, {
      req, action, entity, entityId: id, rootEntity,
      rootEntityId: rootEntityId ?? (rootEntity === entity ? id : null),
      before, after, description,
    });
    await conn.commit();
    return { result, before, after };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
