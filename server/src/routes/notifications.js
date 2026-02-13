// server/src/routes/notifications.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

const PIPELINE_ID = 1;
const PROSPECT_STAGE_NAME = 'Prospecto';
const TYPE_PROSPECT = 'prospect-activity';
const REMIND_AFTER_DAYS = 2;

const toInt = (v) => (v == null ? null : Number(v));

const toDate = (v) => (v ? new Date(String(v).replace(' ', 'T')) : null);
const diffDays = (from, to = new Date()) => {
  const d = toDate(from);
  if (!d || Number.isNaN(d.getTime())) return null;
  const msPerDay = 24 * 60 * 60 * 1e3;
  return Math.floor((to - d) / msPerDay);
};

/* ========= Auto-migracion: tabla notifications ========= */
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        org_id INT NULL,
        deal_id INT NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        due_at DATETIME NULL,
        last_activity_at DATETIME NULL,
        days_without_activity INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (org_id),
        INDEX (deal_id),
        INDEX (type),
        UNIQUE KEY uq_user_org_type (user_id, org_id, type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error('[notifications] No se pudo asegurar tabla:', e?.message || e);
  }
})();

async function getProspectStageId(conn) {
  const [[st]] = await conn.query(
    'SELECT id FROM stages WHERE pipeline_id = ? AND name = ? LIMIT 1',
    [PIPELINE_ID, PROSPECT_STAGE_NAME]
  );
  return st?.id || null;
}

async function syncProspectNotifications(userId, conn = pool) {
  const stageId = await getProspectStageId(conn);
  if (!stageId || !userId) return;

  const [rows] = await conn.query(
    `
    SELECT
      MIN(d.id) AS deal_id,
      d.org_id,
      o.name AS org_name,
      o.created_at AS org_created_at,
      la.created_at AS last_activity_at,
      la.subject AS last_activity_subject,
      cu.name AS last_activity_by,
      c.name AS last_activity_contact
    FROM deals d
    JOIN organizations o ON o.id = d.org_id
    LEFT JOIN activities la ON la.id = (
      SELECT id
      FROM activities
      WHERE org_id = d.org_id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    LEFT JOIN users cu ON cu.id = la.created_by
    LEFT JOIN contacts c ON c.id = la.person_id
    WHERE d.pipeline_id = ?
      AND d.stage_id = ?
      AND d.org_id IS NOT NULL
      AND (d.created_by_user_id = ? OR d.advisor_user_id = ?)
    GROUP BY d.org_id, o.name, o.created_at, la.created_at, la.subject, cu.name, c.name
    `,
    [PIPELINE_ID, stageId, userId, userId]
  );

  const now = new Date();
  const candidateOrgIds = new Set();
  const notifyOrgIds = new Set();

  for (const r of rows || []) {
    if (!r?.org_id) continue;
    candidateOrgIds.add(r.org_id);

    const baseDate = r.last_activity_at || r.org_created_at;
    const days = diffDays(baseDate, now);
    if (days == null || days < REMIND_AFTER_DAYS) continue;

    notifyOrgIds.add(r.org_id);

    const dueAt = baseDate ? new Date(toDate(baseDate).getTime() + REMIND_AFTER_DAYS * 86400000) : null;
    const title = `Recordatorio: ${r.org_name || 'Organizacion'}`;
    let detail = '';
    if (r.last_activity_at) {
      const subj = r.last_activity_subject || 'Sin asunto';
      const by = r.last_activity_by ? `Por: ${r.last_activity_by}` : '';
      const contact = r.last_activity_contact ? `Contacto: ${r.last_activity_contact}` : '';
      const parts = [subj, contact, by].filter(Boolean).join(' · ');
      detail = `Ultima actividad: ${parts}`;
    }
    const body = r.last_activity_at
      ? `Sin actividad desde ${String(r.last_activity_at)} (${days} dias). ${detail}`
      : `Sin actividad desde creacion (${days} dias).`;

    await conn.query(
      `
      INSERT INTO notifications
        (user_id, org_id, deal_id, type, title, body, is_read, is_active, due_at, last_activity_at, days_without_activity)
      VALUES
        (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        deal_id = VALUES(deal_id),
        title = VALUES(title),
        body = VALUES(body),
        is_active = 1,
        due_at = VALUES(due_at),
        last_activity_at = VALUES(last_activity_at),
        days_without_activity = VALUES(days_without_activity),
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        userId,
        r.org_id,
        r.deal_id,
        TYPE_PROSPECT,
        title,
        body,
        dueAt ? dueAt.toISOString().slice(0, 19).replace('T', ' ') : null,
        r.last_activity_at ? String(r.last_activity_at).replace('T', ' ') : null,
        days,
      ]
    );
  }

  if (!candidateOrgIds.size) {
    await conn.query(
      'UPDATE notifications SET is_active = 0 WHERE user_id = ? AND type = ?',
      [userId, TYPE_PROSPECT]
    );
    return;
  }

  const cand = Array.from(candidateOrgIds);
  const notify = Array.from(notifyOrgIds);

  if (notify.length) {
    await conn.query(
      `UPDATE notifications
       SET is_active = 0
       WHERE user_id = ? AND type = ?
         AND org_id IN (?)
         AND org_id NOT IN (?)`,
      [userId, TYPE_PROSPECT, cand, notify]
    );
  } else {
    await conn.query(
      `UPDATE notifications
       SET is_active = 0
       WHERE user_id = ? AND type = ?
         AND org_id IN (?)`,
      [userId, TYPE_PROSPECT, cand]
    );
  }

  await conn.query(
    `UPDATE notifications
     SET is_active = 0
     WHERE user_id = ? AND type = ?
       AND org_id NOT IN (?)`,
    [userId, TYPE_PROSPECT, cand]
  );
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = toInt(req.user?.id);
    if (!userId) return res.json([]);

    await syncProspectNotifications(userId);

    const { status = 'unread', limit = 20 } = req.query;
    const safeLimit = Math.min(Number(limit) || 20, 100);

    const where = ['user_id = ?', 'is_active = 1'];
    const params = [userId];
    if (status === 'unread') {
      where.push('is_read = 0');
    }

    const [rows] = await pool.query(
      `
      SELECT
        id, user_id, org_id, deal_id, type, title, body,
        is_read, is_active, due_at, last_activity_at, days_without_activity,
        created_at, updated_at
      FROM notifications
      WHERE ${where.join(' AND ')}
      ORDER BY is_read ASC, due_at DESC, updated_at DESC, id DESC
      LIMIT ?
      `,
      [...params, safeLimit]
    );

    res.json(rows || []);
  } catch (e) {
    console.error('[notifications][list]', e?.message || e);
    res.status(500).json({ error: 'No se pudieron cargar notificaciones' });
  }
});

router.get('/count', requireAuth, async (req, res) => {
  try {
    const userId = toInt(req.user?.id);
    if (!userId) return res.json({ total: 0 });

    await syncProspectNotifications(userId);

    const { status = 'unread' } = req.query;
    const where = ['user_id = ?', 'is_active = 1'];
    const params = [userId];
    if (status === 'unread') where.push('is_read = 0');

    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS total FROM notifications WHERE ${where.join(' AND ')}`,
      params
    );
    res.json({ total: Number(row?.total || 0) });
  } catch (e) {
    console.error('[notifications][count]', e?.message || e);
    res.status(500).json({ error: 'No se pudo contar notificaciones' });
  }
});

router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const userId = toInt(req.user?.id);
    const id = toInt(req.params.id);
    if (!userId || !id) return res.status(400).json({ error: 'Datos invalidos' });

    await pool.query(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[notifications][read]', e?.message || e);
    res.status(500).json({ error: 'No se pudo marcar como leida' });
  }
});

router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    const userId = toInt(req.user?.id);
    if (!userId) return res.status(400).json({ error: 'Datos invalidos' });

    await pool.query(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_active = 1',
      [userId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[notifications][read-all]', e?.message || e);
    res.status(500).json({ error: 'No se pudo marcar como leidas' });
  }
});

export default router;
