// server/src/services/db.js
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'node:fs';

// Cargar .env (global del deploy si existe; si no, .env local)
const ENV_PATH = '/home/deploy/.env.crm';
if (fs.existsSync(ENV_PATH)) {
  dotenv.config({ path: ENV_PATH });
} else {
  dotenv.config();
}

// Soportar ambos nombres: DB_PASS y DB_PASSWORD
const {
  DB_HOST = '127.0.0.1',
  DB_PORT = '3306',
  DB_NAME = 'crmdb',
  DB_USER = 'crmuser',
} = process.env;

const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? '';

// Crear pool único para toda la app
const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
  timezone: 'Z',
  dateStrings: true,
});

// Helpers convenientes
const query = (...args) => pool.query(...args);
const getConnection = () => pool.getConnection();

// Ping de arranque (solo log informativo)
(async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`[db] pool OK => ${DB_HOST}:${DB_PORT}/${DB_NAME} como ${DB_USER}`);
  } catch (err) {
    console.error('[db] error conectando:', err?.message || err);
  }
})();

// ✅ Export default y nombrados
export { pool, query, getConnection };
export default pool;
