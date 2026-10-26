import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLocaleNumber, parseLocaleNumber } from '../src/utils/localeNumber.js';

test('editing decimal quantities does not multiply them', () => {
  assert.equal(parseLocaleNumber('1,50', 2), 1.5);
  assert.equal(parseLocaleNumber('1.5', 2), 1.5);
  assert.equal(parseLocaleNumber(formatLocaleNumber(1.5, 2), 2), 1.5);
});

test('guarani amounts and exchange rates retain their thousand separators', () => {
  assert.equal(parseLocaleNumber('1.000.000', 0), 1000000);
  assert.equal(parseLocaleNumber('6.500', 0), 6500);
  assert.equal(parseLocaleNumber('1.000,50', 2), 1000.5);
});
