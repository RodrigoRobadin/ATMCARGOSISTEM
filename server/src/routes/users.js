// server/src/routes/users.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../services/db.js';
import { signToken, requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

// Helpers
function toNull(v) {
  return v === '' ? null : v;
}
function toLowerTrim(v) {
  return String(v || '').trim().toLowerCase();
}

// ================== LOGIN ==================
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res
      .status(400)
      .json({ error: 'Email y password requeridos' });
  }

  try {
    const [[user]] = await pool.query(
      `SELECT id, name, email, password_hash, role, is_active
         FROM users
        WHERE email = ? LIMIT 1`,
      [email]
    );

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'Usuario inactivo' });
    }

    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Normalizamos el role SOLO en el token/respuesta
    const roleNorm = toLowerTrim(user.role);

    // 🔐 Generar JWT
    const token = signToken({
      id: user.id,
      email: user.email,
      role: roleNorm,
      name: user.name,
    });

    const userOut = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: roleNorm,
      is_active: user.is_active,
    };

    // 👉 IMPORTANTE: devolver { token, user }
    return res.json({ token, user: userOut });
  } catch (err) {
    console.error('Error en /users/login:', err);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ================== YO MISMO ==================
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [[u]] = await pool.query(
      `SELECT id, name, email, role, is_active
         FROM users
        WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    if (!u) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    u.role = toLowerTrim(u.role);
    return res.json(u);
  } catch (err) {
    console.error('Error en /users/me:', err);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ============ SELECT (lista simple para combos) ============
router.get('/select', requireAuth, async (req, res) => {
  const requesterRole = toLowerTrim(req.user?.role);
  if (!['admin', 'venta'].includes(requesterRole)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const rawActive = toLowerTrim(
    req.query.active ?? req.query.is_active ?? '1'
  );
  const onlyActive = !(
    rawActive === '0' ||
    rawActive === 'false' ||
    rawActive === 'no'
  );

  const rolesParam = String(req.query.roles || 'admin,venta')
    .split(',')
    .map((s) => toLowerTrim(s))
    .filter(Boolean);

  const allowedRoles = ['admin', 'venta', 'manager', 'viewer'];
  const roles = rolesParam.filter((r) => allowedRoles.includes(r));
  const finalRoles = roles.length ? roles : ['admin', 'venta'];

  const params = [];
  const placeholders = finalRoles.map(() => '?').join(',');
  let where = `WHERE LOWER(TRIM(role)) IN (${placeholders})`;
  params.push(...finalRoles);

  if (onlyActive) where += ' AND is_active = 1';

  try {
    const [rows] = await pool.query(
      `SELECT id, name, email
         FROM users
         ${where}
        ORDER BY name ASC, id ASC`,
      params
    );

    const out = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
    }));

    return res.json(out);
  } catch (err) {
    console.error('Error en /users/select:', err);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ============ LISTAR COMPLETO (solo admin) ============
router.get('/', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, role, is_active, created_at, updated_at
         FROM users
        ORDER BY id ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error en GET /users:', err);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ============ OBTENER UNO (cualquiera autenticado) ============
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const [[u]] = await pool.query(
      `SELECT id, name, email, role, is_active
         FROM users
        WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!u) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    u.role = toLowerTrim(u.role);
    return res.json(u);
  } catch (err) {
    console.error('Error en GET /users/:id:', err);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ============ CREAR (solo admin) ============
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, role = 'viewer', is_active = 1 } = req.body || {};
  if (!name || !email) {
    return res
      .status(400)
      .json({ error: 'name y email requeridos' });
  }

  try {
    const [[ex]] = await pool.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (ex) {
      return res
        .status(409)
        .json({ error: 'Email ya existe', id: ex.id });
    }

    const roleNorm = toLowerTrim(role);
    const [ins] = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [name, email, '', roleNorm, Number(is_active) ? 1 : 0]
    );
    return res.status(201).json({ id: ins.insertId });
  } catch (err) {
    console.error('Error en POST /users:', err);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ============ PATCH (solo admin) ============
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const sets = [];
  const params = [];

  const allowed = ['name', 'email', 'role', 'is_active'];
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      if (k === 'is_active') {
        sets.push('is_active = ?');
        params.push(req.body[k] ? 1 : 0);
      } else if (k === 'role') {
        sets.push('role = ?');
        params.push(toLowerTrim(req.body[k]));
      } else {
        sets.push(`${k} = ?`);
        params.push(toNull(req.body[k]));
      }
    }
  }

  if (!sets.length) {
    return res
      .status(400)
      .json({ error: 'Nada para actualizar' });
  }
  params.push(id);

  try {
    const [r] = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    if (r.affectedRows === 0) {
      return res.status(404).json({ error: 'No encontrado' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error en PATCH /users/:id:', err);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ============ SET PASSWORD (admin o el mismo user) ============
router.post('/:id/set-password', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body || {};

  if (!new_password || String(new_password).length < 6) {
    return res
      .status(400)
      .json({ error: 'Password mínimo 6 caracteres' });
  }

  const requesterRole = toLowerTrim(req.user.role);
  if (requesterRole !== 'admin' && Number(id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Permiso denegado' });
  }

  try {
    const hash = await bcrypt.hash(String(new_password), 10);
    const [r] = await pool.query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [hash, id]
    );
    if (r.affectedRows === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error en POST /users/:id/set-password:', err);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

export default router;