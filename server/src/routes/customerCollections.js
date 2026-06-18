import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireAnyRole('admin', 'finanzas'));

async function ensureCustomerCollectionTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_payment_promises (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id INT NULL,
      customer_key VARCHAR(128) NULL,
      invoice_id INT NULL,
      promise_date DATE NOT NULL,
      promised_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      currency_code VARCHAR(8) NOT NULL DEFAULT 'USD',
      status VARCHAR(24) NOT NULL DEFAULT 'pendiente',
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_customer (organization_id, customer_key),
      INDEX idx_invoice (invoice_id),
      INDEX idx_status_date (status, promise_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_collection_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id INT NULL,
      customer_key VARCHAR(128) NULL,
      invoice_id INT NULL,
      event_type VARCHAR(32) NOT NULL DEFAULT 'nota',
      event_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      subject VARCHAR(180) NULL,
      notes TEXT NULL,
      next_action_date DATE NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_customer (organization_id, customer_key),
      INDEX idx_invoice (invoice_id),
      INDEX idx_event_date (event_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

ensureCustomerCollectionTables().catch((err) =>
  console.error('[customer-collections] init tables error', err?.message || err)
);

function customerWhere(query = {}, alias = '') {
  const organizationId = Number(query.organization_id || 0) || null;
  const customerKey = String(query.customer_key || '').trim() || null;
  const where = [];
  const params = [];
  const prefix = alias ? `${alias}.` : '';

  if (organizationId) {
    where.push(`${prefix}organization_id = ?`);
    params.push(organizationId);
  } else if (customerKey) {
    where.push(`${prefix}customer_key = ?`);
    params.push(customerKey);
  }

  if (!where.length) {
    const error = new Error('Cliente requerido');
    error.statusCode = 400;
    throw error;
  }

  return { clause: where.join(' AND '), params, organizationId, customerKey };
}

function normalizeStatus(value) {
  const raw = String(value || 'pendiente').trim().toLowerCase();
  if (['pendiente', 'cumplida', 'incumplida', 'cancelada'].includes(raw)) return raw;
  return 'pendiente';
}

function normalizeEventType(value) {
  const raw = String(value || 'nota').trim().toLowerCase();
  if (['nota', 'llamada', 'email', 'whatsapp', 'promesa', 'reclamo', 'otro'].includes(raw)) return raw;
  return 'nota';
}

router.get('/', async (req, res) => {
  try {
    await ensureCustomerCollectionTables();
    const promiseWhere = customerWhere(req.query || {}, 'p');
    const eventWhere = customerWhere(req.query || {}, 'e');
    const [promises] = await pool.query(
      `
      SELECT p.*, i.invoice_number, u.name AS created_by_name
        FROM customer_payment_promises p
        LEFT JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN users u ON u.id = p.created_by
       WHERE ${promiseWhere.clause}
       ORDER BY
         CASE p.status
           WHEN 'pendiente' THEN 0
           WHEN 'incumplida' THEN 1
           WHEN 'cumplida' THEN 2
           ELSE 3
         END,
         p.promise_date ASC,
         p.id DESC
      `,
      promiseWhere.params
    );

    const [events] = await pool.query(
      `
      SELECT e.*, i.invoice_number, u.name AS created_by_name
        FROM customer_collection_events e
        LEFT JOIN invoices i ON i.id = e.invoice_id
        LEFT JOIN users u ON u.id = e.created_by
       WHERE ${eventWhere.clause}
       ORDER BY e.event_date DESC, e.id DESC
       LIMIT 100
      `,
      eventWhere.params
    );

    res.json({ promises, events });
  } catch (err) {
    console.error('[customer-collections] list error', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'No se pudo cargar cobranza' });
  }
});

router.post('/promises', async (req, res) => {
  try {
    await ensureCustomerCollectionTables();
    const organizationId = Number(req.body?.organization_id || 0) || null;
    const customerKey = String(req.body?.customer_key || '').trim() || null;
    if (!organizationId && !customerKey) return res.status(400).json({ error: 'Cliente requerido' });

    const promiseDate = req.body?.promise_date || null;
    const amount = Number(req.body?.promised_amount || 0);
    if (!promiseDate) return res.status(400).json({ error: 'Fecha prometida requerida' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto prometido invalido' });

    const invoiceId = Number(req.body?.invoice_id || 0) || null;
    const currencyCode = String(req.body?.currency_code || 'USD').trim().toUpperCase() || 'USD';
    const notes = String(req.body?.notes || '').trim() || null;

    const [result] = await pool.query(
      `
      INSERT INTO customer_payment_promises
        (organization_id, customer_key, invoice_id, promise_date, promised_amount,
         currency_code, status, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)
      `,
      [organizationId, customerKey, invoiceId, promiseDate, amount, currencyCode, notes, req.user?.id || null]
    );

    const [[row]] = await pool.query(
      `SELECT p.*, i.invoice_number, u.name AS created_by_name
         FROM customer_payment_promises p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.id = ?`,
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error('[customer-collections] create promise error', err);
    res.status(500).json({ error: 'No se pudo registrar la promesa' });
  }
});

router.patch('/promises/:id', async (req, res) => {
  try {
    await ensureCustomerCollectionTables();
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'Promesa invalida' });
    const status = normalizeStatus(req.body?.status);
    const notes = req.body?.notes == null ? null : String(req.body.notes || '').trim();

    await pool.query(
      `
      UPDATE customer_payment_promises
         SET status = ?,
             notes = CASE WHEN ? IS NULL THEN notes ELSE ? END
       WHERE id = ?
      `,
      [status, notes, notes, id]
    );

    const [[row]] = await pool.query(
      `SELECT p.*, i.invoice_number, u.name AS created_by_name
         FROM customer_payment_promises p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.id = ?`,
      [id]
    );
    res.json(row);
  } catch (err) {
    console.error('[customer-collections] update promise error', err);
    res.status(500).json({ error: 'No se pudo actualizar la promesa' });
  }
});

router.post('/events', async (req, res) => {
  try {
    await ensureCustomerCollectionTables();
    const organizationId = Number(req.body?.organization_id || 0) || null;
    const customerKey = String(req.body?.customer_key || '').trim() || null;
    if (!organizationId && !customerKey) return res.status(400).json({ error: 'Cliente requerido' });

    const invoiceId = Number(req.body?.invoice_id || 0) || null;
    const eventType = normalizeEventType(req.body?.event_type);
    const eventDate = req.body?.event_date || new Date().toISOString().slice(0, 19).replace('T', ' ');
    const subject = String(req.body?.subject || '').trim() || null;
    const notes = String(req.body?.notes || '').trim() || null;
    const nextActionDate = req.body?.next_action_date || null;

    if (!subject && !notes) return res.status(400).json({ error: 'Asunto o detalle requerido' });

    const [result] = await pool.query(
      `
      INSERT INTO customer_collection_events
        (organization_id, customer_key, invoice_id, event_type, event_date,
         subject, notes, next_action_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        organizationId,
        customerKey,
        invoiceId,
        eventType,
        eventDate,
        subject,
        notes,
        nextActionDate,
        req.user?.id || null,
      ]
    );

    const [[row]] = await pool.query(
      `SELECT e.*, i.invoice_number, u.name AS created_by_name
         FROM customer_collection_events e
         LEFT JOIN invoices i ON i.id = e.invoice_id
         LEFT JOIN users u ON u.id = e.created_by
        WHERE e.id = ?`,
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error('[customer-collections] create event error', err);
    res.status(500).json({ error: 'No se pudo registrar el seguimiento' });
  }
});

export default router;
