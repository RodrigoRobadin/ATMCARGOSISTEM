let schemaPromise;

export function ensureWorkCompletionSchema(pool) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const [[column]] = await pool.query("SHOW COLUMNS FROM deals LIKE 'work_completed_at'");
      if (!column) {
        try {
          await pool.query('ALTER TABLE deals ADD COLUMN work_completed_at DATETIME NULL');
        } catch (error) {
          if (error.code !== 'ER_DUP_FIELDNAME') throw error;
        }
      }
      await pool.query(`
        CREATE TABLE IF NOT EXISTS deal_work_completion_events (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          deal_id INT NOT NULL,
          event_type VARCHAR(16) NOT NULL,
          note TEXT NULL,
          actor_user_id BIGINT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_deal_work_completion (deal_id, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
