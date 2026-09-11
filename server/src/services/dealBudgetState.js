import { pool } from './db.js';

let schemaPromise = null;

export function ensureDealBudgetStateSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'deals'
        AND COLUMN_NAME IN ('budget_status','budget_profit','budget_updated_by','budget_updated_at')
    `);
    const names = new Set((cols || []).map((row) => row.COLUMN_NAME));
    const additions = [
      ['budget_status', "ALTER TABLE deals ADD COLUMN budget_status VARCHAR(24) NULL DEFAULT NULL AFTER status"],
      ['budget_profit', 'ALTER TABLE deals ADD COLUMN budget_profit DECIMAL(18,2) NULL AFTER budget_status'],
      ['budget_updated_by', 'ALTER TABLE deals ADD COLUMN budget_updated_by BIGINT NULL AFTER budget_profit'],
      ['budget_updated_at', 'ALTER TABLE deals ADD COLUMN budget_updated_at DATETIME NULL AFTER budget_updated_by'],
    ];
    for (const [name, sql] of additions) {
      if (!names.has(name)) await pool.query(sql);
    }
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

export async function getDealBudgetState(dealId) {
  await ensureDealBudgetStateSchema();
  const [[row]] = await pool.query(
    `SELECT d.id,
            COALESCE(NULLIF(d.budget_status, ''), NULLIF(o.budget_status, ''), 'borrador') AS budget_status,
            COALESCE(d.budget_profit, o.budget_profit) AS budget_profit
       FROM deals d
       LEFT JOIN organizations o ON o.id = d.org_id
      WHERE d.id = ?
      LIMIT 1`,
    [dealId]
  );
  return row || null;
}
