'use strict';

const fs = require('node:fs');
const path = require('node:path');

function setup(root, scriptId) {
  const template = JSON.parse(fs.readFileSync(path.join(root, '.clasp.json.example'), 'utf8'));
  if (scriptId) template.scriptId = scriptId;
  // Never replace an existing deployment target.
  fs.writeFileSync(path.join(root, '.clasp.json'), JSON.stringify(template, null, 2) + '\n', { flag: 'wx' });
  return template;
}

function check(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.clasp.json'), 'utf8'));
  if (typeof config.scriptId !== 'string' || config.scriptId === 'YOUR_BOUND_SCRIPT_ID' ||
      !/^[A-Za-z0-9_-]{20,}$/.test(config.scriptId)) {
    throw new Error('Set scriptId in .clasp.json to the Script ID from Apps Script Project Settings (not the Sheet ID or a URL).');
  }
  if (config.rootDir !== 'src') throw new Error('Keep rootDir set to "src" so only application files are uploaded.');
  if (!fs.existsSync(path.join(root, 'src', 'appsscript.json'))) throw new Error('Missing src/appsscript.json.');
  return config;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  try {
    if (process.argv[2] === 'setup') {
      setup(root, process.argv[3]);
      console.log('Created .clasp.json. Set your bound Script ID, then run npm run clasp:status.');
    } else if (process.argv[2] === 'check') {
      check(root);
      console.log('clasp configuration is valid; upload root is src/.');
    } else throw new Error('Expected setup or check.');
  } catch (error) {
    console.error(error.code === 'EEXIST' ? '.clasp.json already exists; edit it directly. Nothing was overwritten.' :
      error.code === 'ENOENT' ? 'Missing deployment configuration. Run npm run clasp:setup first.' : error.message);
    process.exitCode = 1;
  }
}

module.exports = { setup, check };
