import { Router } from 'express';
import { pool } from '../services/db.js';

const router = Router();

async function ensureDefaultBusinessUnits() {
  await pool.query(
    `
      INSERT INTO business_units (key_slug, name, parent_id)
      SELECT ?, ?, NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM business_units WHERE key_slug = ? LIMIT 1
      )
    `,
    ['atm-container', 'ATM CONTAINER', 'atm-container']
  );
}

router.get('/', async (_req, res) => {
  await ensureDefaultBusinessUnits();
  const [rows] = await pool.query(
    `SELECT id, key_slug, name, parent_id
     FROM business_units
     ORDER BY parent_id IS NOT NULL, name ASC`
  );
  res.json(rows);
});

export default router;
