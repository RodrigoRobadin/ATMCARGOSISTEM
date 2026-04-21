// server/src/routes/admin.js
import { Router } from "express";
import db from "../services/db.js";

const router = Router();
let invoiceHasServiceCaseId = null;

async function q1(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows?.[0] || null;
}

async function hasInvoiceServiceCaseId() {
  if (invoiceHasServiceCaseId !== null) return invoiceHasServiceCaseId;
  try {
    const [rows] = await db.query(
      `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'invoices'
        AND COLUMN_NAME = 'service_case_id'
      `
    );
    invoiceHasServiceCaseId = rows.length > 0;
  } catch {
    invoiceHasServiceCaseId = false;
  }
  return invoiceHasServiceCaseId;
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

    const hasSvc = await hasInvoiceServiceCaseId();
    const serviceInvSelect = hasSvc
      ? `SELECT
         service_case_id,
         GROUP_CONCAT(invoice_number ORDER BY id DESC SEPARATOR ', ') AS invoice_numbers,
         GROUP_CONCAT(status ORDER BY id DESC SEPARATOR ', ') AS invoice_statuses
       FROM invoices
       WHERE status <> 'anulada'
       GROUP BY service_case_id`
      : `SELECT
         NULL AS service_case_id,
         NULL AS invoice_numbers,
         NULL AS invoice_statuses
       FROM invoices
       WHERE 1=0`;

    const [rows] = await db.query(
      `SELECT
         d.id,
         CONVERT(d.reference USING utf8mb4) COLLATE utf8mb4_unicode_ci AS reference,
         CONVERT(d.transport_type USING utf8mb4) COLLATE utf8mb4_unicode_ci AS transport_type,
         CONVERT(d.status_ops USING utf8mb4) COLLATE utf8mb4_unicode_ci AS status_ops,
         d.stage_id,
         CONVERT(s.name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS stage_name,
         s.order_index AS stage_order_index,
         CONVERT(o.name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS org_name,
         CONVERT(c.name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS contact_name,
         d.updated_at,
         d.value,
         d.business_unit_id,
         CONVERT(bu.name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS business_unit_name,
         CONVERT(bu.key_slug USING utf8mb4) COLLATE utf8mb4_unicode_ci AS business_unit_key,
         CONVERT(inv.invoice_numbers USING utf8mb4) COLLATE utf8mb4_unicode_ci AS invoice_numbers,
         CONVERT(inv.invoice_statuses USING utf8mb4) COLLATE utf8mb4_unicode_ci AS invoice_statuses,
         CASE WHEN s.name = 'En transito' THEN 1 ELSE 0 END AS in_transit,
         'deal' COLLATE utf8mb4_unicode_ci AS op_type,
         NULL AS service_stage_id
       FROM deals d
       JOIN stages s             ON s.id = d.stage_id AND s.pipeline_id = d.pipeline_id
       LEFT JOIN organizations o ON o.id = d.org_id
       LEFT JOIN contacts      c ON c.id = d.contact_id
       LEFT JOIN business_units bu ON bu.id = d.business_unit_id
       LEFT JOIN (
         SELECT
           deal_id,
           GROUP_CONCAT(invoice_number ORDER BY id DESC SEPARATOR ', ') AS invoice_numbers,
           GROUP_CONCAT(status ORDER BY id DESC SEPARATOR ', ') AS invoice_statuses
         FROM invoices
         WHERE status <> 'anulada'
         GROUP BY deal_id
       ) inv ON inv.deal_id = d.id
       WHERE d.pipeline_id = ?
         AND s.order_index >= ?

       UNION ALL

       SELECT
         sc.id,
         CONVERT(sc.reference USING utf8mb4) COLLATE utf8mb4_unicode_ci AS reference,
         'SERVICE' COLLATE utf8mb4_unicode_ci AS transport_type,
         CONVERT(sc.status USING utf8mb4) COLLATE utf8mb4_unicode_ci AS status_ops,
         s2.id AS stage_id,
         CONVERT(s2.name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS stage_name,
         s2.order_index AS stage_order_index,
         CONVERT(o.name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS org_name,
         NULL AS contact_name,
         sc.updated_at,
         0 AS value,
         NULL AS business_unit_id,
         'Servicios y mantenimiento' COLLATE utf8mb4_unicode_ci AS business_unit_name,
         'services' COLLATE utf8mb4_unicode_ci AS business_unit_key,
         CONVERT(inv2.invoice_numbers USING utf8mb4) COLLATE utf8mb4_unicode_ci AS invoice_numbers,
         CONVERT(inv2.invoice_statuses USING utf8mb4) COLLATE utf8mb4_unicode_ci AS invoice_statuses,
         CASE WHEN s2.name = 'En transito' THEN 1 ELSE 0 END AS in_transit,
         'service' COLLATE utf8mb4_unicode_ci AS op_type,
         ss.id AS service_stage_id
       FROM service_cases sc
       JOIN service_stages ss ON ss.id = sc.stage_id AND ss.pipeline_id = sc.pipeline_id
       JOIN stages s2          ON s2.pipeline_id = ? AND s2.name COLLATE utf8mb4_unicode_ci = ss.name COLLATE utf8mb4_unicode_ci
       LEFT JOIN organizations o ON o.id = sc.org_id
       LEFT JOIN (
         ${serviceInvSelect}
       ) inv2 ON inv2.service_case_id = sc.id
       WHERE sc.pipeline_id = ?
         AND s2.order_index >= ?

       ORDER BY stage_order_index ASC, updated_at DESC`,
      [pipelineId, anchor.order_index, pipelineId, pipelineId, anchor.order_index]
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

    let { stage_id, stage_name, pipeline_id, op_type } = req.body || {};
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

    if (String(op_type || '').toLowerCase() === 'service') {
      const svc = await q1(`SELECT id, pipeline_id FROM service_cases WHERE id = ?`, [opId]);
      if (!svc) return res.status(404).json({ error: "OP_NOT_FOUND" });
      const serviceStage = await q1(
        `SELECT id, name, pipeline_id FROM service_stages WHERE pipeline_id = ? AND name = ? LIMIT 1`,
        [svc.pipeline_id, targetStage.name]
      );
      if (!serviceStage) {
        return res.status(400).json({
          error: "STAGE_NOT_FOUND",
          detail: "No existe la etapa equivalente en service_stages.",
        });
      }
      await db.query(`UPDATE service_cases SET stage_id = ?, updated_at = NOW() WHERE id = ?`, [
        serviceStage.id,
        opId,
      ]);
      const row = await q1(
        `SELECT
           sc.id,
           sc.reference,
           'SERVICE' AS transport_type,
           sc.status AS status_ops,
           s2.id AS stage_id,
           s2.name AS stage_name,
           s2.order_index AS stage_order_index,
           o.name AS org_name,
           NULL AS contact_name,
           sc.updated_at,
           0 AS value,
           CASE WHEN s2.name = 'En transito' THEN 1 ELSE 0 END AS in_transit,
           'service' AS op_type,
           ss.id AS service_stage_id
         FROM service_cases sc
         JOIN service_stages ss ON ss.id = sc.stage_id AND ss.pipeline_id = sc.pipeline_id
         JOIN stages s2          ON s2.pipeline_id = ? AND s2.name = ss.name
         LEFT JOIN organizations o ON o.id = sc.org_id
         WHERE sc.id = ?
         LIMIT 1`,
        [targetStage.pipeline_id, opId]
      );
      return res.json(row);
    }

    // Validar que la operaci?n exista y pertenezca al mismo pipeline
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
         CASE WHEN s.name = 'En transito' THEN 1 ELSE 0 END AS in_transit,
         'deal' AS op_type,
         NULL AS service_stage_id
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
