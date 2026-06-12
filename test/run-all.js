'use strict';

// Runs the cross-platform-parseable JS test suites in sequence and the
// PowerShell daemon smoke test (Windows only). Exits nonzero on any failure.

const { execFileSync } = require('child_process');
const path = require('path');

const here = __dirname;
const jsTests = ['merge.test.js', 'dispatch.test.js', 'init-uninstall.test.js'];

let failed = false;
for (const t of jsTests) {
  console.log(`\n=== ${t} ===`);
  try {
    execFileSync(process.execPath, [path.join(here, t)], { stdio: 'inherit' });
  } catch {
    failed = true;
  }
}

if (process.platform === 'win32') {
  console.log('\n=== daemon-smoke.ps1 ===');
  const ps = path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    execFileSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'daemon-smoke.ps1')], {
      stdio: 'inherit',
    });
  } catch {
    failed = true;
  }
}

console.log(failed ? '\n>>> SUITE FAILED' : '\n>>> ALL SUITES PASSED');
process.exit(failed ? 1 : 0);
