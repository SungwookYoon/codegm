'use strict';

// `cc-bgm uninstall [--purge]`
// Removes only cc-bgm-owned hooks from settings.json (backup first) and tells the
// daemon to quit. With --purge, also deletes the data dir.

const fs = require('fs');
const { paths } = require('../core/paths');
const {
  readSettings,
  stripOwned,
  backupFile,
  writeSettingsAtomic,
} = require('../core/settings-merge');
const { sendCommand } = require('../core/daemon');

module.exports = function uninstall(args) {
  const purge = args.includes('--purge');
  const p = paths();

  let current;
  try {
    current = readSettings(p.claudeSettings);
  } catch (e) {
    console.error(`cc-bgm: cannot parse ${p.claudeSettings} — aborting (no changes made).`);
    console.error(`  ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const cleaned = stripOwned(current);
  const backup = backupFile(p.claudeSettings);
  writeSettingsAtomic(p.claudeSettings, cleaned);
  console.log('cc-bgm: hooks removed from Claude Code settings.');
  if (backup) console.log(`  backup: ${backup}`);

  // Ask any running daemon to shut down.
  try {
    sendCommand('quit');
  } catch {
    /* daemon may not be running */
  }

  if (purge) {
    try {
      fs.rmSync(p.dataRoot, { recursive: true, force: true });
      console.log(`  purged data dir: ${p.dataRoot}`);
    } catch (e) {
      console.error(`  could not purge data dir: ${e.message}`);
    }
  } else {
    console.log(`  data dir kept: ${p.dataRoot} (use --purge to delete)`);
  }
};
