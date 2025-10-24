// server/src/app.js
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import fs from 'node:fs';

// Routers (ESM/CJS con default export)
import pipelinesRouter from './routes/pipelines.js';
import stagesRouter from './routes/stages.js';
import dealsRouter from './routes/deals.js';
import contactsRouter from './routes/contacts.js';
import orgsRouter from './routes/organizations.js'; // 👈 default (corrige el error)
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

// ⭐️ Operaciones (nuestro router nuevo)
import operationsRouter from './routes/operations.js';
import reportsRouter from "./routes/reports.js";
import adminRouter from "./routes/admin.js";
import catalogRouter from "./routes/catalog.js";

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

/* ========== BYPASS DE AUTH (opcional, controlado por env) ========== */
const AUTH_OPTIONAL = (process.env.AUTH_OPTIONAL === '1' || String(process.env.AUTH_OPTIONAL).toLowerCase() === 'true');
if (AUTH_OPTIONAL) {
  // Inyecta un usuario “falso” para que las rutas que requieren auth no den 401.
  app.use((req, _res, next) => {
    if (!req.user) {
      req.user = { id: 1, name: 'Admin', email: '' };
    }
    req.isAuthenticated = () => true;
    next();
  });

  // Endpoints mínimos para el FE mientras dura el bypass
  app.get('/api/auth/me', (req, res) => res.json(req.user));
  app.post('/api/auth/login', (req, res) => res.json({ ok: true, user: req.user }));
  app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));

  console.log('[auth] AUTH_OPTIONAL activo: autenticación bypass habilitada');
}

/* ========== Archivos estáticos subidos ========== */
app.use('/uploads', express.static('uploads'));
app.use('/api/uploads', express.static('uploads'));

/* ================ Healthcheck ================ */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
app.use('/api/search', searchRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/admin", adminRouter);
app.use("/api", catalogRouter);

// ⭐️ Operaciones (crear/leer y PUT por tipo: air/ocean/road/multimodal)
app.use('/api/operations', operationsRouter);

/* ====== Manejador de errores CORS ====== */
app.use((err, _req, res, next) => {
  if (err && /Not allowed by CORS/.test(err.message)) {
    return res.status(403).json({ error: err.message, allowedOrigins });
  }
  return next(err);
});

/* ================ Arranque ================ */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(', ') || '(none)'}`);
});
