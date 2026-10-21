const SOURCES = {
  deal: {
    activity: { table: 'activities', scopeColumn: 'deal_id' },
    task: { table: 'followup_tasks', scopeColumn: 'deal_id' },
  },
  service_case: {
    followup: { table: 'service_case_followups', scopeColumn: 'service_case_id' },
  },
};

let schemaPromise;

export function followupPinSource(scopeType, sourceType) {
  return SOURCES[scopeType]?.[sourceType] || null;
}

export async function ensureFollowupPinsSchema(db) {
  if (!schemaPromise) {
    schemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS followup_pins (
        scope_type VARCHAR(20) NOT NULL,
        scope_id BIGINT NOT NULL,
        source_type VARCHAR(20) NOT NULL,
        source_id BIGINT NOT NULL,
        pinned_by BIGINT NULL,
        pinned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (scope_type, scope_id, source_type, source_id),
        INDEX idx_followup_pins_scope (scope_type, scope_id, pinned_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function listFollowupPins(db, scopeType, scopeId) {
  await ensureFollowupPinsSchema(db);
  const [rows] = await db.query(
    'SELECT source_type, source_id, pinned_at FROM followup_pins WHERE scope_type = ? AND scope_id = ?',
    [scopeType, scopeId]
  );
  return new Map(rows.map((row) => [`${row.source_type}:${row.source_id}`, row.pinned_at]));
}

export async function setFollowupPin(db, { scopeType, scopeId, sourceType, sourceId, pinned, userId }) {
  const source = followupPinSource(scopeType, sourceType);
  if (!source || !Number.isInteger(scopeId) || scopeId <= 0 || !Number.isInteger(sourceId) || sourceId <= 0 || typeof pinned !== 'boolean') {
    return { error: 'Parametros de anclaje invalidos', status: 400 };
  }
  const [[item]] = await db.query(
    `SELECT id FROM ${source.table} WHERE id = ? AND ${source.scopeColumn} = ? LIMIT 1`,
    [sourceId, scopeId]
  );
  if (!item) return { error: 'Elemento de seguimiento no encontrado', status: 404 };
  await ensureFollowupPinsSchema(db);
  if (pinned) {
    await db.query(
      'INSERT IGNORE INTO followup_pins (scope_type, scope_id, source_type, source_id, pinned_by) VALUES (?, ?, ?, ?, ?)',
      [scopeType, scopeId, sourceType, sourceId, userId || null]
    );
  } else {
    await db.query(
      'DELETE FROM followup_pins WHERE scope_type = ? AND scope_id = ? AND source_type = ? AND source_id = ?',
      [scopeType, scopeId, sourceType, sourceId]
    );
  }
  return { ok: true, pinned };
}
