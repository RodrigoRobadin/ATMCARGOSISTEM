// server/src/routes/auth.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import db from "../services/db.js"; // default export: pool mysql2/promise

const router = Router();

/** Salud simple */
router.get("/health", (_req, res) => res.json({ ok: true }));

/** Usuario logueado por sesión */
router.get("/me", (req, res) => {
  if (req.session && req.session.user) return res.json(req.session.user);
  return res.status(401).json({ error: "No login" });
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Valida con password_hash (bcrypt) y guarda req.session.user
 */
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email y password son requeridos" });
    }

    // SOLO password_hash (evitamos la columna inexistente password)
    const [[u]] = await db.query(
      "SELECT id, name, email, role, is_active, password_hash FROM users WHERE LOWER(email)=? LIMIT 1",
      [email]
    );

    if (!u || u.is_active === 0) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }
    if (!u.password_hash) {
      return res.status(401).json({ error: "Usuario sin contraseña configurada" });
    }

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    const user = { id: u.id, name: u.name, email: u.email, role: u.role };
    req.session.user = user;

    return res.json({ ok: true, user });
  } catch (e) {
    console.error("[auth/login]", e?.message || e);
    return res.status(500).json({ error: "Error interno en login" });
  }
});

/** Logout (destruye sesión) */
router.post("/logout", (req, res) => {
  try {
    req.session?.destroy?.(() => {});
  } catch {}
  res.json({ ok: true });
});

export default router;
