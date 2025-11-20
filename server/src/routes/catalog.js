// server/src/routes/catalog.js
import { Router } from "express";
import db from "../services/db.js";

const router = Router();

/**
 * Normaliza valores varios
 */
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

/* ===================== LISTAR ===================== */
/**
 * GET /api/catalog/items
 * Filtros:
 *  - q: busca en name/sku
 *  - type: PRODUCTO | SERVICIO
 *  - active: 1|0
 *  - limit: máx 1000 (default 500)
 */
router.get("/catalog/items", async (req, res) => {
  try {
    const { q, type } = req.query;
    const active = toBool01(req.query.active);
    const limit = Math.min(toInt(req.query.limit, 500), 1000);

    let sql = `
      SELECT id,
             type,
             sku,
             name,
             brand,         -- 👈 NUEVO: se expone la marca
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
    if (q && q.trim() !== "") {
      sql += " AND (name LIKE ? OR sku LIKE ?)";
      const like = `%${q.trim()}%`;
      params.push(like, like);
    }

    sql += " ORDER BY active DESC, name ASC";
    sql += " LIMIT ?"; // bind del límite
    params.push(limit);

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error("[catalog:list] Error:", e);
    res.status(500).json({ error: "List failed" });
  }
});

/* ===================== OBTENER POR ID ===================== */
router.get("/catalog/items/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    const [[row]] = await db.query(
      `SELECT id,
              type,
              sku,
              name,
              brand,         -- 👈 NUEVO también en get-by-id
              description,
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
    res.json(row);
  } catch (e) {
    console.error("[catalog:get] Error:", e);
    res.status(500).json({ error: "Get failed" });
  }
});

/* ===================== CREAR ===================== */
router.post("/catalog/items", async (req, res) => {
  try {
    const b = req.body || {};
    const [r] = await db.query(
      `INSERT INTO catalog_items
       (type, sku, name, brand, description, unit, currency, price, tax_rate, active)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        (b.type || "PRODUCTO").toUpperCase(),
        b.sku || null,
        b.name || "",
        b.brand || null, // 👈 NUEVO: se inserta la marca
        b.description || null,
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

/* ===================== ACTUALIZAR ===================== */
router.put("/catalog/items/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    const b = req.body || {};
    await db.query(
      `UPDATE catalog_items
          SET type        = ?,
              sku         = ?,
              name        = ?,
              brand       = ?,   -- 👈 NUEVO: se actualiza la marca
              description = ?,
              unit        = ?,
              currency    = ?,
              price       = ?,
              tax_rate    = ?,
              active      = ?
        WHERE id = ?`,
      [
        (b.type || "PRODUCTO").toUpperCase(),
        b.sku || null,
        b.name || "",
        b.brand || null,
        b.description || null,
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

/* ===================== BORRAR ===================== */
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