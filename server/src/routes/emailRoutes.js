// server/src/routes/emailRoutes.js
import { Router } from "express";
import nodemailer from "nodemailer";

const router = Router();

/**
 * Transporter SMTP
 *
 * Podés:
 *  - Usar variables de entorno (recomendado)
 *  - O dejar valores fijos mientras tanto
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "SMTP_HOST",
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // true si usás 465
  auth: {
    user: process.env.SMTP_USER || "TU_USUARIO_SMTP",
    pass: process.env.SMTP_PASS || "TU_PASSWORD_SMTP",
  },
});

/**
 * POST /api/emails/status-report
 * Body esperado:
 *  {
 *    "to": "cliente@ejemplo.com",
 *    "subject": "Status de embarque OP-000028",
 *    "html": "<h1>...</h1>",
 *    "text": "Opcional: texto plano"
 *  }
 */
router.post("/emails/status-report", async (req, res) => {
  try {
    const { to, subject, html, text } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }

    await transporter.sendMail({
      from:
        process.env.SMTP_FROM ||
        '"Tu Empresa" <no-reply@tu-dominio.com>', // FROM por defecto
      to,
      subject,
      text: text || "",
      html, // 👈 aquí va el HTML completo que le mandás desde el frontend
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[emails/status-report] error:", err);
    res.status(500).json({ error: "No se pudo enviar el correo" });
  }
});

// 👈 ESTO ES LO IMPORTANTE PARA QUE EL IMPORT DEFAULT FUNCIONE
export default router;
