const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture(initial) {
  class Sheet {
    constructor(data) { this.data = data; this.formats = {}; this.checkboxes = {}; }
    getLastRow() { return this.data.length; }
    getMaxRows() { return 1000; }
    getRange(row, column, height = 1, width = 1) {
      const sheet = this;
      function each(fn) { for (let r = row - 1; r < row - 1 + height; r++) for (let c = column - 1; c < column - 1 + width; c++) fn(r, c); }
      return {
        getValues() { return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => sheet.data[row - 1 + r]?.[column - 1 + c] ?? '')); },
        setNumberFormat(format) { each((r, c) => { sheet.formats[r + ',' + c] = format; }); return this; },
        setValues(data) {
          each((r, c) => {
            sheet.data[r] ||= [];
            const value = data[r - row + 1][c - column + 1];
            // Model the Sheets behavior responsible for the regression.
            sheet.data[r][c] = sheet.formats[r + ',' + c] === '@' ? String(value) : value;
          });
          return this;
        },
        clearContent() { each((r, c) => { if (sheet.data[r]) sheet.data[r][c] = ''; }); return this; },
        clearDataValidations() { each((r, c) => { delete sheet.checkboxes[r + ',' + c]; }); return this; },
        insertCheckboxes() {
          each((r, c) => { sheet.data[r] ||= []; sheet.data[r][c] = false; sheet.checkboxes[r + ',' + c] = true; });
          return this;
        },
        setDataValidation() { return this; }
      };
    }
  }
  const lists = new Sheet([['Enabled', 'Task List', 'List ID'], ...initial]);
  const tasks = new Sheet([]);
  const context = vm.createContext({ SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: name => name === 'Task Lists' ? lists : tasks }),
    newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } })
  } });
  vm.runInContext(fs.readFileSync(require.resolve('../src/Sheets.js'), 'utf8'), context);
  return { lists, refresh: context.TaskSyncSheets.refreshLists };
}
const remote = [{ id: 'a', title: 'Personal' }, { id: 'b', title: 'Work' }];

test('list refresh keeps checkbox values boolean across repeated runs', () => {
  const f = fixture([[true, 'Personal', 'a'], [false, 'Work', 'b']]);
  f.refresh(remote); f.refresh(remote);
  assert.deepEqual(f.lists.data.slice(1).map(r => r[0]), [true, false]);
  for (const row of [1, 2]) {
    assert.equal(f.lists.formats[row + ',0'], 'General');
    assert.equal(f.lists.checkboxes[row + ',0'], true);
  }
});
test('legacy text true/false values migrate without resetting enabled lists', () => {
  const f = fixture([['true', 'Personal', 'a'], ['false', 'Work', 'b']]);
  const lists = f.refresh(remote);
  assert.deepEqual(Array.from(lists, l => l.enabled), [true, false]);
  assert.deepEqual(f.lists.data.slice(1).map(r => r[0]), [true, false]);
});
test('all-disabled legacy rows become valid checkboxes before requesting a selection', () => {
  const f = fixture([['false', 'Personal', 'a'], ['false', 'Work', 'b']]);
  assert.throws(() => f.refresh(remote), /Enable at least one/);
  assert.deepEqual(f.lists.data.slice(1).map(r => r[0]), [false, false]);
  assert.equal(f.lists.checkboxes['1,0'], true);
  f.lists.data[1][0] = true; // User checks a list after repair.
  assert.doesNotThrow(() => f.refresh(remote));
  assert.equal(f.lists.data[1][0], true);
});
