// server/src/routes/pipelines.js
import { Router } from 'express';
import { pool } from '../services/db.js';

const router = Router();

/* ====== Ensure extra columns in stages ====== */
(async () => {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='stages'
    `);
    const set = new Set(cols.map(c => c.COLUMN_NAME));

    if (!set.has('probability')) {
      await pool.query(`ALTER TABLE stages ADD COLUMN probability INT NULL AFTER name`);
    }
    if (!set.has('stuck_days')) {
      await pool.query(`ALTER TABLE stages ADD COLUMN stuck_days INT NULL AFTER probability`);
    }
  } catch (e) {
    console.error('[pipelines] ensure columns on stages', e?.message || e);
  }
})();

/* ====== GET pipelines ====== */
router.get('/', async (_req, res) => {
  const [rows] = await pool.query('SELECT id, name FROM pipelines ORDER BY id ASC');
  res.json(rows);
});

/* ====== PATCH pipeline name ====== */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name requerido' });
  await pool.query(`UPDATE pipelines SET name = ? WHERE id = ?`, [name, id]);
  res.json({ ok: true });
});

/* ====== STAGES ====== */

/** Listar etapas del pipeline (incluye prob/stuck) */
router.get('/:id/stages', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT id, name, order_index, probability, stuck_days
     FROM stages
     WHERE pipeline_id = ?
     ORDER BY order_index ASC`,
    [id]
  );
  res.json(rows);
});

/** Crear etapa al final */
router.post('/:id/stages', async (req, res) => {
  const { id } = req.params;
  const { name, probability = null, stuck_days = null } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name requerido' });

  const [[last]] = await pool.query(
    `SELECT COALESCE(MAX(order_index), 0) AS maxOrd FROM stages WHERE pipeline_id = ?`,
    [id]
  );
  const order_index = Number(last?.maxOrd || 0) + 10;

  const [ins] = await pool.query(
    `INSERT INTO stages (pipeline_id, name, order_index, probability, stuck_days)
     VALUES (?,?,?,?,?)`,
    [id, name, order_index, probability, stuck_days]
  );
  const [[row]] = await pool.query(
    `SELECT id, name, order_index, probability, stuck_days FROM stages WHERE id = ?`,
    [ins.insertId]
  );
  res.status(201).json(row);
});

/** Actualizar una etapa */
router.patch('/stages/:stageId', async (req, res) => {
  const { stageId } = req.params;
  const { name, order_index, probability, stuck_days } = req.body || {};

  const sets = [];
  const params = [];
  if (name !== undefined)        { sets.push('name = ?');        params.push(name); }
  if (order_index !== undefined) { sets.push('order_index = ?'); params.push(order_index); }
  if (probability !== undefined) { sets.push('probability = ?'); params.push(probability); }
  if (stuck_days !== undefined)  { sets.push('stuck_days = ?');  params.push(stuck_days); }

  if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

  params.push(stageId);
  await pool.query(`UPDATE stages SET ${sets.join(', ')} WHERE id = ?`, params);

  const [[row]] = await pool.query(
    `SELECT id, name, order_index, probability, stuck_days FROM stages WHERE id = ?`,
    [stageId]
  );
  res.json(row);
});

/** Eliminar etapa */
router.delete('/stages/:stageId', async (req, res) => {
  const { stageId } = req.params;
  await pool.query(`DELETE FROM stages WHERE id = ?`, [stageId]);
  res.json({ ok: true });
});

export default router;
