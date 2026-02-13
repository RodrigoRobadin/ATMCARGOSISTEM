// server/src/socket.js
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { pool } from './services/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const AUTH_OPTIONAL =
  process.env.AUTH_OPTIONAL === '1' ||
  String(process.env.AUTH_OPTIONAL || '').toLowerCase() === 'true';

async function isMember(conversationId, userId) {
  const [[row]] = await pool.query(
    'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1',
    [conversationId, userId]
  );
  return !!row;
}

export function initSocket(httpServer, { sessionMiddleware, allowedOrigins }) {
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  if (sessionMiddleware) {
    io.use((socket, next) => sessionMiddleware(socket.request, {}, next));
  }

  io.use((socket, next) => {
    const sessUser = socket.request?.session?.user;
    if (sessUser) {
      socket.user = sessUser;
      return next();
    }

    const token = socket.handshake?.auth?.token || null;
    if (token) {
      try {
        socket.user = jwt.verify(token, JWT_SECRET);
        return next();
      } catch {
        // invalid token, try optional auth below
      }
    }

    if (AUTH_OPTIONAL) {
      socket.user = { id: 2, name: 'Admin', email: 'admin@tuempresa.com', role: 'admin' };
      return next();
    }

    return next(new Error('No auth'));
  });

  io.on('connection', (socket) => {
    socket.on('conversation:join', async (conversationId) => {
      try {
        const cid = Number(conversationId);
        const uid = Number(socket.user?.id);
        if (!cid || !uid) return;
        const ok = await isMember(cid, uid);
        if (!ok) return;
        socket.join(`conv:${cid}`);
      } catch {}
    });

    socket.on('conversation:leave', (conversationId) => {
      try {
        const cid = Number(conversationId);
        if (!cid) return;
        socket.leave(`conv:${cid}`);
      } catch {}
    });
  });

  return io;
}
