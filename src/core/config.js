'use strict';

// User config lives at %LOCALAPPDATA%\cc-bgm\config.json and is the source of
// truth for the on/off toggle, mute, and persisted volume. The daemon owns
// *runtime* state (current track, pid) separately in state/daemon.json.

const fs = require('fs');
const path = require('path');
const { paths } = require('./paths');

const DEFAULTS = Object.freeze({
  enabled: true, // master on/off (cc-bgm on/off)
  mute: false, // silence without disabling hook processing
  volume: 70, // 0-100, master BGM ceiling
  crossfade: 1500, // ms, BGM track transition
  idleTimeoutMs: 30 * 60 * 1000, // daemon self-shutdown when idle this long
  battleIdleMs: 45 * 1000, // auto-return battle->town if no battle ensure for this long
  duckLevel: 0.3, // BGM volume multiplier while an SFX plays
  logLevel: 'info', // info | debug
});

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Create the writable data directory tree. Safe to call repeatedly.
function ensureDataDirs() {
  const p = paths();
  for (const dir of [p.dataRoot, p.cmdDir, p.stateDir, p.logsDir, p.userBgm, p.userSfx]) {
    ensureDir(dir);
  }
  return p;
}

function loadConfig() {
  const p = paths();
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(p.config, 'utf8'));
  } catch {
    user = {};
  }
  return { ...DEFAULTS, ...user };
}

function saveConfig(cfg) {
  const p = paths();
  ensureDir(p.dataRoot);
  // Persist only known keys, merged over defaults, atomically.
  const merged = { ...DEFAULTS, ...cfg };
  const tmp = p.config + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
  fs.renameSync(tmp, p.config);
  return merged;
}

// Convenience: mutate a subset and persist.
function updateConfig(patch) {
  return saveConfig({ ...loadConfig(), ...patch });
}

module.exports = { DEFAULTS, loadConfig, saveConfig, updateConfig, ensureDataDirs, ensureDir };
