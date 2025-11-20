// server/src/routes/industrialDoors.js
import { Router } from "express";
import db from "../services/db.js";
import multer from "multer";
import fs from "fs";
import path from "path";

const router = Router();

function toInt(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// Configuración de multer para imágenes de puertas
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const doorId = String(req.params.doorId);
    const dir = path.resolve("uploads", "industrial-doors", doorId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || "");
    const base = path
      .basename(file.originalname || "file", ext)
      .replace(/\s+/g, "_")
      .slice(0, 80);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${base}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Solo permitir imágenes
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes (JPEG, PNG, GIF, WEBP)"));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
});

/**
 * GET /api/deals/:dealId/industrial-doors
 * Lista todas las puertas / productos industriales de una operación
 */
router.get("/deals/:dealId/industrial-doors", async (req, res) => {
  try {
    const dealId = toInt(req.params.dealId, 0);
    if (!dealId) return res.status(400).json({ error: "dealId inválido" });

    const [rows] = await db.query(
      `
      SELECT id,
             deal_id,
             product_id,
             product_name,
             brand,
             identifier,
             width_available,
             height_available,
             side_install,
             overheight_available,
             frame_type,
             canvas_type,
             frame_material,
             finish,
             clearance_right,
             clearance_left,
             motor_side,
             actuators,
             visor_lines,
             right_leg,
             notes,
             created_at,
             updated_at
        FROM industrial_doors
       WHERE deal_id = ?
       ORDER BY id ASC
      `,
      [dealId]
    );

    // Para cada puerta, obtener sus imágenes
    for (const door of rows) {
      const [images] = await db.query(
        `SELECT id, filename, url, created_at 
         FROM industrial_door_images 
         WHERE door_id = ? 
         ORDER BY created_at ASC`,
        [door.id]
      );
      door.images = images || [];
    }

    res.json(rows);
  } catch (e) {
    console.error("[industrial-doors:list] Error:", e);
    res.status(500).json({ error: "List failed" });
  }
});

/**
 * POST /api/deals/:dealId/industrial-doors
 * Crea UNA puerta inicial para la operación (normalmente desde el modal de alta).
 * Body mínimo esperado: { product_id, identifier? }
 */
router.post("/deals/:dealId/industrial-doors", async (req, res) => {
  try {
    const dealId = toInt(req.params.dealId, 0);
    if (!dealId) return res.status(400).json({ error: "dealId inválido" });

    const b = req.body || {};
    const productId = toInt(b.product_id, 0);

    let productName = b.product_name || null;
    let brand = b.brand || null;

    if (productId) {
      const [[prod]] = await db.query(
        "SELECT name, brand FROM catalog_items WHERE id = ?",
        [productId]
      );
      if (prod) {
        if (!productName) productName = prod.name || null;
        if (!brand) brand = prod.brand || null;
      }
    }

    const identifier = b.identifier || null;

    const [r] = await db.query(
      `
      INSERT INTO industrial_doors
        (deal_id, product_id, product_name, brand, identifier)
      VALUES (?,?,?,?,?)
      `,
      [dealId, productId || null, productName, brand, identifier]
    );

    res.status(201).json({ id: r.insertId });
  } catch (e) {
    console.error("[industrial-doors:create] Error:", e);
    res.status(400).json({ error: "Create failed" });
  }
});

/**
 * PUT /api/industrial-doors/:id
 * Actualiza TODOS los campos de una puerta (desde detalle de operación)
 */
router.put("/industrial-doors/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const b = req.body || {};

    await db.query(
      `
      UPDATE industrial_doors
         SET identifier          = ?,
             width_available     = ?,
             height_available    = ?,
             side_install        = ?,
             overheight_available= ?,
             frame_type          = ?,
             canvas_type         = ?,
             frame_material      = ?,
             finish              = ?,
             clearance_right     = ?,
             clearance_left      = ?,
             motor_side          = ?,
             actuators           = ?,
             visor_lines         = ?,
             right_leg           = ?,
             notes               = ?
       WHERE id = ?
      `,
      [
        b.identifier || null,
        b.width_available ?? null,
        b.height_available ?? null,
        b.side_install || null,
        b.overheight_available ?? null,
        b.frame_type || null,
        b.canvas_type || null,
        b.frame_material || null,
        b.finish || null,
        b.clearance_right ?? null,
        b.clearance_left ?? null,
        b.motor_side || null,
        b.actuators || null,
        b.visor_lines || null,
        b.right_leg || null,
        b.notes || null,
        id,
      ]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("[industrial-doors:update] Error:", e);
    res.status(400).json({ error: "Update failed" });
  }
});

/**
 * DELETE /api/industrial-doors/:id
 * Permite eliminar una puerta de la operación (si hizo mal el pedido, etc.)
 */
router.delete("/industrial-doors/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ error: "id inválido" });

    // Eliminar imágenes asociadas
    const [images] = await db.query(
      "SELECT filename FROM industrial_door_images WHERE door_id = ?",
      [id]
    );

    for (const img of images) {
      const absPath = path.resolve("uploads", "industrial-doors", String(id), img.filename);
      try {
        fs.unlinkSync(absPath);
      } catch (_) {
        // Ignorar si no existe
      }
    }

    await db.query("DELETE FROM industrial_door_images WHERE door_id = ?", [id]);
    await db.query("DELETE FROM industrial_doors WHERE id = ?", [id]);

    res.json({ ok: true });
  } catch (e) {
    console.error("[industrial-doors:delete] Error:", e);
    res.status(400).json({ error: "Delete failed" });
  }
});

/**
 * POST /api/industrial-doors/:doorId/images
 * Sube una imagen para una puerta industrial
 */
router.post("/industrial-doors/:doorId/images", upload.single("image"), async (req, res) => {
  try {
    const doorId = toInt(req.params.doorId, 0);
    if (!doorId) return res.status(400).json({ error: "doorId inválido" });
    if (!req.file) return res.status(400).json({ error: "No se recibió imagen" });

    const relUrl = `/uploads/industrial-doors/${doorId}/${req.file.filename}`;

    const [ins] = await db.query(
      `INSERT INTO industrial_door_images (door_id, filename, url) VALUES (?,?,?)`,
      [doorId, req.file.filename, relUrl]
    );

    res.status(201).json({
      id: ins.insertId,
      door_id: doorId,
      filename: req.file.filename,
      url: relUrl,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[industrial-doors:upload-image] Error:", e);
    res.status(500).json({ error: "No se pudo subir la imagen" });
  }
});

/**
 * GET /api/industrial-doors/:doorId/images
 * Lista las imágenes de una puerta
 */
router.get("/industrial-doors/:doorId/images", async (req, res) => {
  try {
    const doorId = toInt(req.params.doorId, 0);
    if (!doorId) return res.status(400).json({ error: "doorId inválido" });

    const [rows] = await db.query(
      `SELECT id, door_id, filename, url, created_at 
       FROM industrial_door_images 
       WHERE door_id = ? 
       ORDER BY created_at ASC`,
      [doorId]
    );

    res.json(rows);
  } catch (e) {
    console.error("[industrial-doors:list-images] Error:", e);
    res.status(500).json({ error: "No se pudieron listar las imágenes" });
  }
});

/**
 * DELETE /api/industrial-doors/:doorId/images/:imageId
 * Elimina una imagen de una puerta
 */
router.delete("/industrial-doors/:doorId/images/:imageId", async (req, res) => {
  try {
    const doorId = toInt(req.params.doorId, 0);
    const imageId = toInt(req.params.imageId, 0);

    if (!doorId || !imageId) {
      return res.status(400).json({ error: "IDs inválidos" });
    }

    const [[img]] = await db.query(
      "SELECT filename FROM industrial_door_images WHERE id = ? AND door_id = ?",
      [imageId, doorId]
    );

    if (!img) return res.status(404).json({ error: "Imagen no encontrada" });

    const absPath = path.resolve("uploads", "industrial-doors", String(doorId), img.filename);
    try {
      fs.unlinkSync(absPath);
    } catch (_) {
      // Ignorar si no existe
    }

    await db.query("DELETE FROM industrial_door_images WHERE id = ?", [imageId]);

    res.json({ ok: true });
  } catch (e) {
    console.error("[industrial-doors:delete-image] Error:", e);
    res.status(500).json({ error: "No se pudo eliminar la imagen" });
  }
});

// Asegurar tabla de imágenes
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS industrial_door_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        door_id INT NOT NULL,
        filename VARCHAR(255) NOT NULL,
        url VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX(door_id),
        CONSTRAINT fk_door_images_door
          FOREIGN KEY (door_id) REFERENCES industrial_doors(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error("No se pudo asegurar la tabla industrial_door_images:", e);
  }
})();

export default router;