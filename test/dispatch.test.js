'use strict';

// Unit-tests the trigger map -> intent resolution (pure, no I/O on the daemon).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveIntent } = require('../src/core/triggermap');

const map = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'triggermap.default.json'), 'utf8')
);
let failures = 0;
function ok(name, cond) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}`); failures++; }
}

function intent(hook) { return resolveIntent(map, hook); }

console.log('trigger-map dispatch tests\n');

ok('SessionStart -> village + soft fanfare',
  JSON.stringify(intent({ hook_event_name: 'SessionStart', source: 'startup' })) ===
  JSON.stringify({ bgm: 'village', sfx: 'fanfare_soft' }));

ok('UserPromptSubmit -> quest + submit + progress pulse',
  JSON.stringify(intent({ hook_event_name: 'UserPromptSubmit' })) ===
  JSON.stringify({ bgm: 'quest', sfx: 'submit', pulse: 'progress' }));

ok('PreToolUse Bash -> quest + progress pulse',
  JSON.stringify(intent({ hook_event_name: 'PreToolUse', tool_name: 'Bash' })) ===
  JSON.stringify({ bgm: 'quest', pulse: 'progress' }));

ok('PreToolUse Read -> no change (cheap reads)',
  Object.keys(intent({ hook_event_name: 'PreToolUse', tool_name: 'Read' })).length === 0);

ok('PreToolUse mcp tool -> quest + progress pulse via _default',
  JSON.stringify(intent({ hook_event_name: 'PreToolUse', tool_name: 'mcp__foo__bar' })) ===
  JSON.stringify({ bgm: 'quest', pulse: 'progress' }));

ok('PostToolUse Write -> save sfx, no bgm',
  JSON.stringify(intent({ hook_event_name: 'PostToolUse', tool_name: 'Write' })) ===
  JSON.stringify({ sfx: 'save' }));

ok('PostToolUse Read -> nothing (restrained)',
  Object.keys(intent({ hook_event_name: 'PostToolUse', tool_name: 'Read' })).length === 0);

ok('PostToolUseFailure -> error sfx',
  intent({ hook_event_name: 'PostToolUseFailure' }).sfx === 'error');

ok('Notification permission_prompt -> summon sfx',
  intent({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }).sfx === 'summon');

ok('Notification idle_prompt -> village + pulse stop',
  JSON.stringify(intent({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })) ===
  JSON.stringify({ bgm: 'village', pulse: '__stop' }));

ok('Stop -> village + pulse stop + questclear',
  JSON.stringify(intent({ hook_event_name: 'Stop' })) ===
  JSON.stringify({ bgm: 'village', sfx: 'questclear', pulse: '__stop' }));

ok('SessionEnd -> __stop + pulse stop',
  JSON.stringify(intent({ hook_event_name: 'SessionEnd' })) ===
  JSON.stringify({ bgm: '__stop', pulse: '__stop' }));

ok('unknown event -> empty',
  Object.keys(intent({ hook_event_name: 'Nonexistent' })).length === 0);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
