import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

/* ===== import “tolerante” del auditor ===== */
let logAudit = async () => {};
try {
  const mod = await import('../middlewares/audit.js');
  if (mod?.logAudit) logAudit = mod.logAudit;
} catch (e) {
  console.warn('[params] audit.js no encontrado. Continúo sin auditoría.');
}

/* ========= Asegurar tabla ========== */
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS param_values (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\` VARCHAR(100) NOT NULL,
      \`value\` VARCHAR(255) NOT NULL,
      \`ord\` INT NOT NULL DEFAULT 0,
      \`active\` TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_key(\`key\`, \`ord\`),
      INDEX idx_active(\`active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
})();

/**
 * GET /api/params?keys=a,b,c&only_active=1
 * Respuesta: { key1: [{id,value,ord,active}], key2: [...] }
 */
router.get('/', requireAuth, async (req, res) => {
  const keys = String(req.query.keys || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const onlyActive = String(req.query.only_active || '').trim() === '1';

  const where = [];
  const params = [];

  if (keys.length) {
    where.push(`\`key\` IN (${keys.map(()=>'?').join(',')})`);
    params.push(...keys);
  }
  if (onlyActive) {
    where.push('`active` = 1');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `
      SELECT id, \`key\`, \`value\`, \`ord\`, \`active\`
      FROM param_values
      ${whereSql}
      ORDER BY \`key\`, \`ord\`, \`value\`
    `,
    params
  );

  const out = {};
  rows.forEach(r => {
    if (!out[r.key]) out[r.key] = [];
    out[r.key].push(r);
  });
  res.json(out);
});

/**
 * POST /api/params
 * Body: { key, value, ord?, active? }
 * Solo admin.
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { key, value } = req.body || {};
  let { ord, active } = req.body || {};
  if (!key || !value) return res.status(400).json({ error: 'key y value son requeridos' });

  if (ord === undefined || ord === null || ord === '') {
    const [[m]] = await pool.query(
      `SELECT COALESCE(MAX(\`ord\`), -1) AS maxord FROM param_values WHERE \`key\` = ?`,
      [key]
    );
    ord = Number(m?.maxord ?? -1) + 1;
  }

  const [ins] = await pool.query(
    `INSERT INTO param_values (\`key\`, \`value\`, \`ord\`, \`active\`) VALUES (?, ?, ?, ?)`,
    [key, value, Number(ord) || 0, active ? 1 : 0]
  );
  const [[row]] = await pool.query(
    `SELECT id, \`key\`, \`value\`, \`ord\`, \`active\` FROM param_values WHERE id=?`,
    [ins.insertId]
  );

  await logAudit(req, {
    action: 'create',
    entity: 'param_value',
    entityId: ins.insertId,
    message: `Creado parámetro ${key}=${value}`,
    payload: { key, value, ord, active: active ? 1 : 0 }
  });

  res.status(201).json(row);
});

/**
 * PATCH /api/params/:id
 * Body: { value?, ord?, active? }
 * Solo admin
 */
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const sets = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(req.body, 'value')) {
    sets.push('`value` = ?'); params.push(req.body.value);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'ord')) {
    sets.push('`ord` = ?'); params.push(Number(req.body.ord) || 0);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'active')) {
    sets.push('`active` = ?'); params.push(req.body.active ? 1 : 0);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

  params.push(id);
  const [r] = await pool.query(`UPDATE param_values SET ${sets.join(', ')} WHERE id = ?`, params);
  if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });

  const [[row]] = await pool.query(
    `SELECT id, \`key\`, \`value\`, \`ord\`, \`active\` FROM param_values WHERE id=?`,
    [id]
  );

  await logAudit(req, {
    action: 'update',
    entity: 'param_value',
    entityId: Number(id),
    message: `Actualizado parámetro id=${id}`,
    payload: req.body
  });

  res.json(row);
});

/**
 * DELETE /api/params/:id
 * Solo admin
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;

  const [[prev]] = await pool.query(
    `SELECT id, \`key\`, \`value\`, \`ord\`, \`active\` FROM param_values WHERE id=?`,
    [id]
  );

  const [r] = await pool.query(`DELETE FROM param_values WHERE id = ?`, [id]);
  if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });

  await logAudit(req, {
    action: 'delete',
    entity: 'param_value',
    entityId: Number(id),
    message: `Eliminado parámetro id=${id}`,
    payload: prev || null
  });

  res.json({ ok: true });
});

export default router;
