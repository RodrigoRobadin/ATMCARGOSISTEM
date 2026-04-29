import { Router } from "express";
import db from "../services/db.js";

const router = Router();
let ensureCatalogSchemaPromise = null;

function toInt(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function toBool01(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1", "true", "sí", "si", "on"].includes(s)) return 1;
    if (["0", "false", "no", "off"].includes(s)) return 0;
  }
  return v ? 1 : 0;
}

function normalizeCategory(v) {
  return String(v || "").trim() || null;
}

function normalizeModalities(v) {
  if (Array.isArray(v)) {
    return JSON.stringify(
      [...new Set(v.map((it) => String(it || "").trim().toUpperCase()).filter(Boolean))]
    );
  }
  if (typeof v === "string") {
    const raw = v.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeModalities(parsed);
    } catch {}
    return JSON.stringify(
      [...new Set(raw.split(",").map((it) => it.trim().toUpperCase()).filter(Boolean))]
    );
  }
  return null;
}

function parseModalities(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(v)
      .split(",")
      .map((it) => it.trim().toUpperCase())
      .filter(Boolean);
  }
}

async function ensureCatalogSchema() {
  if (ensureCatalogSchemaPromise) return ensureCatalogSchemaPromise;
  ensureCatalogSchemaPromise = (async () => {
    try {
      const [columns] = await db.query("SHOW COLUMNS FROM catalog_items");
      const names = new Set((columns || []).map((col) => String(col.Field || "").toLowerCase()));

      if (!names.has("category")) {
        await db.query("ALTER TABLE catalog_items ADD COLUMN category VARCHAR(120) NULL AFTER brand");
      }
      if (!names.has("applies_to_modalities")) {
        await db.query(
          "ALTER TABLE catalog_items ADD COLUMN applies_to_modalities TEXT NULL AFTER description"
        );
      }
    } catch (error) {
      console.error("[catalog:schema] Error ensuring catalog_items columns:", error);
    }
  })();
  return ensureCatalogSchemaPromise;
}

void ensureCatalogSchema();

router.get("/catalog/items", async (req, res) => {
  try {
    await ensureCatalogSchema();
    const { q, type, category, modality } = req.query;
    const active = toBool01(req.query.active);
    const limit = Math.min(toInt(req.query.limit, 500), 1000);

    let sql = `
      SELECT id,
             type,
             sku,
             name,
             brand,
             category,
             description,
             applies_to_modalities,
             unit,
             currency,
             price,
             tax_rate,
             active,
             created_at,
             updated_at
        FROM catalog_items
       WHERE 1=1
    `;
    const params = [];

    if (active !== null) {
      sql += " AND active = ?";
      params.push(active);
    }
    if (type) {
      sql += " AND type = ?";
      params.push(String(type).toUpperCase());
    }
    if (category) {
      sql += " AND category = ?";
      params.push(String(category));
    }
    if (modality) {
      sql += " AND UPPER(COALESCE(applies_to_modalities, '')) LIKE ?";
      params.push(`%${String(modality).trim().toUpperCase()}%`);
    }
    if (q && q.trim() !== "") {
      sql += " AND (name LIKE ? OR sku LIKE ? OR brand LIKE ? OR category LIKE ? OR description LIKE ?)";
      const like = `%${q.trim()}%`;
      params.push(like, like, like, like, like);
    }

    sql += " ORDER BY active DESC, name ASC";
    sql += " LIMIT ?";
    params.push(limit);

    const [rows] = await db.query(sql, params);
    res.json((rows || []).map((row) => ({ ...row, applies_to_modalities: parseModalities(row.applies_to_modalities) })));
  } catch (e) {
    console.error("[catalog:list] Error:", e);
    res.status(500).json({ error: "List failed" });
  }
});

router.get("/catalog/items/:id", async (req, res) => {
  try {
    await ensureCatalogSchema();
    const id = toInt(req.params.id, 0);
    const [[row]] = await db.query(
      `SELECT id,
              type,
              sku,
              name,
              brand,
              category,
              description,
              applies_to_modalities,
              unit,
              currency,
              price,
              tax_rate,
              active,
              created_at,
              updated_at
         FROM catalog_items
        WHERE id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ ...row, applies_to_modalities: parseModalities(row.applies_to_modalities) });
  } catch (e) {
    console.error("[catalog:get] Error:", e);
    res.status(500).json({ error: "Get failed" });
  }
});

router.post("/catalog/items", async (req, res) => {
  try {
    await ensureCatalogSchema();
    const b = req.body || {};
    const [r] = await db.query(
      `INSERT INTO catalog_items
       (type, sku, name, brand, category, description, applies_to_modalities, unit, currency, price, tax_rate, active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        (b.type || "PRODUCTO").toUpperCase(),
        b.sku || null,
        b.name || "",
        b.brand || null,
        normalizeCategory(b.category),
        b.description || null,
        normalizeModalities(b.applies_to_modalities),
        b.unit || null,
        (b.currency || "USD").toUpperCase(),
        b.price ?? null,
        b.tax_rate ?? null,
        toBool01(b.active ?? 1),
      ]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    console.error("[catalog:create] Error:", e);
    res.status(400).json({ error: "Create failed" });
  }
});

router.put("/catalog/items/:id", async (req, res) => {
  try {
    await ensureCatalogSchema();
    const id = toInt(req.params.id, 0);
    const b = req.body || {};
    await db.query(
      `UPDATE catalog_items
          SET type = ?,
              sku = ?,
              name = ?,
              brand = ?,
              category = ?,
              description = ?,
              applies_to_modalities = ?,
              unit = ?,
              currency = ?,
              price = ?,
              tax_rate = ?,
              active = ?
        WHERE id = ?`,
      [
        (b.type || "PRODUCTO").toUpperCase(),
        b.sku || null,
        b.name || "",
        b.brand || null,
        normalizeCategory(b.category),
        b.description || null,
        normalizeModalities(b.applies_to_modalities),
        b.unit || null,
        (b.currency || "USD").toUpperCase(),
        b.price ?? null,
        b.tax_rate ?? null,
        toBool01(b.active ?? 1),
        id,
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[catalog:update] Error:", e);
    res.status(400).json({ error: "Update failed" });
  }
});

router.delete("/catalog/items/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    await db.query(`DELETE FROM catalog_items WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[catalog:delete] Error:", e);
    res.status(400).json({ error: "Delete failed" });
  }
});

export default router;
