// server/src/app.js
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import fs from 'node:fs';
import session from 'express-session';
import crypto from 'node:crypto';

// Routers (ESM/CJS con default export)
import pipelinesRouter from './routes/pipelines.js';
import stagesRouter from './routes/stages.js';
import dealsRouter from './routes/deals.js';
import contactsRouter from './routes/contacts.js';
import orgsRouter from './routes/organizations.js';
import businessUnitsRouter from './routes/businessUnits.js';

// nuevos
import usersRouter from './routes/users.js';
import labelsRouter from './routes/labels.js';
import activitiesRouter from './routes/activities.js';
import authRouter from './routes/auth.js';
import dealsCostSheetRouter from './routes/dealsCostSheet.js';
import paramsRouter from './routes/params.js';
import adminActivity from './routes/admin-activity.js';
import auditRouter from './routes/audit.js';
import searchRouter from './routes/search.js';

// ⭐️ Seguimiento
import followupsRouter from './routes/followups.js';
import visitsRouter from './routes/visits.js';

// ⭐️ NUEVO: Recorridos (Routes Module)
import zonesRouter from './routes/zones.js';
import routesModuleRouter from './routes/routesModule.js';
import routeStopsRouter from './routes/routeStops.js';

// ⭐️ Operaciones (nuestro router nuevo)
import operationsRouter from './routes/operations.js';
import reportsRouter from './routes/reports.js';
import adminRouter from './routes/admin.js';
import catalogRouter from './routes/catalog.js';

// ⭐️ NUEVO: solicitudes de flete
import freightRequestsRouter from './routes/freightRequests.js';

// ⭐️ NUEVO: envío de informes por correo
import emailRoutes from './routes/emailRoutes.js';
import industrialDoorsRouter from "./routes/industrialDoors.js";


// ====== Cargar variables de entorno ======
const ENV_PATH = '/home/deploy/.env.crm';
if (fs.existsSync(ENV_PATH)) {
  dotenv.config({ path: ENV_PATH });
} else {
  dotenv.config();
}

const app = express();

/* ================== CORS ================== */
const parseList = (v = '') => v.split(',').map(s => s.trim()).filter(Boolean);
const envOrigins = parseList(process.env.CORS_ORIGIN || '');
const defaults = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const pubDomain = process.env.PUBLIC_DOMAIN || 'atmcargosoft.com';
const pubIp = process.env.PUBLIC_IP || '72.60.243.190';
const pubOrigin = process.env.PUBLIC_ORIGIN || '';

defaults.push(
  `http://${pubIp}`, `https://${pubIp}`,
  `http://${pubDomain}`, `https://${pubDomain}`,
  `http://www.${pubDomain}`, `https://www.${pubDomain}`
);
if (pubOrigin) defaults.push(pubOrigin);

const allowedOrigins = Array.from(new Set([...envOrigins, ...defaults]));

const corsOptions = {
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With', 'X-CSRF-Token', 'Origin'],
  exposedHeaders: ['Content-Disposition'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* ============== Middlewares ============== */
app.use(express.json());
app.use(morgan('dev'));

/* ========== SESIÓN / COOKIES ========== */
// Usa X-Forwarded-Proto para que req.secure funcione tras el proxy
const truthy = v => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());
const TRUST_PROXY = truthy(process.env.TRUST_PROXY ?? 'true');
if (TRUST_PROXY) app.set('trust proxy', 1);

// Config de cookie por .env (con defaults seguros para HTTPS)
const SESSION_NAME = process.env.SESSION_NAME || 'sid';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Forzamos Secure para producción (evita rechazo de SameSite=None sin Secure)
const FORCE_SECURE_COOKIE = truthy(process.env.FORCE_SECURE_COOKIE ?? 'true');

let sameSite = (process.env.SESSION_SAMESITE || 'None').toLowerCase(); // 'none' | 'lax' | 'strict'
if (!['none', 'lax', 'strict'].includes(sameSite)) sameSite = 'none';

const sessionDomain = (process.env.SESSION_DOMAIN || '').trim() || undefined;

app.use(session({
  name: SESSION_NAME,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: TRUST_PROXY,
  cookie: {
    httpOnly: true,
    secure: FORCE_SECURE_COOKIE ? true : 'auto',
    sameSite: sameSite,             // 'none' permite envío cross-site (con withCredentials)
    domain: sessionDomain,          // ej: .atmcargosoft.com (opcional)
    path: '/',
    maxAge: 1000 * 60 * 60 * 8,     // 8h
  },
}));

console.log('[auth] TRUST_PROXY:', TRUST_PROXY ? 'ON' : 'OFF');
console.log('[auth] SESSION cookie:', {
  name: SESSION_NAME,
  secure: FORCE_SECURE_COOKIE ? true : 'auto',
  sameSite,
  domain: sessionDomain || '(default)',
});

/* ========== BYPASS DE AUTH (opcional, controlado por env) ========== */
const AUTH_OPTIONAL =
  process.env.AUTH_OPTIONAL === '1' ||
  String(process.env.AUTH_OPTIONAL || '').toLowerCase() === 'true';

console.log(`[auth] AUTH_OPTIONAL: ${AUTH_OPTIONAL ? 'ON' : 'OFF'}`);

if (AUTH_OPTIONAL) {
  // Inyecta un usuario “falso”; NO añadimos Authorization Bearer dummy
  app.use((req, _res, next) => {
    if (!req.user) {
      req.user = { id: 2, name: 'Admin', email: 'admin@tuempresa.com', role: 'admin' };
    }
    req.isAuthenticated = () => true;
    next();
  });

  // Endpoints mínimos para el FE mientras dura el bypass
  app.get('/api/auth/me', (req, res) => res.json(req.user));
  app.post('/api/auth/login', (req, res) => res.json({ ok: true, user: req.user }));
  app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));

  console.log('[auth] Bypass activo: las rutas aceptan requests sin login real');
}

/* ========== Archivos estáticos subidos ========== */
app.use('/uploads', express.static('uploads'));
app.use('/api/uploads', express.static('uploads'));

/* ================ Healthcheck y favicon ================ */
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/favicon.ico', (_req, res) => res.sendStatus(204)); // silencia 404 en consola

/* ================ Rutas Públicas ================ */
app.use('/api/auth', authRouter);

/* ================ Rutas API ================ */
app.use('/api/pipelines', pipelinesRouter);
app.use('/api/stages', stagesRouter);

// /api/deals (core + cost sheet)
app.use('/api/deals', dealsRouter);
app.use('/api/deals', dealsCostSheetRouter);

app.use('/api/contacts', contactsRouter);
app.use('/api/organizations', orgsRouter);
app.use('/api/business-units', businessUnitsRouter);
app.use('/api/users', usersRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/activities', activitiesRouter);
app.use('/api/params', paramsRouter);
app.use('/api/admin/activity', adminActivity);
app.use('/api/audit', auditRouter);
app.use('/api/followups', followupsRouter);
app.use('/api/visits', visitsRouter);

// ⭐️ NUEVO: Recorridos (Routes Module)
app.use('/api/zones', zonesRouter);
app.use('/api/routes', routesModuleRouter);
app.use('/api/route-stops', routeStopsRouter);

app.use('/api/search', searchRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouter);
app.use('/api', catalogRouter);

// ⭐️ Operaciones (crear/leer y PUT por tipo: air/ocean/road/multimodal)
app.use('/api/operations', operationsRouter);

// ⭐️ NUEVO: solicitudes de flete (envío de emails “pedido de tarifa”)
app.use('/api/freight-requests', freightRequestsRouter);

// ⭐️ NUEVO: envío de informes por correo (status report)
app.use('/api', emailRoutes); // /api/emails/status-report

/* ====== Manejador de errores CORS ====== */
app.use((err, _req, res, next) => {
  if (err && /Not allowed by CORS/.test(err.message)) {
    return res.status(403).json({ error: err.message, allowedOrigins });
  }
  return next(err);
});

// ...


// ...
app.use("/api", catalogRouter);
app.use("/api", industrialDoorsRouter);
// ...

/* ================ Arranque ================ */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(', ') || '(none)'}`);
});
