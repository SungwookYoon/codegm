'use strict';

// The CLI's link to the audio daemon.
//
//   sendCommand(line)  — drop an atomic .cmd file into the watched cmd folder.
//   ensureDaemon()     — lazy-start the daemon (detached, hidden) if not running.
//
// The daemon enforces singleton via a Named Mutex, so ensureDaemon can spawn
// unconditionally and a duplicate will exit itself. We still cheaply check a
// pid/state file first to avoid spawning a throwaway process on every command.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { paths, powershellExe } = require('./paths');
const { ensureDataDirs } = require('./config');

let _seq = 0;

// Write a single-line command as an atomic .cmd file.
// Filename encodes ordering: <unix_ms>-<pid>-<seq> so the daemon drains FIFO.
function sendCommand(line) {
  const p = ensureDataDirs();
  const id = `${Date.now()}-${process.pid}-${(_seq++).toString(36)}`;
  const tmp = path.join(p.cmdDir, id + '.cmd.tmp');
  const fin = path.join(p.cmdDir, id + '.cmd');
  fs.writeFileSync(tmp, String(line).trim() + '\n', { encoding: 'utf8' });
  fs.renameSync(tmp, fin); // atomic on same NTFS volume
  return fin;
}

// Read the daemon's last-known pid from its state snapshot (best-effort).
function readDaemonState() {
  const p = paths();
  try {
    let raw = fs.readFileSync(p.stateFile, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // tolerate BOM
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists but not ours
  }
}

// Spawn the daemon detached + hidden. Idempotent in practice: the daemon's
// mutex makes a second instance exit immediately.
function spawnDaemon() {
  const p = ensureDataDirs();
  const ps = powershellExe();

  const psArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    p.daemonScript,
    '-DataRoot',
    p.dataRoot,
    '-PackageRoot',
    p.packageRoot,
  ];

  // IMPORTANT: launch through `cmd /c start "" /b`, NOT a direct detached
  // spawn of powershell.exe. Node's detached:true sets CREATE_NEW_PROCESS_GROUP,
  // which breaks the WPF Dispatcher (the daemon exits 0 silently before its
  // message pump starts). Routing through `start` gives the daemon a normal
  // process environment where WPF/MediaPlayer/Dispatcher work, while still
  // fully detaching it from this short-lived CLI.
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/c', 'start', '', '/b', ps, ...psArgs],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref(); // let it outlive this CLI process
  return child.pid;
}

// Ensure a daemon is (probably) running. Cheap check first, then spawn.
//
// Two guards prevent redundant spawns:
//  1. If the daemon's state file names a live pid, it's already up.
//  2. During the ~1s before a freshly-spawned daemon writes its state file, a
//     short-lived `.spawning` marker stops a burst of hook events from each
//     launching their own (losing) daemon. The daemon's mutex is the ultimate
//     guard, but this avoids spawning a dozen throwaway processes.
function ensureDaemon() {
  const state = readDaemonState();
  if (state && isProcessAlive(state.pid)) return false; // already up

  const p = paths();
  const marker = path.join(p.cmdDir, '.spawning');
  try {
    const st = fs.statSync(marker);
    if (Date.now() - st.mtimeMs < 4000) return false; // someone just spawned
  } catch {
    /* no marker */
  }
  try {
    fs.mkdirSync(p.cmdDir, { recursive: true });
    fs.writeFileSync(marker, String(Date.now()));
  } catch {
    /* best-effort */
  }

  spawnDaemon();
  return true; // spawned
}

module.exports = { sendCommand, ensureDaemon, spawnDaemon, readDaemonState, isProcessAlive };
