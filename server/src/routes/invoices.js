// server/src/routes/invoices.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import PDFDocument from 'pdfkit';

const router = Router();

// Ensures (best-effort) for credit tables/columns on startup
ensureCreditNoteTables().catch((err) => console.error('init credit tables', err?.message));
ensureInvoiceCreditColumns().catch((err) => console.error('init credit cols', err?.message));

// =================== HELPERS ===================
async function ensureInvoiceSequence() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_sequence (
      id INT PRIMARY KEY,
      prefix VARCHAR(16) NOT NULL DEFAULT 'FAC',
      year INT NOT NULL,
      last_number INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(
    `INSERT IGNORE INTO invoice_sequence (id, prefix, year, last_number)
     VALUES (1, 'FAC', YEAR(CURDATE()), 0);`
  );
}

async function ensureInvoiceExtraColumns() {
  const alters = [
    "ALTER TABLE invoices ADD COLUMN percentage DECIMAL(5,2) NULL",
    "ALTER TABLE invoices ADD COLUMN base_amount DECIMAL(15,2) NULL",
    "ALTER TABLE invoices ADD COLUMN payment_condition VARCHAR(20) NULL",
    "ALTER TABLE invoices ADD COLUMN timbrado_number VARCHAR(32) NULL",
    "ALTER TABLE invoices ADD COLUMN timbrado_expires_at DATE NULL",
    "ALTER TABLE invoices ADD COLUMN timbrado_start_date DATE NULL",
    "ALTER TABLE invoices ADD COLUMN customer_doc VARCHAR(32) NULL",
    "ALTER TABLE invoices ADD COLUMN customer_doc_type VARCHAR(16) NULL",
    "ALTER TABLE invoices ADD COLUMN customer_email VARCHAR(128) NULL",
    "ALTER TABLE invoices ADD COLUMN customer_address VARCHAR(255) NULL",
    "ALTER TABLE invoices ADD COLUMN currency_code VARCHAR(8) NULL",
    "ALTER TABLE invoices ADD COLUMN exchange_rate DECIMAL(15,6) NULL",
    "ALTER TABLE invoices ADD COLUMN point_of_issue VARCHAR(8) NULL",
    "ALTER TABLE invoices ADD COLUMN establishment VARCHAR(8) NULL",
    "ALTER TABLE invoices ADD COLUMN sales_rep VARCHAR(128) NULL",
    "ALTER TABLE invoices ADD COLUMN sales_rep_id INT NULL",
    "ALTER TABLE invoices ADD COLUMN purchase_order_ref VARCHAR(128) NULL",
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (err) {
      // Ignorar si la columna ya existe
      if (err?.code !== 'ER_DUP_FIELDNAME') {
        throw err;
      }
    }
  }
}

async function ensureInvoiceItemsTaxColumn() {
  try {
    await pool.query("ALTER TABLE invoice_items ADD COLUMN tax_rate DECIMAL(5,2) NULL");
  } catch (err) {
    if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

async function ensureInvoiceCreditColumns() {
  const alters = [
    "ALTER TABLE invoices ADD COLUMN credited_total DECIMAL(15,2) NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN net_total_amount DECIMAL(15,2) NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN net_balance DECIMAL(15,2) NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN canceled_by_credit_note_id INT NULL",
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (err) {
      if (err?.code === 'ER_DUP_FIELDNAME') continue;
      throw err;
    }
  }
}

async function ensureCreditNoteTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_notes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      credit_note_number VARCHAR(64) NOT NULL,
      invoice_id INT NOT NULL,
      issue_date DATE NULL,
      status ENUM('borrador','emitida','anulada') NOT NULL DEFAULT 'borrador',
      reason VARCHAR(255) NULL,
      subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
      tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      balance DECIMAL(15,2) NOT NULL DEFAULT 0,
      created_by INT NULL,
      issued_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_note_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      credit_note_id INT NOT NULL,
      description VARCHAR(255) NOT NULL,
      quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
      unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
      subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
      tax_rate DECIMAL(5,2) NULL,
      item_order INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_note_sequence (
      id INT PRIMARY KEY,
      prefix VARCHAR(16) NOT NULL DEFAULT 'NC',
      year INT NOT NULL,
      last_number INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(
    `INSERT IGNORE INTO credit_note_sequence (id, prefix, year, last_number)
     VALUES (1, 'NC', YEAR(CURDATE()), 0);`
  );
}

async function generateCreditNoteNumber() {
  await ensureCreditNoteTables();
  const [[seq]] = await pool.query(
    'SELECT last_number, prefix, year FROM credit_note_sequence WHERE id = 1'
  );
  const currentYear = new Date().getFullYear();
  let nextNumber = seq.last_number + 1;
  if (currentYear !== seq.year) {
    nextNumber = 1;
    await pool.query(
      'UPDATE credit_note_sequence SET year = ?, last_number = 0 WHERE id = 1',
      [currentYear]
    );
  }
  await pool.query('UPDATE credit_note_sequence SET last_number = ? WHERE id = 1', [nextNumber]);
  return `${seq.prefix}-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
}

async function recomputeInvoiceCredits(invoiceId) {
  await ensureInvoiceCreditColumns();
  const [[invoice]] = await pool.query('SELECT id, total_amount, balance FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) return;
  const [[agg]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) AS credited
     FROM credit_notes
     WHERE invoice_id = ? AND status != 'anulada'`,
    [invoiceId]
  );
  const credited = parseFloat(agg.credited || 0);
  const netTotal = Math.max(0, parseFloat(invoice.total_amount || 0) - credited);
  const netBalance = Math.max(0, parseFloat(invoice.balance || 0) - credited);
  await pool.query(
    `UPDATE invoices 
     SET credited_total = ?, net_total_amount = ?, net_balance = ?
     WHERE id = ?`,
    [credited.toFixed(2), netTotal.toFixed(2), netBalance.toFixed(2), invoiceId]
  );
}

async function generateInvoiceNumber() {
  await ensureInvoiceSequence();
  const [[seq]] = await pool.query(
    'SELECT last_number, prefix, year FROM invoice_sequence WHERE id = 1'
  );

  const currentYear = new Date().getFullYear();
  let nextNumber = seq.last_number + 1;

  if (currentYear !== seq.year) {
    nextNumber = 1;
    await pool.query(
      'UPDATE invoice_sequence SET year = ?, last_number = 0 WHERE id = 1',
      [currentYear]
    );
  }

  await pool.query(
    'UPDATE invoice_sequence SET last_number = ? WHERE id = 1',
    [nextNumber]
  );

  return `${seq.prefix}-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
}

function calculateTotals(items) {
  const subtotal = items.reduce((sum, item) => sum + parseFloat(item.subtotal || 0), 0);
  const taxAmount = items.reduce((sum, item) => {
    const rate = parseFloat(item.tax_rate ?? 10) || 0;
    return sum + (parseFloat(item.subtotal || 0) * rate) / 100;
  }, 0);
  const total = subtotal + taxAmount;
  return {
    subtotal: subtotal.toFixed(2),
    tax_amount: taxAmount.toFixed(2),
    total_amount: total.toFixed(2),
  };
}

function formatCurrency(value) {
  const num = Number(value || 0);
  return `USD ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  if (!date) return '';
  try {
    const d = new Date(date);
    const day = `${d.getDate()}`.padStart(2, '0');
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (_e) {
    return '';
  }
}

function canManageInvoice(user, invoice) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin') return true;
  if (role === 'finanzas') return true;
  if (role === 'ejecutivo' && invoice.status === 'borrador') {
    return Number(user.id) === Number(invoice.created_by);
  }
  return false;
}

function extractCostItems(rawData = {}) {
  if (!rawData) return [];
  if (Array.isArray(rawData)) return rawData;
  if (Array.isArray(rawData.items)) return rawData.items;

  if (rawData.data) {
    const nested = extractCostItems(rawData.data);
    if (nested.length) return nested;
  }

  const header = rawData.header || {};
  const collected = [];
  const addRows = (rows = [], fallbackDesc) => {
    rows.forEach((r) => {
      const desc = r.concepto || r.service || r.servicio || fallbackDesc;
      const qty = parseFloat(r.cantidad ?? r.quantity ?? 1) || 1;
      let price =
        parseFloat(r.total ?? r.usd ?? r.usdXKg ?? r.unit_price ?? r.price ?? r.unitPrice ?? 0) || 0;
      if (!price && r.gs && header.gsRate) {
        price = parseFloat(r.gs) / (parseFloat(header.gsRate) || 1);
      }
      collected.push({ description: desc || 'Servicio', quantity: qty, unit_price: price });
    });
  };
  if (Array.isArray(rawData.ventaRows)) addRows(rawData.ventaRows, 'Servicio');
  if (Array.isArray(rawData.locCliRows)) addRows(rawData.locCliRows, 'Gasto local');
  if (Array.isArray(rawData.segVentaRows)) addRows(rawData.segVentaRows, 'Seguro');
  if (collected.length) return collected;

  if (Array.isArray(rawData.sections)) {
    const items = rawData.sections.flatMap((sec) =>
      Array.isArray(sec.items) ? sec.items : []
    );
    if (items.length) return items;
  }

  for (const key of ['lines', 'rows', 'concepts']) {
    if (Array.isArray(rawData[key])) return rawData[key];
  }

  if (rawData.items && typeof rawData.items === 'object') {
    const values = Object.values(rawData.items).filter(Boolean);
    if (values.length) return values;
  }

  const deepItems = [];
  const visit = (val) => {
    if (!val) return;
    if (Array.isArray(val)) {
      const candidates = val.filter(
        (it) =>
          it &&
          typeof it === 'object' &&
          (it.description || it.name) &&
          (it.unit_price != null || it.price != null || it.unitPrice != null)
      );
      if (candidates.length) {
        deepItems.push(...candidates);
        return;
      }
      val.forEach(visit);
      return;
    }
    if (typeof val === 'object') {
      Object.values(val).forEach(visit);
    }
  };
  visit(rawData);
  if (deepItems.length) return deepItems;

  return [];
}

// =================== ENDPOINTS ===================

// GET /api/invoices
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, organization_id, from_date, to_date, search } = req.query;
    const userId = req.user.id;
    const userRole = String(req.user.role || '').toLowerCase();

    let query = `
      SELECT 
        i.*, 
        o.name as organization_name,
        d.title as deal_title,
        d.reference as deal_reference,
        u.name as created_by_name
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN users u ON u.id = i.created_by
      WHERE 1=1
    `;
    const params = [];

    if (userRole === 'ejecutivo') {
      query += ' AND i.created_by = ?';
      params.push(userId);
    }
    if (status) { query += ' AND i.status = ?'; params.push(status); }
    if (organization_id) { query += ' AND i.organization_id = ?'; params.push(organization_id); }
    if (from_date) { query += ' AND i.issue_date >= ?'; params.push(from_date); }
    if (to_date) { query += ' AND i.issue_date <= ?'; params.push(to_date); }
    if (search) {
      query += ' AND (i.invoice_number LIKE ? OR o.name LIKE ? OR d.reference LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY i.created_at DESC';
    const [invoices] = await pool.query(query, params);
    res.json(invoices);
  } catch (e) {
    console.error('[invoices] Error listing:', e);
    res.status(500).json({ error: 'Error al listar facturas' });
  }
});

// GET /api/invoices/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[invoice]] = await pool.query(
      `SELECT 
        i.*, 
        o.name as organization_name,
        o.ruc as organization_ruc,
        o.address as organization_address,
        o.city as organization_city,
        d.id as deal_id,
        d.title as deal_title,
        d.reference as deal_reference,
        u.name as created_by_name,
        u2.name as issued_by_name
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN users u ON u.id = i.created_by
      LEFT JOIN users u2 ON u2.id = i.issued_by
      WHERE i.id = ?`,
      [id]
    );

    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (!canManageInvoice(req.user, invoice)) return res.status(403).json({ error: 'No tienes permiso para ver esta factura' });

    const [items] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY item_order, id',
      [id]
    );
    const [payments] = await pool.query(
      `SELECT p.*, u.name as registered_by_name
       FROM invoice_payments p
       LEFT JOIN users u ON u.id = p.registered_by
       WHERE p.invoice_id = ?
       ORDER BY p.payment_date DESC`,
      [id]
    );

    res.json({ ...invoice, items, payments });
  } catch (e) {
    console.error('[invoices] Error getting detail:', e);
    res.status(500).json({ error: 'Error al obtener factura' });
  }
});

// POST /api/invoices - Crear factura
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      deal_id,
      due_date,
      payment_terms,
      notes,
      percentage,
      payment_condition,
      timbrado_number,
      timbrado_expires_at,
      timbrado_start_date,
      customer_doc,
      customer_doc_type,
      customer_email,
      customer_address,
      currency_code,
      exchange_rate,
      point_of_issue,
      establishment,
      sales_rep,
      purchase_order_ref,
    } = req.body;
    const userId = req.user.id;
    if (!deal_id) return res.status(400).json({ error: 'deal_id es requerido' });

    await ensureInvoiceExtraColumns();
    await ensureInvoiceItemsTaxColumn();
    await ensureInvoiceCreditColumns();

    const [[deal]] = await pool.query(
      `SELECT d.*, s.name as stage_name 
       FROM deals d
       LEFT JOIN stages s ON s.id = d.stage_id
       WHERE d.id = ? LIMIT 1`,
      [deal_id]
    );
    if (!deal) return res.status(404).json({ error: 'Deal no encontrado' });

    const stageName = String(deal.stage_name || '').toLowerCase();
    const isConfirmed = stageName.includes('conf') || stageName.includes('coord');
    if (!isConfirmed) {
      return res.status(400).json({ error: 'La operacion debe estar confirmada (etapa con conf/coord) para generar factura' });
    }

    let pct = Number(percentage ?? 100);
    if (Number.isNaN(pct) || pct <= 0 || pct > 100) pct = 100;
    const factor = pct / 100;

    if (pct < 100) {
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(percentage), 0) as used_pct
         FROM invoices
         WHERE deal_id = ? AND status != 'anulada'`,
        [deal_id]
      );
      const used = parseFloat(row.used_pct || 0);
      if (used + pct > 100.01) {
        return res.status(400).json({ error: `El porcentaje acumulado (${used.toFixed(2)}%) supera el 100%` });
      }
    }

    const [[costSheet]] = await pool.query(
      `SELECT cs.current_version_id, cs.data as legacy_data, v.data as version_data
       FROM deal_cost_sheets cs
       LEFT JOIN deal_cost_sheet_versions v ON v.id = cs.current_version_id
       WHERE cs.deal_id = ?
       LIMIT 1`,
      [deal_id]
    );
    const rawData = costSheet?.version_data ?? costSheet?.legacy_data;
    if (!costSheet || !rawData) return res.status(400).json({ error: 'El deal no tiene presupuesto' });

    let costSheetData;
    try {
      costSheetData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (_e) {
      return res.status(400).json({ error: 'Error al leer el presupuesto' });
    }

    const items = extractCostItems(costSheetData);
    let invoiceItemsRaw = Array.isArray(items) ? items : [];

    if (invoiceItemsRaw.length === 0) {
      try {
        const [legacyItems] = await pool.query(
          `SELECT description, quantity, unit_price, item_order
           FROM deal_cost_sheet_items
           WHERE deal_id = ? AND is_active = 1
           ORDER BY item_order, id`,
          [deal_id]
        );
        invoiceItemsRaw = legacyItems || [];
      } catch (err) {
        console.warn('[invoices] no se pudo leer deal_cost_sheet_items:', err?.message);
      }
    }

    if (invoiceItemsRaw.length === 0) {
      return res.status(400).json({ error: 'El presupuesto no tiene items' });
    }

    const invoiceItems = invoiceItemsRaw
      .filter((item) => item && (item.description || item.name))
      .map((item, idx) => {
        const qty = parseFloat(item.quantity ?? item.qty ?? 1) || 1;
        const basePrice = parseFloat(item.unit_price ?? item.price ?? item.unitPrice ?? 0) || 0;
        const price = parseFloat((basePrice * factor).toFixed(2));
        const taxRate = 10; // Opción A: IVA 10% por defecto
        return {
          description: item.description || item.name || 'Sin descripcion',
          quantity: qty,
          unit_price: price,
          tax_rate: taxRate,
          subtotal: parseFloat((qty * price).toFixed(2)),
          base_unit_price: basePrice,
          item_order: item.item_order ?? idx,
        };
      });

    const baseSubtotal = invoiceItems.reduce(
      (sum, it) => sum + (parseFloat(it.base_unit_price || 0) * (parseFloat(it.quantity) || 1)),
      0
    );

    const totals = calculateTotals(invoiceItems);
    const invoiceNumber = await generateInvoiceNumber();

    const [result] = await pool.query(
      `INSERT INTO invoices 
       (invoice_number, deal_id, organization_id, subtotal, tax_rate, tax_amount, 
        total_amount, balance, due_date, payment_terms, notes, created_by,
        percentage, base_amount, payment_condition, timbrado_number, timbrado_expires_at,
        credited_total, net_total_amount, net_balance,
        timbrado_start_date, customer_doc, customer_doc_type, customer_email, customer_address,
        currency_code, exchange_rate, point_of_issue, establishment, sales_rep, purchase_order_ref)
       VALUES (?, ?, ?, ?, 10.00, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNumber,
        deal_id,
        deal.organization_id || deal.org_id,
        totals.subtotal,
        totals.tax_amount,
        totals.total_amount,
        totals.total_amount,
        due_date || null,
        payment_terms || null,
        notes || null,
        userId,
        pct,
        baseSubtotal.toFixed(2),
        payment_condition || null,
        timbrado_number || null,
        timbrado_expires_at || null,
        totals.total_amount,
        totals.total_amount,
        timbrado_start_date || null,
        customer_doc || null,
        customer_doc_type || null,
        customer_email || null,
        customer_address || null,
        currency_code || 'USD',
        exchange_rate || 1,
        point_of_issue || null,
        establishment || null,
        sales_rep || null,
        purchase_order_ref || null,
      ]
    );

    const invoiceId = result.insertId;

    for (let i = 0; i < invoiceItems.length; i++) {
      const item = invoiceItems[i];
      await pool.query(
        `INSERT INTO invoice_items 
         (invoice_id, description, quantity, unit_price, subtotal, cost_sheet_item_id, item_order, tax_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [invoiceId, item.description, item.quantity, item.unit_price, item.subtotal, null, item.item_order, item.tax_rate]
      );
    }

    const [[invoice]] = await pool.query(
      `SELECT i.*, d.title as deal_title, d.reference as deal_reference
       FROM invoices i
       LEFT JOIN deals d ON d.id = i.deal_id
       WHERE i.id = ?`,
      [invoiceId]
    );

    res.status(201).json(invoice);
  } catch (e) {
    console.error('[invoices] Error creating:', e);
    res.status(500).json({ error: 'Error al crear factura' });
  }
});

// PATCH /api/invoices/:id - Actualizar factura (borrador)
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { due_date, payment_terms, notes, items } = req.body;

    const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (invoice.status !== 'borrador') return res.status(400).json({ error: 'Solo se pueden editar facturas en borrador' });
    if (!canManageInvoice(req.user, invoice)) return res.status(403).json({ error: 'No tienes permiso para editar esta factura' });

    if (items && Array.isArray(items)) {
      await pool.query('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await pool.query(
          `INSERT INTO invoice_items 
           (invoice_id, description, quantity, unit_price, subtotal, item_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, item.description, item.quantity, item.unit_price, item.subtotal, i]
        );
      }
      const totals = calculateTotals(items);
      await pool.query(
        `UPDATE invoices 
         SET subtotal = ?, tax_amount = ?, total_amount = ?, balance = ?
         WHERE id = ?`,
        [totals.subtotal, totals.tax_amount, totals.total_amount, totals.total_amount, id]
      );
    }

    const updates = [];
    const params = [];
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date); }
    if (payment_terms !== undefined) { updates.push('payment_terms = ?'); params.push(payment_terms); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

    if (updates.length > 0) {
      params.push(id);
      await pool.query(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const [[updated]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[invoices] Error updating:', e);
    res.status(500).json({ error: 'Error al actualizar factura' });
  }
});

// DELETE /api/invoices/:id - Eliminar factura (borrador)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (invoice.status !== 'borrador') return res.status(400).json({ error: 'Solo se pueden eliminar facturas en borrador' });
    if (!canManageInvoice(req.user, invoice)) return res.status(403).json({ error: 'No tienes permiso para eliminar esta factura' });
    await pool.query('DELETE FROM invoices WHERE id = ?', [id]);
    res.json({ message: 'Factura eliminada correctamente' });
  } catch (e) {
    console.error('[invoices] Error deleting:', e);
    res.status(500).json({ error: 'Error al eliminar factura' });
  }
});

// POST /api/invoices/:id/issue - Emitir factura
router.post('/:id/issue', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (invoice.status !== 'borrador') return res.status(400).json({ error: 'Solo se pueden emitir facturas en borrador' });
    if (!canManageInvoice(req.user, invoice)) return res.status(403).json({ error: 'No tienes permiso para emitir esta factura' });

    const [[count]] = await pool.query(
      'SELECT COUNT(*) as total FROM invoice_items WHERE invoice_id = ?',
      [id]
    );
    if (count.total === 0) return res.status(400).json({ error: 'La factura debe tener al menos un ítem' });

    await pool.query(
      `UPDATE invoices 
       SET status = 'emitida', issue_date = CURDATE(), issued_by = ?
       WHERE id = ?`,
      [userId, id]
    );

    const [[updated]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[invoices] Error issuing:', e);
    res.status(500).json({ error: 'Error al emitir factura' });
  }
});

// POST /api/invoices/:id/cancel - Anular factura
router.post('/:id/cancel', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Debe proporcionar un motivo de anulación' });

    const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (invoice.status === 'pagada') return res.status(400).json({ error: 'No se puede anular una factura pagada completamente' });
    if (invoice.status === 'anulada') return res.status(400).json({ error: 'La factura ya está anulada' });

    await pool.query(
      `UPDATE invoices 
       SET status = 'anulada', cancellation_reason = ?
       WHERE id = ?`,
      [reason, id]
    );

    const [[updated]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[invoices] Error canceling:', e);
    res.status(500).json({ error: 'Error al anular factura' });
  }
});

// POST /api/invoices/:id/payments - Registrar pago
router.post('/:id/payments', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_date, amount, payment_method, reference_number, notes } = req.body;
    const userId = req.user.id;

    if (!payment_date || !amount || !payment_method) {
      return res.status(400).json({ error: 'payment_date, amount y payment_method son requeridos' });
    }

    const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (invoice.status !== 'emitida' && invoice.status !== 'pago_parcial') {
      return res.status(400).json({ error: 'Solo se pueden registrar pagos en facturas emitidas o con pago parcial' });
    }

    const paymentAmount = parseFloat(amount);
    const currentBalance = parseFloat(invoice.balance);
    if (paymentAmount > currentBalance) {
      return res.status(400).json({ error: 'El monto del pago no puede ser mayor al saldo pendiente' });
    }

    await pool.query(
      `INSERT INTO invoice_payments 
       (invoice_id, payment_date, amount, payment_method, reference_number, notes, registered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, payment_date, paymentAmount, payment_method, reference_number, notes, userId]
    );

    const newPaidAmount = parseFloat(invoice.paid_amount) + paymentAmount;
    const newBalance = parseFloat(invoice.total_amount) - newPaidAmount;
    const newStatus = newBalance === 0 ? 'pagada' : 'pago_parcial';

    await pool.query(
      `UPDATE invoices 
       SET paid_amount = ?, balance = ?, status = ?, paid_date = IF(? = 0, CURDATE(), paid_date)
       WHERE id = ?`,
      [newPaidAmount, newBalance, newStatus, newBalance, id]
    );

    const [[updated]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[invoices] Error registering payment:', e);
    res.status(500).json({ error: 'Error al registrar pago' });
  }
});

// GET /api/invoices/:id/payments
router.get('/:id/payments', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [payments] = await pool.query(
      `SELECT p.*, u.name as registered_by_name
       FROM invoice_payments p
       LEFT JOIN users u ON u.id = p.registered_by
       WHERE p.invoice_id = ?
       ORDER BY p.payment_date DESC`,
      [id]
    );
    res.json(payments);
  } catch (e) {
    console.error('[invoices] Error listing payments:', e);
    res.status(500).json({ error: 'Error al listar pagos' });
  }
});

// GET /api/invoices/:id/pdf - Generar PDF
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[invoice]] = await pool.query(
      `SELECT 
        i.*, 
        o.name as organization_name,
        o.ruc as organization_ruc,
        o.address as organization_address,
        o.city as organization_city,
        d.reference as deal_reference,
        d.title as deal_title
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      WHERE i.id = ?`,
      [id]
    );
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    if (!canManageInvoice(req.user, invoice)) return res.status(403).json({ error: 'No tienes permiso para ver esta factura' });

    const [items] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY item_order, id',
      [id]
    );

    const issuer = {
      name: process.env.INVOICE_ISSUER_NAME || 'ATM CARGO S.R.L.',
      ruc: process.env.INVOICE_ISSUER_RUC || '80056841-6',
      phone: process.env.INVOICE_ISSUER_PHONE || '+595 21 493082',
      address: process.env.INVOICE_ISSUER_ADDRESS || 'Cap. Milciades Urbieta 175 e/ Rio de Janeiro y Mcal. Lopez',
      city: process.env.INVOICE_ISSUER_CITY || 'Asuncion - Paraguay',
      timbrado: invoice.timbrado_number || process.env.INVOICE_TIMBRADO_NUMBER || '',
      timbrado_start: formatDate(invoice.timbrado_start_date || process.env.INVOICE_TIMBRADO_START),
      timbrado_end: formatDate(invoice.timbrado_expires_at || process.env.INVOICE_TIMBRADO_END),
    };

    const breakdown = { exentas: 0, vat5: 0, vat10: 0, iva5: 0, iva10: 0 };
    const mappedItems = items.map((it) => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.unit_price || 0);
      const rate = Number(it.tax_rate ?? 10) || 0;
      const lineBase = qty * price;
      const iva = (lineBase * rate) / 100;
      const total = lineBase + iva;

      if (rate >= 9) {
        breakdown.vat10 += total;
        breakdown.iva10 += iva;
      } else if (rate >= 4) {
        breakdown.vat5 += total;
        breakdown.iva5 += iva;
      } else {
        breakdown.exentas += total;
      }
      return { ...it, qty, price, rate, lineBase, iva, total };
    });

    const totalAmount = breakdown.exentas + breakdown.vat5 + breakdown.vat10;
    const totalIva = breakdown.iva5 + breakdown.iva10;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="invoice-${invoice.invoice_number || id}.pdf"`
    );

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    // Encabezado
    doc.fontSize(16).text(issuer.name, 40, 40);
    doc.fontSize(10).text(`RUC: ${issuer.ruc}`, { align: 'left' });
    doc.text(issuer.address);
    doc.text(`${issuer.city}  Tel: ${issuer.phone}`);

    doc.fontSize(16).text(`Factura ${invoice.invoice_number || ''}`, { align: 'right' });
    if (issuer.timbrado) {
      doc.fontSize(10).text(`Timbrado: ${issuer.timbrado}`, { align: 'right' });
      if (issuer.timbrado_end) doc.text(`Vigencia: hasta ${issuer.timbrado_end}`, { align: 'right' });
    }

    // Datos del cliente
    doc.moveDown(1);
    doc.rect(40, doc.y, 515, 70).stroke();
    const startY = doc.y + 10;
    doc.fontSize(11).text('Cliente', 50, startY);
    doc.fontSize(10)
      .text(`Razon social: ${invoice.organization_name || ''}`, 50, startY + 15)
      .text(`RUC: ${invoice.customer_doc || invoice.organization_ruc || ''}`, 50, startY + 30)
      .text(`Direccion: ${invoice.customer_address || invoice.organization_address || ''}`, 50, startY + 45)
      .text(`Correo: ${invoice.customer_email || ''}`, 50, startY + 60);
    doc.fontSize(10)
      .text(`Fecha emision: ${formatDate(invoice.issue_date || new Date())}`, 360, startY + 15)
      .text(`Condicion de venta: ${invoice.payment_condition || 'Credito'}`, 360, startY + 30)
      .text(`Moneda: ${invoice.currency_code || 'USD'}`, 360, startY + 45)
      .text(`Cambio: ${invoice.exchange_rate || 1}`, 360, startY + 60);

    // Referencia
    doc.moveDown(3);
    doc.fontSize(11).text(
      `Ref: ${invoice.deal_reference || invoice.deal_id || ''}  ${invoice.deal_title || ''}`
    );

    // Tabla de items
    const tableTop = doc.y + 10;
    const colX = [45, 90, 240, 340, 400, 460];
    doc.fontSize(10).text('Cant.', colX[0], tableTop);
    doc.text('Descripcion', colX[1], tableTop);
    doc.text('Exentas', colX[2], tableTop);
    doc.text('5 %', colX[3], tableTop);
    doc.text('10 %', colX[4], tableTop);
    doc.moveTo(40, tableTop + 12).lineTo(555, tableTop + 12).stroke();

    let currentY = tableTop + 20;
    mappedItems.forEach((it) => {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }
      const exentasText = it.rate < 1 ? formatCurrency(it.total) : '';
      const vat5Text = it.rate >= 4 && it.rate < 9 ? formatCurrency(it.total) : '';
      const vat10Text = it.rate >= 9 ? formatCurrency(it.total) : '';

      doc.text(it.qty, colX[0], currentY);
      doc.text(it.description || 'Item', colX[1], currentY, { width: 140 });
      doc.text(exentasText, colX[2], currentY);
      doc.text(vat5Text, colX[3], currentY);
      doc.text(vat10Text, colX[4], currentY);
      currentY += 16;
    });

    doc.moveTo(40, currentY + 5).lineTo(555, currentY + 5).stroke();
    currentY += 15;

    // Totales
    doc.fontSize(11).text('Totales', 45, currentY);
    doc.fontSize(10)
      .text(`Exentas: ${formatCurrency(breakdown.exentas)}`, 200, currentY)
      .text(`Gravadas 5%: ${formatCurrency(breakdown.vat5)}`, 200, currentY + 14)
      .text(`Gravadas 10%: ${formatCurrency(breakdown.vat10)}`, 200, currentY + 28)
      .text(`IVA 5%: ${formatCurrency(breakdown.iva5)}`, 400, currentY)
      .text(`IVA 10%: ${formatCurrency(breakdown.iva10)}`, 400, currentY + 14)
      .text(`Total IVA: ${formatCurrency(totalIva)}`, 400, currentY + 28)
      .text(`TOTAL: ${formatCurrency(totalAmount)}`, 400, currentY + 45);

    if (invoice.notes) {
      doc.moveDown(2);
      doc.fontSize(10).text(`Notas: ${invoice.notes}`);
    }

    doc.end();
  } catch (e) {
    console.error('[invoices] Error generating PDF:', e);
    res.status(500).json({ error: 'Error al generar PDF' });
  }
});

// =================== CREDIT NOTES ===================
async function loadInvoiceWithPerms(req, invoiceId) {
  const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) return { invoice: null, error: { code: 404, msg: 'Factura no encontrada' } };
  if (!canManageInvoice(req.user, invoice)) {
    return { invoice: null, error: { code: 403, msg: 'No tienes permiso sobre esta factura' } };
  }
  return { invoice };
}

router.get('/:id/credit-notes', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureCreditNoteTables();
    await ensureInvoiceCreditColumns();
    const { invoice, error } = await loadInvoiceWithPerms(req, id);
    if (error) return res.status(error.code).json({ error: error.msg });

    const [notes] = await pool.query(
      `SELECT cn.*, u.name as created_by_name, u2.name as issued_by_name
       FROM credit_notes cn
       LEFT JOIN users u ON u.id = cn.created_by
       LEFT JOIN users u2 ON u2.id = cn.issued_by
       WHERE cn.invoice_id = ?
       ORDER BY cn.created_at DESC`,
      [id]
    );
    res.json(notes);
  } catch (e) {
    console.error('[credit-notes] Error listing:', e);
    res.status(500).json({ error: 'Error al listar notas de crédito' });
  }
});

router.get('/credit-notes/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureCreditNoteTables();
    await ensureInvoiceCreditColumns();
    const [[note]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Nota de crédito no encontrada' });

    const { invoice, error } = await loadInvoiceWithPerms(req, note.invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });

    const [items] = await pool.query(
      'SELECT * FROM credit_note_items WHERE credit_note_id = ? ORDER BY item_order, id',
      [id]
    );
    res.json({ ...note, items, invoice });
  } catch (e) {
    console.error('[credit-notes] Error getting detail:', e);
    res.status(500).json({ error: 'Error al obtener nota de crédito' });
  }
});

router.post('/credit-notes', requireAuth, async (req, res) => {
  try {
    const { invoice_id, reason, items: payloadItems } = req.body;
    if (!invoice_id) return res.status(400).json({ error: 'invoice_id es requerido' });

    await ensureCreditNoteTables();
    await ensureInvoiceItemsTaxColumn();
    await ensureInvoiceCreditColumns();

    const { invoice, error } = await loadInvoiceWithPerms(req, invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });
    if (['borrador', 'anulada'].includes(invoice.status)) {
      return res.status(400).json({ error: 'Solo se puede crear nota de crédito sobre facturas emitidas' });
    }

    const items = Array.isArray(payloadItems) ? payloadItems : null;
    let creditItems = [];
    if (items && items.length > 0) {
      creditItems = items.map((it, idx) => {
        const qty = parseFloat(it.quantity || 1) || 1;
        const price = parseFloat(it.unit_price || 0) || 0;
        const subtotal = parseFloat((qty * price).toFixed(2));
        const rate = parseFloat(it.tax_rate ?? 10) || 0;
        return {
          description: it.description || 'Item',
          quantity: qty,
          unit_price: price,
          subtotal,
          tax_rate: rate,
          item_order: it.item_order ?? idx,
        };
      });
    } else {
      const [invItems] = await pool.query(
        'SELECT description, quantity, unit_price, subtotal, tax_rate, item_order FROM invoice_items WHERE invoice_id = ? ORDER BY item_order, id',
        [invoice_id]
      );
      creditItems = invItems.map((it, idx) => ({
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        subtotal: it.subtotal,
        tax_rate: it.tax_rate ?? 10,
        item_order: it.item_order ?? idx,
      }));
    }

    if (creditItems.length === 0) {
      return res.status(400).json({ error: 'La nota de crédito debe tener al menos un ítem' });
    }

    const totals = calculateTotals(creditItems);
    const availableCredit = Math.max(
      0,
      parseFloat(invoice.total_amount || 0) -
        (parseFloat(invoice.credited_total || 0) || 0)
    );
    if (parseFloat(totals.total_amount) > availableCredit + 0.01) {
      return res.status(400).json({ error: 'El monto de la nota excede lo disponible de la factura' });
    }

    const creditNumber = await generateCreditNoteNumber();
    const [result] = await pool.query(
      `INSERT INTO credit_notes 
       (credit_note_number, invoice_id, issue_date, status, reason, subtotal, tax_amount, total_amount, balance, created_by)
       VALUES (?, ?, NULL, 'borrador', ?, ?, ?, ?, ?, ?)`,
      [
        creditNumber,
        invoice_id,
        reason || null,
        totals.subtotal,
        totals.tax_amount,
        totals.total_amount,
        totals.total_amount,
        req.user.id,
      ]
    );
    const creditId = result.insertId;
    for (let i = 0; i < creditItems.length; i++) {
      const it = creditItems[i];
      await pool.query(
        `INSERT INTO credit_note_items 
         (credit_note_id, description, quantity, unit_price, subtotal, tax_rate, item_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [creditId, it.description, it.quantity, it.unit_price, it.subtotal, it.tax_rate ?? 10, it.item_order]
      );
    }

    res.status(201).json({ id: creditId, credit_note_number: creditNumber, status: 'borrador' });
  } catch (e) {
    console.error('[credit-notes] Error creating:', e);
    res.status(500).json({ error: 'Error al crear nota de crédito' });
  }
});

router.post('/credit-notes/:id/issue', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureCreditNoteTables();
    await ensureInvoiceCreditColumns();
    const [[note]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Nota de crédito no encontrada' });
    if (note.status !== 'borrador') return res.status(400).json({ error: 'Solo se puede emitir desde borrador' });

    const { invoice, error } = await loadInvoiceWithPerms(req, note.invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });

    await pool.query(
      `UPDATE credit_notes 
       SET status = 'emitida', issue_date = CURDATE(), issued_by = ?
       WHERE id = ?`,
      [req.user.id, id]
    );
    // Anular la factura original y marcar el vínculo con la NC
    await pool.query(
      `UPDATE invoices 
       SET status = 'anulada',
           cancellation_reason = ?,
           canceled_by_credit_note_id = ?,
           credited_total = total_amount,
           net_total_amount = 0,
           net_balance = 0,
           balance = 0
       WHERE id = ?`,
      [`Anulada por nota de crédito ${note.credit_note_number}`, id, invoice.id]
    );
    await recomputeInvoiceCredits(invoice.id);
    const [[updated]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[credit-notes] Error issuing:', e);
    res.status(500).json({ error: 'Error al emitir nota de crédito' });
  }
});

router.post('/credit-notes/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureCreditNoteTables();
    await ensureInvoiceCreditColumns();
    const [[note]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Nota de crédito no encontrada' });
    if (note.status === 'anulada') return res.status(400).json({ error: 'Ya está anulada' });

    const { invoice, error } = await loadInvoiceWithPerms(req, note.invoice_id);
    if (error) return res.status(error.code).json({ error: error.msg });

    await pool.query(`UPDATE credit_notes SET status = 'anulada' WHERE id = ?`, [id]);
    await recomputeInvoiceCredits(invoice.id);
    const [[updated]] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
    res.json(updated);
  } catch (e) {
    console.error('[credit-notes] Error canceling:', e);
    res.status(500).json({ error: 'Error al anular nota de crédito' });
  }
});

export default router;
