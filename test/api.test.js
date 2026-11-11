const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function apiFixture(responses) {
  const calls = [];
  const context = vm.createContext({
    ScriptApp: { getOAuthToken: () => 'test-token' },
    UrlFetchApp: { fetch(url, options) {
      calls.push({ url, options });
      const response = responses.shift();
      if (!response) throw Error('Unexpected request');
      return { getResponseCode: () => response.code || 200,
        getContentText: () => response.code === 204 ? '' : JSON.stringify(response.body) };
    } }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/Api.js'), 'utf8'), context);
  return { api: context.TaskSyncApi, calls };
}
test('task listing follows all pages and includes hidden, completed, assigned, and deleted tasks', () => {
  const f = apiFixture([{ body: { items: [{ id: 'a' }], nextPageToken: 'next page' } }, { body: { items: [{ id: 'b' }] } }]);
  assert.equal(f.api.tasks('list/id').length, 2);
  const url = new URL(f.calls[1].url);
  assert.match(url.pathname, /list%2Fid/);
  assert.equal(url.searchParams.get('pageToken'), 'next page');
  for (const key of ['showCompleted', 'showHidden', 'showDeleted', 'showAssigned']) assert.equal(url.searchParams.get(key), 'true');
});
test('native cross-list move uses destinationTasklist and an empty body', () => {
  const f = apiFixture([{ body: { id: 'moved' } }]);
  assert.equal(f.api.move('a', 'id', 'b', 'version').id, 'moved');
  assert.equal(f.calls[0].options.method, 'post');
  assert.equal(f.calls[0].options.payload, undefined);
  assert.equal(new URL(f.calls[0].url).searchParams.get('destinationTasklist'), 'b');
  assert.equal(f.calls[0].options.headers['If-Match'], 'version');
});
test('precondition errors are surfaced without automatically retrying mutations', () => {
  const f = apiFixture([{ code: 412, body: { error: 'precondition failed' } }]);
  assert.throws(() => f.api.patch('a', 'id', { title: 'changed' }, 'old'), { code: 412 });
  assert.equal(f.calls.length, 1);
});
test('successful empty delete response is accepted', () => {
  const f = apiFixture([{ code: 204 }]);
  assert.equal(f.api.remove('a', 'id'), null);
});
test('Apps Script files can initialize in reverse order without capturing undefined globals', () => {
  const context = vm.createContext({});
  for (const name of ['Sync', 'Sheets', 'Menu', 'Core', 'Api']) {
    vm.runInContext(fs.readFileSync(require.resolve('../src/' + name + '.js'), 'utf8'), context);
  }
  assert.equal(typeof context.TaskSync.run, 'function');
  assert.equal(typeof context.onOpen, 'function');
});
