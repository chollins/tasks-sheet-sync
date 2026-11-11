const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setup, check } = require('../scripts/clasp-config');

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-clasp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, '..', '.clasp.json.example'), path.join(root, '.clasp.json.example'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'appsscript.json'), '{}');
  return root;
}
test('setup creates an editable template and never overwrites an existing target', t => {
  const root = project(t);
  setup(root);
  const before = fs.readFileSync(path.join(root, '.clasp.json'), 'utf8');
  assert.throws(() => setup(root, 'another-id'), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(path.join(root, '.clasp.json'), 'utf8'), before);
  assert.throws(() => check(root), /Script ID/);
});
test('setup accepts a Script ID and validation confines uploads to src', t => {
  const root = project(t), scriptId = 'example_script_id_1234567890';
  setup(root, scriptId);
  assert.deepEqual(check(root), { scriptId, rootDir: 'src' });
  fs.writeFileSync(path.join(root, '.clasp.json'), JSON.stringify({ scriptId, rootDir: '.' }));
  assert.throws(() => check(root), /rootDir/);
});
