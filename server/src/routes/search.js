// server/src/routes/search.js
import express from "express";
import pool from "../services/db.js";

const router = express.Router();

/**
 * Búsqueda global
 * GET /api/search?q=texto
 *
 * Retorna:
 * {
 *   deals: [{
 *     id, reference, title, transport_type, status_ops,
 *     org_name, contact_name,
 *     mercaderia, tipo_carga, modalidad_carga,
 *     origen_pto, destino_pto, incoterm
 *   }],
 *   organizations: [{ id, name }],
 *   contacts: [{ id, name, email, phone }],
 *   notes: [{ id, content, deal_id, org_id, org_name, contact_id, contact_name, created_at }]
 * }
 */
router.get("/", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    return res.json({ deals: [], organizations: [], contacts: [], notes: [] });
  }

  const like = `%${q}%`;

  try {
    /* ================== DEALS (OPERACIONES) ================== */
    const sqlDeals = `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.value,
        d.transport_type,
        d.status_ops,
        o.name AS org_name,
        c.name AS contact_name,
        c.email AS contact_email,
        c.phone AS contact_phone,
        -- CFs relevantes para búsqueda
        cf_merc.value        AS mercaderia,
        cf_tipo_carga.value  AS tipo_carga,
        cf_modalidad.value   AS modalidad_carga,
        cf_origen.value      AS origen_pto,
        cf_destino.value     AS destino_pto,
        cf_incoterm.value    AS incoterm
      FROM deals d
      -- 🔴 AQUÍ EL CAMBIO IMPORTANTE: org_id en lugar de organization_id
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN contacts      c ON c.id = d.contact_id

      -- ⚠️ Ajustá el nombre de la tabla de custom fields si es distinto
      LEFT JOIN deal_custom_fields cf_merc
        ON cf_merc.deal_id = d.id AND cf_merc.\`key\` = 'mercaderia'
      LEFT JOIN deal_custom_fields cf_tipo_carga
        ON cf_tipo_carga.deal_id = d.id AND cf_tipo_carga.\`key\` = 'tipo_carga'
      LEFT JOIN deal_custom_fields cf_modalidad
        ON cf_modalidad.deal_id = d.id AND cf_modalidad.\`key\` = 'modalidad_carga'
      LEFT JOIN deal_custom_fields cf_origen
        ON cf_origen.deal_id = d.id AND cf_origen.\`key\` = 'origen_pto'
      LEFT JOIN deal_custom_fields cf_destino
        ON cf_destino.deal_id = d.id AND cf_destino.\`key\` = 'destino_pto'
      LEFT JOIN deal_custom_fields cf_incoterm
        ON cf_incoterm.deal_id = d.id AND cf_incoterm.\`key\` = 'incoterm'

      WHERE
        (
          d.reference LIKE ?
          OR d.title LIKE ?
          OR o.name LIKE ?
          OR c.name LIKE ?
          OR c.email LIKE ?
          OR c.phone LIKE ?
          OR cf_merc.value LIKE ?
          OR cf_tipo_carga.value LIKE ?
          OR cf_modalidad.value LIKE ?
          OR cf_origen.value LIKE ?
          OR cf_destino.value LIKE ?
          OR cf_incoterm.value LIKE ?
        )
        OR (
          -- Fallback: todo concatenado
          CONCAT_WS(' ',
            d.reference, d.title,
            o.name,
            c.name, c.email, c.phone,
            cf_merc.value,
            cf_tipo_carga.value,
            cf_modalidad.value,
            cf_origen.value,
            cf_destino.value,
            cf_incoterm.value
          ) LIKE ?
        )
      ORDER BY d.id DESC
      LIMIT 50
    `;

    const dealsParams = [
      like, like,  // reference, title
      like,        // org_name
      like, like, like, // contacto
      like, like, like, like, like, like, // CFs
      like         // fulltext
    ];

    const [dealRows] = await pool.query(sqlDeals, dealsParams);

    const deals = dealRows.map((r) => ({
      id: r.id,
      reference: r.reference,
      title: r.title,
      value: r.value,
      transport_type: r.transport_type,
      status_ops: r.status_ops,
      org_name: r.org_name,
      contact_name: r.contact_name,
      contact_email: r.contact_email,
      contact_phone: r.contact_phone,
      mercaderia: r.mercaderia,
      tipo_carga: r.tipo_carga,
      modalidad_carga: r.modalidad_carga,
      origen_pto: r.origen_pto,
      destino_pto: r.destino_pto,
      incoterm: r.incoterm,
    }));

    /* ================== ORGANIZATIONS ================== */
    const [organizations] = await pool.query(
      `
        SELECT id, name
        FROM organizations
        WHERE name LIKE ?
        ORDER BY id DESC
        LIMIT 10
      `,
      [like]
    );

    /* ================== CONTACTS ================== */
    const [contacts] = await pool.query(
      `
        SELECT id, name, email, phone
        FROM contacts
        WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?
        ORDER BY id DESC
        LIMIT 10
      `,
      [like, like, like]
    );


    /* ================== NOTES (followup_notes + activities) ================== */
    const [notesFn] = await pool.query(
      `
        SELECT n.id, n.content, n.created_at,
               n.deal_id, d.reference as deal_reference,
               n.org_id, o.name as org_name,
               n.contact_id, c.name as contact_name
        FROM followup_notes n
        LEFT JOIN deals d ON d.id = n.deal_id
        LEFT JOIN organizations o ON o.id = n.org_id
        LEFT JOIN contacts c ON c.id = n.contact_id
        WHERE n.content LIKE ?
           OR o.name LIKE ?
           OR c.name LIKE ?
           OR d.reference LIKE ?
        ORDER BY n.created_at DESC
        LIMIT 20
      `,
      [like, like, like, like]
    );

    const [notesAct] = await pool.query(
      `
        SELECT a.id, COALESCE(a.notes, a.subject) AS content, a.created_at AS created_at,
               a.deal_id, d.reference AS deal_reference,
               a.org_id, o.name AS org_name
        FROM activities a
        LEFT JOIN deals d ON d.id = a.deal_id
        LEFT JOIN organizations o ON o.id = a.org_id
                WHERE (a.notes LIKE ? OR a.subject LIKE ? OR o.name LIKE ? OR d.reference LIKE ?)
        ORDER BY a.created_at DESC
        LIMIT 20
      `,
      [like, like, like, like]
    );

    const notes = [...(notesFn || []), ...(notesAct || [])];

    return res.json({ deals, organizations, contacts, notes });

  } catch (err) {
    console.error("[search] error", err);
    return res.status(500).json({ error: "search_failed" });
  }
});

export default router;
