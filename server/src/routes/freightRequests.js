// server/src/routes/freightRequests.js
import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';
import { sendMail } from '../services/mailer.js';
import db from '../services/db.js';

const router = Router();

router.post('/', requireAuth, async (req, res) => {
  try {
    let { deal_id, to_emails, subject, html, provider_org_ids = [] } = req.body || {};

    // Normalizar destinatarios
    if (typeof to_emails === 'string') {
      to_emails = to_emails
        .split(/[;,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (!Array.isArray(to_emails) || !to_emails.length) {
      return res.status(400).json({ error: 'Debe indicar al menos un destinatario (to_emails)' });
    }
    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ error: 'subject es requerido' });
    }
    if (!html || !String(html).trim()) {
      return res.status(400).json({ error: 'html es requerido' });
    }

    const to = to_emails.join(', ');

    const from = req.user?.email || process.env.MAIL_FROM || process.env.SMTP_USER;

    await sendMail({ to, subject: String(subject), html: String(html), from });

    // Opcional: grabar algo de contexto (no obligatorio)
    const dealIdNum = deal_id ? Number(deal_id) : null;
    if (dealIdNum && Number.isFinite(dealIdNum)) {
      try {
        await db.query(
          `INSERT INTO activities (type, subject, notes, deal_id, done, created_at)
           VALUES ('email', ?, ?, ?, 1, NOW())`,
          [
            `Solicitud de flete enviada`,
            `Enviado a: ${to}\nAsunto: ${subject}`,
            dealIdNum,
          ]
        );
      } catch (e) {
        console.warn('[freightRequests] no se pudo registrar activity', e?.message);
      }
    }

    await logAudit({
      req,
      action: 'create',
      entity: 'freight_request',
      entityId: dealIdNum || null,
      description: 'Envió solicitud de flete',
      meta: { deal_id: dealIdNum, to_emails, provider_org_ids },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[freightRequests:post]', e);
    res.status(500).json({ error: 'No se pudo enviar la solicitud de flete' });
  }
});

export default router;
