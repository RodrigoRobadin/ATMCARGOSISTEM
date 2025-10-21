// server/src/routes/search.js
import express from 'express';
import pool from '../services/db.js';

const router = express.Router();

/**
 * Búsqueda global simple
 * GET /api/search?q=texto
 *
 * Retorna:
 * {
 *   deals: [{ id, reference, title, stage_id, pipeline_id }],
 *   organizations: [{ id, name }],
 *   contacts: [{ id, name, email, phone }]
 * }
 */
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ deals: [], organizations: [], contacts: [] });
  }

  const like = `%${q}%`;

  try {
    // DEALS: busca por referencia o título. Ordena por id DESC (no depende de updated_at)
    const [deals] = await pool.query(
      `
        SELECT id, reference, title, stage_id, pipeline_id
        FROM deals
        WHERE reference LIKE ? OR title LIKE ?
        ORDER BY id DESC
        LIMIT 10
      `,
      [like, like]
    );

    // ORGANIZATIONS: busca por nombre
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

    // CONTACTS: busca por nombre, email o teléfono
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

    return res.json({ deals, organizations, contacts });
  } catch (err) {
    console.error('[search] error', err);
    return res.status(500).json({ error: 'search_failed' });
  }
});

export default router;
