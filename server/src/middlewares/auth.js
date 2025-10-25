// server/src/middlewares/auth.js
/**
 * Autenticación basada en sesión (express-session).
 * - requireAuth: exige sesión activa y expone req.user
 * - requireRole: exige un rol específico (admin pasa siempre)
 * - requireAnyRole: exige pertenecer a uno de varios roles (admin pasa siempre)
 */

export function requireAuth(req, res, next) {
  try {
    if (req.session && req.session.user) {
      req.user = req.session.user; // { id, name?, email, role }
      return next();
    }
    return res.status(401).json({ error: 'No login' });
  } catch {
    return res.status(401).json({ error: 'No login' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    const u = req.session?.user;
    if (!u) return res.status(401).json({ error: 'No login' });
    if (u.role === 'admin' || u.role === role) return next();
    return res.status(403).json({ error: 'Sin permisos' });
  };
}

export function requireAnyRole(...roles) {
  return (req, res, next) => {
    const u = req.session?.user;
    if (!u) return res.status(401).json({ error: 'No login' });
    if (u.role === 'admin' || roles.includes(u.role)) return next();
    return res.status(403).json({ error: 'Sin permisos' });
  };
}
