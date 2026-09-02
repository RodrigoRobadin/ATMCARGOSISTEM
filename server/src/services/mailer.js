// server/src/services/mailer.js
import nodemailer from 'nodemailer';

function firstEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function booleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'si'].includes(String(value).trim().toLowerCase());
}

function createTransporter() {
  const host = firstEnv('SMTP_HOST', 'MAIL_HOST');
  const port = Number(firstEnv('SMTP_PORT', 'MAIL_PORT') || 587);
  const user = firstEnv('SMTP_USER', 'MAIL_USER');
  const pass = firstEnv('SMTP_PASS', 'MAIL_PASS');

  if (!host || !user || !pass) {
    const missing = [!host && 'host', !user && 'usuario', !pass && 'contraseña']
      .filter(Boolean)
      .join(', ');
    const error = new Error(`El correo SMTP no está configurado. Faltan: ${missing}.`);
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: booleanEnv(firstEnv('SMTP_SECURE', 'MAIL_SECURE'), port === 465),
    auth: { user, pass },
  });
}

export async function sendMail({ to, cc, bcc, subject, html, text, from, attachments }) {
  if (!to || !subject || !html) {
    throw new Error('to, subject y html son requeridos para sendMail');
  }

  const mailFrom = from || firstEnv('MAIL_FROM', 'SMTP_FROM', 'SMTP_USER', 'MAIL_USER');
  const transporter = createTransporter();

  return transporter.sendMail({
    from: mailFrom,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject,
    html,
    text: text || undefined,
    attachments: Array.isArray(attachments) ? attachments : undefined,
  });
}
