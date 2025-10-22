// server/src/routes/users.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../services/db.js';
import { signToken, requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

// Helper: normalizar
function toNull(v){ return v === '' ? null : v; }

// ---- LOGIN ----
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' });

  const [[user]] = await pool.query(
    `SELECT id, name, email, password_hash, role, is_active
       FROM users
      WHERE email = ? LIMIT 1`,
    [email]
  );

  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
  if (!user.is_active) return res.status(403).json({ error: 'Usuario inactivo' });

  const ok = await bcrypt.compare(password, user.password_hash || '');
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
  const userOut = { id: user.id, name: user.name, email: user.email, role: user.role, is_active: user.is_active };

  res.json({ token, user: userOut });
});

// ---- YO MISMO ----
router.get('/me', requireAuth, async (req, res) => {
  const [[u]] = await pool.query(
    `SELECT id, name, email, role, is_active
       FROM users
      WHERE id = ? LIMIT 1`,
    [req.user.id]
  );
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(u);
});

// ---- LISTA MINIMAL PARA SELECT (autenticado, no requiere admin) ----
router.get('/select', requireAuth, async (req, res) => {
  const raw = String(req.query.active ?? req.query.is_active ?? '1').toLowerCase();
  const onlyActive = !(raw === '0' || raw === 'false' || raw === 'no');
  const where = onlyActive ? 'WHERE is_active = 1' : '';
  const [rows] = await pool.query(
    `SELECT id, name, email
       FROM users
       ${where}
      ORDER BY name ASC, id ASC`
  );
  res.json(rows);
});

// ---- LISTAR (solo admin) ----
router.get('/', requireAuth, requireRole('admin'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, role, is_active, created_at, updated_at
       FROM users
      ORDER BY id ASC`
  );
  res.json(rows);
});

// ---- OBTENER UNO (autenticado, no requiere admin) ----
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const [[u]] = await pool.query(
    `SELECT id, name, email, role, is_active
       FROM users
      WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(u);
});

// ---- CREAR (solo admin) ----
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, role = 'viewer', is_active = 1 } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name y email requeridos' });

  // dedupe por email
  const [[ex]] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (ex) return res.status(409).json({ error: 'Email ya existe', id: ex.id });

  const [ins] = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, ?)`,
    [name, email, '', role, Number(is_active) ? 1 : 0]
  );
  res.status(201).json({ id: ins.insertId });
});

// ---- PATCH (solo admin) ----
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const sets = [];
  const params = [];

  const allowed = ['name', 'email', 'role', 'is_active'];
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      if (k === 'is_active') {
        sets.push('is_active = ?'); params.push(req.body[k] ? 1 : 0);
      } else {
        sets.push(`${k} = ?`); params.push(toNull(req.body[k]));
      }
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });
  params.push(id);

  const [r] = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
});

// ---- SET PASSWORD (admin o el mismo usuario) ----
router.post('/:id/set-password', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: 'Password mínimo 6 caracteres' });
  }

  // Si no es admin, solo puede cambiar su propio password
  if (req.user.role !== 'admin' && Number(id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Permiso denegado' });
  }

  const hash = await bcrypt.hash(String(new_password), 10);
  const [r] = await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true });
});

export default router;
