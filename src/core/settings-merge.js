'use strict';

// Safe, idempotent, reversible merge of our hooks into ~/.claude/settings.json.
//
// HARD SAFETY RULES:
//  - Only ever touch the top-level `hooks` key. permissions (190+ allow entries
//    + additionalDirectories) and every other key pass through untouched.
//  - Abort on unparseable JSON — never clobber a file we can't read.
//  - Back up before every mutation.
//  - Ownership is marked by `__ccbgm: true` on each entry; uninstall removes
//    exactly those and nothing else, so user-authored hooks survive.
//  - Idempotent both directions: init strips our old entries then re-adds the
//    current ones (so map/format changes converge to one clean copy).

const fs = require('fs');
const { buildHooksBlock, OWNER_KEY } = require('./hooks-block');

function isOwned(entry) {
  return entry && typeof entry === 'object' && entry[OWNER_KEY] === true;
}

// Remove all cc-bgm-owned entries from a parsed settings object (pure).
// Returns a new object; leaves non-owned hooks and all other keys intact.
function stripOwned(settings) {
  const next = { ...settings };
  if (!next.hooks || typeof next.hooks !== 'object') return next;

  const hooks = {};
  for (const [event, arr] of Object.entries(next.hooks)) {
    if (!Array.isArray(arr)) {
      hooks[event] = arr; // leave unexpected shapes alone
      continue;
    }
    const kept = arr.filter((e) => !isOwned(e));
    if (kept.length > 0) hooks[event] = kept;
  }
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

// Merge our hooks block into a parsed settings object (pure).
// First strips any existing owned entries (idempotency), then appends fresh ones
// after the user's existing entries for each event.
function mergeOwned(settings, { abs = false } = {}) {
  const base = stripOwned(settings);
  const block = buildHooksBlock({ abs });
  const next = { ...base };
  const hooks = { ...(next.hooks || {}) };

  for (const [event, ourEntries] of Object.entries(block)) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = [...existing, ...ourEntries];
  }
  next.hooks = hooks;
  return next;
}

// ---- file-level operations (impure) --------------------------------------

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${filePath}.ccbgm-backup-${stamp}`;
  fs.copyFileSync(filePath, backup);
  return backup;
}

function readSettings(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw); // throws on bad JSON — caller must handle
}

function writeSettingsAtomic(filePath, obj) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

module.exports = {
  isOwned,
  stripOwned,
  mergeOwned,
  backupFile,
  readSettings,
  writeSettingsAtomic,
  OWNER_KEY,
};
