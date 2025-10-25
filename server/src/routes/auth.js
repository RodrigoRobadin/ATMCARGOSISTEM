// server/src/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../services/db.js'; // default export: pool mysql2/promise

const router = Router();

/**
 * GET /api/auth/me
 * Devuelve el usuario de la sesión (si existe).
 */
router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json(req.session.user);
  }
  return res.status(401).json({ error: 'No login' });
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Guarda el usuario en la sesión (cookie 'sid') y responde { ok, user }.
 */
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y password son requeridos' });
    }

    // Buscamos usuario (tolerante: puede tener password_hash (bcrypt) o password plano)
    const [[u]] = await db.query(
      `SELECT id, name, email, role, password_hash, password
         FROM users
        WHERE email = ? LIMIT 1`,
      [email]
    );

    if (!u) return res.status(401).json({ error: 'Credenciales inválidas' });

    let ok = false;
    if (u.password_hash) {
      ok = await bcrypt.compare(password, u.password_hash);
    } else if (u.password) {
      ok = String(u.password) === password;
    }

    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    // Usuario “seguro” en sesión
    const user = {
      id: u.id,
      name: u.name || null,
      email: u.email,
      role: u.role || 'user',
    };
    req.session.user = user;

    return res.json({ ok: true, user });
  } catch (err) {
    console.error('[auth/login]', err?.message || err);
    return res.status(500).json({ error: 'Error interno en login' });
  }
});

/**
 * POST /api/auth/logout
 * Destruye la sesión actual.
 */
router.post('/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => res.json({ ok: true }));
});

/** Health simple */
router.get('/health', (_req, res) => res.json({ ok: true }));

export default router;
