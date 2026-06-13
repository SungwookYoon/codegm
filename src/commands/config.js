'use strict';

// `cc-bgm config list | get <key> | set <key> <value> | reset [<key>]`
// Adjusts persisted options in config.json with validation, and live-applies the
// ones the running daemon understands.

const { DEFAULTS, loadConfig, saveConfig } = require('../core/config');
const { sendCommand } = require('../core/daemon');

// Schema: type + validator + optional live-apply mapping to a daemon `config`
// key (or a dedicated daemon command for volume).
const SCHEMA = {
  enabled: { type: 'bool', desc: 'master on/off (prefer `cc-bgm on/off`)' },
  mute: { type: 'bool', desc: 'silence without disabling hooks' },
  volume: { type: 'int', min: 0, max: 100, desc: 'master volume 0-100', live: 'volume' },
  crossfade: { type: 'int', min: 0, max: 10000, desc: 'BGM transition ms', live: 'config:crossfade' },
  idleTimeoutMs: { type: 'int', min: 10000, max: 24 * 3600 * 1000, desc: 'daemon idle shutdown ms', live: 'config:idle' },
  battleIdleMs: { type: 'int', min: 5000, max: 3600 * 1000, desc: 'auto work→idle after ms of no work', live: 'config:battleIdle' },
  progressPulseMs: { type: 'int', min: 200, max: 10000, desc: 'retro processing SFX interval ms', live: 'config:pulseMs' },
  duckLevel: { type: 'float', min: 0, max: 1, desc: 'BGM volume under SFX (0-1)', live: 'config:duckLevel' },
  logLevel: { type: 'enum', values: ['info', 'debug'], desc: 'daemon log verbosity', live: 'config:logLevel' },
};

function parseValue(key, raw) {
  const s = SCHEMA[key];
  if (!s) throw new Error(`unknown key '${key}'. Run 'cc-bgm config list'.`);
  switch (s.type) {
    case 'bool': {
      if (/^(true|1|on|yes)$/i.test(raw)) return true;
      if (/^(false|0|off|no)$/i.test(raw)) return false;
      throw new Error(`${key} expects a boolean (true/false)`);
    }
    case 'int':
    case 'float': {
      const n = s.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
      if (Number.isNaN(n)) throw new Error(`${key} expects a number`);
      if (s.min != null && n < s.min) throw new Error(`${key} must be >= ${s.min}`);
      if (s.max != null && n > s.max) throw new Error(`${key} must be <= ${s.max}`);
      return n;
    }
    case 'enum': {
      if (!s.values.includes(raw)) throw new Error(`${key} must be one of: ${s.values.join(', ')}`);
      return raw;
    }
    default:
      return raw;
  }
}

// Tell a running daemon about a changed value (best-effort).
function liveApply(key, value) {
  const s = SCHEMA[key];
  if (!s || !s.live) return;
  try {
    if (s.live === 'volume') {
      sendCommand(`volume ${value}`);
    } else if (s.live.startsWith('config:')) {
      const daemonKey = s.live.slice('config:'.length);
      sendCommand(`config ${daemonKey}=${value}`);
    }
  } catch {
    /* daemon may be down; persisted value applies next start */
  }
}

function list() {
  const cfg = loadConfig();
  console.log('cc-bgm config (current → default)\n');
  for (const [key, s] of Object.entries(SCHEMA)) {
    const cur = cfg[key];
    const def = DEFAULTS[key];
    const flag = JSON.stringify(cur) === JSON.stringify(def) ? '' : '  *changed';
    console.log(`  ${key.padEnd(14)} ${String(cur).padEnd(10)} (default ${def})${flag}`);
    console.log(`  ${''.padEnd(14)} ${s.desc}`);
  }
  console.log('\nSet with:  cc-bgm config set <key> <value>');
}

function get(key) {
  if (!SCHEMA[key]) {
    console.error(`unknown key '${key}'. Run 'cc-bgm config list'.`);
    process.exitCode = 1;
    return;
  }
  console.log(loadConfig()[key]);
}

function set(key, raw) {
  let value;
  try {
    value = parseValue(key, raw);
  } catch (e) {
    console.error(`cc-bgm: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  const cfg = loadConfig();
  cfg[key] = value;
  saveConfig(cfg);
  liveApply(key, value);
  console.log(`cc-bgm: ${key} = ${value}`);
}

function reset(key) {
  const cfg = loadConfig();
  if (key) {
    if (!SCHEMA[key]) {
      console.error(`unknown key '${key}'.`);
      process.exitCode = 1;
      return;
    }
    cfg[key] = DEFAULTS[key];
    saveConfig(cfg);
    liveApply(key, DEFAULTS[key]);
    console.log(`cc-bgm: ${key} reset to ${DEFAULTS[key]}`);
  } else {
    saveConfig({ ...DEFAULTS });
    for (const [k, s] of Object.entries(SCHEMA)) if (s.live) liveApply(k, DEFAULTS[k]);
    console.log('cc-bgm: all options reset to defaults');
  }
}

module.exports = function config(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case 'list':
      return list();
    case 'get':
      return get(rest[0]);
    case 'set':
      if (rest.length < 2) {
        console.error('usage: cc-bgm config set <key> <value>');
        process.exitCode = 1;
        return;
      }
      return set(rest[0], rest.slice(1).join(' '));
    case 'reset':
      return reset(rest[0]);
    default:
      console.error(`unknown subcommand '${sub}'. Use: list | get | set | reset`);
      process.exitCode = 1;
  }
};
