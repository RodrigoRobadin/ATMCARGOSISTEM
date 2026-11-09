import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDailyBrief } from '../src/services/assistantDailyBrief.js';

test('morning brief reports only supplied records and links to operations', () => {
  const result = formatDailyBrief({
    mode: 'morning', day: '2026-11-09',
    tasks: [{ source: 'task', title: 'Llamar al cliente', due_at: '2026-11-09 09:00', deal_id: 542, reference: 'OP-000542' }],
    activities: [],
    closings: [{ deal_id: 543, reference: 'OP-000543', title: 'Entrega', close_date: '2026-11-12' }],
  });
  assert.match(result.answer, /Llamar al cliente/);
  assert.equal(result.links[0].href, '/operations/542');
  assert.match(result.answer, /OP-000543/);
  assert.doesNotMatch(result.answer, /cotización/);
});

test('handoff distinguishes logged activity from user-specific claims', () => {
  const result = formatDailyBrief({
    mode: 'handoff', day: '2026-11-09', tasks: [], activities: [],
    events: [{ kind: 'call', call_status: 'completed', title: 'Llamada registrada', deal_id: 542, reference: 'OP-000542', occurred_at: '2026-11-09 15:20:00' }],
  });
  assert.match(result.answer, /actividad registrada en tu cartera/);
  assert.match(result.answer, /llamadas completadas: 1/);
  assert.match(result.answer, /Pendientes vencidas o hasta mañana: 0/);
});

test('truncated pending lists do not claim an exact total', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ source: 'task', title: `Tarea ${i}`, due_at: '2026-11-09 10:00' }));
  const result = formatDailyBrief({ mode: 'morning', day: '2026-11-09', tasks, activities: [], pendingTruncated: true });
  assert.match(result.answer, /al menos 20/);
});

test("yesterday brief labels its period and carries today's pending work", () => {
  const result = formatDailyBrief({ mode: 'yesterday', day: '2026-11-08', tasks: [], activities: [], events: [] });
  assert.match(result.answer, /Continuación de ayer \(2026-11-08\)/);
  assert.match(result.answer, /hasta hoy: 0/);
});
