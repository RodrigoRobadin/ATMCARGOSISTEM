// server/src/routes/dealsCostSheet.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// Helper para parsear JSON sin romper
function safeParseJSON(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// ============== GET: devuelve data como OBJETO ==============
router.get('/:id/cost-sheet', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const [[row]] = await pool.query(
      `SELECT dcs.data, dcs.updated_at, dcs.updated_by, u.name AS updated_by_name
       FROM deal_cost_sheets dcs
       LEFT JOIN users u ON u.id = dcs.updated_by
       WHERE dcs.deal_id = ?
       LIMIT 1`,
      [id]
    );

    if (!row) {
      return res.json({ data: null, updated_at: null, updated_by: null, updated_by_name: null });
    }

    const data = safeParseJSON(row.data);
    return res.json({
      data: data ?? null,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
      updated_by_name: row.updated_by_name ?? null,
    });
  } catch (err) {
    console.error('[cost-sheet][GET] error', err);
    return res.status(500).json({ error: 'Error al obtener planilla' });
  }
});

// ============== PUT: guarda objeto y respeta bloqueo ==============
router.put('/:id/cost-sheet', requireAuth, async (req, res) => {
  const { id } = req.params;
  const data = (req.body && typeof req.body === 'object') ? req.body : {};

  try {
    // Deal y org
    const [[deal]] = await pool.query('SELECT org_id FROM deals WHERE id = ? LIMIT 1', [id]);
    if (!deal) return res.status(404).json({ error: 'Deal no encontrado' });

    // Estado de presupuesto
    const [[org]] = await pool.query(
      'SELECT budget_status FROM organizations WHERE id = ? LIMIT 1',
      [deal.org_id]
    );
    const locked = org && (org.budget_status === 'bloqueado' || org.budget_status === 'confirmado');
    if (locked && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Presupuesto bloqueado' });
    }

    // Upsert
    await pool.query(
      `INSERT INTO deal_cost_sheets (deal_id, data, updated_by, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         data = VALUES(data),
         updated_by = VALUES(updated_by),
         updated_at = NOW()`,
      [id, JSON.stringify(data), req.user.id]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[cost-sheet][PUT] error', err);
    return res.status(500).json({ error: 'Error al guardar planilla' });
  }
});

export default router;
