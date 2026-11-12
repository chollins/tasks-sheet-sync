'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readSecrets(env) {
  const scriptId = env.APPS_SCRIPT_ID;
  if (!scriptId || scriptId === 'YOUR_BOUND_SCRIPT_ID' || !/^[A-Za-z0-9_-]{20,}$/.test(scriptId)) {
    throw new Error('Set the APPS_SCRIPT_ID repository secret to your bound Script ID.');
  }
  let credentials;
  try { credentials = JSON.parse(env.CLASP_CREDENTIALS || ''); }
  catch { throw new Error('Set CLASP_CREDENTIALS to the complete JSON file from the documented clasp login command.'); }
  const token = credentials && credentials.tokens && credentials.tokens.default;
  if (!token || token.type !== 'authorized_user' ||
      !['client_id', 'client_secret', 'refresh_token'].every(k => typeof token[k] === 'string' && token[k].trim())) {
    throw new Error('CLASP_CREDENTIALS needs a clasp v3 default authorized_user account with a refresh token. Log in again using the guide.');
  }
  // Only the deployment account belongs in the temporary file, even if the
  // supplied clasp store also contains unrelated named accounts.
  return { scriptId, credentials: { tokens: { default: token } } };
}

function deploy(root, env = process.env, run = spawnSync) {
  const secrets = readSecrets(env);
  const folder = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'tasks-clasp-'));
  try {
    fs.chmodSync(folder, 0o700);
    const config = path.join(folder, '.clasp.json');
    const auth = path.join(folder, '.clasprc.json');
    fs.writeFileSync(config, JSON.stringify({ scriptId: secrets.scriptId, rootDir: path.join(root, 'src') }), { mode: 0o600 });
    fs.writeFileSync(auth, JSON.stringify(secrets.credentials), { mode: 0o600 });
    const childEnv = { ...env, DEBUG: '' };
    delete childEnv.APPS_SCRIPT_ID;
    delete childEnv.CLASP_CREDENTIALS;
    // Capture, rather than echo, clasp output: API failures can include the
    // private Script ID or authentication details. No credential artifacts/logs.
    const result = run(process.execPath, [path.join(root, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js'),
      '--auth', auth, '--project', config, 'push', '--force'],
    { cwd: root, env: childEnv, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) {
      throw new Error('clasp push failed. Check the Script ID, Apps Script API access, account permissions, and refresh-token validity. See docs/GITHUB_DEPLOYMENT.md.');
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    deploy(path.resolve(__dirname, '..'));
    console.log('Apps Script source uploaded successfully. No setup or synchronization function was run.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { readSecrets, deploy };
