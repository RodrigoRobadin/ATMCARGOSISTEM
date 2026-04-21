// server/src/routes/quotes.js
import { Router } from "express";
import db from "../services/db.js";
import { requireAuth } from '../middlewares/auth.js';

// ✅ Soporta export named o default (evita el error: "does not provide an export named")
import computeQuoteDefault, { computeQuote as computeQuoteNamed } from "../services/quoteEngine.js";

import { buildQuoteXlsxBuffer } from "../services/quoteXlsxTemplate.js";
import { buildFormalQuotePdfBuffer } from '../services/formalQuotePdf.js';

const router = Router();

// Usa el que exista
const computeQuote = computeQuoteNamed || computeQuoteDefault;

async function isDealInvoiced(dealId) {
  if (!dealId) return false;
  try {
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS cnt
         FROM invoices
        WHERE status <> 'anulada'
          AND COALESCE(net_total_amount, total_amount, 0) > 0.01
          AND deal_id = ?`,
      [dealId]
    );
    return Number(row?.cnt || 0) > 0;
  } catch (err) {
    if (err?.code === "ER_BAD_FIELD_ERROR") return false;
    throw err;
  }
}

async function assertDealUnlocked(dealId, res) {
  if (!dealId) return true;
  const locked = await isDealInvoiced(dealId);
  if (locked) {
    res.status(409).json({ error: "Operacion ya facturada. No se puede modificar la cotizacion." });
    return false;
  }
  return true;
}

// asegurar tabla simple para quotes (inputs/computed en JSON)
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deal_id INT NULL,
        ref_code VARCHAR(100),
        revision VARCHAR(50),
        client_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'draft',
        inputs_json JSON,
        computed_json JSON,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_quotes_deal (deal_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // En instalaciones previas, intentar agregar deal_id + índice sin romper si ya existe
    try {
      await db.query("ALTER TABLE quotes ADD COLUMN deal_id INT NULL");
    } catch (_) {}
    try {
      await db.query("ALTER TABLE quotes ADD UNIQUE INDEX uq_quotes_deal (deal_id)");
    } catch (_) {}

    // Tabla de revisiones (snapshots)
    await db.query(`
      CREATE TABLE IF NOT EXISTS quote_revisions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quote_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        inputs_json JSON,
        computed_json JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_quote (quote_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error("[quotes] no se pudo crear tabla:", e?.message || e);
  }
})();

function normalizeInputs(body = {}) {
  return body?.inputs || body || {};
}

async function syncDealBranch(dealId, orgBranchId) {
  if (!dealId) return;
  const branchVal = orgBranchId == null || orgBranchId === '' ? null : Number(orgBranchId);
  try {
    await db.query('UPDATE deals SET org_branch_id = ? WHERE id = ?', [branchVal, dealId]);
  } catch (e) {
    console.error('[quotes][branch] No se pudo actualizar sucursal:', e?.message || e);
  }
}

// ✅ MySQL puede devolver JSON como string según driver/config
function asJson(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return null;
}

async function getRevisionById(quoteId, revisionId) {
  const [[rev]] = await db.query(
    "SELECT * FROM quote_revisions WHERE id = ? AND quote_id = ? LIMIT 1",
    [revisionId, quoteId]
  );
  if (!rev) return null;
  return {
    id: rev.id,
    name: rev.name,
    inputs: asJson(rev.inputs_json) || {},
    computed: asJson(rev.computed_json) || null,
    created_at: rev.created_at,
  };
}

async function listRevisions(quoteId) {
  const [rows] = await db.query(
    "SELECT id, name, created_at FROM quote_revisions WHERE quote_id = ? ORDER BY id DESC",
    [quoteId]
  );
  return rows;
}

function safeCompute(inputs) {
  try {
    if (!computeQuote) {
      return {
        computed: null,
        compute_error: "computeQuote no disponible (import falló).",
      };
    }
    const computed = computeQuote(inputs);
    return { computed, compute_error: null };
  } catch (e) {
    return {
      computed: null,
      compute_error: e?.message || "No se pudo calcular (datos incompletos).",
    };
  }
}

router.get("/quotes", async (_req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, deal_id, ref_code, client_name, status, computed_json, inputs_json, updated_at FROM quotes ORDER BY updated_at DESC"
    );

    const list = rows.map((r) => {
      const computed = asJson(r.computed_json);
      const inputs = asJson(r.inputs_json) || {};
      const opCurrency = String(
        computed?.meta?.operation_currency || inputs.operation_currency || 'USD'
      ).toUpperCase();
      const opRate = Number(
        computed?.meta?.exchange_rate_operation_sell_usd || inputs.exchange_rate_operation_sell_usd || 1
      ) || 1;
      const isPyg = opCurrency === 'PYG' || opCurrency === 'GS';
      const profitUsd = computed?.operacion?.totals?.profit_total_usd ?? null;
      const profitDisplay = Number.isFinite(Number(profitUsd))
        ? (isPyg ? Number(profitUsd) * opRate : Number(profitUsd))
        : null;
      return {
        id: r.id,
        deal_id: r.deal_id,
        ref_code: r.ref_code,
        client_name: r.client_name,
        status: r.status,
        total_sales_usd: computed?.oferta?.totals?.total_sales_usd ?? null,
        profit_total_usd: profitUsd,
        profit_total_currency: opCurrency,
        profit_total_display: profitDisplay,
        exchange_rate_operation_sell_usd: opRate,
        updated_at: r.updated_at,
      };
    });

    res.json(list);
  } catch (e) {
    console.error("[quotes][GET] error:", e);
    res.status(500).json({ error: "No se pudo listar cotizaciones" });
  }
});

// ✅ Preview (para UI en vivo, sin guardar)
router.post("/quotes/preview", async (req, res) => {
  try {
    const inputs = normalizeInputs(req.body);

    if (!computeQuote) {
      return res.status(500).json({ error: "computeQuote no disponible (import falló)." });
    }

    const computed = computeQuote(inputs);
    res.json({ inputs, computed });
  } catch (e) {
    // preview debe avisar error (para que UI lo muestre)
    res.status(400).json({ error: e?.message || "No se pudo previsualizar" });
  }
});

router.post('/quotes/formal-pdf', requireAuth, async (req, res) => {
  try {
    const pdf = await buildFormalQuotePdfBuffer(req.body || {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="cotizacion-formal.pdf"');
    res.send(pdf);
  } catch (e) {
    console.error('[quotes][formal-pdf] error:', e);
    res.status(500).json({ error: e?.message || 'No se pudo generar el PDF formal' });
  }
});

// Obtener o crear (en blanco) la cotización asociada a un deal específico
router.get("/deals/:dealId/quote", async (req, res) => {
  try {
    const dealId = Number(req.params.dealId);
    if (!Number.isFinite(dealId) || dealId <= 0) {
      return res.status(400).json({ error: "dealId inválido" });
    }
    const [rows] = await db.query(
      "SELECT * FROM quotes WHERE deal_id = ? LIMIT 1",
      [dealId]
    );

    if (rows.length) {
      const row = rows[0];
      const revisionId = req.query.revision_id ? Number(req.query.revision_id) : null;
      let rev = null;
      if (revisionId) rev = await getRevisionById(row.id, revisionId);

      const inputs = rev?.inputs || asJson(row.inputs_json) || {};
      const computed = rev?.computed || asJson(row.computed_json) || null;

      return res.json({
        id: row.id,
        deal_id: row.deal_id,
        inputs,
        computed,
        meta: {
          revision_id: rev?.id || null,
          revision_name: rev?.name || null,
          deal_id: row.deal_id,
          ref_code: row.ref_code,
          revision: row.revision,
          client_name: row.client_name,
          status: row.status,
          updated_at: row.updated_at,
        },
      });
    }

    // Crear en blanco ligada al deal
    if (!(await assertDealUnlocked(dealId, res))) return;
    const [[dealRow]] = await db.query(
      'SELECT org_branch_id FROM deals WHERE id = ?',
      [dealId]
    );
    const inputs = {
      deal_id: dealId,
      status: "draft",
      org_branch_id: dealRow?.org_branch_id || null,
    };

    const { computed, compute_error } = safeCompute(inputs);

    const [result] = await db.query(
      `INSERT INTO quotes (deal_id, ref_code, revision, client_name, status, created_by, inputs_json, computed_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        dealId,
        null,
        null,
        null,
        "draft",
        null,
        JSON.stringify(inputs),
        computed ? JSON.stringify(computed) : null,
      ]
    );

    res.status(201).json({
      id: result.insertId,
      deal_id: dealId,
      inputs,
      computed,
      compute_error,
      meta: {
        deal_id: dealId,
        ref_code: null,
        revision: null,
        client_name: null,
        status: "draft",
        updated_at: new Date(),
      },
      created: true,
    });
  } catch (e) {
    // ⚠️ Si falla acá por UNIQUE uq_quotes_deal, es porque ya existe uno para ese deal
    console.error("[quotes][by-deal] error:", e);
    res.status(500).json({ error: e?.message || "No se pudo obtener/crear la cotizacion" });
  }
});

router.post("/quotes", async (req, res) => {
  try {
    const inputs = normalizeInputs(req.body);
    if (!(await assertDealUnlocked(inputs.deal_id, res))) return;

    // ✅ NO romper si no se puede calcular (draft)
    const { computed, compute_error } = safeCompute(inputs);

    const { ref_code, revision, client_name, status, created_by, deal_id } = inputs;

    const [result] = await db.query(
      `INSERT INTO quotes (deal_id, ref_code, revision, client_name, status, created_by, inputs_json, computed_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        deal_id || null,
        ref_code || null,
        revision || null,
        client_name || null,
        status || "draft",
        created_by || null,
        JSON.stringify(inputs),
        computed ? JSON.stringify(computed) : null,
      ]
    );

    if (deal_id) {
      await syncDealBranch(deal_id, inputs.org_branch_id);
    }

    res.status(201).json({ id: result.insertId, inputs, computed, compute_error });
  } catch (e) {
    console.error("[quotes][POST] error:", e);
    res.status(500).json({ error: e?.message || "No se pudo crear la cotizacion" });
  }
});

router.get("/quotes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const revisionId = req.query.revision_id ? Number(req.query.revision_id) : null;

    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });

    let rev = null;
    if (revisionId) {
      rev = await getRevisionById(id, revisionId);
      if (!rev) return res.status(404).json({ error: "Revision no encontrada" });
    }

    const inputs = rev?.inputs || asJson(row.inputs_json) || {};
    const computed = rev?.computed || asJson(row.computed_json) || null;

    res.json({
      id: row.id,
      deal_id: row.deal_id,
      inputs,
      computed,
      meta: {
        revision_id: rev?.id || null,
        revision_name: rev?.name || null,
        deal_id: row.deal_id,
        ref_code: row.ref_code,
        revision: row.revision,
        client_name: row.client_name,
        status: row.status,
        updated_at: row.updated_at,
      },
    });
  } catch (e) {
    console.error("[quotes][GET /:id] error:", e);
    res.status(500).json({ error: "No se pudo obtener la cotizacion" });
  }
});

router.put("/quotes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const inputs = normalizeInputs(req.body);
    const [[existing]] = await db.query("SELECT deal_id FROM quotes WHERE id = ? LIMIT 1", [id]);
    const dealId = inputs.deal_id || existing?.deal_id || null;
    if (!(await assertDealUnlocked(dealId, res))) return;

    // ✅ NO romper si no se puede calcular (guardar igual)
    const { computed, compute_error } = safeCompute(inputs);

    const { ref_code, revision, client_name, status, created_by, deal_id } = inputs;

    await db.query(
      `UPDATE quotes
       SET deal_id=?, ref_code=?, revision=?, client_name=?, status=?, created_by=?, inputs_json=?, computed_json=?
       WHERE id=?`,
      [
        deal_id || null,
        ref_code || null,
        revision || null,
        client_name || null,
        status || "draft",
        created_by || null,
        JSON.stringify(inputs),
        computed ? JSON.stringify(computed) : null,
        id,
      ]
    );

    if (deal_id) {
      await syncDealBranch(deal_id, inputs.org_branch_id);
    }

    res.json({ id, inputs, computed, compute_error });
  } catch (e) {
    console.error("[quotes][PUT] error:", e);
    res.status(500).json({ error: e?.message || "No se pudo actualizar la cotizacion" });
  }
});

router.post("/quotes/:id/recalculate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });
    if (!(await assertDealUnlocked(row.deal_id, res))) return;

    const inputs = asJson(row.inputs_json) || {};

    // ✅ recalcular debe fallar con 422 si faltan datos
    if (!computeQuote) {
      return res.status(500).json({ error: "computeQuote no disponible (import falló)." });
    }

    let computed = null;
    try {
      computed = computeQuote(inputs);
    } catch (e) {
      return res.status(422).json({
        error: e?.message || "No se pudo recalcular (datos incompletos).",
      });
    }

    await db.query("UPDATE quotes SET computed_json=? WHERE id=?", [
      JSON.stringify(computed),
      id,
    ]);

    res.json({ id, inputs, computed });
  } catch (e) {
    console.error("[quotes][recalculate] error:", e);
    res.status(500).json({ error: "No se pudo recalcular" });
  }
});

// Listar revisiones
router.get("/quotes/:id/revisions", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inv??lido" });
    }
    const rows = await listRevisions(id);
    res.json(rows);
  } catch (e) {
    console.error("[quotes][revisions][list] error:", e);
    res.status(500).json({ error: "No se pudieron listar revisiones" });
  }
});

// Crear revisi??n (snapshot)
router.post("/quotes/:id/revisions", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inv??lido" });
    }
    const name = String(req.body?.name || "").trim() || `Rev ${Date.now()}`;

    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });
    if (!(await assertDealUnlocked(row.deal_id, res))) return;

    const inputs = asJson(row.inputs_json) || {};
    const computed = asJson(row.computed_json) || null;

    const [result] = await db.query(
      `INSERT INTO quote_revisions (quote_id, name, inputs_json, computed_json)
       VALUES (?,?,?,?)`,
      [id, name, JSON.stringify(inputs), computed ? JSON.stringify(computed) : null]
    );

    const rows = await listRevisions(id);
    res.status(201).json({ id: result.insertId, name, revisions: rows });
  } catch (e) {
    console.error("[quotes][revisions][create] error:", e);
    res.status(500).json({ error: "No se pudo crear la revision" });
  }
});

// Actualizar revisión
router.put("/quotes/:id/revisions/:revisionId", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const revisionId = Number(req.params.revisionId);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }
    if (!Number.isFinite(revisionId) || revisionId <= 0) {
      return res.status(400).json({ error: "revisionId inválido" });
    }

    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });
    if (!(await assertDealUnlocked(row.deal_id, res))) return;

    const [[rev]] = await db.query(
      "SELECT * FROM quote_revisions WHERE id = ? AND quote_id = ? LIMIT 1",
      [revisionId, id]
    );
    if (!rev) return res.status(404).json({ error: "Revision no encontrada" });

    const inputs = normalizeInputs(req.body);
    const { computed, compute_error } = safeCompute(inputs);
    const name = String(req.body?.name || rev.name || "").trim() || `Rev ${revisionId}`;

    await db.query(
      `UPDATE quote_revisions
         SET name = ?, inputs_json = ?, computed_json = ?
       WHERE id = ? AND quote_id = ?`,
      [
        name,
        JSON.stringify(inputs),
        computed ? JSON.stringify(computed) : null,
        revisionId,
        id,
      ]
    );

    res.json({ id, revision_id: revisionId, inputs, computed, compute_error: compute_error || null, name });
  } catch (e) {
    console.error("[quotes][revisions][update] error:", e);
    res.status(500).json({ error: "No se pudo actualizar la revision" });
  }
});

router.post("/quotes/:id/duplicate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });
    if (!(await assertDealUnlocked(row.deal_id, res))) return;

    // ✅ Parse seguro
    const origInputs = asJson(row.inputs_json) || {};
    const origComputed = asJson(row.computed_json) || null;

    // ✅ Importante: la copia NO debe quedar ligada a deal_id ni dentro del JSON
    const inputs = { ...origInputs };
    delete inputs.deal_id;

    const [result] = await db.query(
      `INSERT INTO quotes (deal_id, ref_code, revision, client_name, status, created_by, inputs_json, computed_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        null, // la copia no se vincula automáticamente a un deal
        `${row.ref_code || "REF"}-COPY`,
        row.revision,
        row.client_name,
        "draft",
        row.created_by,
        JSON.stringify(inputs),
        origComputed ? JSON.stringify(origComputed) : null,
      ]
    );

    res.status(201).json({ id: result.insertId, inputs, computed: origComputed });
  } catch (e) {
    console.error("[quotes][duplicate] error:", e);
    res.status(500).json({ error: e?.message || "No se pudo duplicar la cotizacion" });
  }
});

// ✅ Export EXACTO desde Template (con tu formato y formulas)
router.get("/quotes/:id/export-xlsx", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });

    const inputs = asJson(row.inputs_json) || {};
    const buffer = await buildQuoteXlsxBuffer(inputs);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=quote-${id}.xlsx`);
    res.send(buffer);
  } catch (e) {
    console.error("[quotes][export-xlsx] error:", e);
    res.status(500).json({ error: e?.message || "No se pudo exportar XLSX" });
  }
});

export default router;
