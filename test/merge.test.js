'use strict';

// Verifies settings.json safety: merge preserves everything but `hooks`,
// uninstall is a clean inverse, and re-init is idempotent. Runs against a copy
// of the user's REAL settings.json so we test the actual shape.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { mergeOwned, stripOwned } = require('../src/core/settings-merge');

const real = path.join(os.homedir(), '.claude', 'settings.json');
let base = {};
if (fs.existsSync(real)) {
  base = JSON.parse(fs.readFileSync(real, 'utf8'));
} else {
  base = { permissions: { allow: ['Bash(ls)'], additionalDirectories: ['C:\\x'] } };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let failures = 0;
function ok(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}`);
    failures++;
  }
}

console.log('settings-merge safety tests\n');

// snapshot non-hooks keys
const nonHooksBefore = { ...base };
delete nonHooksBefore.hooks;

// 1. merge
const merged = mergeOwned(base, { abs: false });
const nonHooksAfter = { ...merged };
delete nonHooksAfter.hooks;
ok('merge preserves all non-hooks keys byte-for-byte', deepEqual(nonHooksBefore, nonHooksAfter));
ok('merge adds a hooks key', !!merged.hooks);

// permissions specifically
if (base.permissions) {
  ok('permissions object untouched', deepEqual(base.permissions, merged.permissions));
  if (base.permissions.allow) {
    ok(
      `permissions.allow count preserved (${base.permissions.allow.length})`,
      base.permissions.allow.length === merged.permissions.allow.length
    );
  }
}

// 2. all our entries are tagged
const ours = [];
for (const arr of Object.values(merged.hooks)) {
  for (const e of arr) if (e.__ccbgm) ours.push(e);
}
ok('merge produced tagged entries', ours.length > 0);

// 3. uninstall strips only our owned hooks.
const cleaned = stripOwned(merged);
const baseStripped = stripOwned(base);
ok('uninstall removes hooks key when only owned hooks were present', !baseStripped.hooks ? !cleaned.hooks : true);
ok('uninstall restores original object with owned hooks stripped', deepEqual(baseStripped, cleaned));

// 4. idempotent: merge twice == merge once
const mergedTwice = mergeOwned(merged, { abs: false });
ok('merge is idempotent', deepEqual(merged, mergedTwice));

// 5. user-authored hooks under same event survive
const withUserHook = JSON.parse(JSON.stringify(base));
withUserHook.hooks = {
  Stop: [{ hooks: [{ type: 'command', command: 'echo user-owned' }] }],
};
const m2 = mergeOwned(withUserHook, {});
const userStillThere = m2.hooks.Stop.some(
  (e) => !e.__ccbgm && e.hooks && e.hooks[0].command === 'echo user-owned'
);
ok('user-authored hook preserved alongside ours', userStillThere);
const u2 = stripOwned(m2);
ok('uninstall keeps user hook, removes ours', deepEqual(u2.hooks.Stop, withUserHook.hooks.Stop));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
