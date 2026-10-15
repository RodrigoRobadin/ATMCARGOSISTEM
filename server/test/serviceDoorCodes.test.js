import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDoorPrefix, nextDoorNumber, formatDoorCode } from '../src/services/serviceDoorCodes.js';

test('door codes use the first three letters without accents or punctuation', () => {
  assert.equal(normalizeDoorPrefix('Paresa'), 'PAR');
  assert.equal(normalizeDoorPrefix('  Minerva Foods'), 'MIN');
  assert.equal(normalizeDoorPrefix('Ñandú S.A.'), 'NAN');
});

test('door numbering is per prefix and skips existing references', () => {
  const references = [
    { ref_int: 'PAR001' },
    { ref_int: 'PAR010' },
    { ref_int: 'MIN004' },
    { ref_int: 'PAR-Legacy' },
  ];
  assert.equal(formatDoorCode('PAR', nextDoorNumber(references, 'PAR')), 'PAR011');
  assert.equal(formatDoorCode('MIN', nextDoorNumber(references, 'MIN')), 'MIN005');
  assert.equal(formatDoorCode('ABC', nextDoorNumber(references, 'ABC')), 'ABC001');
  assert.equal(nextDoorNumber(references, 'PAR', 15), 15);
});
