// server/src/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../services/db.js'; // 👈 IMPORTANTE: pool mysql2/promise (default)

const router = Router();

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Responde: { token, user }
 */
router.post('/login', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password || '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y password son requeridos' });
    }

    // Busca usuario
    const [[user]] = await db.query(
      `SELECT id, email, role, is_active, password_hash
         FROM users
        WHERE email = ? LIMIT 1`,
      [email]
    );

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Compara hash
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[auth/login] JWT_SECRET faltante en .env');
      return res.status(500).json({ error: 'Config del servidor incompleta' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      secret,
      { expiresIn: process.env.JWT_EXPIRES || '7d' }
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('[auth/login] ', err?.message || err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * (Opcional) GET /api/auth/health
 * Útil para probar que el router responde.
 */
router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

export default router;
