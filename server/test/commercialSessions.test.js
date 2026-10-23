import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommercialSessions, normalizeSessionRows, validateSessionRange } from '../src/services/commercialSessions.js';

const emptyRows = () => ({
  auditDeals: [], auditOrganizations: [], activities: [], calls: [], notes: [],
  tasks: [], quotes: [], revisions: [], costSheets: [],
});

test('sessions accept a workday or up to 31 calendar days', () => {
  assert.equal(validateSessionRange('2026-10-22', '2026-10-22'), null);
  assert.equal(validateSessionRange('2026-10-01', '2026-10-31'), null);
  assert.match(validateSessionRange('2026-10-01', '2026-11-01'), /31 dias/);
  assert.match(validateSessionRange('2026-02-30', '2026-03-01'), /valido/);
  assert.match(validateSessionRange('2026-10-23', '2026-10-22'), /valido/);
});

test('sessions show creation and completion on their actual recorded days', () => {
  const rows = emptyRows();
  rows.tasks.push({
    id: 9, deal_id: 22, reference: 'OP-000022', org_name: 'Cliente', title: 'Llamar',
    status: 'done', created_at: '2026-10-21 11:00:00', completed_at: '2026-10-22 16:30:00',
  });
  rows.notes.push({
    id: 12, deal_id: 22, reference: 'OP-000022', org_name: 'Cliente',
    content: 'El cliente pidió revisar el plazo.', occurred_at: '2026-10-22 10:00:00',
  });
  const events = normalizeSessionRows(rows, '2026-10-22', '2026-10-22');
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((item) => item.title), ['Tarea completada: Llamar', 'Nota de seguimiento']);
  assert.equal(events[0].deal_id, 22);
});

test('calls use their actual time and separate completed results from pending ones', () => {
  const rows = emptyRows();
  rows.calls.push({ id: 1, status: 'pending_result', subject: 'Seguimiento', occurred_at: '2026-10-22 09:00:00' });
  rows.calls.push({ id: 2, status: 'completed', outcome: 'interesado', subject: 'Cliente', occurred_at: '2026-10-22 10:00:00', organization_id: 4 });
  const events = normalizeSessionRows(rows, '2026-10-22', '2026-10-22');
  assert.deepEqual(events.map((item) => item.title), ['Llamada registrada: Cliente', 'Llamada sin resultado: Seguimiento']);
  assert.equal(events[0].call_status, 'completed');
  assert.equal(events[0].call_outcome, 'interesado');
  assert.equal(events[0].detail, 'Interesado');
  assert.equal(events[0].organization_id, 4);
  assert.equal(events[1].call_status, 'pending_result');
});

test('a completion audit appears on the day the work was done', () => {
  const rows = emptyRows();
  rows.auditDeals.push({
    id: 42, entity: 'deal', deal_id: 22, reference: 'OP-000022',
    description: 'Completó actividad: Llamar al cliente', occurred_at: '2026-10-22 17:15:00',
  });
  const [item] = normalizeSessionRows(rows, '2026-10-22', '2026-10-22');
  assert.equal(item.title, 'Completó actividad: Llamar al cliente');
  assert.equal(item.deal_id, 22);
});

test('session queries remain scoped to Cargo or Industrial and the selected advisor', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return [[]]; } };
  const result = await loadCommercialSessions(db, {
    from: '2026-10-22', to: '2026-10-22', businessUnit: 'atm-industrial', advisorUserId: 13,
  });
  assert.equal(calls.length, 9);
  for (const call of calls) {
    assert.match(call.sql, /bu\.key_slug IN \('atm-cargo', 'atm-industrial'\)/);
    assert.match(call.sql, /d\.advisor_user_id = \?/);
    assert.ok(call.params.includes('atm-industrial'));
    assert.ok(call.params.includes(13));
  }
  const tasksQuery = calls.find((call) => call.sql.includes('FROM followup_tasks t'));
  assert.deepEqual(tasksQuery.params, ['2026-10-22', '2026-10-22', '2026-10-22', '2026-10-22', 'atm-industrial', 13]);
  const callsQuery = calls.find((call) => call.sql.includes('FROM followup_calls c'));
  assert.match(callsQuery.sql, /DATE_FORMAT\(c\.happened_at/);
  assert.match(callsQuery.sql, /d\.org_id = c\.org_id/);
  assert.match(callsQuery.sql, /COALESCE\(c\.status, 'completed'\) <> 'invalidated'/);
  assert.deepEqual(result, { events: [], truncated: false });
});
