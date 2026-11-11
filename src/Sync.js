var TaskSync = (function () {
  'use strict';
  function assertOwner(create) {
    var email = Session.getEffectiveUser().getEmail();
    if (!email) throw new Error('Cannot identify the signed-in Google account.');
    var properties = PropertiesService.getDocumentProperties(), owner = properties.getProperty('owner');
    if (!owner && create) { properties.setProperty('owner', email); owner = email; }
    if (owner !== email) throw new Error('Only the account that set up Tasks Sync can run it.');
  }
  function locked(fn) {
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(1000)) throw new Error('A sync is already running. Try again shortly.');
    try { return fn(); } finally { lock.releaseLock(); }
  }
  function key(listId, id) { return listId + '/' + id; }
  function snapshot(lists) {
    var all = {};
    // Read disabled lists too: a move into one must not look like a deletion.
    // Disabled lists remain read-only and are excluded from new imports.
    lists.forEach(function (l) {
      TaskSyncApi.tasks(l.id).forEach(function (task) {
        if (!task.deleted) all[key(l.id, task.id)] = { task: task, listId: l.id };
      });
    });
    return all;
  }
  function find(meta, all) {
    if (all[key(meta.listId, meta.taskId)]) return all[key(meta.listId, meta.taskId)];
    var matches = Object.keys(all).map(function (k) { return all[k]; }).filter(function (v) { return v.task.id === meta.taskId; });
    if (matches.length > 1) throw new Error('Conflict: task identity exists in multiple lists.');
    return matches[0] || null;
  }
  function fresh(remote) {
    var task = TaskSyncApi.get(remote.listId, remote.task.id);
    if (task.deleted || (remote.task.etag && task.etag !== remote.task.etag) ||
      !TaskSyncCore.same(TaskSyncCore.normalize(task, remote.listId), TaskSyncCore.normalize(remote.task, remote.listId)) ||
      task.parent !== remote.task.parent) throw new Error('Pending: task changed remotely; sync again.');
    return task;
  }
  function confirmed(id, task, listId, lists) {
    var value = TaskSyncCore.normalize(task, listId), list = lists.find(function (l) { return l.id === listId; });
    var meta = { taskId: task.id, listId: listId, listLabel: list ? list.label : listId,
      base: value, parent: task.parent || '', etag: task.etag || '', updated: task.updated || '' };
    TaskSyncSheets.save(id, meta);
    return meta;
  }
  function localValue(row, meta, lists) {
    var local = Object.assign({}, row.local);
    if (!local.listId && meta && row.cells[1] === meta.listLabel) local.listId = meta.listId;
    if (!meta && !row.cells[1]) local.listId = lists.find(function (l) { return l.enabled; }).id;
    return local;
  }
  function conflict(row, meta, remote, fields) {
    meta.conflict = { remote: remote ? TaskSyncCore.normalize(remote.task, remote.listId) : null,
      task: remote ? remote.task : null, local: row.local, fields: fields, at: new Date().toISOString() };
    TaskSyncSheets.save(row.id, meta);
    TaskSyncSheets.message(row.id, 'Conflict: ' + fields.join(', ') + ' — use Resolve selected row');
  }
  function archive(row, meta, reason) {
    meta.archived = true; meta.pending = null; delete meta.conflict;
    TaskSyncSheets.save(row.id, meta);
    TaskSyncSheets.archive(row, reason);
  }
  function process(row, meta, lists, all) {
    var local = localValue(row, meta, lists), enabled = lists.filter(function (l) { return l.enabled; }).map(function (l) { return l.id; });
    if (meta && meta.archived) {
      if (local.status === 'Delete' || TaskSyncCore.same(meta.base, local)) TaskSyncSheets.archive(row, 'Deletion completed');
      else TaskSyncSheets.message(row.id, 'Conflict: deleted task has local edits; copy into a new row to recreate');
      return;
    }
    if (meta && meta.pending) {
      // Deletes are safe to recover automatically after a successful complete fetch.
      if (meta.pending.kind === 'delete' && !find(meta, all)) { archive(row, meta, 'Deleted'); return; }
      TaskSyncSheets.message(row.id, 'Recovery required: ' + meta.pending.kind + ' — use Recover selected row'); return;
    }
    if (meta && !enabled.includes(meta.listId)) { TaskSyncSheets.message(row.id, 'Paused: source list unavailable or disabled'); return; }
    TaskSyncCore.validate(local, enabled);
    if (!meta || !meta.taskId) {
      if (local.status === 'Delete') { archive(row, { base: local }, 'Uncreated row discarded'); return; }
      if (!TaskSyncSheets.unchanged(row)) { TaskSyncSheets.message(row.id, 'Pending: edited during sync'); return; }
      meta = { listId: local.listId, base: local, pending: { kind: 'create', desired: local } };
      TaskSyncSheets.save(row.id, meta);
      var created = TaskSyncApi.create(local.listId, TaskSyncCore.body(local));
      all[key(local.listId, created.id)] = { task: created, listId: local.listId };
      confirmed(row.id, created, local.listId, lists);
      TaskSyncSheets.write(row, TaskSyncCore.normalize(created, local.listId), lists, created.parent);
      return;
    }
    var remote = find(meta, all), remoteValue = remote ? TaskSyncCore.normalize(remote.task, remote.listId) : null;
    if (remote && !enabled.includes(remote.listId)) { TaskSyncSheets.message(row.id, 'Paused: task moved into a disabled list'); return; }
    var plan = TaskSyncCore.plan(meta.base, local, remoteValue);
    if (plan.kind === 'conflict') { conflict(row, meta, remote, plan.fields); return; }
    if (plan.kind === 'archive') { archive(row, meta, 'Deleted in Google Tasks'); return; }
    if (!TaskSyncSheets.unchanged(row)) { TaskSyncSheets.message(row.id, 'Pending: edited during sync'); return; }
    if (plan.kind === 'delete') {
      var deleting = fresh(remote);
      meta.pending = { kind: 'delete', desired: local }; TaskSyncSheets.save(row.id, meta);
      TaskSyncApi.remove(remote.listId, deleting.id, deleting.etag);
      delete all[key(remote.listId, deleting.id)];
      archive(row, meta, 'Deleted from Sheet'); return;
    }
    var task = remote.task, listId = remote.listId;
    if (plan.changed.length) task = fresh(remote);
    if (plan.changed.includes('listId')) {
      var hasChildren = Object.keys(all).some(function (k) {
        return all[k].listId === listId && all[k].task.parent === task.id;
      });
      if (task.parent || hasChildren || task.assignmentInfo) throw new Error('Only standalone, unassigned tasks can move between lists in this version.');
      meta.pending = { kind: 'move', from: listId, to: plan.merged.listId,
        taskId: task.id, desired: plan.merged };
      TaskSyncSheets.save(row.id, meta);
      var moved = TaskSyncApi.move(listId, task.id, plan.merged.listId, task.etag);
      delete all[key(listId, task.id)]; listId = plan.merged.listId; task = moved;
      all[key(listId, task.id)] = { task: task, listId: listId };
      // Persist the returned identity immediately, but retain the prior field
      // baseline until the remaining edits are applied. Otherwise a failed
      // follow-up patch could turn stale Sheet values into apparent new edits.
      meta.taskId = task.id; meta.listId = listId; meta.pending = null;
      TaskSyncSheets.save(row.id, meta);
      // Keep remaining local field edits pending if the patch after a move fails.
    }
    var changes = TaskSyncCore.fields.filter(function (f) { return f !== 'listId' && plan.merged[f] !== TaskSyncCore.normalize(task, listId)[f]; });
    if (changes.length) {
      task = fresh({ task: task, listId: listId });
      task = TaskSyncApi.patch(listId, task.id, TaskSyncCore.body(plan.merged, changes), task.etag);
    }
    all[key(listId, task.id)] = { task: task, listId: listId };
    confirmed(row.id, task, listId, lists);
    TaskSyncSheets.write(row, TaskSyncCore.normalize(task, listId), lists, task.parent);
  }
  function run() {
    return locked(function () {
      assertOwner(false);
      var started = Date.now(), lists = TaskSyncSheets.refreshLists(TaskSyncApi.lists()), all = snapshot(lists);
      var state = TaskSyncSheets.state(), rows = TaskSyncSheets.rows(lists, true), seen = {};
      rows.forEach(function (row) { seen[row.id] = true; });
      // Restore accidentally removed rows without interpreting removal as deletion.
      Object.keys(state).forEach(function (id) {
        var m = state[id].value;
        if (!seen[id] && !m.archived && m.base) TaskSyncSheets.append(id, m.base, lists, m.parent, 'Restored: row removal does not delete tasks');
      });
      rows = TaskSyncSheets.rows(lists, true);
      var count = 0, errors = 0;
      for (var i = 0; i < rows.length; i++) {
        if (Date.now() - started > 240000) break;
        var row = rows[i], meta = state[row.id] ? state[row.id].value : null;
        try { process(row, meta, lists, all); count++; }
        catch (e) { TaskSyncSheets.message(row.id, 'Error: ' + e.message); errors++; }
      }
      // Refresh IDs after writes. Uncertain creations/moves pause imports into their
      // destination list until recovery, so the same task cannot gain a second row.
      var latest = TaskSyncSheets.state(), linked = {}, uncertainLists = {};
      Object.keys(latest).forEach(function (id) {
        var m = latest[id].value;
        if (m.taskId) linked[key(m.listId, m.taskId)] = true;
        if (m.pending && ['create', 'move'].includes(m.pending.kind)) uncertainLists[m.pending.to || m.listId] = true;
      });
      if (i === rows.length) Object.keys(all).forEach(function (k) {
        if (Date.now() - started > 260000 || linked[k] || uncertainLists[all[k].listId] ||
          !lists.some(function (l) { return l.enabled && l.id === all[k].listId; })) return;
        var remote = all[k], id = Utilities.getUuid();
        // Same-ID moves detected across enabled lists must not be reimported.
        var known = Object.keys(latest).some(function (rid) { return latest[rid].value.taskId === remote.task.id && !latest[rid].value.archived; });
        if (known) return;
        var m = confirmed(id, remote.task, remote.listId, lists);
        TaskSyncSheets.append(id, m.base, lists, remote.task.parent); count++;
      });
      var result = count + ' rows processed; ' + errors + ' errors.' + (i < rows.length ? ' Time budget reached; sync again to continue.' : '');
      TaskSyncSheets.book().toast(result, 'Tasks Sync', 10);
      return result;
    });
  }
  function setup() {
    return locked(function () { assertOwner(true); TaskSyncSheets.setup(); TaskSyncSheets.refreshLists(TaskSyncApi.lists()); });
  }
  function selected() {
    var range = TaskSyncSheets.book().getActiveRange();
    if (!range || range.getSheet().getName() !== 'Tasks' || range.getRow() < 2 || range.getNumRows() !== 1) throw new Error('Select one task row on the Tasks tab.');
    var id = String(range.getSheet().getRange(range.getRow(), 7).getValue());
    if (!id) throw new Error('Run Sync now before resolving this row.');
    return id;
  }
  function details() {
    assertOwner(false);
    var id = selected(), entry = TaskSyncSheets.state()[id];
    if (!entry) throw new Error('No synchronized state for this row.');
    return { id: id, meta: entry.value };
  }
  function resolve(id, choice) {
    return locked(function () {
      assertOwner(false);
      var entry = TaskSyncSheets.state()[id], m = entry && entry.value;
      if (!m || !m.conflict) throw new Error('Run sync again; this row no longer has a recorded conflict.');
      var lists = TaskSyncSheets.refreshLists(TaskSyncApi.lists()), rows = TaskSyncSheets.rows(lists, false), row = rows.find(function (r) { return r.id === id; });
      if (!row) throw new Error('Task row missing. Run sync to restore it.');
      var remote = find(m, snapshot(lists));
      var now = remote ? TaskSyncCore.normalize(remote.task, remote.listId) : null;
      if (!TaskSyncCore.equal(now, m.conflict.remote)) throw new Error('Remote task changed again. Run sync before resolving.');
      if (choice === 'remote') {
        if (remote) {
          confirmed(id, remote.task, remote.listId, lists);
          TaskSyncSheets.write(row, now, lists, remote.task.parent);
        } else archive(row, m, 'Remote deletion accepted');
      } else if (choice === 'local') {
        if (!remote) throw new Error('To recreate a deleted task, copy its editable cells into a new row, then accept the remote deletion here.');
        // Rebase only the explicit conflicting fields; retain unrelated changes
        // so the next regular reconciliation still merges them.
        m.conflict.fields.forEach(function (f) {
          if (TaskSyncCore.fields.includes(f)) m.base[f] = now[f];
          else m.base = now; // Explicit deletion-versus-edit resolution.
        });
        delete m.conflict; TaskSyncSheets.save(id, m); TaskSyncSheets.message(id, 'Pending: Sheet choice accepted; run Sync now');
      } else throw new Error('Unknown resolution.');
    });
  }
  function recoveryCandidates(id) {
    assertOwner(false);
    var m = TaskSyncSheets.state()[id].value;
    if (!m.pending) throw new Error('No pending operation.');
    var dest = m.pending.to || m.listId, state = TaskSyncSheets.state();
    var linked = Object.keys(state).filter(function (rid) { return rid !== id; }).map(function (rid) {
      var v = state[rid].value; return key(v.listId, v.taskId);
    });
    return TaskSyncApi.tasks(dest).filter(function (t) { return !t.deleted && !linked.includes(key(dest, t.id)); })
      .map(function (t) { return { task: t, listId: dest }; });
  }
  function recover(id, candidate, retry) {
    return locked(function () {
      assertOwner(false);
      var m = TaskSyncSheets.state()[id].value;
      if (!m.pending) throw new Error('No pending operation.');
      if (retry) {
        if (m.pending.kind === 'move') {
          var source = TaskSyncApi.get(m.pending.from, m.pending.taskId);
          if (source.deleted || !TaskSyncCore.same(TaskSyncCore.normalize(source, m.pending.from), m.base)) throw new Error('Source changed or moved; select the destination task instead.');
        }
        m.pending = null; TaskSyncSheets.save(id, m); TaskSyncSheets.message(id, 'Pending: retry authorized; run Sync now'); return;
      }
      if (!candidate) throw new Error('Choose a destination task.');
      var currentState = TaskSyncSheets.state();
      if (Object.keys(currentState).some(function (rid) {
        var other = currentState[rid].value;
        return rid !== id && other.listId === candidate.listId && other.taskId === candidate.task.id;
      })) throw new Error('That task is already linked to another row.');
      var task = TaskSyncApi.get(candidate.listId, candidate.task.id);
      if (task.deleted) throw new Error('Destination task was deleted.');
      var lists = TaskSyncSheets.refreshLists(TaskSyncApi.lists());
      m.taskId = task.id; m.listId = candidate.listId; m.pending = null;
      TaskSyncSheets.save(id, m);
      // Keep the Sheet unchanged: its pending edits merge on the next sync.
      TaskSyncSheets.message(id, 'Pending: linked to selected task; run Sync now');
    });
  }
  return { setup: setup, run: run, assertOwner: assertOwner, details: details, resolve: resolve,
    recoveryCandidates: recoveryCandidates, recover: recover };
}());
