// server/src/routes/admin.js
import { Router } from "express";
import db from "../services/db.js";

const router = Router();

async function q1(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows?.[0] || null;
}

/** Ping */
router.get("/ping", (req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

/** Listar etapas de un pipeline (para el selector de cambio de etapa) */
router.get("/stages", async (req, res) => {
  try {
    const pipelineId = Number(req.query.pipeline_id || 1);
    const [rows] = await db.query(
      `SELECT id, name, order_index
         FROM stages
        WHERE pipeline_id = ?
        ORDER BY order_index ASC`,
      [pipelineId]
    );
    res.json(rows || []);
  } catch (e) {
    console.error("[admin:stages] error", e);
    res.status(500).json({ error: "SERVER_ERROR", detail: e?.message });
  }
});

/**
 * Listar operaciones desde cierta etapa (incluida) en adelante
 * GET /api/admin/ops?pipeline_id=1&from_stage=Conf%20a%20Coord
 * Devuelve campo calculado in_transit (1 si la etapa actual se llama 'En transito')
 */
router.get("/ops", async (req, res) => {
  try {
    const pipelineId = Number(req.query.pipeline_id || 1);
    const fromStage = String(req.query.from_stage || "Conf a Coord");

    const anchor = await q1(
      `SELECT id, name, order_index
         FROM stages
        WHERE pipeline_id = ? AND name = ?
        LIMIT 1`,
      [pipelineId, fromStage]
    );
    if (!anchor) {
      return res.status(404).json({
        error: "STAGE_NOT_FOUND",
        detail: `No existe la etapa '${fromStage}' en el pipeline ${pipelineId}.`,
      });
    }

    const [rows] = await db.query(
      `SELECT
         d.id,
         d.reference,
         d.transport_type,
         d.status_ops,
         d.stage_id,
         s.name        AS stage_name,
         s.order_index AS stage_order_index,
         o.name        AS org_name,
         c.name        AS contact_name,
         d.updated_at,
         d.value,
         CASE WHEN s.name = 'En transito' THEN 1 ELSE 0 END AS in_transit
       FROM deals d
       JOIN stages s             ON s.id = d.stage_id AND s.pipeline_id = d.pipeline_id
       LEFT JOIN organizations o ON o.id = d.org_id
       LEFT JOIN contacts      c ON c.id = d.contact_id
       WHERE d.pipeline_id = ?
         AND s.order_index >= ?
       ORDER BY s.order_index ASC, d.updated_at DESC`,
      [pipelineId, anchor.order_index]
    );

    res.json(rows || []);
  } catch (e) {
    console.error("[admin:ops] error", e);
    res.status(500).json({ error: "SERVER_ERROR", detail: e?.message });
  }
});

/**
 * Cambiar la etapa de una operación
 * PATCH /api/admin/ops/:id/stage
 * body: { stage_id }  o  { stage_name, pipeline_id }
 */
router.patch("/ops/:id/stage", async (req, res) => {
  try {
    const opId = Number(req.params.id || 0);
    if (!opId) return res.status(400).json({ error: "BAD_ID" });

    let { stage_id, stage_name, pipeline_id } = req.body || {};
    let targetStage = null;

    if (stage_id) {
      targetStage = await q1(`SELECT id, name, pipeline_id FROM stages WHERE id = ?`, [stage_id]);
      if (!targetStage) return res.status(404).json({ error: "STAGE_NOT_FOUND" });
    } else if (stage_name) {
      const pid = Number(pipeline_id || 1);
      targetStage = await q1(
        `SELECT id, name, pipeline_id FROM stages WHERE pipeline_id = ? AND name = ? LIMIT 1`,
        [pid, stage_name]
      );
      if (!targetStage) {
        return res.status(404).json({
          error: "STAGE_NOT_FOUND",
          detail: `No existe la etapa '${stage_name}' en el pipeline ${pid}.`,
        });
      }
    } else {
      return res.status(400).json({ error: "MISSING_STAGE" });
    }

    // Validar que la operación exista y pertenezca al mismo pipeline
    const deal = await q1(`SELECT id, pipeline_id FROM deals WHERE id = ?`, [opId]);
    if (!deal) return res.status(404).json({ error: "OP_NOT_FOUND" });
    if (deal.pipeline_id !== targetStage.pipeline_id) {
      return res.status(400).json({
        error: "PIPELINE_MISMATCH",
        detail: "La etapa seleccionada pertenece a otro pipeline.",
      });
    }

    // Actualizar etapa
    await db.query(`UPDATE deals SET stage_id = ?, updated_at = NOW() WHERE id = ?`, [
      targetStage.id,
      opId,
    ]);

    // Devolver fila actualizada (con in_transit recalculado)
    const row = await q1(
      `SELECT
         d.id,
         d.reference,
         d.transport_type,
         d.status_ops,
         d.stage_id,
         s.name        AS stage_name,
         s.order_index AS stage_order_index,
         o.name        AS org_name,
         c.name        AS contact_name,
         d.updated_at,
         d.value,
         CASE WHEN s.name = 'En transito' THEN 1 ELSE 0 END AS in_transit
       FROM deals d
       JOIN stages s             ON s.id = d.stage_id AND s.pipeline_id = d.pipeline_id
       LEFT JOIN organizations o ON o.id = d.org_id
       LEFT JOIN contacts      c ON c.id = d.contact_id
       WHERE d.id = ?
       LIMIT 1`,
      [opId]
    );

    res.json(row);
  } catch (e) {
    console.error("[admin:ops:patch-stage] error", e);
    res.status(500).json({ error: "SERVER_ERROR", detail: e?.message });
  }
});

export default router;
