// server/src/routes/messages.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { getIO } from '../services/socket.js';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

const router = Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/* ========= Auto-migracion: tablas de chat ========= */
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type VARCHAR(10) NOT NULL DEFAULT 'direct',
        title VARCHAR(255) NULL,
        created_by BIGINT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (created_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT NOT NULL,
        user_id BIGINT NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'member',
        joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_read_message_id INT NULL,
        UNIQUE KEY uq_conv_user (conversation_id, user_id),
        INDEX (user_id),
        INDEX (conversation_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT NOT NULL,
        sender_id BIGINT NOT NULL,
        body TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (conversation_id),
        INDEX (sender_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        message_id INT NOT NULL,
        type VARCHAR(20) NOT NULL DEFAULT 'file',
        url VARCHAR(500) NULL,
        mime VARCHAR(100) NULL,
        filename VARCHAR(255) NULL,
        size INT NULL,
        entity_type VARCHAR(30) NULL,
        entity_id INT NULL,
        label VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (message_id),
        INDEX (entity_type),
        INDEX (entity_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error('[messages] No se pudo asegurar tablas:', e?.message || e);
  }
})();

function getUserId(req) {
  return req?.user?.id || req?.session?.user?.id || null;
}

async function ensureMember(conversationId, userId) {
  const [[row]] = await pool.query(
    'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1',
    [conversationId, userId]
  );
  return !!row;
}

function emitMessage(conversationId, payload) {
  const io = getIO();
  if (!io) return;
  io.to(`conv:${conversationId}`).emit('message:new', payload);
}

/* ====== Multer para adjuntos ====== */
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const cid = String(req.params.id);
    const dir = path.resolve('uploads', 'messages', cid);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '');
    const base = path
      .basename(file.originalname || 'file', ext)
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${base}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    return cb(new Error('Tipo de archivo no permitido'));
  },
});

/* ===================== CONVERSACIONES ===================== */
// GET /api/messages/conversations
router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const userId = Number(getUserId(req));
    if (!userId) return res.json([]);
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const [rows] = await pool.query(
      `
      SELECT
        c.id, c.type, c.title, c.created_by, c.created_at,
        cm.last_read_message_id,
        lm.id AS last_message_id,
        lm.body AS last_message_body,
        lm.created_at AS last_message_at,
        u.name AS last_message_by,
        (
          SELECT COUNT(*)
          FROM messages m2
          WHERE m2.conversation_id = c.id
            AND (cm.last_read_message_id IS NULL OR m2.id > cm.last_read_message_id)
            AND m2.sender_id <> ?
        ) AS unread_count
      FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      LEFT JOIN messages lm ON lm.id = (
        SELECT id FROM messages
        WHERE conversation_id = c.id
        ORDER BY id DESC
        LIMIT 1
      )
      LEFT JOIN users u ON u.id = lm.sender_id
      WHERE cm.user_id = ?
      ORDER BY COALESCE(lm.created_at, c.created_at) DESC, c.id DESC
      LIMIT ?
      `,
      [userId, userId, limit]
    );

    const convIds = rows.map((r) => r.id);
    const membersByConv = {};
    if (convIds.length) {
      const [members] = await pool.query(
        `
        SELECT cm.conversation_id, u.id, u.name, u.email
        FROM conversation_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id IN (?)
        ORDER BY u.name ASC
        `,
        [convIds]
      );
      for (const m of members) {
        if (!membersByConv[m.conversation_id]) membersByConv[m.conversation_id] = [];
        membersByConv[m.conversation_id].push({
          id: m.id,
          name: m.name,
          email: m.email,
        });
      }
    }

    const out = rows.map((r) => ({
      ...r,
      members: membersByConv[r.id] || [],
    }));

    res.json(out);
  } catch (e) {
    console.error('[messages][conversations]', e?.message || e);
    res.status(500).json({ error: 'No se pudieron listar conversaciones' });
  }
});

// POST /api/messages/conversations
router.post('/conversations', requireAuth, async (req, res) => {
  try {
    const userId = Number(getUserId(req));
    if (!userId) return res.status(401).json({ error: 'No auth' });

    const type = String(req.body?.type || 'direct').toLowerCase();
    const title = (req.body?.title || '').trim() || null;
    let memberIds = Array.isArray(req.body?.member_ids) ? req.body.member_ids : [];
    memberIds = memberIds.map((v) => Number(v)).filter((v) => Number.isFinite(v));

    if (!memberIds.includes(userId)) memberIds.push(userId);
    memberIds = Array.from(new Set(memberIds));

    if (type === 'direct') {
      const otherIds = memberIds.filter((id) => id !== userId);
      if (otherIds.length !== 1) {
        return res.status(400).json({ error: 'Direct requiere 1 usuario' });
      }
      const otherId = otherIds[0];
      const [exists] = await pool.query(
        `
        SELECT c.id
        FROM conversations c
        JOIN conversation_members cm ON cm.conversation_id = c.id
        WHERE c.type = 'direct' AND cm.user_id IN (?, ?)
        GROUP BY c.id
        HAVING COUNT(*) = 2
        LIMIT 1
        `,
        [userId, otherId]
      );
      if (exists.length) {
        return res.json({ id: exists[0].id, reused: true });
      }
    }

    const [ins] = await pool.query(
      'INSERT INTO conversations(type, title, created_by) VALUES(?,?,?)',
      [type === 'group' ? 'group' : 'direct', title, userId]
    );
    const convId = ins.insertId;

    const values = memberIds.map((id) => [convId, id, 'member']);
    await pool.query(
      'INSERT INTO conversation_members(conversation_id, user_id, role) VALUES ?',
      [values]
    );

    res.status(201).json({ id: convId, reused: false });
  } catch (e) {
    console.error('[messages][conversations:create]', e?.message || e);
    res.status(500).json({ error: 'No se pudo crear conversacion' });
  }
});

/* ===================== MENSAJES ===================== */
// GET /api/messages/conversations/:id/messages
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const userId = Number(getUserId(req));
    const convId = Number(req.params.id);
    if (!userId || !convId) return res.status(400).json({ error: 'Datos invalidos' });
    const ok = await ensureMember(convId, userId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const beforeId = Number(req.query.before) || null;

    const where = ['m.conversation_id = ?'];
    const params = [convId];
    if (beforeId) {
      where.push('m.id < ?');
      params.push(beforeId);
    }

    const [messages] = await pool.query(
      `
      SELECT m.id, m.conversation_id, m.sender_id, m.body, m.created_at,
             u.name AS sender_name
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.id DESC
      LIMIT ?
      `,
      [...params, limit]
    );

    const msgIds = messages.map((m) => m.id);
    let attachmentsByMsg = {};
    if (msgIds.length) {
      const [atts] = await pool.query(
        `
        SELECT id, message_id, type, url, mime, filename, size, entity_type, entity_id, label, created_at
        FROM message_attachments
        WHERE message_id IN (?)
        ORDER BY id ASC
        `,
        [msgIds]
      );
      for (const a of atts) {
        if (!attachmentsByMsg[a.message_id]) attachmentsByMsg[a.message_id] = [];
        attachmentsByMsg[a.message_id].push(a);
      }
    }

    const out = messages
      .map((m) => ({ ...m, attachments: attachmentsByMsg[m.id] || [] }))
      .reverse();

    res.json(out);
  } catch (e) {
    console.error('[messages][list]', e?.message || e);
    res.status(500).json({ error: 'No se pudieron cargar mensajes' });
  }
});

// POST /api/messages/conversations/:id/messages (texto + links)
router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const userId = Number(getUserId(req));
    const convId = Number(req.params.id);
    if (!userId || !convId) return res.status(400).json({ error: 'Datos invalidos' });
    const ok = await ensureMember(convId, userId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });

    const body = String(req.body?.body || '').trim();
    const links = Array.isArray(req.body?.links) ? req.body.links : [];
    if (!body && !links.length) {
      return res.status(400).json({ error: 'Mensaje vacio' });
    }

    const [ins] = await pool.query(
      'INSERT INTO messages(conversation_id, sender_id, body) VALUES (?,?,?)',
      [convId, userId, body || null]
    );
    const msgId = ins.insertId;

    if (links.length) {
      const values = links.map((l) => [
        msgId,
        'link',
        l.url || null,
        null,
        null,
        null,
        l.entity_type || null,
        l.entity_id ? Number(l.entity_id) : null,
        l.label || null,
      ]);
      await pool.query(
        `
        INSERT INTO message_attachments
          (message_id, type, url, mime, filename, size, entity_type, entity_id, label)
        VALUES ?
        `,
        [values]
      );
    }

    const [[msg]] = await pool.query(
      'SELECT id, conversation_id, sender_id, body, created_at FROM messages WHERE id = ?',
      [msgId]
    );
    const [atts] = await pool.query(
      `
      SELECT id, message_id, type, url, mime, filename, size, entity_type, entity_id, label, created_at
      FROM message_attachments
      WHERE message_id = ?
      ORDER BY id ASC
      `,
      [msgId]
    );

    const payload = { ...msg, sender_name: req.user?.name || '', attachments: atts || [] };
    emitMessage(convId, payload);

    res.status(201).json(payload);
  } catch (e) {
    console.error('[messages][create]', e?.message || e);
    res.status(500).json({ error: 'No se pudo enviar mensaje' });
  }
});

// POST /api/messages/conversations/:id/files (upload)
router.post('/conversations/:id/files', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const userId = Number(getUserId(req));
    const convId = Number(req.params.id);
    if (!userId || !convId) return res.status(400).json({ error: 'Datos invalidos' });
    const ok = await ensureMember(convId, userId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const body = String(req.body?.body || '').trim() || null;

    const [ins] = await pool.query(
      'INSERT INTO messages(conversation_id, sender_id, body) VALUES (?,?,?)',
      [convId, userId, body]
    );
    const msgId = ins.insertId;

    const relUrl = `/uploads/messages/${convId}/${req.file.filename}`;
    await pool.query(
      `
      INSERT INTO message_attachments
        (message_id, type, url, mime, filename, size)
      VALUES (?,?,?,?,?,?)
      `,
      [msgId, 'file', relUrl, req.file.mimetype, req.file.originalname, req.file.size]
    );

    const [[msg]] = await pool.query(
      'SELECT id, conversation_id, sender_id, body, created_at FROM messages WHERE id = ?',
      [msgId]
    );
    const [atts] = await pool.query(
      `
      SELECT id, message_id, type, url, mime, filename, size, entity_type, entity_id, label, created_at
      FROM message_attachments
      WHERE message_id = ?
      ORDER BY id ASC
      `,
      [msgId]
    );

    const payload = { ...msg, sender_name: req.user?.name || '', attachments: atts || [] };
    emitMessage(convId, payload);

    res.status(201).json(payload);
  } catch (e) {
    console.error('[messages][upload]', e?.message || e);
    res.status(500).json({ error: 'No se pudo subir archivo' });
  }
});

// POST /api/messages/conversations/:id/read
router.post('/conversations/:id/read', requireAuth, async (req, res) => {
  try {
    const userId = Number(getUserId(req));
    const convId = Number(req.params.id);
    if (!userId || !convId) return res.status(400).json({ error: 'Datos invalidos' });
    const ok = await ensureMember(convId, userId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });

    let messageId = Number(req.body?.message_id) || null;
    if (!messageId) {
      const [[last]] = await pool.query(
        'SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
        [convId]
      );
      messageId = last?.id || null;
    }
    if (!messageId) return res.json({ ok: true });

    await pool.query(
      `
      UPDATE conversation_members
      SET last_read_message_id = ?
      WHERE conversation_id = ? AND user_id = ?
      `,
      [messageId, convId, userId]
    );

    const io = getIO();
    if (io) {
      io.to(`conv:${convId}`).emit('conversation:read', {
        conversation_id: convId,
        user_id: userId,
        message_id: messageId,
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[messages][read]', e?.message || e);
    res.status(500).json({ error: 'No se pudo marcar como leido' });
  }
});

export default router;
