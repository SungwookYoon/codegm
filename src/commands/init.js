'use strict';

// `cc-bgm init [--dry-run] [--abs]`
// Safely injects the cc-bgm hooks block into ~/.claude/settings.json and creates
// the writable data dirs. Idempotent. Backs up before any write.

const fs = require('fs');
const { paths } = require('../core/paths');
const { ensureDataDirs } = require('../core/config');
const {
  readSettings,
  mergeOwned,
  backupFile,
  writeSettingsAtomic,
} = require('../core/settings-merge');

module.exports = function init(args) {
  const dryRun = args.includes('--dry-run');
  const abs = args.includes('--abs');
  const p = paths();

  // Create writable data dirs (cmd channel, assets, logs, state).
  ensureDataDirs();

  // Seed user trigger map if absent (copy of the default, for easy editing).
  try {
    if (!fs.existsSync(p.userTriggerMap) && fs.existsSync(p.defaultTriggerMap)) {
      fs.copyFileSync(p.defaultTriggerMap, p.userTriggerMap);
    }
  } catch {
    /* non-fatal */
  }

  let current;
  try {
    current = readSettings(p.claudeSettings);
  } catch (e) {
    console.error(`cc-bgm: cannot parse ${p.claudeSettings} — aborting (no changes made).`);
    console.error(`  ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const merged = mergeOwned(current, { abs });

  if (dryRun) {
    console.log('cc-bgm init --dry-run: would write the following hooks block:\n');
    console.log(JSON.stringify(merged.hooks, null, 2));
    console.log(`\nTarget: ${p.claudeSettings}`);
    return;
  }

  const backup = backupFile(p.claudeSettings);
  writeSettingsAtomic(p.claudeSettings, merged);

  console.log('cc-bgm: hooks installed into Claude Code settings.');
  if (backup) console.log(`  backup: ${backup}`);
  console.log(`  data:   ${p.dataRoot}`);
  console.log('\nStart a new Claude Code session to hear it. Tips:');
  console.log('  cc-bgm doctor   — verify the audio stack');
  console.log('  cc-bgm off/on   — mute without uninstalling');
  console.log('  cc-bgm uninstall — remove the hooks');
};
