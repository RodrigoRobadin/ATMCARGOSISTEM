// server/src/middlewares/auth.js
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const [, token] = auth.split(' ');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email, role }
    return next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No auth' });
    if (req.user.role !== role) return res.status(403).json({ error: 'Permiso denegado' });
    next();
  };
}

export function requireAnyRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No auth' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Permiso denegado' });
    next();
  };
}
