// server/src/middlewares/auth.js
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// Opcional: si en algún momento querés emitir tokens JWT
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * requireAuth
 *
 * ACEPTA:
 * 1) JWT en header Authorization: "Bearer <token>"
 * 2) Sesión de Express: req.session.user (como en /auth/login)
 *
 * Así funciona tanto con el login por sesión que tenés ahora,
 * como con JWT si más adelante lo usás.
 */
export function requireAuth(req, res, next) {
  // 1) Intentar JWT primero
  try {
    const auth = req.headers.authorization || "";
    const parts = auth.split(" ");
    const token = parts.length === 2 && parts[0] === "Bearer" ? parts[1] : null;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { id, email, role, name, ... }
        return next();
      } catch (err) {
        // Token inválido -> probamos sesión más abajo
        // console.warn("[auth] JWT inválido, probando sesión:", err?.message);
      }
    }
  } catch {
    // ignoramos y seguimos a sesión
  }

  // 2) Fallback: sesión de Express (login con /auth/login)
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }

  // Si no hay ni JWT ni sesión, no hay auth
  return res.status(401).json({ error: "No auth" });
}

// un único rol
export function requireRole(role) {
  return (req, res, next) => {
    const u = req.user || (req.session && req.session.user) || null;
    if (!u) return res.status(401).json({ error: "No auth" });
    if (u.role !== role) {
      return res.status(403).json({ error: "Permiso denegado" });
    }
    next();
  };
}

// alguno de varios roles
export function requireAnyRole(...roles) {
  return (req, res, next) => {
    const u = req.user || (req.session && req.session.user) || null;
    if (!u) return res.status(401).json({ error: "No auth" });
    if (!roles.includes(u.role)) {
      return res.status(403).json({ error: "Permiso denegado" });
    }
    next();
  };
}