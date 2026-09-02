import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
const MILESTONES = [
  'supplier_start_payment',
  'manufacturing_start',
  'factory_departure',
  'paraguay_arrival',
  'installation',
];

const num = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value, currency = 'USD') => {
  const decimals = ['PYG', 'GS'].includes(String(currency).toUpperCase()) ? 0 : 2;
  return Number(num(value).toFixed(decimals));
};
const dateOnly = (value) => value ? String(value).slice(0, 10) : null;

async function getIndustrialDeal(conn, dealId) {
  const [[deal]] = await conn.query(
    `SELECT d.id, d.reference, d.title, d.org_id AS organization_id, d.business_unit_id, bu.key_slug AS business_unit_key
       FROM deals d
       LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE d.id = ?`,
    [dealId]
  );
  if (!deal) return null;
  return String(deal.business_unit_key || '').toLowerCase() === 'atm-industrial' ? deal : false;
}

async function getInvoiceRows(conn, dealId) {
  const [rows] = await conn.query(
    `SELECT i.id, i.invoice_number, i.issue_date, i.status, i.currency_code,
            i.total_amount, COALESCE(i.credited_total, 0) AS credited_total,
            GREATEST(0, COALESCE(i.total_amount,0) - COALESCE(i.credited_total,0)) AS net_total,
            i.quote_revision_id,
            CASE
              WHEN i.quote_revision_id IS NULL THEN 'current'
              WHEN qr.id IS NULL THEN 'missing'
              ELSE 'saved'
            END AS revision_kind,
            CASE WHEN i.quote_revision_id IS NULL THEN 'Revisión actual'
                 ELSE COALESCE(qr.name, CONCAT('Revisión #', i.quote_revision_id))
            END AS revision_name,
            COALESCE(rp.debt_paid,0) AS debt_paid,
            COALESCE(rp.cash_received,0) AS cash_received,
            COALESCE(rp.retention_total,0) AS retention_total
       FROM invoices i
       LEFT JOIN quote_revisions qr ON qr.id = i.quote_revision_id
       LEFT JOIN (
         SELECT invoice_id, SUM(amount) AS debt_paid, SUM(net_amount) AS cash_received,
                SUM(retention_amount) AS retention_total
           FROM receipts
          WHERE status <> 'anulado'
          GROUP BY invoice_id
       ) rp ON rp.invoice_id = i.id
      WHERE i.deal_id = ?
        AND i.status NOT IN ('borrador','anulada')
      ORDER BY i.issue_date, i.id`,
    [dealId]
  );
  return rows || [];
}

function effectiveInstallments(items, baselineTotal, currentTotal, currency) {
  const result = items.map((item) => ({ ...item, effective_amount: money(item.planned_amount, currency) }));
  let credit = Math.max(0, money(baselineTotal - currentTotal, currency));
  for (let index = result.length - 1; index >= 0 && credit > 0; index -= 1) {
    const reduction = Math.min(credit, result[index].effective_amount);
    result[index].effective_amount = money(result[index].effective_amount - reduction, currency);
    credit = money(credit - reduction, currency);
  }
  return result;
}

function allocateReceipts({ installments, receipts, manualRows, currency }) {
  const allocations = new Map(installments.map((item) => [Number(item.id), {
    debt_paid: 0, cash_received: 0, retention: 0, receipts: [],
  }]));
  const capacity = new Map(installments.map((item) => [Number(item.id), num(item.effective_amount)]));
  const manualByReceipt = new Map();
  for (const row of manualRows || []) {
    if (!manualByReceipt.has(Number(row.receipt_id))) manualByReceipt.set(Number(row.receipt_id), []);
    manualByReceipt.get(Number(row.receipt_id)).push(row);
  }

  for (const receipt of receipts || []) {
    const debtTotal = money(receipt.amount, currency);
    const cashTotal = money(receipt.net_amount, currency);
    const retentionTotal = money(receipt.retention_amount, currency);
    const manual = manualByReceipt.get(Number(receipt.id));
    let parts = [];
    if (manual?.length) {
      parts = manual.map((row) => ({ installment_id: Number(row.installment_id), amount: money(row.amount_applied, currency) }));
    } else {
      let remaining = debtTotal;
      for (const item of installments) {
        if (remaining <= 0) break;
        const id = Number(item.id);
        const available = Math.max(0, num(capacity.get(id)));
        const applied = Math.min(remaining, available);
        if (applied > 0) parts.push({ installment_id: id, amount: money(applied, currency) });
        remaining = money(remaining - applied, currency);
      }
      if (remaining > 0 && installments.length) {
        const lastId = Number(installments[installments.length - 1].id);
        parts.push({ installment_id: lastId, amount: remaining });
      }
    }
    for (const part of parts) {
      const bucket = allocations.get(part.installment_id);
      if (!bucket || part.amount <= 0) continue;
      const ratio = debtTotal > 0 ? part.amount / debtTotal : 0;
      bucket.debt_paid = money(bucket.debt_paid + part.amount, currency);
      bucket.cash_received = money(bucket.cash_received + cashTotal * ratio, currency);
      bucket.retention = money(bucket.retention + retentionTotal * ratio, currency);
      bucket.receipts.push({
        id: receipt.id,
        receipt_number: receipt.receipt_number,
        issue_date: dateOnly(receipt.issue_date),
        debt_applied: part.amount,
        cash_received: money(cashTotal * ratio, currency),
        retention: money(retentionTotal * ratio, currency),
        manual: Boolean(manual?.length),
      });
      capacity.set(part.installment_id, money(num(capacity.get(part.installment_id)) - part.amount, currency));
    }
  }
  return allocations;
}

function installmentStatus(item) {
  if (item.balance <= 0.009) return 'cancelada';
  if (item.debt_paid > 0) return 'parcial';
  if (!item.expected_date) return 'sin_fecha';
  return item.expected_date < new Date().toISOString().slice(0, 10) ? 'atrasada' : 'programada';
}

async function buildPayload(conn, dealId) {
  const deal = await getIndustrialDeal(conn, dealId);
  if (deal === null) return { error: 404, message: 'Operacion no encontrada' };
  if (deal === false) return { error: 400, message: 'La operacion no es ATM Industrial' };
  const invoices = await getInvoiceRows(conn, dealId);
  const invoiceIds = invoices.map((row) => Number(row.id));
  let plans = [], items = [], receipts = [], manualRows = [];
  if (invoiceIds.length) {
    const placeholders = invoiceIds.map(() => '?').join(',');
    [plans] = await conn.query(`SELECT * FROM industrial_collection_plans WHERE invoice_id IN (${placeholders})`, invoiceIds);
    const planIds = plans.map((row) => Number(row.id));
    if (planIds.length) {
      const pp = planIds.map(() => '?').join(',');
      [items] = await conn.query(`SELECT * FROM industrial_collection_installments WHERE plan_id IN (${pp}) ORDER BY plan_id, sequence_no`, planIds);
    }
    [receipts] = await conn.query(`SELECT id, invoice_id, receipt_number, issue_date, amount, net_amount, retention_amount FROM receipts WHERE invoice_id IN (${placeholders}) AND status <> 'anulado' ORDER BY issue_date, id`, invoiceIds);
    [manualRows] = await conn.query(
      `SELECT a.* FROM industrial_receipt_installment_allocations a
        JOIN receipts r ON r.id = a.receipt_id
       WHERE r.invoice_id IN (${placeholders}) AND r.status <> 'anulado'`,
      invoiceIds
    );
  }
  const planByInvoice = new Map(plans.map((row) => [Number(row.invoice_id), row]));
  const resultInvoices = invoices.map((invoice) => {
    const currency = String(invoice.currency_code || 'PYG').toUpperCase();
    const plan = planByInvoice.get(Number(invoice.id));
    if (!plan) return { ...invoice, net_total: money(invoice.net_total, currency), plan: null };
    const planItems = items.filter((item) => Number(item.plan_id) === Number(plan.id));
    const effective = effectiveInstallments(planItems, num(plan.baseline_total), num(invoice.net_total), currency);
    const invoiceReceipts = receipts.filter((row) => Number(row.invoice_id) === Number(invoice.id));
    const allocations = allocateReceipts({ installments: effective, receipts: invoiceReceipts, manualRows, currency });
    const enriched = effective.map((item) => {
      const paid = allocations.get(Number(item.id)) || { debt_paid: 0, cash_received: 0, retention: 0, receipts: [] };
      const value = {
        ...item,
        expected_date: dateOnly(item.expected_date),
        debt_paid: money(paid.debt_paid, currency),
        cash_received: money(paid.cash_received, currency),
        retention: money(paid.retention, currency),
        balance: money(Math.max(0, num(item.effective_amount) - paid.debt_paid), currency),
        receipts: paid.receipts,
      };
      value.status = installmentStatus(value);
      return value;
    });
    const effectiveTotal = money(enriched.reduce((sum, row) => sum + num(row.effective_amount), 0), currency);
    return {
      ...invoice,
      net_total: money(invoice.net_total, currency),
      plan: {
        ...plan,
        baseline_total: money(plan.baseline_total, currency),
        installments: enriched,
        unplanned_difference: money(Math.max(0, num(invoice.net_total) - effectiveTotal), currency),
        needs_review: Math.abs(num(invoice.net_total) - effectiveTotal) > (currency === 'PYG' ? 0.5 : 0.009),
      },
    };
  });
  const [milestones] = await conn.query(`SELECT * FROM industrial_logistics_milestones WHERE deal_id = ?`, [dealId]);
  const summary = {};
  for (const invoice of resultInvoices) {
    const currency = String(invoice.currency_code || 'PYG').toUpperCase();
    if (!summary[currency]) summary[currency] = { invoiced: 0, credited: 0, debt_paid: 0, cash_received: 0, retention: 0, pending: 0 };
    summary[currency].invoiced += num(invoice.total_amount);
    summary[currency].credited += num(invoice.credited_total);
    summary[currency].debt_paid += num(invoice.debt_paid);
    summary[currency].cash_received += num(invoice.cash_received);
    summary[currency].retention += num(invoice.retention_total);
    summary[currency].pending += Math.max(0, num(invoice.net_total) - num(invoice.debt_paid));
  }
  for (const [currency, bucket] of Object.entries(summary)) {
    for (const key of Object.keys(bucket)) bucket[key] = money(bucket[key], currency);
  }
  return { deal, enabled: invoices.length > 0, summary, invoices: resultInvoices, milestones };
}

router.get('/deals/:dealId', requireAuth, async (req, res) => {
  try {
    const payload = await buildPayload(pool, Number(req.params.dealId));
    if (payload.error) return res.status(payload.error).json({ error: payload.message });
    res.json(payload);
  } catch (error) {
    console.error('[industrial-planning] get', error);
    res.status(500).json({ error: 'No se pudo cargar la planificacion. Verifica que la migracion este aplicada.' });
  }
});

router.put('/deals/:dealId/invoices/:invoiceId/plan', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const dealId = Number(req.params.dealId);
    const invoiceId = Number(req.params.invoiceId);
    const deal = await getIndustrialDeal(conn, dealId);
    if (!deal) return res.status(deal === null ? 404 : 400).json({ error: deal === null ? 'Operacion no encontrada' : 'La operacion no es industrial' });
    const invoices = await getInvoiceRows(conn, dealId);
    const invoice = invoices.find((row) => Number(row.id) === invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Factura emitida no encontrada' });
    const currency = String(invoice.currency_code || 'PYG').toUpperCase();
    const incoming = Array.isArray(req.body?.installments) ? req.body.installments : [];
    if (!incoming.length) return res.status(400).json({ error: 'Agrega al menos una cuota' });
    const normalized = incoming.map((item, index) => ({
      sequence_no: index + 1,
      concept: String(item.concept || `Cuota ${index + 1}`).trim().slice(0, 120),
      percentage: item.percentage === '' || item.percentage == null ? null : num(item.percentage),
      planned_amount: money(item.planned_amount, currency),
      expected_date: dateOnly(item.expected_date),
      notes: String(item.notes || '').trim().slice(0, 500) || null,
    }));
    if (normalized.some((item) => item.planned_amount < 0)) return res.status(400).json({ error: 'Los montos no pueden ser negativos' });
    const total = money(normalized.reduce((sum, item) => sum + item.planned_amount, 0), currency);
    const tolerance = currency === 'PYG' ? 0.5 : 0.009;
    if (Math.abs(total - num(invoice.net_total)) > tolerance) {
      return res.status(400).json({ error: `Las cuotas deben sumar ${money(invoice.net_total, currency)} ${currency}` });
    }
    await conn.beginTransaction();
    const [[existing]] = await conn.query(`SELECT * FROM industrial_collection_plans WHERE invoice_id = ? FOR UPDATE`, [invoiceId]);
    const expectedVersion = req.body?.version == null ? null : Number(req.body.version);
    if (existing && expectedVersion != null && Number(existing.version) !== expectedVersion) {
      await conn.rollback();
      return res.status(409).json({ error: 'La planificacion fue modificada por otro usuario. Recarga antes de guardar.' });
    }
    let planId;
    if (existing) {
      planId = existing.id;
      await conn.query(`UPDATE industrial_collection_plans SET baseline_total=?, currency_code=?, version=version+1, updated_by=? WHERE id=?`, [invoice.net_total, currency, req.user.id, planId]);
      await conn.query(`DELETE FROM industrial_collection_installments WHERE plan_id=?`, [planId]);
    } else {
      const [result] = await conn.query(`INSERT INTO industrial_collection_plans (deal_id, invoice_id, currency_code, baseline_total, created_by, updated_by) VALUES (?,?,?,?,?,?)`, [dealId, invoiceId, currency, invoice.net_total, req.user.id, req.user.id]);
      planId = result.insertId;
    }
    for (const item of normalized) {
      await conn.query(`INSERT INTO industrial_collection_installments (plan_id, sequence_no, concept, percentage, planned_amount, expected_date, notes) VALUES (?,?,?,?,?,?,?)`, [planId, item.sequence_no, item.concept, item.percentage, item.planned_amount, item.expected_date, item.notes]);
    }
    await conn.commit();
    await logAudit({ req, action: existing ? 'update' : 'create', entity: 'industrial_collection_plan', entityId: planId, description: `Plan de cobros de factura ${invoice.invoice_number}`, meta: { deal_id: dealId, invoice_id: invoiceId, installments: normalized } });
    res.json(await buildPayload(pool, dealId));
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[industrial-planning] save plan', error);
    res.status(500).json({ error: 'No se pudo guardar la planificacion' });
  } finally {
    conn.release();
  }
});

router.put('/deals/:dealId/milestones', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const dealId = Number(req.params.dealId);
    const deal = await getIndustrialDeal(conn, dealId);
    if (!deal) return res.status(deal === null ? 404 : 400).json({ error: 'Operacion industrial no encontrada' });
    const incoming = Array.isArray(req.body?.milestones) ? req.body.milestones : [];
    await conn.beginTransaction();
    for (const item of incoming) {
      const key = String(item.milestone_key || '');
      if (!MILESTONES.includes(key)) continue;
      await conn.query(
        `INSERT INTO industrial_logistics_milestones (deal_id, milestone_key, expected_date, actual_date, notes, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE expected_date=VALUES(expected_date), actual_date=VALUES(actual_date), notes=VALUES(notes), version=version+1, updated_by=VALUES(updated_by)`,
        [dealId, key, dateOnly(item.expected_date), dateOnly(item.actual_date), String(item.notes || '').trim().slice(0, 500) || null, req.user.id, req.user.id]
      );
    }
    await conn.commit();
    await logAudit({ req, action: 'update', entity: 'industrial_logistics', entityId: dealId, description: `Hitos logisticos de ${deal.reference}`, meta: { milestones: incoming } });
    res.json(await buildPayload(pool, dealId));
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[industrial-planning] milestones', error);
    res.status(500).json({ error: 'No se pudieron guardar los hitos logisticos' });
  } finally {
    conn.release();
  }
});

router.put('/invoices/:invoiceId/receipt-allocation', requireAuth, requireAnyRole('admin', 'finanzas'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const invoiceId = Number(req.params.invoiceId);
    const receiptId = Number(req.body?.receipt_id);
    const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
    const [[receipt]] = await conn.query(`SELECT * FROM receipts WHERE id=? AND invoice_id=? AND status <> 'anulado'`, [receiptId, invoiceId]);
    if (!receipt) return res.status(404).json({ error: 'Recibo no encontrado' });
    const [validItems] = await conn.query(`SELECT ci.id FROM industrial_collection_installments ci JOIN industrial_collection_plans cp ON cp.id=ci.plan_id WHERE cp.invoice_id=?`, [invoiceId]);
    const validIds = new Set(validItems.map((row) => Number(row.id)));
    const normalized = allocations.map((item) => ({ installment_id: Number(item.installment_id), amount: num(item.amount) })).filter((item) => validIds.has(item.installment_id) && item.amount > 0);
    if (Math.abs(normalized.reduce((sum, item) => sum + item.amount, 0) - num(receipt.amount)) > 0.009) return res.status(400).json({ error: 'La distribucion debe cubrir el total aplicado del recibo' });
    await conn.beginTransaction();
    await conn.query(`DELETE FROM industrial_receipt_installment_allocations WHERE receipt_id=?`, [receiptId]);
    for (const item of normalized) await conn.query(`INSERT INTO industrial_receipt_installment_allocations (receipt_id, installment_id, amount_applied, created_by) VALUES (?,?,?,?)`, [receiptId, item.installment_id, item.amount, req.user.id]);
    await conn.commit();
    await logAudit({ req, action: 'update', entity: 'industrial_receipt_allocation', entityId: receiptId, description: `Redistribucion del recibo ${receipt.receipt_number}`, meta: { invoice_id: invoiceId, allocations: normalized } });
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[industrial-planning] receipt allocation', error);
    res.status(500).json({ error: 'No se pudo redistribuir el recibo' });
  } finally {
    conn.release();
  }
});

export default router;
