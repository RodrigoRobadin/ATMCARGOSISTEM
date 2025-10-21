// server/src/routes/stages.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

/* ========= Auto-migración: asegurar columnas nuevas en stages ========= */
(async () => {
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stages'
    `);
    const have = new Set(cols.map(c => c.COLUMN_NAME));

    if (!have.has('probability')) {
      await pool.query(`ALTER TABLE stages ADD COLUMN probability INT NULL AFTER name`);
    }
    if (!have.has('stuck_days')) {
      await pool.query(`ALTER TABLE stages ADD COLUMN stuck_days INT NULL AFTER probability`);
    }
  } catch (e) {
    console.error('[stages] No se pudieron asegurar columnas (probability/stuck_days):', e?.message || e);
  }
})();

/* ===================== Listar ===================== */
router.get('/', async (req, res) => {
  const { pipeline_id } = req.query;
  const [rows] = await pool.query(
    `SELECT id, pipeline_id, name, order_index, probability, stuck_days
     FROM stages
     WHERE (? IS NULL OR pipeline_id = ?)
     ORDER BY order_index ASC`,
    [pipeline_id || null, pipeline_id || null]
  );
  res.json(rows);
});

/* ===================== Crear etapa ===================== */
router.post('/', requireAuth, async (req, res) => {
  const { pipeline_id, name, order_index, probability, stuck_days } = req.body;
  if (!pipeline_id || !name) {
    return res.status(400).json({ error: 'pipeline_id y name requeridos' });
  }

  // si no viene order_index, lo ponemos al final
  const [[max]] = await pool.query(
    'SELECT COALESCE(MAX(order_index),0) AS mx FROM stages WHERE pipeline_id = ?',
    [pipeline_id]
  );
  const ord = Number.isFinite(Number(order_index)) ? Number(order_index) : (max?.mx || 0) + 10;

  // normalizar opciones
  const prob =
    probability === '' || probability === null || probability === undefined
      ? null
      : Math.max(0, Math.min(100, Number(probability)));
  const stuck =
    stuck_days === '' || stuck_days === null || stuck_days === undefined
      ? null
      : Math.max(0, Number(stuck_days));

  const [ins] = await pool.query(
    'INSERT INTO stages (pipeline_id, name, order_index, probability, stuck_days) VALUES (?,?,?,?,?)',
    [pipeline_id, name, ord, prob, stuck]
  );

  const [[row]] = await pool.query(
    'SELECT id, pipeline_id, name, order_index, probability, stuck_days FROM stages WHERE id = ?',
    [ins.insertId]
  );
  res.status(201).json(row);
});

/* ===================== Actualizar etapa ===================== */
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, order_index, probability, stuck_days } = req.body;

  const sets = [];
  const params = [];

  if (name !== undefined)        { sets.push('name = ?');        params.push(name); }
  if (order_index !== undefined) { sets.push('order_index = ?'); params.push(Number(order_index)); }

  if (probability !== undefined) {
    const prob =
      probability === '' || probability === null
        ? null
        : Math.max(0, Math.min(100, Number(probability)));
    sets.push('probability = ?'); params.push(prob);
  }

  if (stuck_days !== undefined) {
    const stuck =
      stuck_days === '' || stuck_days === null
        ? null
        : Math.max(0, Number(stuck_days));
    sets.push('stuck_days = ?'); params.push(stuck);
  }

  if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

  params.push(id);
  await pool.query(`UPDATE stages SET ${sets.join(', ')} WHERE id = ?`, params);

  const [[row]] = await pool.query(
    'SELECT id, pipeline_id, name, order_index, probability, stuck_days FROM stages WHERE id = ?',
    [id]
  );
  res.json(row);
});

/* = Eliminar etapa (con protección de deals; mover si target_stage_id) = */
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { target_stage_id = null } = req.query; // opcional: mover deals

  const [[st]] = await pool.query('SELECT id, pipeline_id FROM stages WHERE id = ? LIMIT 1', [id]);
  if (!st) return res.status(404).json({ error: 'Stage no encontrado' });

  const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM deals WHERE stage_id = ?', [id]);
  if (cnt.c > 0) {
    if (!target_stage_id) {
      return res.status(409).json({ error: 'Etapa con operaciones, indique target_stage_id para mover' });
    }
    await pool.query('UPDATE deals SET stage_id = ? WHERE stage_id = ?', [target_stage_id, id]);
  }

  await pool.query('DELETE FROM stages WHERE id = ?', [id]);
  res.json({ ok: true });
});

export default router;
