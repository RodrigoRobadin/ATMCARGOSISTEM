import { Router } from 'express';
import { createHash, randomInt } from 'node:crypto';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import { pool } from '../services/db.js';
import { requireAuth, requireAnyRole } from '../middlewares/auth.js';
import { electronicPointFor } from '../services/electronicExpedition.js';
import { canRetryTestDocument, createFactpyClient, factpyMode, fiscalDateTime } from '../services/factpyClient.js';
import { buildRemissionPayload, normalizeDeliveryItems, validateRemissionDraft } from '../services/remissionPayload.js';
import { sifenGeography } from '../services/sifenGeography.js';

const router = Router();
const fiscalRole = requireAnyRole('admin', 'finanzas');
const deliveryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1048576, files: 2 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'image/png')
}).fields([{ name: 'signature_png', maxCount: 1 }, { name: 'paper_png', maxCount: 1 }]);
let schemaPromise;

function errorResponse(res, error) {
  console.error('[remissions]', error);
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'No se pudo procesar la remisión' });
}

function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS operation_remissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      deal_id INT NULL, service_case_id INT NULL, invoice_id INT NULL,
      draft_json LONGTEXT NOT NULL,
      delivery_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      created_by_user_id BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_remission_deal (deal_id), INDEX idx_remission_service (service_case_id),
      CONSTRAINT chk_remission_owner CHECK ((deal_id IS NOT NULL) <> (service_case_id IS NOT NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS operation_remission_deliveries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      remission_id BIGINT UNSIGNED NOT NULL,
      received_at DATETIME NOT NULL, receiver_name VARCHAR(180) NOT NULL,
      receiver_document VARCHAR(80) NOT NULL,
      outcome VARCHAR(30) NOT NULL, notes TEXT NULL,
      delivered_items_json LONGTEXT NOT NULL,
      signature_png MEDIUMBLOB NULL, paper_png MEDIUMBLOB NULL,
      evidence_sha256 CHAR(64) NOT NULL,
      recorded_by_user_id BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_remission_delivery (remission_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

async function context(dealId, serviceCaseId, conn = pool) {
  if (Boolean(dealId) === Boolean(serviceCaseId)) throw Object.assign(new Error('Elegí una operación o un servicio'), { statusCode: 400 });
  const [[row]] = dealId ? await conn.query(
    `SELECT d.id, d.reference, d.org_id, bu.key_slug AS business_unit_key,
       o.ruc, COALESCE(o.razon_social, o.name) AS org_name, o.address, o.email
       FROM deals d JOIN organizations o ON o.id = d.org_id
       LEFT JOIN business_units bu ON bu.id = d.business_unit_id WHERE d.id = ?`, [dealId]
  ) : await conn.query(
    `SELECT s.id, s.reference, s.org_id, 'service' AS business_unit_key,
       o.ruc, COALESCE(o.razon_social, o.name) AS org_name, o.address, o.email
       FROM service_cases s JOIN organizations o ON o.id = s.org_id WHERE s.id = ?`, [serviceCaseId]
  );
  if (!row) throw Object.assign(new Error('Operación no encontrada'), { statusCode: 404 });
  return row;
}

async function load(id, conn = pool, lock = false) {
  const [[row]] = await conn.query(`SELECT r.*, fd.status AS fiscal_status, fd.environment,
      fd.document_number, fd.receipt_id, fd.cdc, fd.kude_url, fd.xml_url,
      fd.error_message, fd.request_json, fd.mock_scenario, fd.check_count,
      dv.received_at, dv.receiver_name, dv.receiver_document, dv.outcome,
      dv.notes AS delivery_notes, dv.evidence_sha256
    FROM operation_remissions r
    LEFT JOIN fiscal_documents fd ON fd.document_type = 'remission' AND fd.local_id = r.id
    LEFT JOIN operation_remission_deliveries dv ON dv.remission_id = r.id
    WHERE r.id = ? ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!row) throw Object.assign(new Error('Remisión no encontrada'), { statusCode: 404 });
  return row;
}

function publicRow(row) {
  const { request_json, mock_scenario, draft_json, ...rest } = row;
  return { ...rest, draft: JSON.parse(draft_json), has_cdc: Boolean(row.cdc),
    cdc: ['approved', 'cancelled'].includes(row.fiscal_status) ? row.cdc : null,
    kude_url: row.fiscal_status === 'approved' ? row.kude_url : null,
    xml_url: row.fiscal_status === 'approved' ? row.xml_url : null };
}

async function reserveNumber(conn, environment, point) {
  const establishment = String(process.env.FACTPY_ESTABLISHMENT || '').padStart(3, '0');
  if (!/^\d{3}$/.test(establishment) || !/^\d{3}$/.test(point)) {
    throw Object.assign(new Error('Configurá establecimiento y punto de FactPy Test'), { statusCode: 400 });
  }
  const start = Number(process.env[`FACTPY_REMISSION_SEQUENCE_START_${point}`] || 1);
  if (!Number.isInteger(start) || start < 1 || start > 9999999) {
    throw Object.assign(new Error('Secuencia inicial de remisiones inválida'), { statusCode: 400 });
  }
  await conn.query(`INSERT INTO fiscal_sequences (environment, document_type, establishment, point, next_number)
    VALUES (?, 'remission', ?, ?, ?) ON DUPLICATE KEY UPDATE next_number = next_number`,
    [environment, establishment, point, start]);
  const [[sequence]] = await conn.query(`SELECT next_number FROM fiscal_sequences
    WHERE environment = ? AND document_type = 'remission' AND establishment = ? AND point = ? FOR UPDATE`,
    [environment, establishment, point]);
  if (sequence.next_number > 9999999) throw Object.assign(new Error('Secuencia de remisiones agotada'), { statusCode: 409 });
  await conn.query(`UPDATE fiscal_sequences SET next_number = next_number + 1
    WHERE environment = ? AND document_type = 'remission' AND establishment = ? AND point = ?`,
    [environment, establishment, point]);
  return `${establishment}-${point}-${String(sequence.next_number).padStart(7, '0')}`;
}

async function sendPrepared(id, environment, payload) {
  try {
    const client = createFactpyClient(environment);
    const response = await client.send(payload);
    if (response?.status !== true && response?.status !== false) throw new Error('Respuesta incierta de FactPy');
    const links = client.links(response);
    await pool.query(`UPDATE fiscal_documents SET status = ?, cdc = ?, kude_url = ?, xml_url = ?, error_message = ?
      WHERE document_type = 'remission' AND local_id = ? AND status = 'sending'`,
      [response.status ? 'processing' : 'rejected', /^\d{44}$/.test(String(response.cdc || '')) ? response.cdc : null,
        links.kude, links.xml, response.status ? null : String(response.code || 'Rechazado').slice(0, 500), id]);
  } catch (error) {
    await pool.query(`UPDATE fiscal_documents SET status = 'review', error_message = ?
      WHERE document_type = 'remission' AND local_id = ? AND status = 'sending'`,
      [String(error.message || 'Resultado incierto').slice(0, 500), id]);
  }
  return publicRow(await load(id));
}

router.get('/', requireAuth, async (req, res) => {
  try {
    if (!factpyMode()) return res.json([]);
    await ensureSchema();
    const dealId = Number(req.query.deal_id || 0) || null;
    const serviceCaseId = Number(req.query.service_case_id || 0) || null;
    await context(dealId, serviceCaseId);
    const [rows] = await pool.query(`SELECT id FROM operation_remissions
      WHERE ${dealId ? 'deal_id = ?' : 'service_case_id = ?'} ORDER BY id DESC`, [dealId || serviceCaseId]);
    res.json(await Promise.all(rows.map(async ({ id }) => publicRow(await load(id)))));
  } catch (error) { errorResponse(res, error); }
});

router.get('/context', requireAuth, async (req, res) => {
  try {
    if (!factpyMode()) return res.status(503).json({ error: 'Remisiones electrónicas deshabilitadas' });
    const row = await context(Number(req.query.deal_id || 0) || null,
      Number(req.query.service_case_id || 0) || null);
    res.json(row);
  } catch (error) { errorResponse(res, error); }
});

router.get('/geography', requireAuth, (_req, res) => {
  res.json(sifenGeography);
});

router.post('/', requireAuth, fiscalRole, async (req, res) => {
  try {
    if (!factpyMode()) return res.status(503).json({ error: 'Remisiones electrónicas deshabilitadas en este entorno' });
    await ensureSchema();
    const dealId = Number(req.body?.deal_id || 0) || null;
    const serviceCaseId = Number(req.body?.service_case_id || 0) || null;
    const owner = await context(dealId, serviceCaseId);
    const draft = validateRemissionDraft(req.body);
    if (draft.invoice_id) {
      const [[invoice]] = await pool.query(`SELECT i.id, fd.status FROM invoices i
        LEFT JOIN fiscal_documents fd ON fd.document_type = 'invoice' AND fd.local_id = i.id
        WHERE i.id = ? AND ${dealId ? 'i.deal_id = ?' : 'i.service_case_id = ?'}`,
        [draft.invoice_id, owner.id]);
      if (!invoice || invoice.status !== 'approved') {
        return res.status(409).json({ error: 'La factura asociada debe ser electrónica, aprobada y de esta operación' });
      }
    }
    const [result] = await pool.query(`INSERT INTO operation_remissions
      (deal_id, service_case_id, invoice_id, draft_json, created_by_user_id) VALUES (?, ?, ?, ?, ?)`,
      [dealId, serviceCaseId, draft.invoice_id, JSON.stringify(draft), req.user.id]);
    res.status(201).json(publicRow(await load(result.insertId)));
  } catch (error) { errorResponse(res, error); }
});

router.post('/:id/issue', requireAuth, fiscalRole, async (req, res) => {
  const environment = factpyMode();
  if (!environment) return res.status(503).json({ error: 'FactPy está deshabilitado' });
  let conn;
  let payload;
  try {
    await ensureSchema();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const row = await load(req.params.id, conn, true);
    if (row.fiscal_status) throw Object.assign(new Error('La remisión ya tiene un envío. Consultá su estado.'), { statusCode: 409 });
    const owner = await context(row.deal_id, row.service_case_id, conn);
    const draft = JSON.parse(row.draft_json);
    const point = electronicPointFor({ dealId: row.deal_id, serviceCaseId: row.service_case_id,
      businessUnitKey: owner.business_unit_key });
    let invoiceCdc = null;
    let printedInvoice = null;
    if (row.invoice_id) {
      const [[invoice]] = await conn.query(`SELECT i.fiscal_mode, i.status, i.invoice_number,
        DATE_FORMAT(i.issue_date, '%Y-%m-%d') AS issue_date, i.timbrado_number,
        fd.status AS fiscal_status, fd.cdc
        FROM invoices i LEFT JOIN fiscal_documents fd
        ON fd.document_type = 'invoice' AND fd.local_id = i.id
        WHERE i.id = ? AND ${row.deal_id ? 'i.deal_id = ?' : 'i.service_case_id = ?'}`,
        [row.invoice_id, owner.id]);
      if (!invoice || !['emitida', 'pago_parcial', 'pagada', 'vencida'].includes(String(invoice.status || '').toLowerCase())) {
        throw Object.assign(new Error('La factura asociada no está emitida o ya no pertenece a esta operación'), { statusCode: 409 });
      }
      if (invoice.fiscal_mode === 'electronic') {
        if (invoice.fiscal_status !== 'approved') throw Object.assign(new Error('La factura electrónica asociada ya no está aprobada'), { statusCode: 409 });
        invoiceCdc = invoice.cdc;
      } else {
        printedInvoice = { number: invoice.invoice_number, issueDate: invoice.issue_date,
          timbrado: invoice.timbrado_number };
      }
    }
    // Validate every field before consuming a fiscal number.
    buildRemissionPayload(draft, { number: `001-${point}-0000001`, receiptId: 'validation', securityCode: '000000001', invoiceCdc, printedInvoice });
    const number = await reserveNumber(conn, environment, point);
    const receiptId = `atm-${environment}-remission-${row.id}`;
    payload = buildRemissionPayload(draft, { number, receiptId,
      securityCode: String(randomInt(0, 1000000000)).padStart(9, '0'), invoiceCdc, printedInvoice });
    await conn.query(`INSERT INTO fiscal_documents (document_type, local_id, environment, receipt_id,
      document_number, status, request_json, attempt_count, sent_at)
      VALUES ('remission', ?, ?, ?, ?, 'sending', ?, 1, NOW())`,
      [row.id, environment, receiptId, number, JSON.stringify(payload)]);
    await conn.commit();
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    return errorResponse(res, error);
  } finally { conn?.release(); }
  try { return res.status(202).json(await sendPrepared(req.params.id, environment, payload)); }
  catch (error) { return errorResponse(res, error); }
});

router.post('/:id/refresh', requireAuth, fiscalRole, async (req, res) => {
  try {
    await ensureSchema();
    const row = await load(req.params.id);
    if (!row.fiscal_status) return res.status(409).json({ error: 'La remisión todavía no fue enviada' });
    if (['approved', 'rejected'].includes(row.fiscal_status)) return res.json(publicRow(row));
    let state;
    try { state = await createFactpyClient(row.environment).check(row.receipt_id, row.mock_scenario, Number(row.check_count || 0)); }
    catch (error) { state = { state: 'review', message: error.message }; }
    if (state.state === 'approved' && (!/^\d{44}$/.test(String(state.cdc || '')) ||
      (state.number && state.number !== row.document_number))) {
      state = { state: 'review', message: 'Aprobación sin CDC válido o con número diferente' };
    }
    if (state.notFound && row.cdc) state = { state: 'review', message: 'FactPy devolvió CDC al enviar, pero no encuentra el receiptid. Verificá en FactPy; no se reenviará.' };
    await pool.query(`UPDATE fiscal_documents SET status = ?, cdc = COALESCE(?, cdc), error_message = ?,
      check_count = check_count + 1, last_checked_at = NOW(),
      approved_at = IF(? = 'approved', NOW(), approved_at)
      WHERE document_type = 'remission' AND local_id = ? AND status NOT IN ('approved', 'rejected')`,
      [state.state, state.state === 'approved' ? state.cdc : null, state.message || null, state.state, row.id]);
    res.json(publicRow(await load(row.id)));
  } catch (error) { errorResponse(res, error); }
});

router.post('/:id/retry', requireAuth, fiscalRole, async (req, res) => {
  if (factpyMode() !== 'test') return res.status(409).json({ error: 'El reintento solo está habilitado en FactPy Test' });
  if (req.body?.confirm_same_document !== true) {
    return res.status(400).json({ error: 'Confirmá el reenvío del mismo número y receiptid' });
  }
  let conn;
  try {
    await ensureSchema();
    const row = await load(req.params.id);
    if (row.environment !== 'test' || !canRetryTestDocument({ ...row, status: row.fiscal_status })) {
      return res.status(409).json({ error: 'La remisión no admite reintento en Test' });
    }
    const checked = await createFactpyClient('test').check(row.receipt_id);
    if (!checked.notFound) {
      return res.status(409).json({ error: `${checked.message || checked.state || 'FactPy no confirmó ausencia'}. No se reenviará.` });
    }
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[current]] = await conn.query(`SELECT * FROM fiscal_documents
      WHERE document_type = 'remission' AND local_id = ? FOR UPDATE`, [row.id]);
    if (!current || current.environment !== 'test' || !canRetryTestDocument(current)) {
      throw Object.assign(new Error('El estado fiscal cambió; consultá nuevamente'), { statusCode: 409 });
    }
    const payload = JSON.parse(current.request_json || 'null');
    const number = `${payload?.establecimiento}-${payload?.punto}-${payload?.numero}`;
    if (!payload || payload.receiptid !== current.receipt_id || number !== current.document_number) {
      throw Object.assign(new Error('El envío guardado no coincide con el número reservado'), { statusCode: 409 });
    }
    if (String(payload.fecha || '').slice(0, 10) !== fiscalDateTime().slice(0, 10)) {
      throw Object.assign(new Error('La fecha fiscal guardada ya no es de hoy; requiere revisión manual'), { statusCode: 409 });
    }
    await conn.query(`UPDATE fiscal_documents SET status = 'sending', error_message = NULL,
      attempt_count = attempt_count + 1 WHERE id = ?`, [current.id]);
    await conn.commit();
    conn.release();
    conn = null;
    return res.status(202).json(await sendPrepared(row.id, 'test', payload));
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    return errorResponse(res, error);
  } finally { conn?.release(); }
});

function imageFromUpload(file) {
  if (!file) return null;
  const buffer = file.buffer;
  if (buffer.length < 100 || buffer.length > 1048576 ||
      !buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
      buffer.readUInt32BE(16) > 3000 || buffer.readUInt32BE(20) > 3000) {
    throw Object.assign(new Error('Imagen PNG inválida'), { statusCode: 400 });
  }
  return buffer;
}

router.post('/:id/delivery', requireAuth, (req, res, next) => {
  deliveryUpload(req, res, (error) => error ? res.status(400).json({ error: 'La evidencia debe ser PNG y menor a 1 MB por imagen' }) : next());
}, async (req, res) => {
  try {
    await ensureSchema();
    const row = await load(req.params.id);
    if (row.fiscal_status !== 'approved') return res.status(409).json({ error: 'La nota debe estar aprobada antes de registrar la entrega' });
    if (row.received_at) return res.status(409).json({ error: 'La entrega ya fue registrada' });
    const name = String(req.body?.receiver_name || '').trim().slice(0, 180);
    const document = String(req.body?.receiver_document || '').trim().slice(0, 80);
    const outcome = String(req.body?.outcome || '');
    const notes = String(req.body?.notes || '').trim().slice(0, 4000);
    const receivedAt = String(req.body?.received_at || '');
    let items;
    try { items = JSON.parse(req.body?.items || 'null'); }
    catch { items = null; }
    const draft = JSON.parse(row.draft_json);
    if (!name || !document || !['conforme', 'con_observaciones', 'no_entregada'].includes(outcome) ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(receivedAt) ||
        Number.isNaN(new Date(receivedAt).getTime()) || new Date(receivedAt).getTime() > Date.now() + 60000 ||
        !Array.isArray(items) || items.length !== draft.items.length) {
      return res.status(400).json({ error: 'Completá receptor, fecha, resultado y cantidades recibidas' });
    }
    const normalized = normalizeDeliveryItems(items, draft.items);
    if (outcome === 'no_entregada' && normalized.some((item) => item.quantity !== 0 || item.condition_status !== 'no_recibido')) {
      return res.status(400).json({ error: 'Una entrega no realizada debe tener cantidad recibida cero' });
    }
    if (outcome === 'conforme' && (normalized.some((item, index) =>
      item.quantity !== draft.items[index].quantity || item.condition_status !== 'buen_estado') || notes)) {
      return res.status(400).json({ error: 'Una entrega con diferencias u observaciones no puede marcarse conforme' });
    }
    if (outcome === 'con_observaciones' && normalized.every((item) => item.condition_status === 'buen_estado')) {
      return res.status(400).json({ error: 'Indicá qué artículo tiene observaciones' });
    }
    if (outcome !== 'conforme' && !notes) return res.status(400).json({ error: 'Describí la diferencia o el motivo de la no entrega' });
    const signature = imageFromUpload(req.files?.signature_png?.[0]);
    const paper = imageFromUpload(req.files?.paper_png?.[0]);
    if (!signature && !paper) return res.status(400).json({ error: 'Adjuntá firma en pantalla o foto de la nota firmada' });
    const evidence = { remission_id: row.id, number: row.document_number, cdc: row.cdc,
      received_at: receivedAt, receiver_name: name, receiver_document: document,
      outcome, notes, items: normalized, recorded_by_user_id: req.user.id };
    const hash = createHash('sha256').update(JSON.stringify(evidence)).update(signature || Buffer.alloc(0)).update(paper || Buffer.alloc(0)).digest('hex');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const current = await load(row.id, conn, true);
      if (current.received_at || current.fiscal_status !== 'approved') throw Object.assign(new Error('La entrega ya cambió de estado'), { statusCode: 409 });
      await conn.query(`INSERT INTO operation_remission_deliveries
        (remission_id, received_at, receiver_name, receiver_document, outcome, notes,
         delivered_items_json, signature_png, paper_png, evidence_sha256, recorded_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, receivedAt.replace('T', ' ').slice(0, 19), name, document, outcome, notes,
          JSON.stringify(normalized), signature, paper, hash, req.user.id]);
      await conn.query('UPDATE operation_remissions SET delivery_status = ? WHERE id = ?', [outcome, row.id]);
      await conn.commit();
    } catch (error) { await conn.rollback().catch(() => {}); throw error; }
    finally { conn.release(); }
    res.status(201).json(publicRow(await load(row.id)));
  } catch (error) { errorResponse(res, error); }
});

router.get('/:id/delivery.pdf', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const row = await load(req.params.id);
    const [[delivery]] = await pool.query('SELECT * FROM operation_remission_deliveries WHERE remission_id = ?', [row.id]);
    if (!delivery) return res.status(404).json({ error: 'No hay constancia de entrega' });
    const draft = JSON.parse(row.draft_json);
    const items = JSON.parse(delivery.delivered_items_json);
    const pdf = new PDFDocument({ margin: 45, size: 'A4' });
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="entrega-${row.id}.pdf"`);
    pdf.pipe(res);
    pdf.fontSize(18).text('Constancia de entrega', { align: 'center' }).moveDown();
    pdf.fontSize(10).text(`Nota de remisión: ${row.document_number}  |  Operación: ${row.deal_id || row.service_case_id}`);
    pdf.text(`CDC: ${row.cdc}`).text(`Destinatario: ${draft.customer.name}`);
    const receivedAt = new Date(`${String(delivery.received_at).replace(' ', 'T')}Z`)
      .toLocaleString('es-PY', { timeZone: 'America/Asuncion' });
    pdf.text(`Recepción: ${receivedAt}  |  Resultado: ${delivery.outcome}`);
    pdf.text(`Recibió: ${delivery.receiver_name}  |  Documento: ${delivery.receiver_document}`).moveDown();
    pdf.font('Helvetica-Bold').text('Mercadería recibida').font('Helvetica');
    for (const item of items) {
      if (pdf.y > 690) pdf.addPage();
      pdf.text(`${item.quantity} x ${item.description} (${item.code})`);
      pdf.fontSize(9).text(`Estado: ${item.condition_description || 'No registrado'}`, { indent: 15 }).fontSize(10);
    }
    pdf.moveDown().text(`Observaciones: ${delivery.notes || 'Sin observaciones'}`);
    if (delivery.signature_png) {
      if (pdf.y > 600) pdf.addPage();
      pdf.moveDown().text('Firma de quien recibe:');
      pdf.image(delivery.signature_png, { fit: [250, 110] });
      pdf.moveDown(7);
    }
    if (delivery.paper_png) {
      pdf.addPage().text('Copia firmada en papel:').moveDown();
      pdf.image(delivery.paper_png, { fit: [500, 650] });
    }
    pdf.fontSize(8).text(`Registro de integridad SHA-256: ${delivery.evidence_sha256}`, 45, 790);
    pdf.end();
  } catch (error) { errorResponse(res, error); }
});

export default router;
