import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db.js';

function resolveLocalAssetPath(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:') || /^https?:\/\//i.test(raw)) return '';
  const ext = String(path.extname(raw) || '').toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return '';
  const localPath = raw.startsWith('/uploads/')
    ? path.resolve(raw.replace(/^\/+/, ''))
    : path.isAbsolute(raw)
      ? raw
      : path.resolve(raw);
  return fs.existsSync(localPath) ? localPath : '';
}

export async function getBrandLogoPath(key = 'quote_brand_logo_url') {
  const [[row]] = await pool.query(
    `SELECT \`value\`
       FROM param_values
      WHERE \`key\` = ?
        AND (\`active\` IS NULL OR \`active\` <> 0)
        AND COALESCE(TRIM(\`value\`), '') <> ''
      ORDER BY \`ord\`, id
      LIMIT 1`,
    [key]
  );
  return resolveLocalAssetPath(row?.value);
}
