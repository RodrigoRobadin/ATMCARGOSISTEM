import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDiff, auditedRowMutation, recordAuditChange } from '../src/services/audit.js';

test('auditDiff records only changed persisted fields and omits secrets', () => {
  assert.deepEqual(
    auditDiff(
      { id: 3, name: 'Antes', phone: null, updated_at: 'yesterday', access_token: 'old' },
      { id: 3, name: 'Después', phone: '123', updated_at: 'today', access_token: 'new' }
    ),
    { name: { before: 'Antes', after: 'Después' }, phone: { before: null, after: '123' } }
  );
});

test('unchanged updates do not insert audit events', async () => {
  const conn = { query: () => { throw new Error('Unexpected insert'); } };
  const result = await recordAuditChange(conn, {
    action: 'update', entity: 'contact', entityId: 4,
    before: { id: 4, name: 'Igual' }, after: { id: 4, name: 'Igual' },
  });
  assert.equal(result, false);
});

test('audit insert has actor, parent record and before/after values', async () => {
  let parameters;
  const conn = { query: async (_sql, params) => { parameters = params; } };
  await recordAuditChange(conn, {
    req: { user: { id: 8, name: 'Ana' }, ip: '127.0.0.1', headers: {} },
    action: 'update', entity: 'branch', entityId: 9,
    rootEntity: 'organization', rootEntityId: 2,
    before: { city: 'Asunción' }, after: { city: 'Luque' },
  });
  assert.equal(parameters[0], 8);
  assert.equal(parameters[1], 'Ana');
  assert.equal(parameters[5], 'organization');
  assert.equal(parameters[6], 2);
  assert.deepEqual(JSON.parse(parameters[8]).changes.city, { before: 'Asunción', after: 'Luque' });
});

test('audit resolves the actor name when the session only contains a user ID', async () => {
  let inserted;
  const conn = {
    query: async (sql, params) => {
      if (sql.startsWith('SELECT name FROM users')) return [[{ name: 'Ana' }]];
      inserted = params;
      return [{}];
    },
  };
  await recordAuditChange(conn, {
    req: { user: { id: 8 }, headers: {} },
    action: 'update', entity: 'contact', entityId: 4,
    before: { name: 'Antes' }, after: { name: 'Después' },
  });
  assert.equal(inserted[1], 'Ana');
});

test('audit insert failure is propagated to the mutation transaction', async () => {
  const conn = { query: async () => { throw new Error('db unavailable'); } };
  await assert.rejects(
    recordAuditChange(conn, {
      action: 'update', entity: 'deal', entityId: 1,
      before: { title: 'A' }, after: { title: 'B' },
    }),
    /db unavailable/
  );
});

test('audited mutation rolls back when writing history fails', async () => {
  let row = { id: 7, name: 'Antes' };
  let original;
  let released = false;
  const conn = {
    beginTransaction: async () => { original = { ...row }; },
    commit: async () => { throw new Error('Should not commit'); },
    rollback: async () => { row = original; },
    release: () => { released = true; },
    query: async (sql) => {
      if (sql.startsWith('SELECT *')) return [[{ ...row }]];
      if (sql.startsWith('UPDATE')) { row.name = 'Después'; return [{ affectedRows: 1 }]; }
      if (sql.startsWith('INSERT INTO audit_events')) throw new Error('audit unavailable');
      throw new Error('Unexpected SQL');
    },
  };
  await assert.rejects(
    auditedRowMutation({ getConnection: async () => conn }, {
      action: 'update', entity: 'contact', entityId: 7,
      run: (connection) => connection.query('UPDATE contacts'),
    }),
    /audit unavailable/
  );
  assert.equal(row.name, 'Antes');
  assert.equal(released, true);
});
