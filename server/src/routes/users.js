// server/src/routes/users.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../services/db.js';
import { requireAuth, signToken } from '../middlewares/auth.js';

const router = Router();

// Login estilo JWT (alias de /auth/login)
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email y password son requeridos' });

    const [[u]] = await pool.query(
      'SELECT id, name, email, role, is_active, password_hash FROM users WHERE LOWER(email)=? LIMIT 1',
      [email]
    );
    if (!u || u.is_active === 0) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (!u.password_hash) return res.status(401).json({ error: 'Usuario sin contraseña configurada' });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const user = { id: u.id, name: u.name, email: u.email, role: u.role };
    const token = signToken(user);
    return res.json({ token, user });
  } catch (err) {
    console.error('[users/login] Error:', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    return res.json(req.user);
  } catch (err) {
    console.error('[users/me] Error:', err);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { role } = req.query;
    let sql = `SELECT id, name, email, role, is_active FROM users`;
    const params = [];
    if (role) {
      sql += ' WHERE role = ?';
      params.push(role);
    }
    sql += ' ORDER BY name ASC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[users] Error listing:', err);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

// Compat: /users/select?active=1
router.get('/select', requireAuth, async (req, res) => {
  try {
    const { active } = req.query;
    let sql = `SELECT id, name, email, role, is_active FROM users`;
    const params = [];
    if (active !== undefined) {
      sql += ' WHERE is_active = ?';
      params.push(Number(active) ? 1 : 0);
    }
    sql += ' ORDER BY name ASC';
    const [rows] = await pool.query(sql, params);
    res.json(rows || []);
  } catch (err) {
    console.error('[users/select] Error:', err);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

// Crear usuario (admin)
router.post('/', requireAuth, async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ error: 'Permiso denegado' });

    const { name, email, password, is_active = 1, user_role = 'viewer', role: bodyRole } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name y email son requeridos' });

    const useRole = bodyRole || user_role || 'viewer';
    let password_hash = null;
    if (password) {
      password_hash = await bcrypt.hash(password, 10);
    }

    const [ins] = await pool.query(
      `INSERT INTO users (name, email, role, is_active, password_hash)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), is_active=VALUES(is_active)`,
      [name, email, useRole, is_active ? 1 : 0, password_hash]
    );

    res.status(201).json({ id: ins.insertId || null, ok: true });
  } catch (err) {
    console.error('[users] Error creating:', err);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// Actualizar rol/activo (admin)
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ error: 'Permiso denegado' });

    const { id } = req.params;
    const fields = [];
    const params = [];

    if (req.body.role !== undefined) {
      fields.push('role = ?');
      params.push(req.body.role);
    }
    if (req.body.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(Number(req.body.is_active) ? 1 : 0);
    }
    if (!fields.length) return res.status(400).json({ error: 'Nada para actualizar' });

    params.push(id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error('[users] Error updating:', err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// Set password (admin)
router.post('/:id/set-password', requireAuth, async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ error: 'Permiso denegado' });

    const { id } = req.params;
    const { new_password } = req.body;
    if (!new_password) return res.status(400).json({ error: 'new_password requerido' });

    const password_hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[users] Error set-password:', err);
    res.status(500).json({ error: 'Error al actualizar password' });
  }
});

export default router;
