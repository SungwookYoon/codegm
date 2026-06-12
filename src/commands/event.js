'use strict';

// Generic hook dispatcher. Claude Code hooks all call `cc-bgm event`; this reads
// the hook JSON from stdin, consults the trigger map, and emits idempotent
// commands to the daemon. It must NEVER block and ALWAYS exit 0 — a failure here
// must never disrupt a Claude session.
//
// Toggle gates (any one silences, checked cheaply before doing anything):
//   1. env CC_BGM_DISABLE=1
//   2. config.enabled === false  or  config.mute === true

const { loadConfig } = require('../core/config');
const { loadTriggerMap, resolveIntent } = require('../core/triggermap');
const { sendCommand, ensureDaemon } = require('../core/daemon');

function readStdin(timeoutMs = 250) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(data);
    };
    if (process.stdin.isTTY) return finish(); // no piped input
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, timeoutMs); // hard cap — never hang a hook
  });
}

async function run() {
  // Gate 1: env override
  if (process.env.CC_BGM_DISABLE === '1') return;

  // Gate 2: config toggle/mute
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    cfg = { enabled: true, mute: false };
  }
  if (cfg.enabled === false || cfg.mute === true) return;

  let raw = await readStdin();
  // Strip a UTF-8 BOM if present (some shells prepend one when piping).
  if (raw && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  let hook = {};
  try {
    hook = raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    hook = {};
  }

  const map = loadTriggerMap();
  const intent = resolveIntent(map, hook);
  if (!intent || (!intent.bgm && !intent.sfx)) return;

  // Ensure the daemon is up before sending (lazy start).
  try {
    ensureDaemon();
  } catch {
    /* daemon spawn best-effort */
  }

  try {
    if (intent.bgm === '__stop') {
      sendCommand('stop');
    } else if (intent.bgm) {
      sendCommand(`ensure ${intent.bgm}`);
    }
    if (intent.sfx) {
      sendCommand(`sfx ${intent.sfx}`);
    }
  } catch {
    /* never throw out of a hook */
  }
}

module.exports = async function eventCommand() {
  try {
    await run();
  } catch {
    /* swallow — exit 0 always */
  }
};
