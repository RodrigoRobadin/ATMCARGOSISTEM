// server/src/services/mailer.js
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendMail({ to, subject, html, from }) {
  if (!to || !subject || !html) {
    throw new Error('to, subject y html son requeridos para sendMail');
  }

  const mailFrom = from || process.env.MAIL_FROM || process.env.SMTP_USER;

  return transporter.sendMail({
    from: mailFrom,
    to,
    subject,
    html,
  });
}
