// server/src/middlewares/auth.js
/**
 * Autenticación por sesión (express-session).
 * - requireAuth: exige sesión -> req.user
 * - requireRole / requireAnyRole: control de permisos
 * Compat: exportamos signToken (dummy) para no romper imports viejos.
 */

export function requireAuth(req, res, next) {
  try {
    const u = req.session?.user;
    if (u) { req.user = u; return next(); }
    return res.status(401).json({ error: "No login" });
  } catch {
    return res.status(401).json({ error: "No login" });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    const u = req.session?.user;
    if (!u) return res.status(401).json({ error: "No login" });
    if (u.role === "admin" || u.role === role) return next();
    return res.status(403).json({ error: "Sin permisos" });
  };
}

export function requireAnyRole(...roles) {
  return (req, res, next) => {
    const u = req.session?.user;
    if (!u) return res.status(401).json({ error: "No login" });
    if (u.role === "admin" || roles.includes(u.role)) return next();
    return res.status(403).json({ error: "Sin permisos" });
  };
}

/** Stub para compatibilidad con código viejo que aún importa signToken */
export function signToken(_payload) {
  return "SESSION";
}
