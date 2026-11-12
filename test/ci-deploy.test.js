const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSecrets, deploy, failureMessage } = require('../scripts/ci-deploy');

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
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'appsscript.json'), '{}');
  let directory;
  deploy(root, { ...env, RUNNER_TEMP: root }, (command, args, options) => {
    const auth = args[args.indexOf('--auth') + 1];
    const config = args[args.indexOf('--project') + 1];
    directory = path.dirname(auth);
    assert.equal(command, process.execPath);
    assert.equal(path.basename(args[0]), 'index.js');
    assert.deepEqual(JSON.parse(fs.readFileSync(config)), { scriptId: env.APPS_SCRIPT_ID, rootDir: 'src' });
    assert.equal(fs.existsSync(path.join(directory, 'src', 'appsscript.json')), true);
    assert.equal(options.cwd, directory);
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
  fs.mkdirSync(path.join(root, 'src'));
  assert.throws(() => deploy(root, { ...env, RUNNER_TEMP: root }, () =>
    ({ status: 1, stderr: 'private-token-and-script-id' })), e =>
    /clasp push failed/.test(e.message) && !e.message.includes('private-token-and-script-id'));
  assert.deepEqual(fs.readdirSync(root), ['src']);
});

test('known errors produce actionable messages without echoing private output', () => {
  for (const [stderr, expected] of [
    ['invalid_grant private-token', /refresh token/],
    ['Security Error: srcDir escapes project root private-id', /staging-directory/],
    ['SERVICE_DISABLED private-id', /enable.*API/],
    ['ACCESS_TOKEN_SCOPE_INSUFFICIENT private-token', /upload scopes/],
    ['403 PERMISSION_DENIED private-id', /can edit/]
  ]) {
    const message = failureMessage({ stderr });
    assert.match(message, expected);
    assert.doesNotMatch(message, /private-token|private-id/);
  }
});

const root = path.resolve(__dirname, '..');
const installed = fs.existsSync(path.join(root, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js'));
test('real clasp accepts the staged project and sees exactly the six upload files', { skip: !installed }, t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clasp-preview-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  deploy(root, { ...env, RUNNER_TEMP: temp }, (command, args, options) => {
    // A local preview exercises actual clasp configuration/file loading without
    // authenticating to Google or uploading anything.
    const result = spawnSync(command, args.slice(0, -2).concat('show-file-status'), options);
    assert.equal(result.status, 0, result.stderr);
    for (const file of ['Api.js', 'Core.js', 'Menu.js', 'Sheets.js', 'Sync.js', 'appsscript.json']) assert.ok(result.stdout.includes(file));
    assert.equal((result.stdout.match(/└─/g) || []).length, 6);
    return result;
  });
  assert.deepEqual(fs.readdirSync(temp), []);
});
