// server/src/routes/labels.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

// Crea la tabla si no existe (id, name, scope, color + timestamps)
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS labels (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      scope VARCHAR(32) NOT NULL DEFAULT 'organization',
      color VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_scope_name (scope, name),
      KEY idx_scope (scope)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

/**
 * GET /api/labels?scope=organization
 * scope es opcional. Devuelve [{id,name,scope,color}...]
 */
router.get('/', requireAuth, async (req, res) => {
  await ensureTable();
  const scope = String(req.query.scope || '').trim();
  let rows = [];
  if (scope) {
    const [r] = await pool.query(
      `SELECT id, name, scope, color
         FROM labels
        WHERE scope = ?
        ORDER BY name`,
      [scope]
    );
    rows = r;
  } else {
    const [r] = await pool.query(
      `SELECT id, name, scope, color
         FROM labels
        ORDER BY scope, name`
    );
    rows = r;
  }
  res.json(rows);
});

/**
 * POST /api/labels  (solo admin)
 * Body: { name, scope?, color? }
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  await ensureTable();
  const { name, scope = 'organization', color = null } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name es requerido' });
  }
  try {
    const [ins] = await pool.query(
      `INSERT INTO labels (name, scope, color) VALUES (?, ?, ?)`,
      [String(name).trim(), String(scope).trim(), color || null]
    );
    const [[row]] = await pool.query(
      `SELECT id, name, scope, color FROM labels WHERE id=?`,
      [ins.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    // conflicto por UNIQUE(scope,name)
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre para ese scope' });
    }
    throw e;
  }
});

/**
 * PATCH /api/labels/:id  (solo admin)
 * Body: { name?, scope?, color? }
 */
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await ensureTable();
  const { id } = req.params;

  const sets = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
    const v = String(req.body.name || '').trim();
    if (!v) return res.status(400).json({ error: 'name no puede ser vacío' });
    sets.push('name = ?'); params.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'scope')) {
    const v = String(req.body.scope || '').trim();
    if (!v) return res.status(400).json({ error: 'scope no puede ser vacío' });
    sets.push('scope = ?'); params.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'color')) {
    sets.push('color = ?'); params.push(req.body.color || null);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

  params.push(id);
  try {
    const [r] = await pool.query(`UPDATE labels SET ${sets.join(', ')} WHERE id = ?`, params);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre para ese scope' });
    }
    throw e;
  }

  const [[row]] = await pool.query(`SELECT id, name, scope, color FROM labels WHERE id = ?`, [id]);
  res.json(row);
});

/**
 * DELETE /api/labels/:id  (solo admin)
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await ensureTable();
  const { id } = req.params;
  const [r] = await pool.query(`DELETE FROM labels WHERE id = ?`, [id]);
  if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
});

export default router;
