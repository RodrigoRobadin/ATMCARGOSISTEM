// server/src/routes/industrialQuotes.js
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../services/db.js';

const router = Router();

function toInt(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// Asegurar tabla básica para cotizaciones industrial (proveedor + flete)
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS industrial_quotes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deal_id INT NOT NULL,
        provider_dimensions VARCHAR(255) NULL,
        provider_weight VARCHAR(100) NULL,
        provider_value VARCHAR(100) NULL,
        freight_value VARCHAR(100) NULL,
        notes TEXT NULL,
        provider_filename VARCHAR(255) NULL,
        provider_url VARCHAR(255) NULL,
        freight_filename VARCHAR(255) NULL,
        freight_url VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX(deal_id),
        FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS industrial_quote_forms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deal_id INT NOT NULL UNIQUE,
        data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error('[industrial-quotes] No se pudo asegurar tabla:', e?.message || e);
  }
})();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dealId = String(req.params.dealId || 'general');
    const dir = path.resolve('uploads', 'industrial-quotes', dealId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '');
    const base = path
      .basename(file.originalname || 'file', ext)
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${base}-${unique}${ext}`);
  },
});

const upload = multer({ storage });

// GET última cotización de una operación
router.get('/deals/:dealId/industrial-quote', async (req, res) => {
  try {
    const dealId = toInt(req.params.dealId, 0);
    if (!dealId) return res.status(400).json({ error: 'dealId inválido' });

    const [[row]] = await db.query(
      `SELECT * FROM industrial_quotes WHERE deal_id = ? ORDER BY id DESC LIMIT 1`,
      [dealId]
    );

    res.json(row || null);
  } catch (e) {
    console.error('[industrial-quote][GET] Error:', e);
    res.status(500).json({ error: 'No se pudo obtener la cotización' });
  }
});

// POST crear/actualizar cotización con archivos opcionales
router.post(
  '/deals/:dealId/industrial-quote',
  upload.fields([
    { name: 'provider_file', maxCount: 1 },
    { name: 'freight_file', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const dealId = toInt(req.params.dealId, 0);
      if (!dealId) return res.status(400).json({ error: 'dealId inválido' });

      const body = req.body || {};
      const providerFile = req.files?.provider_file?.[0];
      const freightFile = req.files?.freight_file?.[0];

      const providerUrl = providerFile
        ? `/uploads/industrial-quotes/${dealId}/${providerFile.filename}`
        : null;
      const freightUrl = freightFile
        ? `/uploads/industrial-quotes/${dealId}/${freightFile.filename}`
        : null;

      await db.query(
        `INSERT INTO industrial_quotes
         (deal_id, provider_dimensions, provider_weight, provider_value, freight_value, notes, provider_filename, provider_url, freight_filename, freight_url)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          dealId,
          body.provider_dimensions ?? null,
          body.provider_weight ?? null,
          body.provider_value ?? null,
          body.freight_value ?? null,
          body.notes ?? null,
          providerFile?.filename ?? null,
          providerUrl,
          freightFile?.filename ?? null,
          freightUrl,
        ]
      );

      res.status(201).json({ ok: true, provider_url: providerUrl, freight_url: freightUrl });
    } catch (e) {
      console.error('[industrial-quote][POST] Error completo:', e);
      res.status(500).json({ error: e?.message || 'No se pudo guardar la cotización' });
    }
  }
);

// GET /deals/:dealId/industrial-quote-form
router.get('/deals/:dealId/industrial-quote-form', async (req, res) => {
  try {
    const dealId = toInt(req.params.dealId, 0);
    if (!dealId) return res.status(400).json({ error: 'dealId inválido' });
    const [[row]] = await db.query(
      `SELECT data, updated_at FROM industrial_quote_forms WHERE deal_id = ? LIMIT 1`,
      [dealId]
    );
    let parsed = null;
    if (row) {
      try {
        const raw = Buffer.isBuffer(row.data) ? row.data.toString('utf8') : row.data;
        console.log('[industrial-quote-form][GET] raw data type:', typeof raw, 'value:', raw);
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        console.error('[industrial-quote-form][GET] No se pudo parsear JSON de data:', e?.message || e);
      }
    }
    const rowsPreview = Array.isArray(parsed?.quoteSheet?.rows)
      ? parsed.quoteSheet.rows.map((r, i) => ({ i, v_puerta: r?.v_puerta, cant: r?.cant })).slice(0, 3)
      : [];
    console.log('[industrial-quote-form][GET] deal', dealId, 'fleteTotal=', parsed?.quoteSheet?.header?.fleteTotal, 'freight_value=', parsed?.quotePanel?.freight_value, 'rows preview=', rowsPreview);
    res.json(row ? { data: parsed, updated_at: row.updated_at } : null);
  } catch (e) {
    console.error('[industrial-quote-form][GET] Error:', e);
    res.status(500).json({ error: 'No se pudo obtener la planilla' });
  }
});

// POST /deals/:dealId/industrial-quote-form
router.post('/deals/:dealId/industrial-quote-form', async (req, res) => {
  try {
    const dealId = toInt(req.params.dealId, 0);
    if (!dealId) return res.status(400).json({ error: 'dealId inválido' });

    const payload = req.body?.data || req.body || {};
    // debug mínimo para rastrear flete
    const flete = payload?.quoteSheet?.header?.fleteTotal ?? payload?.quotePanel?.freight_value;
    const rowsPreview = Array.isArray(payload?.quoteSheet?.rows)
      ? payload.quoteSheet.rows.map((r, i) => ({ i, v_puerta: r?.v_puerta, cant: r?.cant })).slice(0, 3)
      : [];
    console.log('[industrial-quote-form][POST] deal', dealId, 'fleteTotal=', flete, 'rows preview=', rowsPreview);
    await db.query(
      `INSERT INTO industrial_quote_forms (deal_id, data)
       VALUES(?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      [dealId, JSON.stringify(payload)]
    );

    // devolver lo que quedó guardado en DB para verificar persistencia
    const [[row]] = await db.query(
      `SELECT data, updated_at FROM industrial_quote_forms WHERE deal_id = ? LIMIT 1`,
      [dealId]
    );
    let saved = payload;
    if (row) {
      try {
        const raw = Buffer.isBuffer(row.data) ? row.data.toString('utf8') : row.data;
        saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        console.error('[industrial-quote-form][POST] No se pudo parsear data recién guardada:', e?.message || e);
      }
    }

    res.json({ ok: true, data: saved });
  } catch (e) {
    console.error('[industrial-quote-form][POST] Error:', e);
    res.status(500).json({ error: 'No se pudo guardar la planilla' });
  }
});

export default router;
