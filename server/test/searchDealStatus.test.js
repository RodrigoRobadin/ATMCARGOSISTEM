import test from 'node:test';
import assert from 'node:assert/strict';
import { addDealSearchStatuses } from '../src/services/searchDealStatus.js';

const deal = { id: 7, reference: 'OP-000007' };
const confirmationFields = [
  { deal_id: 7, key: 'f_confirm', value: '2026-10-10' },
  { deal_id: 7, key: 'confirm_file_id', value: '12' },
];

test('confirmation requires a valid date and a customer confirmation file from the same deal', () => {
  const confirmed = addDealSearchStatuses([deal], confirmationFields, [{ id: 12, deal_id: 7 }], []);
  assert.equal(confirmed[0].is_confirmed, true);
  assert.equal(confirmed[0].is_invoiced, false);
  assert.equal(addDealSearchStatuses([deal], confirmationFields, [{ id: 12, deal_id: 8 }], [])[0].is_confirmed, false);
  assert.equal(addDealSearchStatuses([deal], confirmationFields, [], [])[0].is_confirmed, false);
  assert.equal(addDealSearchStatuses([deal], [
    { deal_id: 7, key: 'f_confirm', value: '2026-02-30' },
    { deal_id: 7, key: 'confirm_file_id', value: '12' },
  ], [{ id: 12, deal_id: 7 }], [])[0].is_confirmed, false);
});

test('only issued invoices count as invoiced; both indicators can be shown', () => {
  const invoices = [
    { deal_id: 7, status: 'borrador', issue_date: '2026-10-11' },
    { deal_id: 7, status: 'anulada', issue_date: '2026-10-12' },
    { deal_id: 8, status: 'emitida', issue_date: '2026-10-11' },
  ];
  const [notIssued] = addDealSearchStatuses([deal], [], [], invoices);
  assert.equal(notIssued.is_invoiced, false);
  assert.equal(notIssued.is_confirmed, false);
  invoices.push({ deal_id: 7, status: 'emitida', issue_date: '2026-10-13' });
  const [invoiceOnly] = addDealSearchStatuses([deal], [], [], invoices);
  assert.equal(invoiceOnly.is_invoiced, true);
  assert.equal(invoiceOnly.is_confirmed, true);
  const [result] = addDealSearchStatuses([deal], confirmationFields, [{ id: 12, deal_id: 7 }], invoices);
  assert.equal(result.is_invoiced, true);
  assert.equal(result.is_confirmed, true);
});

test('latest saved confirmation fields take precedence', () => {
  const [result] = addDealSearchStatuses([deal], [
    { deal_id: 7, key: 'confirm_file_id', value: '' },
    ...confirmationFields,
  ], [{ id: 12, deal_id: 7 }], []);
  assert.equal(result.is_confirmed, false);
});
