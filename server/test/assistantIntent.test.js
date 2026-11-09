import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDailyRoutineIntent, detectFollowupActionIntent, isGeneralCrmQuery } from '../src/services/assistantIntent.js';

test('general CRM queries do not become actions', () => {
  assert.equal(detectFollowupActionIntent('Abiertas en general'), null);
  assert.equal(detectFollowupActionIntent('Genera un informe de operaciones'), null);
  assert.equal(detectFollowupActionIntent('Mostrame los seguimientos pendientes'), null);
});

test('explicit followup commands still prepare actions', () => {
  assert.equal(detectFollowupActionIntent('Creame una tarea para OP-000542'), 'task');
  assert.equal(detectFollowupActionIntent('Agrega una nota a la operacion'), 'note');
  assert.equal(detectFollowupActionIntent('Genera un recordatorio'), 'reminder');
});

test('general queries ignore an unrelated attached operation', () => {
  assert.equal(isGeneralCrmQuery('Abiertas en general'), true);
  assert.equal(isGeneralCrmQuery('Que operaciones no tienen cotizacion'), true);
  assert.equal(isGeneralCrmQuery('Mostrame los seguimientos pendientes'), true);
  assert.equal(isGeneralCrmQuery('Mostrame las tareas de esta operación'), false);
});

test('daily routines are recognized without treating them as write actions', () => {
  assert.equal(detectDailyRoutineIntent('¿Qué requiere atención hoy?'), 'morning');
  assert.equal(detectDailyRoutineIntent('Resumí lo hecho hoy y lo pendiente para mañana'), 'handoff');
  assert.equal(detectDailyRoutineIntent('Qué hice ayer'), 'yesterday');
  assert.equal(detectFollowupActionIntent('Resumí lo hecho hoy y lo pendiente para mañana'), null);
  assert.equal(detectDailyRoutineIntent('Qué operaciones no tienen cotización'), null);
});
