import test from 'node:test';
import assert from 'node:assert/strict';
import { followupPinSource, listFollowupPins, setFollowupPin } from '../src/services/followupPins.js';

test('pin sources are restricted to the supported followup tables', () => {
  assert.equal(followupPinSource('deal', 'activity')?.table, 'activities');
  assert.equal(followupPinSource('deal', 'task')?.table, 'followup_tasks');
  assert.equal(followupPinSource('service_case', 'followup')?.table, 'service_case_followups');
  assert.equal(followupPinSource('deal', 'followup'), null);
});

test('invalid pin requests do not query the database', async () => {
  const db = { query: () => { throw new Error('unexpected query'); } };
  const result = await setFollowupPin(db, {
    scopeType: 'deal', scopeId: 3, sourceType: 'other', sourceId: 8, pinned: true, userId: 1,
  });
  assert.equal(result.status, 400);
});

test('an item from another operation cannot be pinned', async () => {
  const queries = [];
  const db = { query: async (sql, params) => {
    queries.push({ sql, params });
    return [[]];
  } };
  const result = await setFollowupPin(db, {
    scopeType: 'deal', scopeId: 3, sourceType: 'activity', sourceId: 8, pinned: true, userId: 1,
  });
  assert.equal(result.status, 404);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [8, 3]);
  assert.match(queries[0].sql, /WHERE id = \? AND deal_id = \?/);
});

test('pinning and unpinning a service followup keep the same record scope', async () => {
  const queries = [];
  const db = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith('SELECT id FROM service_case_followups')) return [[{ id: 8 }]];
    if (sql.startsWith('SELECT source_type')) return [[{ source_type: 'followup', source_id: 8, pinned_at: '2026-10-21' }]];
    return [[]];
  } };
  const values = { scopeType: 'service_case', scopeId: 3, sourceType: 'followup', sourceId: 8, userId: 1 };
  assert.deepEqual(await setFollowupPin(db, { ...values, pinned: true }), { ok: true, pinned: true });
  assert.deepEqual(queries.find(({ sql }) => sql.startsWith('INSERT IGNORE')).params, ['service_case', 3, 'followup', 8, 1]);
  assert.equal((await listFollowupPins(db, 'service_case', 3)).has('followup:8'), true);
  assert.deepEqual(await setFollowupPin(db, { ...values, pinned: false }), { ok: true, pinned: false });
  assert.deepEqual(queries.find(({ sql }) => sql.startsWith('DELETE FROM followup_pins')).params, ['service_case', 3, 'followup', 8]);
});
