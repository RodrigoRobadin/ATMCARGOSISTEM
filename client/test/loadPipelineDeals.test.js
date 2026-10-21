import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPipelineDeals } from '../src/utils/loadPipelineDeals.js';

test('loads all pages with the same filters', async () => {
  const calls = [];
  const api = { get: async (_path, { params }) => {
    calls.push(params);
    return { data: params.offset === 0 ? Array.from({ length: 500 }, (_, index) => ({ id: index + 1 })) : [{ id: 501 }] };
  } };
  const deals = await loadPipelineDeals(api, { pipeline_id: 4, commercial_outcome: 'active' });
  assert.equal(deals.length, 501);
  assert.deepEqual(calls.map((call) => call.offset), [0, 500]);
  assert.ok(calls.every((call) => call.pipeline_id === 4 && call.limit === 500));
});

test('does not repeat an operation that appears across page boundaries', async () => {
  const api = { get: async (_path, { params }) => ({ data: params.offset === 0
    ? Array.from({ length: 500 }, (_, index) => ({ id: index + 1 }))
    : [{ id: 500 }, { id: 501 }] }) };
  const deals = await loadPipelineDeals(api, {});
  assert.equal(deals.length, 501);
});
