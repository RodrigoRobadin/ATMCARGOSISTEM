// server/src/routes/suppliers.js
// Endpoint helper para listar solo proveedores
import { Router } from 'express';
import db from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// GET /api/suppliers - Listar solo organizaciones marcadas como proveedores
router.get('/', requireAuth, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 100, 200);
        const offset = Number(req.query.offset) || 0;
        const { search, category } = req.query;

        let query = `
      SELECT
        id,
        razon_social,
        name,
        ruc,
        phone,
        email,
        address,
        city,
        country,
        supplier_category,
        payment_terms,
        credit_limit,
        tax_id_type,
        bank_account,
        bank_name,
        created_at,
        updated_at
      FROM organizations
      WHERE is_supplier = TRUE
    `;
        const params = [];

        if (search) {
            query += ' AND (name LIKE ? OR razon_social LIKE ? OR ruc LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (category) {
            query += ' AND supplier_category = ?';
            params.push(category);
        }

        query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [suppliers] = await db.query(query, params);
        res.json(suppliers);
    } catch (e) {
        console.error('[suppliers] Error listing:', e);
        res.status(500).json({ error: 'Error al listar proveedores' });
    }
});

export default router;
