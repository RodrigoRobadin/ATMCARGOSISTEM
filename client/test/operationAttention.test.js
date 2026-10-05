import test from 'node:test';
import assert from 'node:assert/strict';
import { needsOperationAttention } from '../src/utils/operationAttention.js';

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
