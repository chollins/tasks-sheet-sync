const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/Core');
const base = { title: 'Book dentist', listId: 'personal', due: '2026-11-20', status: 'Needs action', notes: '' };

test('merges independent changes, including a cross-list move', () => {
  const local = { ...base, listId: 'health', notes: 'Ask about cleaning' };
  const remote = { ...base, due: '2026-11-21' };
  assert.deepEqual(C.plan(base, local, remote), {
    kind: 'merge', merged: { ...local, due: remote.due }, changed: ['listId', 'notes']
  });
});
test('same-field differences are conflicts rather than last-write wins', () => {
  assert.deepEqual(C.plan(base, { ...base, title: 'Local' }, { ...base, title: 'Remote' }),
    { kind: 'conflict', fields: ['title'] });
});
test('identical edits on both sides converge without a write', () => {
  const changed = { ...base, status: 'Completed' };
  assert.deepEqual(C.plan(base, changed, changed), { kind: 'merge', merged: changed, changed: [] });
});
test('remote deletion archives unchanged tasks but preserves pending local edits', () => {
  assert.equal(C.plan(base, base, null).kind, 'archive');
  assert.equal(C.plan(base, { ...base, notes: 'Keep this' }, null).kind, 'conflict');
});
test('explicit delete conflicts with concurrent remote edits', () => {
  const local = { ...base, status: 'Delete' };
  assert.equal(C.plan(base, local, base).kind, 'delete');
  assert.equal(C.plan(base, local, { ...base, title: 'Changed' }).kind, 'conflict');
  assert.equal(C.plan(base, local, null).kind, 'archive');
});
test('different list destinations conflict', () => {
  assert.deepEqual(C.plan(base, { ...base, listId: 'a' }, { ...base, listId: 'b' }).fields, ['listId']);
});
test('patches include only changed fields and explicitly clear dates/completion', () => {
  assert.deepEqual(C.body({ ...base, due: '' }, ['due']), { due: null });
  assert.deepEqual(C.body(base, ['status']), { status: 'needsAction', completed: null });
  assert.deepEqual(C.body({ ...base, status: 'Completed' }, ['status']), { status: 'completed' });
  assert.deepEqual(C.body(base, ['notes', 'listId']), { notes: '' });
});
test('API normalization preserves date-only due dates and blank notes', () => {
  assert.deepEqual(C.normalize({ title: base.title, due: '2026-11-20T00:00:00.000Z' }, base.listId), base);
});
test('validates dates, lists, status, and field limits', () => {
  C.validate(base, ['personal']);
  for (const bad of [{ due: '2026-02-30' }, { due: 'tomorrow' }, { listId: 'missing' },
    { status: 'Maybe' }, { title: ' ' }, { notes: 'a'.repeat(8193) }]) {
    assert.throws(() => C.validate({ ...base, ...bad }, ['personal']));
  }
});
