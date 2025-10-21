import { Router } from 'express';
import { pool } from '../services/db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, key_slug, name, parent_id
     FROM business_units
     ORDER BY parent_id IS NOT NULL, name ASC`
  );
  res.json(rows);
});

export default router;
