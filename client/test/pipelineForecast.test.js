import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedCloseMonth, groupForecastOperations } from '../src/utils/pipelineForecast.js';

test('forecast accepts real calendar dates only', () => {
  assert.equal(expectedCloseMonth('2026-11-30'), '2026-11');
  assert.equal(expectedCloseMonth('2026-02-30'), null);
  assert.equal(expectedCloseMonth('2026-11-30x'), null);
  assert.equal(expectedCloseMonth(''), null);
});

test('forecast includes each dated operation once, excluding prospects', () => {
  const stages = [{ id: 1, name: 'Prospecto' }, { id: 2, name: 'A Cotizar' }];
  const deals = [
    { id: 3, stage_id: 2, expected_close_date: '2026-12-05' },
    { id: 2, stage_id: 2, expected_close_date: '2026-11-20' },
    { id: 1, stage_id: 2, expected_close_date: null },
    { id: 4, stage_id: 1, expected_close_date: '2026-11-01' },
    { id: 5, stage_id: 2, record_type: 'prospect', expected_close_date: '2026-11-02' },
  ];
  assert.deepEqual(groupForecastOperations(deals, stages).map((group) =>
    [group.month, group.operations.map((deal) => deal.id)]
  ), [['2026-11', [2]], ['2026-12', [3]]]);
  const corrected = deals.map((deal) => deal.id === 2 ? { ...deal, expected_close_date: '2026-12-10' } : deal);
  assert.deepEqual(groupForecastOperations(corrected, stages).map((group) =>
    [group.month, group.operations.map((deal) => deal.id)]
  ), [['2026-12', [3, 2]]]);
});
