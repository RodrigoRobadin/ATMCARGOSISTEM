// server/src/routes/organizations.js
import { Router } from 'express';
import db from '../services/db.js';

import { requireAuth, requireRole } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
const toNull = (v) => (v === '' || typeof v === 'undefined' ? null : v);

/* ========= Auto-migración: asegurar columna hoja_ruta ========= */
(async () => {
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations'
    `);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));

    if (!have.has('hoja_ruta')) {
      await db.query(`
        ALTER TABLE organizations
        ADD COLUMN hoja_ruta TEXT NULL AFTER operacion
      `);
      console.log('[organizations] Columna hoja_ruta agregada');
    }
  } catch (e) {
    console.error('[organizations] No se pudo asegurar columna hoja_ruta:', e?.message || e);
  }
})();

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
        email, rubro, tipo_org, operacion, hoja_ruta,
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
      razon_social, // requerido (o se toma name)
      name,
      industry = null,
      phone = null,
      website = null,
      ruc = null,
      address = null,
      city = null,
      country = null,
      notes = null,
      // legacy (compat)
      label = null,
      owner_user_id = null,
      visibility = 'company',
      is_agent = 0,
      modalities_supported = null,
      // nuevos
      email = null,
      rubro = null,
      tipo_org = null,
      operacion = null,
      hoja_ruta = null,
    } = req.body || {};

    const rs = String(razon_social || '').trim() || String(name || '').trim();
    if (!rs) return res.status(400).json({ error: 'razon_social es requerido' });

    const [ins] = await db.query(
      `
      INSERT INTO organizations
        (razon_social, name, industry, phone, website, ruc, address, city, country, notes,
         label, owner_user_id, visibility, is_agent, modalities_supported,
         email, rubro, tipo_org, operacion, hoja_ruta,
         budget_status, budget_profit, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         'borrador', NULL, NOW(), NOW())
      `,
      [
        rs,
        rs,
        industry,
        phone,
        website,
        ruc,
        address,
        city,
        country,
        notes,
        owner_user_id,
        owner_user_id,
        visibility,
        is_agent ? 1 : 0,
        modalities_supported,
        email,
        rubro,
        tipo_org,
        operacion,
        hoja_ruta,
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
        email, rubro, tipo_org, operacion, hoja_ruta,
        created_at, updated_at,
        budget_status, budget_profit AS budget_profit_value,
        NULL AS advisor_name
      FROM organizations
      WHERE id = ?
      `,
      [ins.insertId]
    );

    await logAudit({
      req,
      action: 'create',
      entity: 'organization',
      entityId: row.id,
      description: `Creó organización ${row.name}`,
      meta: { payload: req.body },
    });

    res.status(201).json(row);
  } catch (e) {
    console.error('[organizations:post]', e);
    res.status(400).json({ error: 'Create failed' });
  }
});

/* ===================== FLETE: BÚSQUEDA DE PROVEEDORES ===================== */
// GET /organizations/search-flete-providers?modalidad=aereo&origin=XXX&destination=YYY
router.get('/search-flete-providers', requireAuth, async (req, res) => {
  try {
    let { modalidad, origin, destination, origin_country, destination_country } = req.query || {};
    modalidad = (modalidad || '').toLowerCase().trim();
    origin = (origin || '').trim();
    destination = (destination || '').trim();
    origin_country = (origin_country || '').trim();
    destination_country = (destination_country || '').trim();

    if (!modalidad) {
      return res
        .status(400)
        .json({ error: 'modalidad es requerida (aereo/maritimo/terrestre)' });
    }

    const params = [];
    let sql = `
      SELECT
        o.id             AS org_id,
        o.razon_social,
        o.name,
        o.email,
        o.phone,
        o.country,
        o.city,
        r.id             AS route_id,
        r.modality,
        r.origin,
        r.destination,
        r.origin_country,
        r.destination_country,
        r.notes,
        r.created_at,
        r.updated_at
      FROM org_flete_routes r
      JOIN organizations o ON o.id = r.org_id
      WHERE (o.deleted_at IS NULL OR o.deleted_at IS NULL)
        AND (o.rubro = 'flete' OR o.tipo_org = 'flete' OR o.operacion = 'flete' OR o.rubro LIKE '%FLETE%')
        AND r.modality = ?
    `;
    params.push(modalidad);

    if (origin) {
      sql += `
        AND (
          r.origin IS NULL
          OR r.origin = ''
          OR r.origin LIKE CONCAT('%', ?, '%')
          OR (r.origin_country IS NOT NULL AND r.origin_country LIKE CONCAT('%', ?, '%'))
        )
      `;
      params.push(origin, origin);
    }

    if (destination) {
      sql += `
        AND (
          r.destination IS NULL
          OR r.destination = ''
          OR r.destination LIKE CONCAT('%', ?, '%')
          OR (r.destination_country IS NOT NULL AND r.destination_country LIKE CONCAT('%', ?, '%'))
        )
      `;
      params.push(destination, destination);
    }

    sql += ` ORDER BY o.name ASC, r.origin ASC, r.destination ASC`;

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('[organizations:search-flete-providers]', e);
    res.status(500).json({ error: 'Search flete providers failed' });
  }
});

/* ===================== FLETE: RUTAS POR ORGANIZACIÓN ===================== */
// GET /organizations/:id/flete-routes
router.get('/:id/flete-routes', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `
      SELECT
        id,
        org_id,
        modality,
        origin,
        destination,
        origin_country,
        destination_country,
        notes,
        created_at,
        updated_at
      FROM org_flete_routes
      WHERE org_id = ?
      ORDER BY modality ASC, origin ASC, destination ASC
      `,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error('[organizations:flete-routes:list]', e);
    res.status(500).json({ error: 'List flete routes failed' });
  }
});

// POST /organizations/:id/flete-routes
router.post('/:id/flete-routes', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    let {
      modality,
      origin = null,
      destination = null,
      origin_country = null,
      destination_country = null,
      notes = null,
    } = req.body || {};

    modality = (modality || '').toLowerCase().trim();
    if (!['aereo', 'maritimo', 'terrestre'].includes(modality)) {
      return res
        .status(400)
        .json({ error: 'modality debe ser aereo, maritimo o terrestre' });
    }

    const [orgRows] = await db.query(
      `SELECT id, name FROM organizations WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!orgRows.length)
      return res.status(404).json({ error: 'Organización no encontrada' });

    const [ins] = await db.query(
      `
      INSERT INTO org_flete_routes
        (org_id, modality, origin, destination, origin_country, destination_country, notes, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        id,
        modality,
        origin || null,
        destination || null,
        origin_country || null,
        destination_country || null,
        notes || null,
      ]
    );

    const [[row]] = await db.query(
      `SELECT id, org_id, modality, origin, destination, origin_country, destination_country, notes, created_at, updated_at
       FROM org_flete_routes WHERE id = ?`,
      [ins.insertId]
    );

    await logAudit({
      req,
      action: 'create',
      entity: 'org_flete_route',
      entityId: row.id,
      description: `Creó ruta de flete para org #${id}`,
      meta: { payload: req.body },
    });

    res.status(201).json(row);
  } catch (e) {
    console.error('[organizations:flete-routes:post]', e);
    res.status(400).json({ error: 'Create flete route failed' });
  }
});

// DELETE /organizations/:id/flete-routes/:routeId
router.delete('/:id/flete-routes/:routeId', requireAuth, async (req, res) => {
  try {
    const { id, routeId } = req.params;
    const [r] = await db.query(
      `DELETE FROM org_flete_routes WHERE id = ? AND org_id = ?`,
      [routeId, id]
    );
    if (r.affectedRows === 0)
      return res.status(404).json({ error: 'Ruta no encontrada' });

    await logAudit({
      req,
      action: 'delete',
      entity: 'org_flete_route',
      entityId: Number(routeId),
      description: `Eliminó ruta de flete de org #${id}`,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[organizations:flete-routes:delete]', e);
    res.status(400).json({ error: 'Delete flete route failed' });
  }
});

/* ===================== CONTACTOS POR ORGANIZACIÓN (para NewOperationModal) ===================== */
// GET /organizations/:id/contacts
router.get('/:id/contacts', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT id, name, email, phone, title
       FROM contacts
       WHERE org_id = ?
       ORDER BY name ASC`,
      [id]
    );

    // Devolvemos siempre 200 con lista (vacía o con datos)
    res.json(rows || []);
  } catch (e) {
    console.error('[organizations:contacts:list]', e?.message || e);
    res
      .status(500)
      .json({ error: 'No se pudieron obtener los contactos de la organización' });
  }
});

/* ===================== TIMELINE POR ORGANIZACIÓN ===================== */
// GET /organizations/:id/timeline
router.get('/:id/timeline', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Organización
    const [[org]] = await db.query(
      `
      SELECT
        id,
        razon_social, name,
        industry, phone, website, ruc, address, city, country,
        label, owner_user_id, visibility, notes,
        is_agent, modalities_supported,
        email, rubro, tipo_org, operacion, hoja_ruta,
        created_at, updated_at,
        budget_status, budget_profit AS budget_profit_value,
        NULL AS advisor_name
      FROM organizations
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!org) {
      return res.status(404).json({ error: 'Organización no encontrada' });
    }

    // Contactos
    const [contacts] = await db.query(
      `SELECT id, name, email, phone, title
       FROM contacts
       WHERE org_id = ?
       ORDER BY name ASC`,
      [id]
    );

    // Llamadas de seguimiento
    const [calls] = await db.query(
      `
      SELECT
        c.id,
        c.user_id,
        u.name AS user_name,
        c.org_id,
        o.name AS org_name,
        c.contact_id,
        ct.name AS contact_name,
        c.deal_id,
        c.subject,
        c.notes,
        c.happened_at,
        c.duration_min,
        c.outcome,
        c.created_at
      FROM followup_calls c
      LEFT JOIN users u         ON u.id  = c.user_id
      LEFT JOIN organizations o ON o.id  = c.org_id
      LEFT JOIN contacts ct     ON ct.id = c.contact_id
      WHERE c.org_id = ?
      ORDER BY c.happened_at DESC, c.id DESC
      `,
      [id]
    );

    // Notas de seguimiento
    const [notes] = await db.query(
      `
      SELECT
        n.id,
        n.user_id,
        u.name AS user_name,
        n.org_id,
        o.name AS org_name,
        n.contact_id,
        ct.name AS contact_name,
        n.deal_id,
        n.content,
        n.created_at
      FROM followup_notes n
      LEFT JOIN users u         ON u.id  = n.user_id
      LEFT JOIN organizations o ON o.id  = n.org_id
      LEFT JOIN contacts ct     ON ct.id = n.contact_id
      WHERE n.org_id = ?
      ORDER BY n.created_at DESC, n.id DESC
      `,
      [id]
    );

    // Tareas de seguimiento
    const [tasks] = await db.query(
      `
      SELECT
        t.id,
        t.user_id,
        u.name AS user_name,
        t.org_id,
        o.name AS org_name,
        t.contact_id,
        ct.name AS contact_name,
        t.deal_id,
        t.title,
        t.priority,
        t.status,
        t.due_at,
        t.completed_at,
        t.created_at
      FROM followup_tasks t
      LEFT JOIN users u         ON u.id  = t.user_id
      LEFT JOIN organizations o ON o.id  = t.org_id
      LEFT JOIN contacts ct     ON ct.id = t.contact_id
      WHERE t.org_id = ?
      ORDER BY t.due_at ASC, t.id ASC
      `,
      [id]
    );

    res.json({
      org,
      contacts,
      calls,
      notes,
      tasks,
    });
  } catch (e) {
    console.error('[organizations:timeline]', e?.message || e);
    res.status(500).json({ error: 'No se pudo cargar el timeline de la organización' });
  }
});

router.get('/:id/followup-feed', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [[deal]] = await db.query(
      `
      SELECT d.id, d.reference, d.org_id, d.contact_id
      FROM deals d
      WHERE d.id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!deal) {
      return res.status(404).json({ error: 'Operacion no encontrada' });
    }

    const [activities] = await db.query(
      `
      SELECT
        a.id,
        a.type,
        a.subject,
        a.notes,
        a.due_date,
        a.done,
        a.created_at,
        a.created_by,
        u.name AS created_by_name,
        u.email AS created_by_email
      FROM activities a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.deal_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      `,
      [id]
    );

    const [tasks] = await db.query(
      `
      SELECT
        t.id,
        t.title,
        t.priority,
        t.status,
        t.due_at,
        t.completed_at,
        t.created_at,
        t.user_id,
        u.name AS user_name
      FROM followup_tasks t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.deal_id = ?
      ORDER BY t.created_at DESC, t.id DESC
      `,
      [id]
    );

    const feed = [
      ...activities.map((row) => ({
        id: `activity-${row.id}`,
        source_id: row.id,
        source_type: 'activity',
        entry_type:
          row.type === 'note'
            ? 'note'
            : row.type === 'reminder' || (row.due_date && Number(row.done || 0) === 0)
            ? 'reminder'
            : 'activity',
        type: row.type,
        title: row.subject || (row.type === 'note' ? 'Nota' : 'Actividad'),
        content: row.notes || '',
        due_at: row.due_date || null,
        done: Number(row.done || 0) === 1,
        created_at: row.created_at,
        created_by: row.created_by,
        created_by_name: row.created_by_name,
        created_by_email: row.created_by_email,
      })),
      ...tasks.map((row) => ({
        id: `task-${row.id}`,
        source_id: row.id,
        source_type: 'followup_task',
        entry_type: 'task',
        type: 'task',
        title: row.title,
        content: '',
        due_at: row.due_at || null,
        done: String(row.status || '').toLowerCase() === 'done',
        status: row.status || 'pending',
        priority: row.priority || 'medium',
        created_at: row.created_at,
        created_by: row.user_id,
        created_by_name: row.user_name,
        completed_at: row.completed_at || null,
      })),
    ]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    res.json({
      deal: {
        id: deal.id,
        reference: deal.reference,
        org_id: deal.org_id,
        contact_id: deal.contact_id,
      },
      items: feed,
    });
  } catch (e) {
    console.error('[operations:followup-feed]', e?.message || e);
    res.status(500).json({ error: 'No se pudo cargar el seguimiento de la operacion' });
  }
});

router.post('/:id/followup-feed', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const entryType = String(req.body?.entry_type || 'note').trim().toLowerCase();
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    const dueAt = String(req.body?.due_at || '').trim();
    const priority = String(req.body?.priority || 'medium').trim().toLowerCase();
    const userId = Number(req.user?.id) || null;

    const [[deal]] = await db.query(
      `
      SELECT d.id, d.reference, d.org_id, d.contact_id
      FROM deals d
      WHERE d.id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!deal) {
      return res.status(404).json({ error: 'Operacion no encontrada' });
    }

    if (entryType === 'task') {
      if (!title) return res.status(400).json({ error: 'title es requerido' });
      if (!dueAt) return res.status(400).json({ error: 'due_at es requerido' });

      const dueSql = dueAt.length === 16 ? `${dueAt}:00` : dueAt;
      const [ins] = await db.query(
        `
        INSERT INTO followup_tasks
          (user_id, org_id, contact_id, deal_id, title, priority, status, due_at)
        VALUES (?,?,?,?,?,?, 'pending', ?)
        `,
        [
          userId,
          deal.org_id || null,
          deal.contact_id || null,
          deal.id,
          title,
          ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
          dueSql,
        ]
      );

      return res.status(201).json({ ok: true, source_type: 'followup_task', id: ins.insertId });
    }

    const activityType =
      entryType === 'note' ? 'note' : entryType === 'reminder' ? 'reminder' : 'activity';
    const subject =
      title ||
      (entryType === 'note'
        ? `Nota en ${deal.reference || 'operacion'}`
        : entryType === 'reminder'
        ? `Recordatorio en ${deal.reference || 'operacion'}`
        : `Actividad en ${deal.reference || 'operacion'}`);

    if (!content && entryType === 'note') {
      return res.status(400).json({ error: 'content es requerido' });
    }
    if (entryType === 'reminder' && !dueAt) {
      return res.status(400).json({ error: 'due_at es requerido' });
    }

    const dueSql = dueAt ? (dueAt.length === 16 ? `${dueAt}:00` : dueAt) : null;

    const [ins] = await db.query(
      `
      INSERT INTO activities
        (type, subject, due_date, done, org_id, person_id, deal_id, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)
      `,
      [
        activityType,
        subject,
        dueSql,
        0,
        deal.org_id || null,
        deal.contact_id || null,
        deal.id,
        content || null,
        userId,
      ]
    );

    return res.status(201).json({ ok: true, source_type: 'activity', id: ins.insertId });
  } catch (e) {
    console.error('[operations:create-followup-feed]', e?.message || e);
    res.status(500).json({ error: 'No se pudo registrar el elemento de seguimiento' });
  }
});

router.patch('/:id/followup-feed/:sourceType/:itemId/done', requireAuth, async (req, res) => {
  try {
    const { id, sourceType, itemId } = req.params;
    const normalizedType = String(sourceType || '').trim().toLowerCase();
    const numericDealId = Number(id);
    const numericItemId = Number(itemId);

    if (!numericDealId || !numericItemId) {
      return res.status(400).json({ error: 'Parametros invalidos' });
    }

    if (normalizedType === 'task') {
      const [[task]] = await db.query(
        `
        SELECT id, deal_id, status
        FROM followup_tasks
        WHERE id = ? AND deal_id = ?
        LIMIT 1
        `,
        [numericItemId, numericDealId]
      );

      if (!task) {
        return res.status(404).json({ error: 'Tarea no encontrada' });
      }

      await db.query(
        `
        UPDATE followup_tasks
        SET status = 'done', completed_at = NOW()
        WHERE id = ? AND deal_id = ?
        `,
        [numericItemId, numericDealId]
      );

      return res.json({ ok: true, source_type: 'task', id: numericItemId, status: 'done' });
    }

    if (normalizedType === 'activity' || normalizedType === 'reminder') {
      const [[activity]] = await db.query(
        `
        SELECT id, deal_id, done, type
        FROM activities
        WHERE id = ? AND deal_id = ?
        LIMIT 1
        `,
        [numericItemId, numericDealId]
      );

      if (!activity) {
        return res.status(404).json({ error: 'Actividad no encontrada' });
      }

      await db.query(
        `
        UPDATE activities
        SET done = 1
        WHERE id = ? AND deal_id = ?
        `,
        [numericItemId, numericDealId]
      );

      return res.json({
        ok: true,
        source_type: 'activity',
        id: numericItemId,
        status: 'done',
        type: activity.type,
      });
    }

    return res.status(400).json({ error: 'Tipo de origen no soportado' });
  } catch (e) {
    console.error('[operations:followup-feed:done]', e?.message || e);
    res.status(500).json({ error: 'No se pudo marcar como hecho' });
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
        email, rubro, tipo_org, operacion, hoja_ruta,
        created_at, updated_at,
        budget_status, budget_profit AS budget_profit_value,
        NULL AS advisor_name
      FROM organizations
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );
    if (!org)
      return res.status(404).json({ error: 'Organización no encontrada' });

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
      'razon_social',
      'name',
      'industry',
      'phone',
      'website',
      'ruc',
      'address',
      'city',
      'country',
      'label',
      'owner_user_id',
      'visibility',
      'notes',
      'is_agent',
      'modalities_supported',
      'email',
      'rubro',
      'tipo_org',
      'operacion',
      'hoja_ruta',
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
    if (r.affectedRows === 0)
      return res.status(404).json({ error: 'No encontrado' });

    const [[row]] = await db.query(
      `
      SELECT
        id,
        razon_social, name,
        industry, phone, website, ruc, address, city, country,
        label, owner_user_id, visibility, notes,
        is_agent, modalities_supported,
        email, rubro, tipo_org, operacion, hoja_ruta,
        created_at, updated_at,
        budget_status, budget_profit AS budget_profit_value,
        NULL AS advisor_name
      FROM organizations
      WHERE id = ?
      `,
      [id]
    );

    await logAudit({
      req,
      action: 'update',
      entity: 'organization',
      entityId: Number(id),
      description: 'Actualizó organización',
      meta: { patch: req.body },
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
    if (r.affectedRows === 0)
      return res.status(404).json({ error: 'No encontrado' });

    await logAudit({
      req,
      action: 'delete',
      entity: 'organization',
      entityId: Number(id),
      description: 'Eliminó organización',
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
    if (!org)
      return res.status(404).json({ error: 'Organización no encontrada' });
    res.json({
      id: org.id,
      budget_status: org.budget_status,
      budget_profit: org.budget_profit,
    });
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
    if (!org)
      return res.status(404).json({ error: 'Organización no encontrada' });
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
      req,
      action: 'update',
      entity: 'organization',
      entityId: Number(id),
      description: 'Bloqueó presupuesto',
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
    if (!org)
      return res.status(404).json({ error: 'Organización no encontrada' });

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
      req,
      action: 'update',
      entity: 'organization',
      entityId: Number(id),
      description: 'Confirmó presupuesto',
      meta: { profit_value },
    });

    res.json({
      ok: true,
      budget_status: 'confirmado',
      budget_profit: profit_value ?? null,
    });
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
    if (!org)
      return res.status(404).json({ error: 'Organización no encontrada' });

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
      req,
      action: 'update',
      entity: 'organization',
      entityId: Number(id),
      description: 'Reabrió presupuesto',
    });

    res.json({ ok: true, budget_status: 'borrador' });
  } catch (e) {
    console.error('[organizations:budget:reopen]', e);
    res.status(400).json({ error: 'Reopen budget failed' });
  }
});

export default router;
