const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const C = require('../src/Core');
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

function fixture() {
  let serial = 0, rev = 0;
  const f = { lists: [{ id: 'a', label: 'Personal', enabled: true }, { id: 'b', label: 'Work', enabled: true }],
    tasks: {}, rows: [], state: {}, messages: {}, archived: [], writes: [], fail: {}, properties: { owner: 'owner@example.com' } };
  const k = (l, id) => l + '/' + id;
  const version = task => ({ ...task, etag: 'v' + ++rev });
  f.add = (listId, task = {}) => {
    const value = version({ id: 't' + ++serial, title: 'Example', status: 'needsAction', ...task });
    f.tasks[k(listId, value.id)] = value; return value;
  };
  f.editRemote = (list, id, change) => { f.tasks[k(list, id)] = version({ ...f.tasks[k(list, id)], ...change }); };
  f.edit = (id, change) => { Object.assign(f.rows.find(r => r.id === id).local, change); };
  const makeRow = (id, local) => {
    const list = f.lists.find(l => l.id === local.listId);
    return { id, local: clone(local), cells: [local.title, list ? list.label : local.listId,
      local.due, local.status, local.notes, 'Synced', id] };
  };
  const refresh = row => {
    const oldLabel = row.cells[1];
    const out = makeRow(row.id, row.local);
    // Retain old rendered label on rename until the next write.
    if (f.state[row.id]?.listLabel === oldLabel && oldLabel !== out.cells[1]) out.cells[1] = oldLabel;
    return out;
  };
  const S = {
    book: () => ({ toast() {} }), setup() {},
    refreshLists: () => clone(f.lists),
    state: () => Object.fromEntries(Object.entries(f.state).map(([id, value]) => [id, { value: clone(value) }])),
    save: (id, value) => { f.state[id] = clone(value); },
    rows: () => {
      const rows = f.rows.map(refresh);
      if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error('Duplicate Row ID');
      return clone(rows);
    },
    locate: id => clone(f.rows.find(r => r.id === id)),
    message: (id, text) => { f.messages[id] = text; },
    unchanged: row => {
      const now = f.rows.find(r => r.id === row.id);
      return now && C.same(now.local, row.local);
    },
    write: (row, value) => {
      if (!S.unchanged(row)) return false;
      f.rows[f.rows.findIndex(r => r.id === row.id)] = makeRow(row.id, value); return true;
    },
    append: (id, value) => { f.rows.push(makeRow(id, value)); },
    archive: (row, reason) => {
      if (!S.unchanged(row)) return false;
      f.archived.push({ row: clone(row), reason }); f.rows = f.rows.filter(r => r.id !== row.id); return true;
    }
  };
  function get(list, id) {
    const task = f.tasks[k(list, id)];
    if (!task) throw Object.assign(Error('404'), { code: 404 });
    return clone(task);
  }
  const A = {
    lists: () => clone(f.lists),
    tasks: list => {
      if (f.fail.fetch === list) throw Error('incomplete fetch');
      return clone(Object.entries(f.tasks).filter(([key]) => key.startsWith(list + '/')).map(([, t]) => t));
    }, get,
    create: (list, body) => {
      const t = f.add(list, body); f.writes.push('create');
      if (f.fail.create) throw Error('response lost');
      return clone(t);
    },
    move: (list, id, dest) => {
      const t = get(list, id); delete f.tasks[k(list, id)];
      if (f.fail.newId) t.id = 'moved' + ++serial;
      f.tasks[k(dest, t.id)] = version(t); f.writes.push('move');
      if (f.fail.move) throw Error('response lost');
      return get(dest, t.id);
    },
    patch: (list, id, body) => {
      if (f.fail.patch) throw Error('patch unavailable');
      f.editRemote(list, id, body); f.writes.push('patch'); return get(list, id);
    },
    remove: (list, id) => { delete f.tasks[k(list, id)]; f.writes.push('delete'); }
  };
  const context = vm.createContext({ TaskSyncCore: C, TaskSyncSheets: S, TaskSyncApi: A,
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    PropertiesService: { getDocumentProperties: () => ({ getProperty: k => f.properties[k], setProperty: (k,v) => { f.properties[k] = v; } }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => 'row' + ++serial }, console });
  vm.runInContext(fs.readFileSync(require.resolve('../src/Sync.js'), 'utf8'), context);
  f.sync = context.TaskSync;
  f.newRow = (local = {}) => {
    const id = 'row' + ++serial;
    f.rows.push(makeRow(id, { title: 'New task', listId: 'a', due: '', status: 'Needs action', notes: '', ...local }));
    return id;
  };
  return f;
}

test('initial import is repeatable and does not write to Google Tasks', () => {
  const f = fixture(); f.add('a'); f.add('b'); f.sync.run(); f.sync.run();
  assert.equal(f.rows.length, 2); assert.deepEqual(f.writes, []);
});
test('stable row identity survives sorting and field edits', () => {
  const f = fixture(); f.add('a', { title: 'First' }); f.add('a', { title: 'Second' }); f.sync.run();
  const row = f.rows[0]; f.rows.reverse(); f.edit(row.id, { notes: 'Edited' }); f.sync.run();
  assert.equal(f.tasks['a/' + f.state[row.id].taskId].notes, 'Edited');
});
test('merges remote fields with a local native cross-list move', () => {
  const f = fixture(); const t = f.add('a'); f.sync.run(); const id = f.rows[0].id;
  f.edit(id, { listId: 'b' }); f.editRemote('a', t.id, { notes: 'Remote note' }); f.sync.run();
  assert.equal(f.rows[0].local.listId, 'b'); assert.equal(f.rows[0].local.notes, 'Remote note');
  assert.deepEqual(f.writes, ['move']);
});
test('failed patch after a move retains the old field baseline', () => {
  const f = fixture(); const t = f.add('a'); f.sync.run(); const id = f.rows[0].id;
  f.edit(id, { listId: 'b', title: 'Local title' }); f.editRemote('a', t.id, { notes: 'Remote note' });
  f.fail.patch = true; f.sync.run(); f.fail.patch = false; f.sync.run();
  assert.equal(f.rows[0].local.notes, 'Remote note'); assert.equal(f.rows[0].local.title, 'Local title');
  assert.equal(f.rows[0].local.listId, 'b'); assert.equal(f.rows.length, 1);
});
test('lost create response blocks retries and duplicate imports until linked', () => {
  const f = fixture(); const id = f.newRow(); f.fail.create = true; f.sync.run(); f.sync.run();
  assert.deepEqual(f.writes, ['create']); assert.equal(f.rows.length, 1);
  const candidates = f.sync.recoveryCandidates(id); assert.equal(candidates.length, 1);
  f.sync.recover(id, candidates[0], false); f.sync.run();
  assert.equal(f.state[id].pending, undefined); assert.equal(f.rows.length, 1);
});
test('lost move response with a new identity can be recovered without losing unrelated remote edits', () => {
  const f = fixture(); const t = f.add('a'); f.sync.run(); const id = f.rows[0].id;
  f.edit(id, { listId: 'b', title: 'Local' }); f.editRemote('a', t.id, { notes: 'Remote' });
  f.fail.move = true; f.fail.newId = true; f.sync.run(); f.sync.run();
  assert.equal(f.rows.length, 1); assert.equal(f.state[id].pending.kind, 'move');
  const candidates = f.sync.recoveryCandidates(id);
  f.sync.recover(id, candidates[0], false); f.sync.run();
  assert.equal(f.rows[0].local.notes, 'Remote'); assert.equal(f.rows[0].local.title, 'Local');
});
test('same-field conflict can explicitly keep Sheet values while merging unrelated remote changes', () => {
  const f = fixture(); const t = f.add('a'); f.sync.run(); const id = f.rows[0].id;
  f.edit(id, { title: 'Sheet' }); f.editRemote('a', t.id, { title: 'Tasks', notes: 'Remote note' });
  f.sync.run(); assert.equal(f.state[id].conflict.fields[0], 'title'); assert.equal(f.writes.length, 0);
  f.sync.resolve(id, 'local'); f.sync.run();
  assert.equal(f.rows[0].local.title, 'Sheet'); assert.equal(f.rows[0].local.notes, 'Remote note');
});
test('moves to disabled lists pause instead of deleting the Sheet row', () => {
  const f = fixture(); const t = f.add('a'); f.sync.run(); const id = f.rows[0].id;
  f.lists[1].enabled = false; f.tasks['b/' + t.id] = f.tasks['a/' + t.id]; delete f.tasks['a/' + t.id];
  f.sync.run(); assert.equal(f.rows.length, 1); assert.match(f.messages[id], /Paused/);
  assert.equal(f.archived.length, 0);
});
test('incomplete reads abort before any remote mutation or archival', () => {
  const f = fixture(); f.add('a'); f.sync.run(); f.edit(f.rows[0].id, { status: 'Delete' });
  f.fail.fetch = 'b'; assert.throws(() => f.sync.run(), /incomplete fetch/);
  assert.equal(f.archived.length, 0); assert.equal(f.writes.length, 0);
});
test('physical row deletion restores the row without deleting its task', () => {
  const f = fixture(); f.add('a'); f.sync.run(); const id = f.rows[0].id; f.rows = []; f.sync.run();
  assert.equal(f.rows[0].id, id); assert.equal(f.writes.length, 0);
});
test('explicit deletion archives the row; remote deletion plus local edits conflicts', () => {
  const f = fixture(); f.add('a'); f.sync.run(); f.edit(f.rows[0].id, { status: 'Delete' }); f.sync.run();
  assert.equal(f.rows.length, 0); assert.equal(f.archived.length, 1);
  const g = fixture(); const t = g.add('a'); g.sync.run(); const id = g.rows[0].id;
  delete g.tasks['a/' + t.id]; g.edit(id, { notes: 'Keep' }); g.sync.run();
  assert.equal(g.rows.length, 1); assert.ok(g.state[id].conflict);
});
test('parents and subtasks cannot move across lists', () => {
  const f = fixture(); const t = f.add('a'); f.add('a', { parent: t.id }); f.sync.run();
  const id = f.rows.find(r => f.state[r.id].taskId === t.id).id;
  f.edit(id, { listId: 'b' }); f.sync.run();
  assert.equal(f.writes.length, 0); assert.match(f.messages[id], /standalone/);
});
test('list renaming refreshes display without moving or recreating tasks', () => {
  const f = fixture(); f.add('a'); f.sync.run(); f.lists[0].label = 'Renamed'; f.sync.run();
  assert.equal(f.rows[0].cells[1], 'Renamed'); assert.equal(f.writes.length, 0);
});
test('edits made in the Sheet during a remote write survive until the next sync', () => {
  const f = fixture(); f.add('a'); f.sync.run(); const id = f.rows[0].id;
  f.edit(id, { title: 'First edit' });
  const original = f.sync; // API write hook through the fixture state mutation.
  // Simulate stale row detection directly by changing local values during reads.
  Object.defineProperty(f.fail, 'patch', { get() { f.edit(id, { title: 'Second edit' }); return false; } });
  original.run(); assert.equal(f.rows[0].local.title, 'Second edit');
  delete f.fail.patch; original.run();
  assert.equal(f.tasks['a/' + f.state[id].taskId].title, 'Second edit');
});
