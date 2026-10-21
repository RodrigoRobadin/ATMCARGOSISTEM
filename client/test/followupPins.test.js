import test from 'node:test';
import assert from 'node:assert/strict';
import { sortFollowupEntries } from '../src/utils/followupPins.js';

test('pinned followups stay first and retain newest-first order within each group', () => {
  const entries = [
    { id: 'old', created_at: '2026-10-01', pinned: false },
    { id: 'pinned-old', created_at: '2026-10-02', pinned: true },
    { id: 'new', created_at: '2026-10-20', pinned: false },
    { id: 'pinned-new', created_at: '2026-10-19', pinned: true },
  ];
  assert.deepEqual(sortFollowupEntries(entries).map((item) => item.id), ['pinned-new', 'pinned-old', 'new', 'old']);
  assert.equal(entries[0].id, 'old');
});
