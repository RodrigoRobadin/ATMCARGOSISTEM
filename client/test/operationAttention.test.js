import test from 'node:test';
import assert from 'node:assert/strict';
import { getOperationAttention, needsOperationAttention } from '../src/utils/operationAttention.js';

const now = Date.parse('2026-10-05T12:00:00Z');
const operation = { reference: 'OP-000123', record_type: 'operation', has_operation_work: 0 };

test('flags an untouched operation after four complete days', () => {
  assert.equal(needsOperationAttention({ ...operation, created_at: '2026-10-01T12:00:00Z' }, now), true);
  assert.equal(needsOperationAttention({ ...operation, created_at: '2026-10-01T12:01:00Z' }, now), false);
});

test('does not flag operations with work or prospects', () => {
  assert.equal(needsOperationAttention({ ...operation, created_at: '2026-09-20T12:00:00Z', has_operation_work: 1 }, now), false);
  assert.equal(needsOperationAttention({ ...operation, created_at: '2026-09-20T12:00:00Z', record_type: 'prospect' }, now), false);
  assert.equal(needsOperationAttention({ ...operation, created_at: '2026-09-20T12:00:00Z' }, now, true), false);
});

test('does not flag unknown activity state, missing dates, or lost operations', () => {
  assert.equal(needsOperationAttention({ ...operation, created_at: '2026-09-20T12:00:00Z', has_operation_work: undefined }, now), false);
  assert.equal(needsOperationAttention({ ...operation, created_at: null }, now), false);
  assert.equal(needsOperationAttention({ ...operation, created_at: '2026-09-20T12:00:00Z', commercial_outcome: 'lost' }, now), false);
});

test('overdue activities take priority even when there is a future activity', () => {
  const deal = {
    ...operation,
    has_operation_work: 1,
    created_at: '2026-10-04T12:00:00Z',
    overdue_followup_tasks_count: 2,
    future_followup_tasks_count: 1,
    last_operation_work_at: '2026-10-04T12:00:00Z',
  };
  assert.deepEqual(getOperationAttention(deal, now), {
    reason: 'overdue', label: '2 actividades vencidas',
  });
  assert.equal(needsOperationAttention(deal, now), true);
});

test('a scheduled activity turns the card red when it expires without a reload', () => {
  const deal = {
    ...operation,
    has_operation_work: 1,
    created_at: '2026-10-04T12:00:00Z',
    last_operation_work_at: '2026-10-04T12:00:00Z',
    future_followup_tasks_count: 1,
    next_task_due_at: '2026-10-05T12:00:00Z',
  };
  assert.equal(getOperationAttention(deal, now), null);
  assert.equal(getOperationAttention(deal, now + 1000)?.reason, 'overdue');
});

test('flags worked operations after five full days without a future follow-up', () => {
  const deal = {
    ...operation,
    has_operation_work: 1,
    created_at: '2026-09-01T12:00:00Z',
    last_operation_work_at: '2026-09-30T12:00:00Z',
    future_followup_tasks_count: 0,
  };
  assert.deepEqual(getOperationAttention(deal, now), {
    reason: 'no_followup', label: 'Sin próximo seguimiento (5 d)',
  });
  assert.equal(getOperationAttention({ ...deal, last_operation_work_at: '2026-09-30T12:01:00Z' }, now), null);
  assert.equal(getOperationAttention({ ...deal, future_followup_tasks_count: 1 }, now), null);
  assert.equal(getOperationAttention({ ...deal, last_operation_work_at: null }, now), null);
});

test('prospects and lost operations stay excluded from all alerts', () => {
  const overdue = { ...operation, created_at: '2026-10-01T12:00:00Z', overdue_followup_tasks_count: 1 };
  assert.equal(getOperationAttention({ ...overdue, record_type: 'prospect' }, now), null);
  assert.equal(getOperationAttention({ ...overdue, commercial_outcome: 'lost' }, now), null);
  assert.equal(getOperationAttention(overdue, now, true), null);
});
