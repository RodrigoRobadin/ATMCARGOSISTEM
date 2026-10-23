import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNextAction, closingAssessment, commercialJourneyKey, offerExpiry } from '../src/routes/commercialDashboard.js';

test('overdue follow-up takes precedence over quote and stage alerts', () => {
  const action = buildNextAction({
    overdue_activities: 2,
    is_prospect: false,
    has_quote: true,
    quote_followup_due: true,
    is_closing_soon: true,
  });
  assert.equal(action.key, 'resolver_vencidos');
  assert.equal(action.priority, 'alta');
});

test('a prospect without contact is prompted to make first contact', () => {
  assert.equal(buildNextAction({ is_prospect: true, last_contact_at: null }).key, 'primer_contacto');
});

test('a quoted operation with no recent follow-up is prioritized', () => {
  assert.equal(buildNextAction({ has_quote: true, quote_followup_due: true }).key, 'seguimiento_cotizacion');
});

test('each open deal belongs to one commercial journey group', () => {
  const deals = [
    { is_prospect: true, stage_name: 'Prospecto', has_quote: false },
    { stage_name: 'En seguimiento', has_quote: false },
    { stage_name: 'A cotizar', has_quote: false },
    { stage_name: 'Cotizada', has_quote: true },
    { stage_name: 'A confirmar', has_quote: true, is_closing_soon: true },
  ];
  assert.deepEqual(deals.map(commercialJourneyKey), [
    'prospect', 'followup', 'to_quote', 'quoted', 'closing',
  ]);
});

test('offer validity uses the fixed quotation date and calendar days', () => {
  assert.deepEqual(offerExpiry('2026-10-20', '7 DIAS', '2026-10-23'), {
    expires_on: '2026-10-27', days_remaining: 4,
  });
  assert.equal(offerExpiry('2026-10-20', '7 días hábiles', '2026-10-23'), null);
  assert.equal(offerExpiry(null, '7 DIAS', '2026-10-23'), null);
});

test('an expired offer becomes a high-priority action', () => {
  const action = buildNextAction({ has_quote: true, offer_days_remaining: -2 });
  assert.equal(action.key, 'vigencia_oferta');
  assert.equal(action.priority, 'alta');
});

test('customer closing date adds an operation to closing within 30 calendar days', () => {
  const deal = { record_type: 'operation', stage_name: 'A cotizar', probability: 20 };
  assert.equal(closingAssessment({ ...deal, expected_close_date: '2026-11-22' }, '2026-10-23').is_closing_soon, true);
  assert.equal(closingAssessment({ ...deal, expected_close_date: '2026-11-23' }, '2026-10-23').is_closing_soon, false);
  const today = closingAssessment({ ...deal, expected_close_date: '2026-10-23' }, '2026-10-23');
  assert.equal(today.closing_days_remaining, 0);
  assert.equal(today.closing_reason, 'Cierre estimado para hoy');
});

test('overdue customer date remains visible and stage probability still qualifies', () => {
  const deal = { record_type: 'operation', stage_name: 'En seguimiento', probability: 10 };
  const overdue = closingAssessment({ ...deal, expected_close_date: '2026-10-20' }, '2026-10-23');
  assert.equal(overdue.is_closing_soon, true);
  assert.equal(overdue.closing_days_remaining, -3);
  assert.equal(buildNextAction({ has_quote: true, ...overdue }).reason, overdue.closing_reason);
  assert.equal(closingAssessment({ ...deal, probability: 75 }, '2026-10-23').is_closing_soon, true);
});

test('invalid or cleared dates do not qualify and prospects never appear in closing', () => {
  const deal = { record_type: 'operation', stage_name: 'En seguimiento', probability: 10 };
  assert.equal(closingAssessment({ ...deal, expected_close_date: null }, '2026-10-23').is_closing_soon, false);
  assert.equal(closingAssessment({ ...deal, expected_close_date: '2026-02-30' }, '2026-10-23').is_closing_soon, false);
  assert.equal(closingAssessment({ ...deal, record_type: 'prospect', expected_close_date: '2026-10-25', probability: 90 }, '2026-10-23').is_closing_soon, false);
});
