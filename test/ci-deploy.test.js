const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSecrets, deploy } = require('../scripts/ci-deploy');

const token = { type: 'authorized_user', client_id: 'example-client', client_secret: 'example-secret', refresh_token: 'example-refresh' };
const env = { APPS_SCRIPT_ID: 'example_script_id_1234567890', CLASP_CREDENTIALS: JSON.stringify({ tokens: { default: token } }) };

test('missing or malformed deployment secrets fail without echoing their contents', () => {
  assert.throws(() => readSecrets({}), /APPS_SCRIPT_ID/);
  assert.throws(() => readSecrets({ ...env, CLASP_CREDENTIALS: 'sensitive-invalid-value' }), e =>
    !e.message.includes('sensitive-invalid-value') && /CLASP_CREDENTIALS/.test(e.message));
  assert.throws(() => readSecrets({ ...env, CLASP_CREDENTIALS: '{}' }), /refresh token/);
});
test('deployment uses private temporary files and removes them after success', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let directory;
  deploy(root, { ...env, RUNNER_TEMP: root }, (command, args, options) => {
    const auth = args[args.indexOf('--auth') + 1];
    const config = args[args.indexOf('--project') + 1];
    directory = path.dirname(auth);
    assert.equal(command, process.execPath);
    assert.equal(path.basename(args[0]), 'index.js');
    assert.deepEqual(JSON.parse(fs.readFileSync(config)), { scriptId: env.APPS_SCRIPT_ID, rootDir: path.join(root, 'src') });
    assert.deepEqual(JSON.parse(fs.readFileSync(auth)), { tokens: { default: token } });
    assert.equal(fs.statSync(auth).mode & 0o777, 0o600);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(options.env.CLASP_CREDENTIALS, undefined);
    assert.equal(options.env.APPS_SCRIPT_ID, undefined);
    assert.ok(args.includes('--force'));
    return { status: 0 };
  });
  assert.equal(fs.existsSync(directory), false);
  assert.equal(fs.existsSync(path.join(root, '.clasp.json')), false);
});
test('failed uploads remove credentials and suppress sensitive child output', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => deploy(root, { ...env, RUNNER_TEMP: root }, () =>
    ({ status: 1, stderr: 'private-token-and-script-id' })), e =>
    /clasp push failed/.test(e.message) && !e.message.includes('private-token-and-script-id'));
  assert.deepEqual(fs.readdirSync(root), []);
});
