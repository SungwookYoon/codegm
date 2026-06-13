'use strict';

// Thin manual-control commands: play / stop / sfx / volume / on / off / status.
// Each just talks to the daemon (and persists config where relevant).

const fs = require('fs');
const { paths } = require('../core/paths');
const { loadConfig, updateConfig } = require('../core/config');
const { sendCommand, ensureDaemon, readDaemonState, isProcessAlive } = require('../core/daemon');

function play(args) {
  const track = args[0];
  if (!track) {
    console.error('usage: cc-bgm play <track>   (e.g. village, quest, dungeon)');
    process.exitCode = 1;
    return;
  }
  ensureDaemon();
  sendCommand(`play ${track}`);
  console.log(`cc-bgm: playing ${track}`);
}

function stop() {
  sendCommand('stop');
  console.log('cc-bgm: stopped');
}

function sfx(args) {
  const name = args[0];
  if (!name) {
    console.error('usage: cc-bgm sfx <name>   (e.g. submit, progress, questclear)');
    process.exitCode = 1;
    return;
  }
  ensureDaemon();
  sendCommand(`sfx ${name}`);
  console.log(`cc-bgm: sfx ${name}`);
}

function volume(args) {
  const n = parseInt(args[0], 10);
  if (Number.isNaN(n) || n < 0 || n > 100) {
    console.error('usage: cc-bgm volume <0-100>');
    process.exitCode = 1;
    return;
  }
  updateConfig({ volume: n });
  sendCommand(`volume ${n}`);
  console.log(`cc-bgm: volume ${n}`);
}

function on() {
  updateConfig({ enabled: true, mute: false });
  console.log('cc-bgm: enabled (next event will resume audio)');
}

function off() {
  updateConfig({ enabled: false });
  try {
    sendCommand('stop');
  } catch {
    /* daemon may be down */
  }
  console.log('cc-bgm: disabled (hooks stay installed; audio silenced)');
}

function status(args) {
  const asJson = args.includes('--json');
  const cfg = loadConfig();
  const state = readDaemonState();
  const alive = state ? isProcessAlive(state.pid) : false;

  const out = {
    enabled: cfg.enabled,
    mute: cfg.mute,
    volume: cfg.volume,
    daemonRunning: alive,
    daemonPid: alive ? state.pid : null,
    currentMode: alive ? state.mode : null,
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log('cc-bgm status');
  console.log(`  enabled:       ${out.enabled}`);
  console.log(`  muted:         ${out.mute}`);
  console.log(`  volume:        ${out.volume}`);
  console.log(`  daemon:        ${out.daemonRunning ? `running (pid ${out.daemonPid})` : 'not running'}`);
  console.log(`  current mode:  ${out.currentMode || '(none)'}`);

  const p = paths();
  const hooksInstalled =
    fs.existsSync(p.claudeSettings) &&
    fs.readFileSync(p.claudeSettings, 'utf8').includes('__ccbgm');
  console.log(`  hooks:         ${hooksInstalled ? 'installed' : 'NOT installed (run: cc-bgm init)'}`);
}

module.exports = { play, stop, sfx, volume, on, off, status };
