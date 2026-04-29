// server/src/routes/dealsCostSheet.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

let ensureCostSheetVersionSchemaPromise = null;

// ============== Crear tabla de versiones al iniciar ==============
async function ensureCostSheetVersionSchema() {
  if (ensureCostSheetVersionSchemaPromise) return ensureCostSheetVersionSchemaPromise;
  ensureCostSheetVersionSchemaPromise = (async () => {
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
          revision_name VARCHAR(255) NULL,
          UNIQUE KEY unique_version (deal_id, version_number),
          INDEX (deal_id),
          INDEX (status),
          FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      const [sheetCols] = await pool.query(`SHOW COLUMNS FROM deal_cost_sheets`);
      const sheetColNames = new Set((sheetCols || []).map((col) => String(col.Field || "").toLowerCase()));
      if (!sheetColNames.has("current_version_id")) {
        await pool.query(`ALTER TABLE deal_cost_sheets ADD COLUMN current_version_id INT NULL`);
      }

      const [versionCols] = await pool.query(`SHOW COLUMNS FROM deal_cost_sheet_versions`);
      const versionColNames = new Set((versionCols || []).map((col) => String(col.Field || "").toLowerCase()));
      if (!versionColNames.has("revision_name")) {
        await pool.query(
          `ALTER TABLE deal_cost_sheet_versions ADD COLUMN revision_name VARCHAR(255) NULL AFTER change_reason`
        );
      }

      console.log('[cost-sheet] Tabla de versiones lista.');
    } catch (e) {
      console.error('[cost-sheet] No se pudo crear tabla de versiones:', e?.message || e);
      throw e;
    }
  })();
  return ensureCostSheetVersionSchemaPromise;
}

void ensureCostSheetVersionSchema();

// Helper para parsear JSON sin romper


function formatRevisionName(versionNumber, createdAt = new Date()) {
  const n = Number(versionNumber || 0);
  const seq = String(n).padStart(2, '0');
  const dt = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `REV ${seq} - ${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}
function safeParseJSON(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function normalizeDocumentSnapshot(value) {
  const parsed = safeParseJSON(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function withDocumentSnapshot(data, documentSnapshot) {
  const base = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  if (documentSnapshot && typeof documentSnapshot === 'object' && !Array.isArray(documentSnapshot)) {
    base.document_snapshot = documentSnapshot;
  }
  return base;
}

async function getFallbackCostSheetData(dealId, preferredVersionId = null) {
  if (preferredVersionId) {
    const [[versionRow]] = await pool.query(
      'SELECT data FROM deal_cost_sheet_versions WHERE id = ? AND deal_id = ? LIMIT 1',
      [preferredVersionId, dealId]
    );
    const versionData = safeParseJSON(versionRow?.data);
    if (versionData) return versionData;
  }

  const [[sheet]] = await pool.query(
    'SELECT current_version_id, data FROM deal_cost_sheets WHERE deal_id = ? LIMIT 1',
    [dealId]
  );
  if (sheet?.current_version_id) {
    const [[currentVersion]] = await pool.query(
      'SELECT data FROM deal_cost_sheet_versions WHERE id = ? LIMIT 1',
      [sheet.current_version_id]
    );
    const currentVersionData = safeParseJSON(currentVersion?.data);
    if (currentVersionData) return currentVersionData;
  }
  return safeParseJSON(sheet?.data) || {};
}

async function updateCostSheetDocumentSnapshot(dealId, documentSnapshot, preferredVersionId = null, userId = null) {
  const normalizedSnapshot = normalizeDocumentSnapshot(documentSnapshot);
  const baseData = withDocumentSnapshot(
    await getFallbackCostSheetData(dealId, preferredVersionId),
    normalizedSnapshot
  );

  const [[sheet]] = await pool.query(
    'SELECT current_version_id FROM deal_cost_sheets WHERE deal_id = ? LIMIT 1',
    [dealId]
  );
  const versionId = Number(preferredVersionId || sheet?.current_version_id || 0) || null;

  if (versionId) {
    await pool.query(
      'UPDATE deal_cost_sheet_versions SET data = ? WHERE id = ? AND deal_id = ?',
      [JSON.stringify(baseData), versionId, dealId]
    );
  }

  await pool.query(
    `INSERT INTO deal_cost_sheets (deal_id, data, updated_by, updated_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       data = VALUES(data),
       updated_by = VALUES(updated_by),
       updated_at = NOW()`,
    [dealId, JSON.stringify(baseData), userId]
  );

  return baseData;
}

async function mergeCostSheetDataWithExisting(dealId, incomingData, preferredVersionId = null) {
  const normalizedIncoming =
    incomingData && typeof incomingData === 'object' && !Array.isArray(incomingData)
      ? { ...incomingData }
      : {};
  const existingData = await getFallbackCostSheetData(dealId, preferredVersionId);
  if (!normalizeDocumentSnapshot(normalizedIncoming.document_snapshot)) {
    const existingSnapshot = normalizeDocumentSnapshot(existingData?.document_snapshot);
    if (existingSnapshot) normalizedIncoming.document_snapshot = existingSnapshot;
  }
  return normalizedIncoming;
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const s = String(v).replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function buildQuoteSyncFromCostSheet(costSheet) {
  const d = costSheet || {};
  const h = d.header || {};
  const gsRate = toNum(h.gsRate) || 0;
  const opCurrency = String(h.operationCurrency || h.currency || "USD").toUpperCase();
  const isPyg = opCurrency === "PYG" || opCurrency === "GS";
  const pesoKg = toNum(h.pesoKg || 0);
  const allInEnabled = !!h.allInEnabled;
  const allInName = String(h.allInServiceName || '').trim();

  const ventaRows = Array.isArray(d.ventaRows) ? d.ventaRows : [];
  const locCliRows = Array.isArray(d.locCliRows) ? d.locCliRows : [];
  const segVentaRows = Array.isArray(d.segVentaRows) ? d.segVentaRows : [];

  const ventaBaseTotal = ventaRows.reduce((acc, v) => {
    const manualInt =
      v?.ventaInt !== '' && v?.ventaInt !== undefined && v?.ventaInt !== null
        ? toNum(v.ventaInt)
        : null;
    let line = 0;
    if (allInEnabled) {
      if (manualInt !== null) line = manualInt;
      else if (v?.total !== '' && !v?.lockPerKg) line = toNum(v.total);
      else line = toNum(v?.usdXKg) * pesoKg;
    } else {
      if (v?.total !== '' && !v?.lockPerKg) line = toNum(v.total);
      else line = toNum(v?.usdXKg) * pesoKg;
    }
    return acc + (Number.isFinite(line) ? line : 0);
  }, 0);

  let ventaItems = [];
  if (allInEnabled && allInName) {
    const target = allInName.toLowerCase();
    const hasTarget = ventaRows.some(
      (v) => String(v?.concepto || '').trim().toLowerCase() === target
    );
    const baseZeroed = ventaRows.map((v) => ({
      descripcion: v?.concepto || 'Servicio',
      precio: 0,
      tax_rate: Number(v?.tax_rate ?? 0),
    }));
    if (hasTarget) {
      ventaItems = baseZeroed.map((it) =>
        String(it.descripcion || '').trim().toLowerCase() === target
          ? { ...it, precio: ventaBaseTotal }
          : it
      );
    } else {
      ventaItems = [
        ...baseZeroed,
        { descripcion: allInName, precio: ventaBaseTotal, tax_rate: 10 },
      ];
    }
  } else {
    ventaItems = ventaRows.map((v) => {
      let valor = 0;
      if (v?.total !== '' && !v?.lockPerKg) valor = toNum(v.total);
      else valor = toNum(v?.usdXKg) * pesoKg;
      return {
        descripcion: v?.concepto || 'Servicio',
        precio: valor,
        tax_rate: Number(v?.tax_rate ?? 0),
      };
    });
  }

  const locItems = locCliRows.map((v) => ({
    descripcion: v?.concepto || 'Gasto local',
    precio: gsRate ? toNum(v?.gs) / gsRate : 0,
    tax_rate: Number(v?.tax_rate ?? 0),
  }));

  const segItems = segVentaRows.map((v) => ({
    descripcion: v?.concepto || 'Seguro',
    precio: toNum(v?.usd ?? v?.monto ?? 0),
    tax_rate: Number(v?.tax_rate ?? 10),
  }));

  const allItems = [...ventaItems, ...locItems, ...segItems]
    .filter((it) => String(it.descripcion || '').trim() !== '');

  const toUsd = (val) => {
    if (!isPyg) return Number(val || 0);
    if (!gsRate) return Number(val || 0);
    return Number(val || 0) / gsRate;
  };

  const inputsItems = allItems.map((it, idx) => ({
    line_no: idx + 1,
    description: it.descripcion,
    qty: 1,
    unit_price: toUsd(it.precio),
    tax_rate: Number(it.tax_rate || 0),
  }));

  const computedItems = allItems.map((it, idx) => ({
    line_no: idx + 1,
    description: it.descripcion,
    qty: 1,
    unit_price: toUsd(it.precio),
    total_sales: toUsd(it.precio),
    item_order: idx + 1,
  }));

  const totalSalesUsd = computedItems.reduce((acc, it) => acc + Number(it.total_sales || 0), 0);

  return {
    inputsItems,
    computed: {
      oferta: {
        items: computedItems,
        totals: { total_sales_usd: Number(totalSalesUsd.toFixed(2)) },
      },
      operacion: {
        totals: { total_sell_usd: Number(totalSalesUsd.toFixed(2)) },
      },
      meta: {
        operation_currency: opCurrency || 'USD',
        exchange_rate_operation_sell_usd: isPyg ? (gsRate || 1) : 1,
      },
    },
  };
}

async function syncQuoteFromCostSheet(dealId, costSheetData) {
  const { inputsItems, computed } = buildQuoteSyncFromCostSheet(costSheetData);
  if (!inputsItems.length) return;
  const documentSnapshot = normalizeDocumentSnapshot(costSheetData?.document_snapshot);

  const [[dealRow]] = await pool.query(
    `SELECT d.org_branch_id, bu.key_slug AS business_unit_key
       FROM deals d
       LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE d.id = ? LIMIT 1`,
    [dealId]
  );
  const buKey = String(dealRow?.business_unit_key || '').toLowerCase();
  // No tocar ATM INDUSTRIAL. Si no hay buKey, asumimos no-industrial.
  if (buKey && buKey.includes('industrial')) return;

  const [[existing]] = await pool.query(
    'SELECT id, inputs_json, computed_json FROM quotes WHERE deal_id = ? LIMIT 1',
    [dealId]
  );

  const prevInputs = safeParseJSON(existing?.inputs_json) || {};
  const prevComputed = safeParseJSON(existing?.computed_json) || {};
  const nextInputs = {
    ...prevInputs,
    items: inputsItems,
    operation_currency: prevInputs.operation_currency || computed?.meta?.operation_currency || 'USD',
    exchange_rate_operation_sell_usd:
      prevInputs.exchange_rate_operation_sell_usd || computed?.meta?.exchange_rate_operation_sell_usd || 1,
    org_branch_id: prevInputs.org_branch_id ?? dealRow?.org_branch_id ?? null,
  };
  const nextComputed = {
    ...prevComputed,
    oferta: computed?.oferta || prevComputed?.oferta,
    operacion: computed?.operacion || prevComputed?.operacion,
    meta: {
      ...(prevComputed?.meta || {}),
      ...(computed?.meta || {}),
    },
  };

  if (existing?.id) {
    await pool.query(
      `UPDATE quotes
         SET inputs_json = ?, document_snapshot_json = ?, computed_json = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        JSON.stringify(nextInputs),
        documentSnapshot ? JSON.stringify(documentSnapshot) : null,
        JSON.stringify(nextComputed),
        existing.id,
      ]
    );
    return;
  }

  await pool.query(
    `INSERT INTO quotes (deal_id, ref_code, revision, client_name, status, created_by, inputs_json, document_snapshot_json, computed_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dealId,
      null,
      null,
      null,
      'draft',
      null,
      JSON.stringify(nextInputs),
      documentSnapshot ? JSON.stringify(documentSnapshot) : null,
      JSON.stringify(nextComputed),
    ]
  );
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

    const mergedData = await mergeCostSheetDataWithExisting(Number(id), data);

    // Upsert
    await pool.query(
      `INSERT INTO deal_cost_sheets (deal_id, data, updated_by, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         data = VALUES(data),
         updated_by = VALUES(updated_by),
         updated_at = NOW()`,
      [id, JSON.stringify(mergedData), req.user.id]
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
        v.revision_name,
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

router.put('/:id/cost-sheet/document-snapshot', requireAuth, async (req, res) => {
  const { id } = req.params;
  const dealId = Number(id);
  const versionId = Number(req.body?.version_id || 0) || null;
  const documentSnapshot = normalizeDocumentSnapshot(req.body?.document_snapshot);

  if (!dealId) {
    return res.status(400).json({ error: 'Deal inválido' });
  }

  try {
    const updatedData = await updateCostSheetDocumentSnapshot(
      dealId,
      documentSnapshot,
      versionId,
      req.user?.id || null
    );

    try {
      await syncQuoteFromCostSheet(dealId, updatedData);
    } catch (syncErr) {
      console.error('[cost-sheet][document-snapshot][sync-quote] error', syncErr);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[cost-sheet][document-snapshot][PUT] error', err);
    return res.status(500).json({ error: 'Error al guardar snapshot comercial' });
  }
});

// Crear nueva versión
router.post('/:id/cost-sheet/versions', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data, change_reason, revision_name } = req.body;

  try {
    await ensureCostSheetVersionSchema();
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

    const mergedData = await mergeCostSheetDataWithExisting(Number(id), data);

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

    const effectiveRevisionName = String(revision_name || '').trim() || formatRevisionName(nextVersion);

    // Crear nueva revisi?n
    const [result] = await pool.query(
      `INSERT INTO deal_cost_sheet_versions 
      (deal_id, version_number, data, status, created_by_user_id, change_reason, revision_name)
      VALUES (?, ?, ?, 'borrador', ?, ?, ?)`,
      [id, nextVersion, JSON.stringify(mergedData), req.user.id, change_reason || null, effectiveRevisionName]
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

    // Sync a quotes solo para ATM CARGO (no afecta ATM INDUSTRIAL)
    try {
      await syncQuoteFromCostSheet(Number(id), mergedData);
    } catch (syncErr) {
      console.error('[cost-sheet][sync-quote] error', syncErr);
    }

    res.json({ ok: true, version_id: result.insertId, version_number: nextVersion });
  } catch (err) {
    console.error('[cost-sheet][version][POST] error', err);
    return res.status(500).json({ error: 'Error al crear versión' });
  }
});

// Actualizar versión existente (solo si es borrador)
router.put('/:id/cost-sheet/versions/:versionId', requireAuth, async (req, res) => {
  const { id, versionId } = req.params;
  const { data, revision_name, change_reason } = req.body;

  try {
    await ensureCostSheetVersionSchema();
    // Verificar que la versión existe y es borrador
    const [[version]] = await pool.query(
      'SELECT status, change_reason FROM deal_cost_sheet_versions WHERE id = ? AND deal_id = ?',
      [versionId, id]
    );

    if (!version) return res.status(404).json({ error: 'Versi?n no encontrada' });

    const hasIncomingData = data && typeof data === 'object' && Object.keys(data).length > 0;
    if (version.status !== 'borrador' && hasIncomingData) {
      return res.status(403).json({ error: 'Solo se pueden editar datos de versiones en borrador' });
    }

    const revisionNamePatch = String(revision_name || '').trim();
    const changeReasonPatch = change_reason === undefined ? version.change_reason : change_reason;

    if (hasIncomingData) {
      const mergedData = await mergeCostSheetDataWithExisting(Number(id), data, Number(versionId));

      // Actualizar data / metadatos
      await pool.query(
        'UPDATE deal_cost_sheet_versions SET data = ?, revision_name = COALESCE(?, revision_name), change_reason = ? WHERE id = ?',
        [JSON.stringify(mergedData), revisionNamePatch || null, changeReasonPatch || null, versionId]
      );

      // Sync a quotes solo para ATM CARGO (no afecta ATM INDUSTRIAL)
      try {
        await syncQuoteFromCostSheet(Number(id), mergedData);
      } catch (syncErr) {
        console.error('[cost-sheet][sync-quote] error', syncErr);
      }
    } else {
      await pool.query(
        'UPDATE deal_cost_sheet_versions SET revision_name = COALESCE(?, revision_name), change_reason = ? WHERE id = ?',
        [revisionNamePatch || null, changeReasonPatch || null, versionId]
      );
    }

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
      `SELECT version_number, data, created_at, change_reason, revision_name
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
