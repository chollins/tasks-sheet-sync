var TaskSyncSheets = (function () {
  'use strict';
  var headers = ['Task', 'Task List', 'Due Date', 'Status', 'Notes', 'Sync', 'Row ID'];
  var names = { tasks: 'Tasks', lists: 'Task Lists', state: '_Sync', archive: 'Archive' };
  function book() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('Run this from the bound spreadsheet.');
    return ss;
  }
  function literal(value) { return typeof value === 'string' && /^[=+\-@']/.test(value) ? "'" + value : value; }
  function values(range, data) { range.setNumberFormat('@').setValues(data.map(function (r) { return r.map(literal); })); }
  function sheet(name, columns) {
    var s = book().getSheetByName(name);
    if (!s) s = book().insertSheet(name);
    if (s.getLastRow() && JSON.stringify(s.getRange(1, 1, 1, columns.length).getValues()[0]) !== JSON.stringify(columns)) {
      throw new Error('Unexpected headers in ' + name + '. Restore the original headers before continuing.');
    }
    values(s.getRange(1, 1, 1, columns.length), [columns]);
    s.setFrozenRows(1);
    s.getRange(1, 1, 1, columns.length).setBackground('#174ea6').setFontColor('#ffffff').setFontWeight('bold');
    return s;
  }
  function setup() {
    var t = sheet(names.tasks, headers);
    var l = sheet(names.lists, ['Enabled', 'Task List', 'List ID']);
    sheet(names.state, ['Row ID', 'State JSON']).hideSheet();
    sheet(names.archive, headers.concat(['Archived At', 'Reason']));
    t.hideColumns(7);
    t.setColumnWidth(1, 320); t.setColumnWidth(2, 220); t.setColumnWidth(3, 120);
    t.setColumnWidth(4, 130); t.setColumnWidth(5, 400); t.setColumnWidth(6, 280);
    t.getRange(2, 1, t.getMaxRows() - 1, 7).setNumberFormat('@');
    t.getRange(2, 4, t.getMaxRows() - 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['Needs action', 'Completed', 'Delete'], true).setAllowInvalid(false).build());
    // Include the hidden ID in filter sorts, or values would detach from IDs.
    if (!t.getFilter()) t.getRange(1, 1, t.getMaxRows(), 7).createFilter();
    l.setColumnWidth(2, 280); l.setColumnWidth(3, 350);
    [t.getRange('F:G'), l.getRange('B:C')].forEach(function (r) {
      var description = 'Tasks Sync system fields: ' + r.getSheet().getName();
      if (!r.getSheet().getProtections(SpreadsheetApp.ProtectionType.RANGE).some(function (p) { return p.getDescription() === description; })) {
        r.protect().setDescription(description).setWarningOnly(true);
      }
    });
  }
  function refreshLists(remote) {
    var s = book().getSheetByName(names.lists), old = {};
    if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 3).getValues().forEach(function (r) {
      // Migrate text booleans written by older versions without resetting choices.
      old[r[2]] = r[0] === true || (typeof r[0] === 'string' && r[0].trim().toLowerCase() === 'true');
    });
    var counts = {};
    remote.forEach(function (l) { counts[l.title] = (counts[l.title] || 0) + 1; });
    var lists = remote.map(function (l) {
      return { id: l.id, label: l.title + (counts[l.title] > 1 ? ' [' + l.id + ']' : ''), enabled: Object.prototype.hasOwnProperty.call(old, l.id) ? old[l.id] : true };
    });
    if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 3).clearContent().clearDataValidations();
    if (lists.length) {
      // Do not use the literal-text helper for checkbox cells: plain-text
      // formatting turns booleans into strings, which fail checkbox validation.
      s.getRange(2, 1, lists.length).setNumberFormat('General').insertCheckboxes()
        .setValues(lists.map(function (l) { return [l.enabled]; }));
      values(s.getRange(2, 2, lists.length, 2), lists.map(function (l) { return [l.label, l.id]; }));
    }
    var enabled = lists.filter(function (l) { return l.enabled; });
    if (!enabled.length) throw new Error('Enable at least one list on the Task Lists tab.');
    var tasks = book().getSheetByName(names.tasks);
    tasks.getRange(2, 2, tasks.getMaxRows() - 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(enabled.map(function (l) { return l.label; }), true).setAllowInvalid(false).build());
    return lists;
  }
  function state() {
    var s = book().getSheetByName(names.state), result = {};
    if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 2).getValues().forEach(function (r, i) {
      if (!r[0]) return;
      if (result[r[0]]) throw new Error('Duplicate state ID. Restore _Sync before syncing.');
      result[r[0]] = { index: i + 2, value: JSON.parse(r[1]) };
    });
    return result;
  }
  function save(id, value) {
    var s = book().getSheetByName(names.state), entry = state()[id];
    var serialized = JSON.stringify(value);
    if (serialized.length > 49000) throw new Error('Sync record too large; shorten Notes.');
    values(s.getRange(entry ? entry.index : s.getLastRow() + 1, 1, 1, 2), [[id, serialized]]);
    SpreadsheetApp.flush(); // Durable journal before any remote mutation.
  }
  function rawRows() {
    var s = book().getSheetByName(names.tasks);
    return s.getLastRow() < 2 ? [] : s.getRange(2, 1, s.getLastRow() - 1, 7).getValues();
  }
  function rows(lists, assign) {
    var s = book().getSheetByName(names.tasks), seen = {}, result = [];
    rawRows().forEach(function (cells, i) {
      var id = String(cells[6] || '');
      if (!id && !cells.slice(0, 5).some(function (c) { return c !== ''; })) return;
      if (assign && !id) { id = Utilities.getUuid(); values(s.getRange(i + 2, 7), [[id]]); cells[6] = id; }
      if (seen[id]) throw new Error('Duplicate Row ID: undo copied rows including hidden columns.');
      seen[id] = true;
      var list = lists.find(function (l) { return l.label === String(cells[1]); });
      var due = cells[2] instanceof Date ? Utilities.formatDate(cells[2], book().getSpreadsheetTimeZone(), 'yyyy-MM-dd') : String(cells[2]);
      result.push({ id: id, index: i + 2, cells: cells, local: {
        title: String(cells[0]), listId: list ? list.id : '', due: due,
        status: String(cells[3] || 'Needs action'), notes: String(cells[4])
      } });
    });
    return result;
  }
  function locate(id) {
    var all = rawRows(), matches = [];
    all.forEach(function (r, i) { if (String(r[6]) === id) matches.push({ index: i + 2, cells: r }); });
    if (matches.length > 1) throw new Error('Duplicate Row ID.');
    return matches[0];
  }
  function message(id, text) {
    var row = locate(id);
    if (row) values(book().getSheetByName(names.tasks).getRange(row.index, 6), [[text]]);
  }
  function unchanged(row) {
    var current = locate(row.id);
    return current && TaskSyncCore.equal(current.cells.slice(0, 5), row.cells.slice(0, 5));
  }
  function write(row, value, lists, parent) {
    if (!unchanged(row)) { message(row.id, 'Pending: edited during sync'); return false; }
    var current = locate(row.id), list = lists.find(function (l) { return l.id === value.listId; });
    values(book().getSheetByName(names.tasks).getRange(current.index, 1, 1, 6),
      [[value.title, list ? list.label : value.listId, value.due, value.status, value.notes, 'Synced']]);
    book().getSheetByName(names.tasks).getRange(current.index, 1).setNote(parent ? 'Subtask of task ID: ' + parent : '');
    return true;
  }
  function append(id, value, lists, parent, messageText) {
    var s = book().getSheetByName(names.tasks), index = s.getLastRow() + 1;
    if (index > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), 100);
    var list = lists.find(function (l) { return l.id === value.listId; });
    values(s.getRange(index, 1, 1, 7), [[value.title, list ? list.label : value.listId, value.due,
      value.status, value.notes, messageText || 'Synced', id]]);
    s.getRange(index, 1).setNote(parent ? 'Subtask of task ID: ' + parent : '');
  }
  function archive(row, reason) {
    if (!unchanged(row)) { message(row.id, 'Conflict: edited during deletion; row retained'); return false; }
    var current = locate(row.id), s = book().getSheetByName(names.archive);
    // Idempotent archival: an interrupted run may already have appended this record.
    var exists = s.getLastRow() > 1 && s.getRange(2, 7, s.getLastRow() - 1).getValues().some(function (r) { return r[0] === row.id; });
    if (!exists) values(s.getRange(s.getLastRow() + 1, 1, 1, 9),
      [current.cells.concat([new Date().toISOString(), reason])]);
    book().getSheetByName(names.tasks).deleteRow(current.index);
    return true;
  }
  return { book: book, setup: setup, refreshLists: refreshLists, state: state, save: save, rows: rows,
    locate: locate, message: message, unchanged: unchanged, write: write, append: append, archive: archive };
}());
