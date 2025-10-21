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
        action  VARCHAR(50)  NOT NULL,
        entity  VARCHAR(50)  NOT NULL,
        entity_id BIGINT NULL,
        description VARCHAR(255) NULL,
        meta JSON NULL,
        ip  VARCHAR(64)  NULL,
        ua  VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_entity (entity, entity_id),
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
