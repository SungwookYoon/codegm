'use strict';

// `cc-bgm doctor` — environment diagnostics. Verifies everything the audio
// stack needs and reports a pass/fail table. Exit 1 if any hard check fails.

const fs = require('fs');
const { execFileSync } = require('child_process');
const { paths, powershellExe } = require('../core/paths');

function check(label, fn) {
  try {
    const detail = fn();
    return { label, ok: true, detail: detail || '' };
  } catch (e) {
    return { label, ok: false, detail: e.message };
  }
}

module.exports = function doctor() {
  const p = paths();
  const results = [];

  results.push(check('Node >= 18', () => {
    const major = parseInt(process.versions.node.split('.')[0], 10);
    if (major < 18) throw new Error(`found ${process.versions.node}`);
    return `v${process.versions.node}`;
  }));

  const isWin = process.platform === 'win32';
  results.push(check('Platform is Windows', () => {
    if (!isWin) throw new Error(`platform=${process.platform} (Phase 1 is Windows-only)`);
    return 'win32';
  }));

  let psOk = false;
  results.push(check('PowerShell 5.1 (Desktop)', () => {
    if (!isWin) throw new Error('skipped (non-Windows)');
    const ps = powershellExe();
    if (!fs.existsSync(ps)) throw new Error(`not found at ${ps}`);
    const out = execFileSync(
      ps,
      ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString() + " " + $PSVersionTable.PSEdition'],
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    psOk = true;
    return out;
  }));

  results.push(check('WPF MediaPlayer loads', () => {
    if (!isWin || !psOk) throw new Error('skipped');
    const ps = powershellExe();
    const out = execFileSync(
      ps,
      ['-NoProfile', '-NonInteractive', '-Command',
        'Add-Type -AssemblyName PresentationCore,WindowsBase; (New-Object System.Windows.Media.MediaPlayer).GetType().Name'],
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    if (out !== 'MediaPlayer') throw new Error(`unexpected: ${out}`);
    return 'ok';
  }));

  results.push(check('daemon script present', () => {
    if (!fs.existsSync(p.daemonScript)) throw new Error(`missing ${p.daemonScript}`);
    return p.daemonScript;
  }));

  results.push(check('bundled assets present', () => {
    const bgm = fs.existsSync(p.bundledBgm) ? fs.readdirSync(p.bundledBgm).length : 0;
    const sfx = fs.existsSync(p.bundledSfx) ? fs.readdirSync(p.bundledSfx).length : 0;
    if (bgm === 0 && sfx === 0) throw new Error('no assets found');
    return `${bgm} bgm, ${sfx} sfx`;
  }));

  results.push(check('command dir writable', () => {
    fs.mkdirSync(p.cmdDir, { recursive: true });
    const probe = require('path').join(p.cmdDir, '.doctor-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return p.cmdDir;
  }));

  results.push(check('settings.json parseable', () => {
    if (!fs.existsSync(p.claudeSettings)) return 'not present (will be created by init)';
    JSON.parse(fs.readFileSync(p.claudeSettings, 'utf8'));
    return 'ok';
  }));

  results.push(check('hooks installed', () => {
    if (!fs.existsSync(p.claudeSettings)) throw new Error('settings.json absent — run: cc-bgm init');
    const has = fs.readFileSync(p.claudeSettings, 'utf8').includes('__ccbgm');
    if (!has) throw new Error('not installed — run: cc-bgm init');
    return 'ok';
  }));

  console.log('cc-bgm doctor\n');
  let hardFail = false;
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${r.label.padEnd(26)} ${r.detail}`);
    // "hooks installed" is informational, not a hard failure for doctor.
    if (!r.ok && r.label !== 'hooks installed') hardFail = true;
  }
  if (hardFail) process.exitCode = 1;
};
