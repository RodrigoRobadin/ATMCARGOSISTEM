import express from 'express';
import pool from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = express.Router();
const RESULT_LIMIT = 30;

function cleanQuery(value) {
  return String(value || '').trim().slice(0, 120);
}

async function safeQuery(source, sql, params, warnings) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  } catch (error) {
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) {
      warnings.push(`${source}: fuente no disponible`);
      return [];
    }
    throw error;
  }
}

router.get('/', requireAuth, async (req, res) => {
  const q = cleanQuery(req.query.q);
  if (!q) {
    return res.json({
      people: [],
      organizations: [],
      activities: [],
      deals: [],
      files: [],
      prospects: [],
      products: [],
      warnings: [],
    });
  }

  const like = `%${q}%`;
  const warnings = [];

  try {
    const [people, organizations, activities, deals, files, prospects, products] = await Promise.all([
      safeQuery(
        'Personas',
        `SELECT c.id, c.name, c.email, c.phone, c.title, c.label,
                c.org_id, o.name AS org_name, c.created_at
           FROM contacts c
           LEFT JOIN organizations o ON o.id = c.org_id
          WHERE c.deleted_at IS NULL
            AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.title LIKE ?
                 OR c.label LIKE ? OR o.name LIKE ?)
          ORDER BY c.id DESC
          LIMIT ?`,
        [like, like, like, like, like, like, RESULT_LIMIT],
        warnings
      ),
      safeQuery(
        'Organizaciones',
        `SELECT o.id, o.name, o.razon_social, o.ruc, o.email, o.phone,
                o.address, o.city, o.industry, o.created_at
           FROM organizations o
          WHERE o.deleted_at IS NULL
            AND (o.name LIKE ? OR o.razon_social LIKE ? OR o.ruc LIKE ?
                 OR o.email LIKE ? OR o.phone LIKE ? OR o.address LIKE ?
                 OR o.city LIKE ? OR o.industry LIKE ?)
          ORDER BY o.id DESC
          LIMIT ?`,
        [like, like, like, like, like, like, like, like, RESULT_LIMIT],
        warnings
      ),
      safeQuery(
        'Actividades',
        `SELECT a.id, a.type, a.subject, a.notes, a.due_date, a.done,
                a.deal_id, d.reference AS deal_reference,
                a.org_id, o.name AS org_name,
                a.person_id AS contact_id, c.name AS contact_name,
                a.created_at
           FROM activities a
           LEFT JOIN deals d ON d.id = a.deal_id
           LEFT JOIN organizations o ON o.id = a.org_id
           LEFT JOIN contacts c ON c.id = a.person_id
          WHERE a.subject LIKE ? OR a.notes LIKE ? OR a.type LIKE ?
             OR d.reference LIKE ? OR d.title LIKE ? OR o.name LIKE ? OR c.name LIKE ?
          ORDER BY a.id DESC
          LIMIT ?`,
        [like, like, like, like, like, like, like, RESULT_LIMIT],
        warnings
      ),
      safeQuery(
        'Operaciones',
        `SELECT d.id, d.reference, d.title, d.value, d.status_ops,
                d.transport_type, d.created_at,
                o.name AS org_name, c.name AS contact_name,
                c.email AS contact_email, c.phone AS contact_phone,
                s.name AS stage_name, bu.name AS business_unit_name,
                cf_merc.value AS mercaderia,
                cf_tipo.value AS tipo_carga,
                cf_modalidad.value AS modalidad_carga,
                cf_origen.value AS origen_pto,
                cf_destino.value AS destino_pto,
                cf_incoterm.value AS incoterm
           FROM deals d
           LEFT JOIN organizations o ON o.id = d.org_id
           LEFT JOIN contacts c ON c.id = d.contact_id
           LEFT JOIN stages s ON s.id = d.stage_id
           LEFT JOIN business_units bu ON bu.id = d.business_unit_id
           LEFT JOIN deal_custom_fields cf_merc ON cf_merc.deal_id = d.id AND cf_merc.\`key\` = 'mercaderia'
           LEFT JOIN deal_custom_fields cf_tipo ON cf_tipo.deal_id = d.id AND cf_tipo.\`key\` = 'tipo_carga'
           LEFT JOIN deal_custom_fields cf_modalidad ON cf_modalidad.deal_id = d.id AND cf_modalidad.\`key\` = 'modalidad_carga'
           LEFT JOIN deal_custom_fields cf_origen ON cf_origen.deal_id = d.id AND cf_origen.\`key\` = 'origen_pto'
           LEFT JOIN deal_custom_fields cf_destino ON cf_destino.deal_id = d.id AND cf_destino.\`key\` = 'destino_pto'
           LEFT JOIN deal_custom_fields cf_incoterm ON cf_incoterm.deal_id = d.id AND cf_incoterm.\`key\` = 'incoterm'
          WHERE LOWER(COALESCE(s.name, '')) NOT LIKE '%prospect%'
            AND (d.reference LIKE ? OR d.title LIKE ? OR o.name LIKE ?
                 OR c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
                 OR s.name LIKE ? OR bu.name LIKE ? OR cf_merc.value LIKE ?
                 OR cf_tipo.value LIKE ? OR cf_modalidad.value LIKE ?
                 OR cf_origen.value LIKE ? OR cf_destino.value LIKE ?
                 OR cf_incoterm.value LIKE ?)
          ORDER BY d.id DESC
          LIMIT ?`,
        Array(14).fill(like).concat(RESULT_LIMIT),
        warnings
      ),
      safeQuery(
        'Archivos',
        `SELECT f.id, f.deal_id, f.type, f.filename, f.url, f.created_at,
                d.reference AS deal_reference, d.title AS deal_title,
                o.name AS org_name
           FROM deal_files f
           INNER JOIN deals d ON d.id = f.deal_id
           LEFT JOIN organizations o ON o.id = d.org_id
          WHERE f.filename LIKE ? OR f.type LIKE ? OR d.reference LIKE ?
             OR d.title LIKE ? OR o.name LIKE ?
          ORDER BY f.id DESC
          LIMIT ?`,
        [like, like, like, like, like, RESULT_LIMIT],
        warnings
      ),
      safeQuery(
        'Prospectos',
        `SELECT d.id, d.reference, d.title, d.value, d.created_at,
                o.id AS org_id, o.name AS org_name,
                c.id AS contact_id, c.name AS contact_name,
                c.email AS contact_email, c.phone AS contact_phone,
                s.name AS stage_name, bu.name AS business_unit_name
           FROM deals d
           INNER JOIN stages s ON s.id = d.stage_id
           LEFT JOIN organizations o ON o.id = d.org_id
           LEFT JOIN contacts c ON c.id = d.contact_id
           LEFT JOIN business_units bu ON bu.id = d.business_unit_id
          WHERE LOWER(COALESCE(s.name, '')) LIKE '%prospect%'
            AND (d.reference LIKE ? OR d.title LIKE ? OR o.name LIKE ?
                 OR c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
                 OR bu.name LIKE ?)
          ORDER BY d.id DESC
          LIMIT ?`,
        [like, like, like, like, like, like, like, RESULT_LIMIT],
        warnings
      ),
      safeQuery(
        'Productos',
        `SELECT id, sku, name, brand, category, description, unit,
                currency, price, active, created_at, updated_at
           FROM catalog_items
          WHERE type = 'PRODUCTO'
            AND active = 1
            AND (sku LIKE ? OR name LIKE ? OR brand LIKE ?
                 OR category LIKE ? OR description LIKE ?)
          ORDER BY active DESC, id DESC
          LIMIT ?`,
        [like, like, like, like, like, RESULT_LIMIT],
        warnings
      ),
    ]);

    return res.json({
      people,
      organizations,
      activities,
      deals,
      files,
      prospects,
      products,
      warnings,
    });
  } catch (error) {
    console.error('[search] error', error);
    return res.status(500).json({ error: 'No se pudo completar la búsqueda global.' });
  }
});

export default router;
