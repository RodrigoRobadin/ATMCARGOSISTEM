import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFontScale, readFontScale, saveFontScale } from '../src/utils/fontPreference.js';

test('font scale stays within the supported steps', () => {
  assert.equal(normalizeFontScale('120'), 120);
  assert.equal(normalizeFontScale(200), 130);
  assert.equal(normalizeFontScale(10), 90);
  assert.equal(normalizeFontScale('invalid'), 100);
});

test('font preference is independent for each user', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  saveFontScale(3, 120, storage);
  saveFontScale(7, 90, storage);
  assert.equal(readFontScale(3, storage), 120);
  assert.equal(readFontScale(7, storage), 90);
  assert.equal(readFontScale(8, storage), 100);
  assert.equal(readFontScale(null, storage), 100);
});
