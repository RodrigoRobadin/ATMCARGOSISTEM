// server/src/routes/dealsCostSheet.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// ============== Crear tabla de versiones al iniciar ==============
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deal_cost_sheet_versions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deal_id INT NOT NULL,
        version_number INT NOT NULL DEFAULT 1,
        data JSON,
        status ENUM('borrador', 'confirmado', 'bloqueado', 'supersedida') DEFAULT 'borrador',
        created_by_user_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP NULL,
        confirmed_by_user_id BIGINT NULL,
        change_reason TEXT,
        UNIQUE KEY unique_version (deal_id, version_number),
        INDEX (deal_id),
        INDEX (status),
        FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Agregar columna current_version_id a deal_cost_sheets si no existe
    await pool.query(`
      ALTER TABLE deal_cost_sheets 
      ADD COLUMN IF NOT EXISTS current_version_id INT NULL
    `).catch(() => {
      // Columna ya existe, ignorar error
    });

    console.log('[cost-sheet] Tabla de versiones lista.');
  } catch (e) {
    console.error('[cost-sheet] No se pudo crear tabla de versiones:', e?.message || e);
  }
})();

// Helper para parsear JSON sin romper
function safeParseJSON(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// ============== GET: devuelve datos de la versión actual ==============
router.get('/:id/cost-sheet', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Buscar current_version_id
    const [[sheet]] = await pool.query(
      `SELECT current_version_id, data, updated_at, updated_by
       FROM deal_cost_sheets
       WHERE deal_id = ?
       LIMIT 1`,
      [id]
    );

    // Si no hay registro, devolver null
    if (!sheet) {
      return res.json({ data: null, updated_at: null, updated_by: null, updated_by_name: null });
    }

    // 2. Si hay current_version_id, devolver datos de esa versión
    if (sheet.current_version_id) {
      const [[version]] = await pool.query(
        `SELECT v.data, v.created_at, v.created_by_user_id, u.name AS created_by_name
         FROM deal_cost_sheet_versions v
         LEFT JOIN users u ON u.id = v.created_by_user_id
         WHERE v.id = ?
         LIMIT 1`,
        [sheet.current_version_id]
      );

      if (version) {
        const data = safeParseJSON(version.data);
        return res.json({
          data: data ?? null,
          updated_at: version.created_at,
          updated_by: version.created_by_user_id,
          updated_by_name: version.created_by_name ?? null,
        });
      }
    }

    // 3. Fallback: devolver data antiguo (retrocompatibilidad)
    const [[userInfo]] = await pool.query(
      'SELECT name FROM users WHERE id = ? LIMIT 1',
      [sheet.updated_by]
    );

    const data = safeParseJSON(sheet.data);
    return res.json({
      data: data ?? null,
      updated_at: sheet.updated_at,
      updated_by: sheet.updated_by,
      updated_by_name: userInfo?.name ?? null,
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

// ============== VERSIONES ==============

// Listar todas las versiones de un deal
router.get('/:id/cost-sheet/versions', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT 
        v.id, v.version_number, v.status, v.created_at, v.confirmed_at,
        v.change_reason,
        u1.name AS created_by_name,
        u2.name AS confirmed_by_name
      FROM deal_cost_sheet_versions v
      LEFT JOIN users u1 ON u1.id = v.created_by_user_id
      LEFT JOIN users u2 ON u2.id = v.confirmed_by_user_id
      WHERE v.deal_id = ?
      ORDER BY v.version_number DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[cost-sheet][versions][GET] error', err);
    return res.status(500).json({ error: 'Error al obtener versiones' });
  }
});

// Obtener versión específica por número
router.get('/:id/cost-sheet/versions/:versionNum', requireAuth, async (req, res) => {
  const { id, versionNum } = req.params;
  try {
    const [[row]] = await pool.query(
      `SELECT v.*, u.name AS created_by_name
      FROM deal_cost_sheet_versions v
      LEFT JOIN users u ON u.id = v.created_by_user_id
      WHERE v.deal_id = ? AND v.version_number = ?`,
      [id, versionNum]
    );

    if (!row) return res.status(404).json({ error: 'Versión no encontrada' });

    const data = safeParseJSON(row.data);
    res.json({ ...row, data });
  } catch (err) {
    console.error('[cost-sheet][version][GET] error', err);
    return res.status(500).json({ error: 'Error al obtener versión' });
  }
});

// Obtener versión actual
router.get('/:id/cost-sheet/current-version', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const [[sheet]] = await pool.query(
      'SELECT current_version_id FROM deal_cost_sheets WHERE deal_id = ?',
      [id]
    );

    if (!sheet?.current_version_id) {
      return res.json({ version: null });
    }

    const [[version]] = await pool.query(
      `SELECT v.*, u.name AS created_by_name
      FROM deal_cost_sheet_versions v
      LEFT JOIN users u ON u.id = v.created_by_user_id
      WHERE v.id = ?`,
      [sheet.current_version_id]
    );

    if (!version) {
      return res.json({ version: null });
    }

    const data = safeParseJSON(version.data);
    res.json({ ...version, data });
  } catch (err) {
    console.error('[cost-sheet][current-version][GET] error', err);
    return res.status(500).json({ error: 'Error al obtener versión actual' });
  }
});

// Crear nueva versión
router.post('/:id/cost-sheet/versions', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data, change_reason } = req.body;

  try {
    // Verificar que el deal existe
    const [[deal]] = await pool.query('SELECT org_id FROM deals WHERE id = ?', [id]);
    if (!deal) return res.status(404).json({ error: 'Deal no encontrado' });

    // Verificar permisos (solo admin puede crear versiones si está bloqueado)
    const [[org]] = await pool.query(
      'SELECT budget_status FROM organizations WHERE id = ?',
      [deal.org_id]
    );

    const locked = org?.budget_status === 'bloqueado';
    if (locked && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Presupuesto bloqueado' });
    }

    // Obtener último número de versión
    const [[lastVersion]] = await pool.query(
      'SELECT MAX(version_number) as max_ver FROM deal_cost_sheet_versions WHERE deal_id = ?',
      [id]
    );
    const nextVersion = (lastVersion?.max_ver || 0) + 1;

    // Marcar versión anterior como supersedida (si existe y es borrador)
    if (lastVersion?.max_ver) {
      await pool.query(
        `UPDATE deal_cost_sheet_versions 
        SET status = 'supersedida' 
        WHERE deal_id = ? AND version_number = ? AND status = 'borrador'`,
        [id, lastVersion.max_ver]
      );
    }

    // Crear nueva versión
    const [result] = await pool.query(
      `INSERT INTO deal_cost_sheet_versions 
      (deal_id, version_number, data, status, created_by_user_id, change_reason)
      VALUES (?, ?, ?, 'borrador', ?, ?)`,
      [id, nextVersion, JSON.stringify(data), req.user.id, change_reason || null]
    );

    // Actualizar current_version_id en deal_cost_sheets
    await pool.query(
      `INSERT INTO deal_cost_sheets (deal_id, current_version_id, updated_by, updated_at, data)
      VALUES (?, ?, ?, NOW(), '{}')
      ON DUPLICATE KEY UPDATE
        current_version_id = VALUES(current_version_id),
        updated_by = VALUES(updated_by),
        updated_at = NOW()`,
      [id, result.insertId, req.user.id]
    );

    res.json({ ok: true, version_id: result.insertId, version_number: nextVersion });
  } catch (err) {
    console.error('[cost-sheet][version][POST] error', err);
    return res.status(500).json({ error: 'Error al crear versión' });
  }
});

// Actualizar versión existente (solo si es borrador)
router.put('/:id/cost-sheet/versions/:versionId', requireAuth, async (req, res) => {
  const { id, versionId } = req.params;
  const { data } = req.body;

  try {
    // Verificar que la versión existe y es borrador
    const [[version]] = await pool.query(
      'SELECT status FROM deal_cost_sheet_versions WHERE id = ? AND deal_id = ?',
      [versionId, id]
    );

    if (!version) return res.status(404).json({ error: 'Versión no encontrada' });
    if (version.status !== 'borrador') {
      return res.status(403).json({ error: 'Solo se pueden editar versiones en borrador' });
    }

    // Actualizar data
    await pool.query(
      'UPDATE deal_cost_sheet_versions SET data = ? WHERE id = ?',
      [JSON.stringify(data), versionId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[cost-sheet][version][PUT] error', err);
    return res.status(500).json({ error: 'Error al actualizar versión' });
  }
});

// Confirmar versión
router.post('/:id/cost-sheet/versions/:versionId/confirm', requireAuth, async (req, res) => {
  const { id, versionId } = req.params;

  try {
    const [[version]] = await pool.query(
      'SELECT deal_id FROM deal_cost_sheet_versions WHERE id = ? AND deal_id = ?',
      [versionId, id]
    );

    if (!version) return res.status(404).json({ error: 'Versión no encontrada' });

    // Actualizar versión
    await pool.query(
      `UPDATE deal_cost_sheet_versions 
      SET status = 'confirmado', confirmed_at = NOW(), confirmed_by_user_id = ?
      WHERE id = ?`,
      [req.user.id, versionId]
    );

    // Actualizar organización
    const [[deal]] = await pool.query('SELECT org_id FROM deals WHERE id = ?', [id]);
    if (deal?.org_id) {
      await pool.query(
        'UPDATE organizations SET budget_status = \'confirmado\' WHERE id = ?',
        [deal.org_id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[cost-sheet][version][confirm] error', err);
    return res.status(500).json({ error: 'Error al confirmar versión' });
  }
});

// Comparar dos versiones
router.get('/:id/cost-sheet/compare', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { from, to } = req.query;

  try {
    const [versions] = await pool.query(
      `SELECT version_number, data, created_at, change_reason
      FROM deal_cost_sheet_versions
      WHERE deal_id = ? AND version_number IN (?, ?)
      ORDER BY version_number`,
      [id, from, to]
    );

    if (versions.length !== 2) {
      return res.status(404).json({ error: 'Versiones no encontradas' });
    }

    res.json({
      from: { ...versions[0], data: safeParseJSON(versions[0].data) },
      to: { ...versions[1], data: safeParseJSON(versions[1].data) }
    });
  } catch (err) {
    console.error('[cost-sheet][compare] error', err);
    return res.status(500).json({ error: 'Error al comparar versiones' });
  }
});

export default router;
