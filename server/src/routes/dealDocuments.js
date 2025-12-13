import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// GET /api/deals/:id/documents?type=OC
router.get('/:id/documents', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query;

    let sql = `SELECT id, name, url, type, created_at FROM deal_documents WHERE deal_id = ?`;
    const params = [id];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY created_at DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows || []);
  } catch (err) {
    console.error('[deal-documents] Error listing:', err);
    res.status(500).json({ error: 'Error al listar documentos' });
  }
});

export default router;
