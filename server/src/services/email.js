// server/src/services/email.js
import { sendMail } from './mailer.js';

export async function sendEmail({ to, cc, subject, html }) {
  const payload = {
    to,
    subject,
    html,
  };
  if (cc) payload.cc = cc;
  return sendMail(payload);
}
