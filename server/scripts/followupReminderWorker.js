import { pathToFileURL } from 'node:url';
import { pool } from '../src/services/db.js';
import { ensureFollowupManagementSchema } from '../src/services/followupManagementService.js';

const POLL_MS = Math.max(30000, Number(process.env.FOLLOWUP_REMINDER_POLL_MS || 60000));

function paraguaySqlDate(offsetMinutes = 0) {
  const date = new Date(Date.now() + offsetMinutes * 60000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

async function sendExpoPush(token, task, stage) {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      sound: 'default',
      title: stage === 'before' ? 'Seguimiento proximo' : 'Seguimiento vencido',
      body: `${task.title}${task.org_name ? ` - ${task.org_name}` : ''}`,
      data: { screen: 'Seguimiento', task_id: task.id, call_id: task.call_id, org_id: task.org_id },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.data?.status === 'error') {
    throw new Error(payload?.data?.message || payload?.errors?.[0]?.message || `Expo HTTP ${response.status}`);
  }
  return payload?.data?.id || null;
}

async function createInternalNotification(task, stage) {
  const type = `followup-${task.id}-${stage}`.slice(0, 50);
  const title = stage === 'before' ? 'Seguimiento proximo' : 'Seguimiento vencido';
  const body = `${task.title}${task.org_name ? ` - ${task.org_name}` : ''}`;
  try {
    const [[existing]] = await pool.query(
      'SELECT id FROM notifications WHERE user_id = ? AND type = ? LIMIT 1',
      [task.user_id, type]
    );
    if (existing) {
      await pool.query(
        `UPDATE notifications
            SET title = ?, body = ?, due_at = ?, is_active = 1
          WHERE id = ?`,
        [title, body, task.due_at, existing.id]
      );
      return;
    }
    await pool.query(
      `INSERT INTO notifications
         (user_id, org_id, deal_id, type, title, body, is_read, is_active, due_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`,
      [task.user_id, task.org_id || null, task.deal_id || null, type, title, body, task.due_at]
    );
  } catch (error) {
    console.warn('[followup-reminders] internal:', error?.message || error);
  }
}
async function processStage(task, device, stage) {
  const [insert] = await pool.query(
    `INSERT IGNORE INTO followup_push_deliveries
       (task_id, device_id, reminder_stage, status)
     VALUES (?, ?, ?, 'pending')`,
    [task.id, device.id, stage]
  );
  if (!insert.affectedRows) return;
  await createInternalNotification(task, stage);
  try {
    const messageId = await sendExpoPush(device.expo_push_token, task, stage);
    await pool.query(
      `UPDATE followup_push_deliveries SET status='sent', provider_message_id=?, sent_at=? WHERE task_id=? AND device_id=? AND reminder_stage=?`,
      [messageId, paraguaySqlDate(), task.id, device.id, stage]
    );
  } catch (error) {
    await pool.query(
      `UPDATE followup_push_deliveries SET status='failed', error_message=?, sent_at=? WHERE task_id=? AND device_id=? AND reminder_stage=?`,
      [String(error?.message || error).slice(0, 500), paraguaySqlDate(), task.id, device.id, stage]
    );
  }
}

export async function runFollowupReminderPass() {
  await ensureFollowupManagementSchema();
  const now = paraguaySqlDate();
  const ahead = paraguaySqlDate(30);
  const [tasks] = await pool.query(
    `SELECT t.id, t.user_id, t.org_id, t.deal_id, t.call_id, t.title, t.due_at, o.name AS org_name
       FROM followup_tasks t
       LEFT JOIN organizations o ON o.id = t.org_id
      WHERE t.status='pending' AND t.due_at <= ?
      ORDER BY t.due_at ASC LIMIT 500`,
    [ahead]
  );
  for (const task of tasks || []) {
    const stage = String(task.due_at) <= now ? 'due' : 'before';
    const [devices] = await pool.query(
      `SELECT id, expo_push_token FROM user_push_devices WHERE user_id=? AND active=1`,
      [task.user_id]
    );
    if (!(devices || []).length) await createInternalNotification(task, stage);
    for (const device of devices || []) await processStage(task, device, stage);
  }
  return { checked: (tasks || []).length, at: now };
}

async function main() {
  console.log(`[followup-reminders] worker activo cada ${POLL_MS} ms`);
  const tick = async () => {
    try {
      const result = await runFollowupReminderPass();
      if (result.checked) console.log('[followup-reminders]', result);
    } catch (error) {
      console.error('[followup-reminders] error:', error?.message || error);
    }
  };
  await tick();
  setInterval(tick, POLL_MS);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
