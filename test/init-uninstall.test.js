'use strict';

// Tests init/uninstall end-to-end against a COPY of the real settings.json in a
// temp HOME, so the user's actual file is never touched. Uses Node's JSON.parse
// (robust) rather than PowerShell's ConvertFrom-Json. Verifies permissions
// survive and uninstall is a clean inverse.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { stripOwned } = require('../src/core/settings-merge');

const pkg = path.resolve(__dirname, '..');
const bin = path.join(pkg, 'bin', 'cc-bgm.js');

const fakeHome = path.join(os.tmpdir(), 'ccbgm_fakehome');
fs.rmSync(fakeHome, { recursive: true, force: true });
fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });

const realSettings = path.join(os.homedir(), '.claude', 'settings.json');
const fakeSettings = path.join(fakeHome, '.claude', 'settings.json');
fs.copyFileSync(realSettings, fakeSettings);

const read = () => JSON.parse(fs.readFileSync(fakeSettings, 'utf8'));
const orig = read();
const origStripped = stripOwned(orig);
const origAllow = orig.permissions ? orig.permissions.allow.length : 0;
const origNonHooks = JSON.stringify((() => { const o = { ...orig }; delete o.hooks; return o; })());
const expectedFinalHooks = JSON.stringify(origStripped.hooks);

const env = { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome };
const run = (args) => execFileSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' });

let pass = true;
const ok = (name, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${name}`); if (!cond) pass = false; };

console.log(`original permissions.allow count: ${origAllow}\n`);

console.log('--- cc-bgm init ---');
console.log(run(['init']));
const after = read();
ok('init preserved permissions.allow count',
  after.permissions && after.permissions.allow.length === origAllow);
ok('init preserved all non-hooks keys byte-for-byte',
  JSON.stringify((() => { const o = { ...after }; delete o.hooks; return o; })()) === origNonHooks);
ok('init added hooks', !!after.hooks);
ok('hooks are tagged __ccbgm', fs.readFileSync(fakeSettings, 'utf8').includes('__ccbgm'));

console.log('\n--- cc-bgm uninstall ---');
console.log(run(['uninstall']));
const final = read();
ok('uninstall preserved permissions.allow count',
  final.permissions && final.permissions.allow.length === origAllow);
ok('uninstall removed only cc-bgm-owned hooks',
  JSON.stringify(final.hooks) === expectedFinalHooks && !fs.readFileSync(fakeSettings, 'utf8').includes('__ccbgm'));
ok('uninstall restored original object with owned hooks stripped',
  JSON.stringify(final) === JSON.stringify(origStripped));

const backups = fs.readdirSync(path.join(fakeHome, '.claude')).filter((f) => f.includes('ccbgm-backup'));
ok('backups were created', backups.length >= 1);
console.log(`  (${backups.length} backup file(s))`);

console.log(pass ? '\nALL PASS' : '\nFAILURES');
process.exit(pass ? 0 : 1);
