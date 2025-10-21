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

const {
  DB_HOST = '127.0.0.1',
  DB_PORT = '3306',
  DB_NAME = 'crmdb',
  DB_USER = 'crmuser',
  DB_PASSWORD = 'root',
} = process.env;

// Crear pool
const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
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
    console.log(`[db] conectado a ${DB_HOST}:${DB_PORT}/${DB_NAME} como ${DB_USER}`);
  } catch (err) {
    console.error('[db] error conectando:', err?.message || err);
  }
})();

// ✅ Export default y nombrados para compatibilidad
export { pool, query, getConnection };
export default pool;
