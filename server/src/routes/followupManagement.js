import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import {
  CALL_OUTCOMES,
  OUTCOMES_REQUIRING_TASK,
  assertCallAccess,
  cleanText,
  ensureFollowupManagementSchema,
  getManagedCall,
  insertFollowupAudit,
  isAdmin,
  normalizeDateTime,
  requireFollowupManagementRole,
  upsertTaskForCall,
} from '../services/followupManagementService.js';

const router = Router();
router.use(requireAuth, requireFollowupManagementRole);

const safeInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function paraguayNowSql() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function buildCallsWhere(req) {
  const where = [];
  const params = [];
  if (isAdmin(req)) {
    if (req.query.user_id) {
      where.push('c.user_id = ?');
      params.push(Number(req.query.user_id));
    }
  } else {
    where.push('c.user_id = ?');
    params.push(Number(req.user?.id));
  }
  if (req.query.from) {
    where.push('c.happened_at >= ?');
    params.push(`${String(req.query.from).slice(0, 10)} 00:00:00`);
  }
  if (req.query.to) {
    where.push('c.happened_at <= ?');
    params.push(`${String(req.query.to).slice(0, 10)} 23:59:59`);
  }
  for (const [queryKey, column] of [
    ['outcome', 'c.outcome'],
    ['status', 'c.status'],
    ['source', 'c.source'],
    ['org_id', 'c.org_id'],
    ['contact_id', 'c.contact_id'],
    ['deal_id', 'c.deal_id'],
  ]) {
    if (req.query[queryKey]) {
      where.push(`${column} = ?`);
      params.push(req.query[queryKey]);
    }
  }
  if (!req.query.status && String(req.query.include_invalidated || '0') !== '1') {
    where.push("COALESCE(c.status, 'completed') <> 'invalidated'");
  }
  const q = cleanText(req.query.q, 200);
  if (q) {
    const like = `%${q}%`;
    where.push(`(
      c.subject LIKE ? OR c.notes LIKE ? OR c.phone_number LIKE ? OR
      o.name LIKE ? OR ct.name LIKE ? OR d.reference LIKE ? OR u.name LIKE ? OR u.email LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like, like);
  }
  if (req.query.task_status) {
    where.push('COALESCE(t.status, ?) = ?');
    params.push('sin_tarea', req.query.task_status);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const callSelect = `
  SELECT c.id, c.user_id, u.name AS user_name, u.email AS user_email,
         c.org_id, o.name AS org_name, c.contact_id, ct.name AS contact_name,
         COALESCE(NULLIF(c.phone_number,''), ct.phone, o.phone) AS phone_number,
         c.deal_id, d.reference AS deal_reference, c.subject, c.notes,
         c.happened_at, c.started_at, c.completed_at, c.duration_min, c.outcome,
         COALESCE(c.status, 'completed') AS status, COALESCE(c.source, 'legacy') AS source,
         c.invalidation_reason, c.invalidated_at, c.created_at, c.updated_at,
         t.id AS task_id, t.title AS task_title, t.priority AS task_priority,
         t.status AS task_status, t.due_at AS task_due_at, t.completed_at AS task_completed_at,
         t.reminder_minutes
    FROM followup_calls c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN organizations o ON o.id = c.org_id
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    LEFT JOIN deals d ON d.id = c.deal_id
    LEFT JOIN followup_tasks t ON t.id = (
      SELECT t2.id FROM followup_tasks t2 WHERE t2.call_id = c.id ORDER BY t2.id DESC LIMIT 1
    )`;

async function fetchCalls(req, { exportAll = false } = {}) {
  await ensureFollowupManagementSchema();
  const { whereSql, params } = buildCallsWhere(req);
  const limit = exportAll ? 10000 : Math.min(Math.max(safeInt(req.query.limit, 50), 1), 500);
  const offset = exportAll ? 0 : Math.max(safeInt(req.query.offset, 0), 0);
  const [rows] = await pool.query(
    `${callSelect} ${whereSql} ORDER BY c.happened_at DESC, c.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[count]] = await pool.query(
    `SELECT COUNT(DISTINCT c.id) AS total
       FROM followup_calls c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN organizations o ON o.id = c.org_id
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN deals d ON d.id = c.deal_id
       LEFT JOIN followup_tasks t ON t.id = (
         SELECT t2.id FROM followup_tasks t2 WHERE t2.call_id = c.id ORDER BY t2.id DESC LIMIT 1
       )
       ${whereSql}`,
    params
  );
  return { rows: rows || [], total: Number(count?.total || 0), limit, offset };
}

router.get('/calls', async (req, res) => {
  try {
    res.json(await fetchCalls(req));
  } catch (error) {
    console.error('[followup-management][calls]', error);
    res.status(500).json({ error: 'No se pudo listar llamadas' });
  }
});

router.get('/notes', async (req, res) => {
  try {
    await ensureFollowupManagementSchema();
    const where = [];
    const params = [];
    if (isAdmin(req)) {
      if (req.query.user_id) { where.push('n.user_id = ?'); params.push(Number(req.query.user_id)); }
    } else {
      where.push('n.user_id = ?'); params.push(Number(req.user?.id));
    }
    const limit = Math.min(Math.max(safeInt(req.query.limit, 100), 1), 500);
    const [rows] = await pool.query(
      `SELECT n.id, n.user_id, u.name AS user_name, n.org_id, o.name AS org_name,
              n.contact_id, ct.name AS contact_name, n.deal_id, d.reference AS deal_reference,
              n.content, n.created_at
         FROM followup_notes n
         LEFT JOIN users u ON u.id = n.user_id
         LEFT JOIN organizations o ON o.id = n.org_id
         LEFT JOIN contacts ct ON ct.id = n.contact_id
         LEFT JOIN deals d ON d.id = n.deal_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
      [...params, limit]
    );
    res.json(rows || []);
  } catch (error) {
    console.error('[followup-management][notes]', error);
    res.status(500).json({ error: 'No se pudieron listar las notas' });
  }
});

router.post('/notes', async (req, res) => {
  const content = cleanText(req.body?.content, 5000);
  if (!content) return res.status(400).json({ error: 'El contenido es obligatorio' });
  const conn = await pool.getConnection();
  try {
    await ensureFollowupManagementSchema();
    await conn.beginTransaction();
    const [insert] = await conn.query(
      `INSERT INTO followup_notes (user_id, org_id, contact_id, deal_id, content)
       VALUES (?, ?, ?, ?, ?)`,
      [Number(req.user?.id), req.body?.org_id ? Number(req.body.org_id) : null,
       req.body?.contact_id ? Number(req.body.contact_id) : null,
       req.body?.deal_id ? Number(req.body.deal_id) : null, content]
    );
    const [[row]] = await conn.query('SELECT * FROM followup_notes WHERE id = ?', [insert.insertId]);
    await insertFollowupAudit(conn, req, {
      action: 'create', entity: 'followup_note', entityId: insert.insertId,
      description: 'Nota de seguimiento creada', after: row, meta: { source: req.body?.source || 'web' },
    });
    await conn.commit();
    res.status(201).json(row);
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[followup-management][note-create]', error);
    res.status(500).json({ error: 'No se pudo crear la nota' });
  } finally { conn.release(); }
});
router.get('/summary', async (req, res) => {
  try {
    await ensureFollowupManagementSchema();
    const clauses = [];
    const params = [];
    if (!isAdmin(req) || req.query.user_id) {
      clauses.push('user_id = ?');
      params.push(isAdmin(req) ? Number(req.query.user_id) : Number(req.user?.id));
    }
    if (req.query.from) {
      clauses.push('happened_at >= ?');
      params.push(`${String(req.query.from).slice(0, 10)} 00:00:00`);
    }
    if (req.query.to) {
      clauses.push('happened_at <= ?');
      params.push(`${String(req.query.to).slice(0, 10)} 23:59:59`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [[calls]] = await pool.query(
      `SELECT COUNT(*) AS total_calls,
              SUM(CASE WHEN DATE(happened_at) = CURRENT_DATE THEN 1 ELSE 0 END) AS calls_today,
              SUM(CASE WHEN status = 'pending_result' THEN 1 ELSE 0 END) AS pending_results,
              SUM(CASE WHEN outcome = 'interesado' THEN 1 ELSE 0 END) AS interested,
              SUM(CASE WHEN outcome = 'en_negociacion' THEN 1 ELSE 0 END) AS negotiating
         FROM followup_calls ${where}`,
      params
    );
    const taskClauses = [];
    const taskParams = [];
    if (!isAdmin(req) || req.query.user_id) {
      taskClauses.push('user_id = ?');
      taskParams.push(isAdmin(req) ? Number(req.query.user_id) : Number(req.user?.id));
    }
    const taskWhere = taskClauses.length ? `WHERE ${taskClauses.join(' AND ')} AND` : 'WHERE';
    const [[tasks]] = await pool.query(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_tasks,
         SUM(CASE WHEN status = 'pending' AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue_tasks,
         SUM(CASE WHEN status = 'pending' AND DATE(due_at) = CURRENT_DATE THEN 1 ELSE 0 END) AS tasks_today
       FROM followup_tasks ${taskWhere} 1=1`,
      taskParams
    );
    res.json({
      total_calls: Number(calls?.total_calls || 0),
      calls_today: Number(calls?.calls_today || 0),
      pending_results: Number(calls?.pending_results || 0),
      interested: Number(calls?.interested || 0),
      negotiating: Number(calls?.negotiating || 0),
      pending_tasks: Number(tasks?.pending_tasks || 0),
      overdue_tasks: Number(tasks?.overdue_tasks || 0),
      tasks_today: Number(tasks?.tasks_today || 0),
    });
  } catch (error) {
    console.error('[followup-management][summary]', error);
    res.status(500).json({ error: 'No se pudo cargar el resumen' });
  }
});

router.post('/calls/start', async (req, res) => {
  try {
    await ensureFollowupManagementSchema();
    const userId = Number(req.user?.id || 0);
    const startedAt = normalizeDateTime(req.body?.started_at || req.body?.happened_at) || paraguayNowSql();
    const source = ['mobile', 'web'].includes(req.body?.source) ? req.body.source : 'mobile';
    const [ins] = await pool.query(
      `INSERT INTO followup_calls
        (user_id, org_id, contact_id, deal_id, subject, notes, happened_at, started_at,
         duration_min, outcome, status, source, phone_number, updated_by)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, 0, NULL, 'pending_result', ?, ?, ?)`,
      [
        userId,
        req.body?.org_id ? Number(req.body.org_id) : null,
        req.body?.contact_id ? Number(req.body.contact_id) : null,
        req.body?.deal_id ? Number(req.body.deal_id) : null,
        cleanText(req.body?.subject, 255) || 'Llamada',
        startedAt,
        startedAt,
        source,
        cleanText(req.body?.phone_number, 80) || null,
        userId,
      ]
    );
    const call = await getManagedCall(pool, ins.insertId);
    await insertFollowupAudit(pool, req, {
      action: 'start', entity: 'followup_call', entityId: ins.insertId,
      description: 'Llamada iniciada', after: call, meta: { source },
    });
    res.status(201).json(call);
  } catch (error) {
    console.error('[followup-management][call-start]', error);
    res.status(500).json({ error: 'No se pudo iniciar el registro de llamada' });
  }
});

async function completeOrEditCall(req, res, { completing = false } = {}) {
  const conn = await pool.getConnection();
  try {
    await ensureFollowupManagementSchema();
    await conn.beginTransaction();
    const before = await getManagedCall(conn, Number(req.params.id), true);
    const accessError = assertCallAccess(req, before);
    if (accessError) {
      await conn.rollback();
      return res.status(accessError.status).json({ error: accessError.error });
    }
    if (before.status === 'invalidated') {
      await conn.rollback();
      return res.status(409).json({ error: 'La llamada fue invalidada' });
    }
    const outcome = req.body?.outcome ?? before.outcome;
    const notes = req.body?.notes !== undefined ? cleanText(req.body.notes, 5000) : cleanText(before.notes, 5000);
    if (!CALL_OUTCOMES.has(outcome)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Resultado de llamada invalido' });
    }
    if (outcome !== 'no_contesta' && !notes) {
      await conn.rollback();
      return res.status(400).json({ error: 'El contexto de la llamada es obligatorio' });
    }
    const taskInput = req.body?.task || req.body;
    const taskTitle = cleanText(taskInput?.title || taskInput?.task_title, 255);
    const taskDue = normalizeDateTime(taskInput?.due_at || taskInput?.task_due);
    if (OUTCOMES_REQUIRING_TASK.has(outcome) && (!taskTitle || !taskDue)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Este resultado requiere una proxima tarea con fecha y hora' });
    }
    const happenedAt = normalizeDateTime(req.body?.happened_at) || before.happened_at;
    const duration = Math.max(0, safeInt(req.body?.duration_min, Number(before.duration_min || 0)));
    const subject = req.body?.subject !== undefined ? cleanText(req.body.subject, 255) : before.subject;
    await conn.query(
      `UPDATE followup_calls
          SET subject = ?, notes = ?, happened_at = ?, duration_min = ?, outcome = ?,
              status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_by = ?
        WHERE id = ?`,
      [subject || 'Llamada', notes, happenedAt, duration, outcome, Number(req.user?.id || 0), before.id]
    );
    let taskId = null;
    if (taskTitle && taskDue) taskId = await upsertTaskForCall(conn, req, before, taskInput);
    const after = await getManagedCall(conn, before.id);
    await insertFollowupAudit(conn, req, {
      action: completing ? 'complete' : 'update', entity: 'followup_call', entityId: before.id,
      description: completing ? 'Llamada completada' : 'Llamada corregida', before, after,
      meta: { task_id: taskId, source: before.source || 'legacy' },
    });
    await conn.commit();
    res.json({ ...after, task_id: taskId || after?.task_id || null });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[followup-management][call-save]', error);
    res.status(500).json({ error: 'No se pudo guardar la llamada' });
  } finally {
    conn.release();
  }
}

router.patch('/calls/:id/complete', (req, res) => completeOrEditCall(req, res, { completing: true }));
router.patch('/calls/:id', (req, res) => completeOrEditCall(req, res));

router.post('/calls/:id/invalidate', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo admin puede invalidar llamadas' });
  const reason = cleanText(req.body?.reason, 500);
  if (!reason) return res.status(400).json({ error: 'El motivo es obligatorio' });
  const conn = await pool.getConnection();
  try {
    await ensureFollowupManagementSchema();
    await conn.beginTransaction();
    const before = await getManagedCall(conn, Number(req.params.id), true);
    if (!before) {
      await conn.rollback();
      return res.status(404).json({ error: 'Llamada no encontrada' });
    }
    await conn.query(
      `UPDATE followup_calls SET status = 'invalidated', invalidated_at = NOW(), invalidation_reason = ?, updated_by = ? WHERE id = ?`,
      [reason, Number(req.user?.id || 0), before.id]
    );
    await conn.query(`UPDATE followup_tasks SET status = 'canceled', updated_by = ? WHERE call_id = ? AND status = 'pending'`, [Number(req.user?.id || 0), before.id]);
    const after = await getManagedCall(conn, before.id);
    await insertFollowupAudit(conn, req, {
      action: 'invalidate', entity: 'followup_call', entityId: before.id,
      description: 'Llamada invalidada', before, after, meta: { reason },
    });
    await conn.commit();
    res.json(after);
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[followup-management][invalidate]', error);
    res.status(500).json({ error: 'No se pudo invalidar la llamada' });
  } finally {
    conn.release();
  }
});

router.get('/calls/:id/history', async (req, res) => {
  try {
    await ensureFollowupManagementSchema();
    const call = await getManagedCall(pool, Number(req.params.id));
    const accessError = assertCallAccess(req, call);
    if (accessError) return res.status(accessError.status).json({ error: accessError.error });
    const [rows] = await pool.query(
      `SELECT ae.id, ae.created_at, ae.user_id, u.name AS user_name, ae.action, ae.description, ae.meta
         FROM audit_events ae LEFT JOIN users u ON u.id = ae.user_id
        WHERE ae.entity = 'followup_call' AND ae.entity_id = ?
        ORDER BY ae.id DESC`,
      [call.id]
    );
    res.json(rows || []);
  } catch (error) {
    console.error('[followup-management][history]', error);
    res.status(500).json({ error: 'No se pudo cargar el historial' });
  }
});

router.post('/agenda', async (req, res) => {
  const title = cleanText(req.body?.title, 255);
  const dueAt = normalizeDateTime(req.body?.due_at);
  if (!title || !dueAt) return res.status(400).json({ error: 'Titulo y vencimiento son obligatorios' });
  const conn = await pool.getConnection();
  try {
    await ensureFollowupManagementSchema();
    await conn.beginTransaction();
    const [insert] = await conn.query(
      `INSERT INTO followup_tasks
         (user_id, org_id, contact_id, deal_id, call_id, title, priority, status, due_at, reminder_minutes, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [Number(req.user?.id), req.body?.org_id ? Number(req.body.org_id) : null,
       req.body?.contact_id ? Number(req.body.contact_id) : null,
       req.body?.deal_id ? Number(req.body.deal_id) : null,
       req.body?.call_id ? Number(req.body.call_id) : null, title,
       ['low','medium','high'].includes(req.body?.priority) ? req.body.priority : 'medium', dueAt,
       Math.max(0, Math.min(safeInt(req.body?.reminder_minutes, 30), 10080)), Number(req.user?.id)]
    );
    const [[row]] = await conn.query('SELECT * FROM followup_tasks WHERE id = ?', [insert.insertId]);
    await insertFollowupAudit(conn, req, {
      action: 'create', entity: 'followup_task', entityId: insert.insertId,
      description: 'Tarea de seguimiento creada', after: row, meta: { source: req.body?.source || 'web' },
    });
    await conn.commit();
    res.status(201).json(row);
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[followup-management][agenda-create]', error);
    res.status(500).json({ error: 'No se pudo crear la tarea' });
  } finally { conn.release(); }
});
router.get('/agenda', async (req, res) => {
  try {
    await ensureFollowupManagementSchema();
    const where = [];
    const params = [];
    if (isAdmin(req)) {
      if (req.query.user_id) { where.push('t.user_id = ?'); params.push(Number(req.query.user_id)); }
    } else { where.push('t.user_id = ?'); params.push(Number(req.user?.id)); }
    if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
    const [rows] = await pool.query(
      `SELECT t.*, o.name AS org_name, ct.name AS contact_name, d.reference AS deal_reference,
              c.outcome AS call_outcome, c.notes AS call_notes, u.name AS user_name
         FROM followup_tasks t
         LEFT JOIN organizations o ON o.id = t.org_id
         LEFT JOIN contacts ct ON ct.id = t.contact_id
         LEFT JOIN deals d ON d.id = t.deal_id
         LEFT JOIN followup_calls c ON c.id = t.call_id
         LEFT JOIN users u ON u.id = t.user_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY CASE WHEN t.status = 'pending' THEN 0 ELSE 1 END, t.due_at ASC, t.id ASC
         LIMIT 1000`,
      params
    );
    res.json(rows || []);
  } catch (error) {
    console.error('[followup-management][agenda]', error);
    res.status(500).json({ error: 'No se pudo cargar la agenda' });
  }
});

router.patch('/agenda/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureFollowupManagementSchema();
    await conn.beginTransaction();
    const [[before]] = await conn.query(`SELECT * FROM followup_tasks WHERE id = ? FOR UPDATE`, [Number(req.params.id)]);
    if (!before) { await conn.rollback(); return res.status(404).json({ error: 'Tarea no encontrada' }); }
    if (!isAdmin(req) && Number(before.user_id) !== Number(req.user?.id)) { await conn.rollback(); return res.status(403).json({ error: 'Permiso denegado' }); }
    const status = req.body?.status !== undefined && ['pending', 'done', 'canceled'].includes(req.body.status) ? req.body.status : before.status;
    const title = req.body?.title !== undefined ? cleanText(req.body.title, 255) : before.title;
    const dueAt = req.body?.due_at !== undefined ? normalizeDateTime(req.body.due_at) : before.due_at;
    const priority = req.body?.priority !== undefined && ['low', 'medium', 'high'].includes(req.body.priority) ? req.body.priority : before.priority;
    const reminderMinutes = req.body?.reminder_minutes !== undefined ? Math.max(0, Math.min(safeInt(req.body.reminder_minutes, 30), 10080)) : before.reminder_minutes;
    await conn.query(
      `UPDATE followup_tasks SET title=?, due_at=?, priority=?, reminder_minutes=?, status=?,
              completed_at = CASE WHEN ? = 'done' THEN NOW() WHEN ? = 'pending' THEN NULL ELSE completed_at END,
              updated_by=? WHERE id=?`,
      [title, dueAt, priority, reminderMinutes, status, status, status, Number(req.user?.id || 0), before.id]
    );
    if (status !== 'pending') {
      await conn.query(
        `UPDATE notifications SET is_active = 0 WHERE user_id = ? AND type LIKE ?`,
        [before.user_id, `followup-${before.id}-%`]
      );
    }
    const [[after]] = await conn.query(`SELECT * FROM followup_tasks WHERE id = ?`, [before.id]);
    await insertFollowupAudit(conn, req, {
      action: 'update', entity: 'followup_task', entityId: before.id,
      description: 'Tarea de seguimiento actualizada', before, after,
    });
    await conn.commit();
    res.json(after);
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[followup-management][agenda-update]', error);
    res.status(500).json({ error: 'No se pudo actualizar la tarea' });
  } finally { conn.release(); }
});

router.post('/devices', async (req, res) => {
  try {
    await ensureFollowupManagementSchema();
    const token = cleanText(req.body?.expo_push_token, 255);
    if (!/^ExponentPushToken\[.+\]$|^ExpoPushToken\[.+\]$/.test(token)) {
      return res.status(400).json({ error: 'Token push invalido' });
    }
    await pool.query(
      `INSERT INTO user_push_devices (user_id, expo_push_token, platform, device_name, active, last_seen_at)
       VALUES (?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), platform=VALUES(platform), device_name=VALUES(device_name), active=1, last_seen_at=NOW()`,
      [Number(req.user?.id || 0), token, cleanText(req.body?.platform, 20) || null, cleanText(req.body?.device_name, 120) || null]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('[followup-management][device]', error);
    res.status(500).json({ error: 'No se pudo registrar el dispositivo' });
  }
});

router.delete('/devices', async (req, res) => {
  try {
    const token = cleanText(req.body?.expo_push_token, 255);
    await pool.query(`UPDATE user_push_devices SET active=0 WHERE user_id=? AND expo_push_token=?`, [Number(req.user?.id || 0), token]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo desactivar el dispositivo' });
  }
});

function callExportRows(rows) {
  return rows.map((row) => ({
    Fecha: row.happened_at || '',
    Comercial: row.user_name || row.user_email || '',
    Organizacion: row.org_name || '',
    Contacto: row.contact_name || '',
    Telefono: row.phone_number || '',
    Operacion: row.deal_reference || '',
    Contexto: row.notes || '',
    Resultado: row.outcome || '',
    Duracion: Number(row.duration_min || 0),
    Proxima_tarea: row.task_title || '',
    Vencimiento: row.task_due_at || '',
    Estado_tarea: row.task_status || '',
    Origen: row.source || '',
  }));
}

router.get('/calls/export', async (req, res) => {
  try {
    const { rows } = await fetchCalls(req, { exportAll: true });
    const reportRows = callExportRows(rows);
    const format = String(req.query.format || 'xlsx').toLowerCase();
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="informe-llamadas.pdf"');
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
      doc.pipe(res);
      doc.fontSize(16).text('GESTION DE SEGUIMIENTO - INFORME DE LLAMADAS');
      doc.moveDown(0.4).fontSize(8).fillColor('#475569').text(`Generado: ${new Date().toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}`);
      doc.moveDown(0.8).fillColor('#000000');
      const widths = [62, 76, 86, 70, 70, 65, 176, 70];
      const headers = ['Fecha', 'Comercial', 'Organizacion', 'Contacto', 'Operacion', 'Resultado', 'Contexto', 'Proxima tarea'];
      let y = doc.y;
      const drawRow = (values, header = false) => {
        let x = doc.page.margins.left;
        const height = header ? 20 : 34;
        if (y + height > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top; }
        values.forEach((value, index) => {
          doc.rect(x, y, widths[index], height).fillAndStroke(header ? '#e2e8f0' : '#ffffff', '#94a3b8');
          doc.fillColor('#0f172a').fontSize(header ? 7.5 : 7).text(String(value || ''), x + 3, y + 3, { width: widths[index] - 6, height: height - 6, ellipsis: true });
          x += widths[index];
        });
        y += height;
      };
      drawRow(headers, true);
      for (const row of reportRows) drawRow([row.Fecha, row.Comercial, row.Organizacion, row.Contacto, row.Operacion, row.Resultado, row.Contexto, `${row.Proxima_tarea} ${row.Vencimiento}`]);
      doc.end();
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Llamadas');
    sheet.columns = Object.keys(reportRows[0] || { Fecha: '' }).map((key) => ({ header: key.replaceAll('_', ' '), key, width: key === 'Contexto' ? 45 : 22 }));
    reportRows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="informe-llamadas.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('[followup-management][export]', error);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo exportar el informe' });
  }
});

export default router;
