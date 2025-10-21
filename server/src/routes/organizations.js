// server/src/routes/organizations.js
import { Router } from 'express';
import db from '../services/db.js';

import { requireAuth, requireRole } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
const toNull = (v) => (v === '' || typeof v === 'undefined' ? null : v);

/* ===================== LISTAR ===================== */
router.get('/', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const [rows] = await db.query(
      `
      SELECT
        id,
        razon_social,
        name,
        industry, phone, website, ruc, address, city, country,
        label, owner_user_id, visibility, notes,
        is_agent, modalities_supported,
        email, rubro, tipo_org, operacion,
        created_at, updated_at,
        budget_status,
        budget_profit AS budget_profit_value,
        NULL AS advisor_name
      FROM organizations
      ORDER BY name ASC
      LIMIT ? OFFSET ?
      `,
      [limit, offset]
    );

    res.json(rows);
  } catch (e) {
    console.error('[organizations:list]', e);
    res.status(500).json({ error: 'List failed' });
  }
});

/* ===================== CREAR ===================== */
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      razon_social,         // requerido (o se toma name)
      name,
      industry = null, phone = null, website = null, ruc = null, address = null,
      city = null, country = null, notes = null,
      // legacy (compat)
      label = null, owner_user_id = null, visibility = 'company',
      is_agent = 0, modalities_supported = null,
      // nuevos
      email = null, rubro = null, tipo_org = null, operacion = null,
    } = req.body || {};

    const rs = String(razon_social || '').trim() || String(name || '').trim();
    if (!rs) return res.status(400).json({ error: 'razon_social es requerido' });

    const [ins] = await db.query(
      `
      INSERT INTO organizations
        (razon_social, name, industry, phone, website, ruc, address, city, country, notes,
         label, owner_user_id, visibility, is_agent, modalities_supported,
         email, rubro, tipo_org, operacion,
         budget_status, budget_profit, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         'borrador', NULL, NOW(), NOW())
      `,
      [
        rs, rs, industry, phone, website, ruc, address, city, country, notes,
        label, owner_user_id, visibility, is_agent ? 1 : 0, modalities_supported,
        email, rubro, tipo_org, operacion
      ]
    );

    const [[row]] = await db.query(
      `
      SELECT
        id,
        razon_social, name,
        industry, phone, website, ruc, address, city, country,
        label, owner_user_id, visibility, notes,
        is_agent, modalities_supported,
        email, rubro, tipo_org, operacion,
        created_at, updated_at,
        budget_status, budget_profit AS budget_profit_value,
        NULL AS advisor_name
      FROM organizations
      WHERE id = ?
      `,
      [ins.insertId]
    );

    await logAudit({
      req, action: 'create', entity: 'organization', entityId: row.id,
      description: `Creó organización ${row.name}`, meta: { payload: req.body }
    });

    res.status(201).json(row);
  } catch (e) {
    console.error('[organizations:post]', e);
    res.status(400).json({ error: 'Create failed' });
  }
});

/* ===================== DETALLE ===================== */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [[org]] = await db.query(
      `
      SELECT
        id,
        razon_social, name,
        industry, phone, website, ruc, address, city, country,
        label, owner_user_id, visibility, notes,
        is_agent, modalities_supported,
        email, rubro, tipo_org, operacion,
        created_at, updated_at,
        budget_status, budget_profit AS budget_profit_value,
        NULL AS advisor_name
      FROM organizations
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    const [contacts] = await db.query(
      `SELECT id, name, email, phone, title FROM contacts WHERE org_id = ? ORDER BY name`,
      [id]
    );

    res.json({ ...org, contacts });
  } catch (e) {
    console.error('[organizations:get]', e);
    res.status(500).json({ error: 'Get failed' });
  }
});

/* ===================== ACTUALIZAR ===================== */
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = [
      'razon_social','name','industry','phone','website','ruc','address','city','country',
      'label','owner_user_id','visibility','notes',
      'is_agent','modalities_supported',
      'email','rubro','tipo_org','operacion'
    ];

    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        sets.push(`\`${k}\` = ?`);
        params.push(toNull(req.body[k]));
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

    sets.push('updated_at = NOW()');
    params.push(id);

    const [r] = await db.query(
      `UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });

    const [[row]] = await db.query(
      `
      SELECT
        id,
        razon_social, name,
        industry, phone, website, ruc, address, city, country,
        label, owner_user_id, visibility, notes,
        is_agent, modalities_supported,
        email, rubro, tipo_org, operacion,
        created_at, updated_at,
        budget_status, budget_profit AS budget_profit_value,
        NULL AS advisor_name
      FROM organizations
      WHERE id = ?
      `,
      [id]
    );

    await logAudit({
      req, action: 'update', entity: 'organization', entityId: Number(id),
      description: 'Actualizó organización', meta: { patch: req.body }
    });

    res.json(row);
  } catch (e) {
    console.error('[organizations:patch]', e);
    res.status(400).json({ error: 'Update failed' });
  }
});

/* ===================== BORRAR ===================== */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [r] = await db.query(`DELETE FROM organizations WHERE id = ?`, [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });

    await logAudit({
      req, action: 'delete', entity: 'organization', entityId: Number(id),
      description: 'Eliminó organización'
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[organizations:delete]', e);
    res.status(400).json({ error: 'Delete failed' });
  }
});

/* ===================== PRESUPUESTO ===================== */
router.get('/:id/budget', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[org]] = await db.query(
      `SELECT id, budget_status, budget_profit FROM organizations WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    res.json({ id: org.id, budget_status: org.budget_status, budget_profit: org.budget_profit });
  } catch (e) {
    console.error('[organizations:budget:get]', e);
    res.status(500).json({ error: 'Get budget failed' });
  }
});

router.post('/:id/budget/lock', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [[org]] = await db.query(
      `SELECT id, budget_status FROM organizations WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    if (org.budget_status === 'confirmado') {
      return res.status(409).json({ error: 'Ya confirmado' });
    }

    await db.query(
      `UPDATE organizations
          SET budget_status = 'bloqueado',
              budget_updated_by = ?,
              budget_updated_at = NOW(),
              updated_at = NOW()
        WHERE id = ?`,
      [req.user.id, id]
    );

    await logAudit({
      req, action: 'update', entity: 'organization', entityId: Number(id),
      description: 'Bloqueó presupuesto'
    });

    res.json({ ok: true, budget_status: 'bloqueado' });
  } catch (e) {
    console.error('[organizations:budget:lock]', e);
    res.status(400).json({ error: 'Lock budget failed' });
  }
});

router.post('/:id/budget/confirm', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { profit_value } = req.body || {};

    const [[org]] = await db.query(
      `SELECT id, budget_status FROM organizations WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    if (org.budget_status === 'confirmado') {
      return res.json({ ok: true, budget_status: 'confirmado' });
    }

    await db.query(
      `UPDATE organizations
          SET budget_status = 'confirmado',
              budget_profit = ?,
              budget_updated_by = ?,
              budget_updated_at = NOW(),
              updated_at = NOW()
        WHERE id = ?`,
      [profit_value ?? null, req.user.id, id]
    );

    await logAudit({
      req, action: 'update', entity: 'organization', entityId: Number(id),
      description: 'Confirmó presupuesto', meta: { profit_value }
    });

    res.json({ ok: true, budget_status: 'confirmado', budget_profit: profit_value ?? null });
  } catch (e) {
    console.error('[organizations:budget:confirm]', e);
    res.status(400).json({ error: 'Confirm budget failed' });
  }
});

router.post('/:id/budget/reopen', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const [[org]] = await db.query(
      `SELECT id FROM organizations WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    await db.query(
      `UPDATE organizations
          SET budget_status = 'borrador',
              budget_updated_by = ?,
              budget_updated_at = NOW(),
              updated_at = NOW()
        WHERE id = ?`,
      [req.user.id, id]
    );

    await logAudit({
      req, action: 'update', entity: 'organization', entityId: Number(id),
      description: 'Reabrió presupuesto'
    });

    res.json({ ok: true, budget_status: 'borrador' });
  } catch (e) {
    console.error('[organizations:budget:reopen]', e);
    res.status(400).json({ error: 'Reopen budget failed' });
  }
});

export default router;
