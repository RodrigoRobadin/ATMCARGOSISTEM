import test from 'node:test';
import assert from 'node:assert/strict';
import { electronicPointFor } from '../src/services/electronicExpedition.js';

test('electronic invoices use the point assigned to their operation module', () => {
  assert.equal(electronicPointFor({ dealId: 1, businessUnitKey: 'atm-cargo' }), '001');
  assert.equal(electronicPointFor({ dealId: 2, businessUnitKey: 'atm-industrial' }), '002');
  assert.equal(electronicPointFor({ serviceCaseId: 3 }), '002');
});

test('container and unidentified sources do not silently use the Cargo point', () => {
  assert.throws(() => electronicPointFor({ dealId: 1, businessUnitKey: 'atm-cargo', containerBillingCycleId: 4 }), /Container/);
  assert.throws(() => electronicPointFor({ dealId: 1, businessUnitKey: 'unknown' }), /identificar/);
  assert.throws(() => electronicPointFor({}), /identificar/);
});
