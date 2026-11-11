/* Pure reconciliation logic. Also loaded unchanged by the Apps Script V8 runtime. */
var TaskSyncCore = (function () {
  'use strict';
  var fields = ['title', 'listId', 'due', 'status', 'notes'];
  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function normalize(task, listId) {
    return {
      title: task.title || '', listId: listId,
      due: task.due ? task.due.slice(0, 10) : '',
      status: task.status === 'completed' ? 'Completed' : 'Needs action',
      notes: task.notes || ''
    };
  }
  function same(a, b) { return fields.every(function (f) { return a[f] === b[f]; }); }
  function plan(base, local, remote) {
    if (!remote) {
      return local.status === 'Delete' || same(base, local)
        ? { kind: 'archive' }
        : { kind: 'conflict', fields: ['deleted remotely'] };
    }
    if (local.status === 'Delete') {
      return same(base, remote) ? { kind: 'delete' }
        : { kind: 'conflict', fields: ['deletion versus remote edits'] };
    }
    var merged = {}, conflicts = [], changed = [];
    fields.forEach(function (f) {
      var lc = local[f] !== base[f], rc = remote[f] !== base[f];
      if (lc && rc && local[f] !== remote[f]) conflicts.push(f);
      merged[f] = lc ? local[f] : remote[f];
      if (merged[f] !== remote[f]) changed.push(f);
    });
    return conflicts.length ? { kind: 'conflict', fields: conflicts }
      : { kind: 'merge', merged: merged, changed: changed };
  }
  function body(value, changed) {
    var result = {};
    (changed || fields).forEach(function (f) {
      if (f === 'listId') return;
      if (f === 'due') result.due = value.due ? value.due + 'T00:00:00.000Z' : null;
      else if (f === 'status') {
        result.status = value.status === 'Completed' ? 'completed' : 'needsAction';
        if (value.status !== 'Completed') result.completed = null;
      } else result[f] = value[f];
    });
    return result;
  }
  function validate(value, listIds) {
    if (!value.title.trim()) throw new Error('Task is required.');
    if (value.title.length > 1024) throw new Error('Task exceeds 1,024 characters.');
    if (value.notes.length > 8192) throw new Error('Notes exceed 8,192 characters.');
    if (!listIds.includes(value.listId)) throw new Error('Choose an enabled Task List.');
    if (!['Needs action', 'Completed', 'Delete'].includes(value.status)) throw new Error('Invalid Status.');
    if (value.due && (!/^\d{4}-\d{2}-\d{2}$/.test(value.due) ||
      !Number.isFinite(Date.parse(value.due)) || new Date(value.due).toISOString().slice(0, 10) !== value.due)) {
      throw new Error('Due Date must be a valid date.');
    }
  }
  return { fields: fields, equal: equal, same: same, normalize: normalize, plan: plan, body: body, validate: validate };
}());
if (typeof module !== 'undefined') module.exports = TaskSyncCore;
