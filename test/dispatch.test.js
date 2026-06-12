'use strict';

// Unit-tests the trigger map -> intent resolution (pure, no I/O on the daemon).

const assert = require('assert');
const { loadTriggerMap, resolveIntent } = require('../src/core/triggermap');

const map = loadTriggerMap();
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

ok('UserPromptSubmit -> quest (enter battle)',
  intent({ hook_event_name: 'UserPromptSubmit' }).bgm === 'quest');

ok('PreToolUse Bash -> quest',
  intent({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }).bgm === 'quest');

ok('PreToolUse Read -> no change (cheap reads)',
  Object.keys(intent({ hook_event_name: 'PreToolUse', tool_name: 'Read' })).length === 0);

ok('PreToolUse mcp tool -> quest via _default',
  intent({ hook_event_name: 'PreToolUse', tool_name: 'mcp__foo__bar' }).bgm === 'quest');

ok('PostToolUse Write -> save sfx, no bgm',
  JSON.stringify(intent({ hook_event_name: 'PostToolUse', tool_name: 'Write' })) ===
  JSON.stringify({ sfx: 'save' }));

ok('PostToolUse Read -> nothing (restrained)',
  Object.keys(intent({ hook_event_name: 'PostToolUse', tool_name: 'Read' })).length === 0);

ok('PostToolUseFailure -> error sfx',
  intent({ hook_event_name: 'PostToolUseFailure' }).sfx === 'error');

ok('Notification permission_prompt -> summon sfx',
  intent({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }).sfx === 'summon');

ok('Notification idle_prompt -> village',
  intent({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }).bgm === 'village');

ok('Stop -> village + questclear',
  JSON.stringify(intent({ hook_event_name: 'Stop' })) ===
  JSON.stringify({ bgm: 'village', sfx: 'questclear' }));

ok('SessionEnd -> __stop',
  intent({ hook_event_name: 'SessionEnd' }).bgm === '__stop');

ok('unknown event -> empty',
  Object.keys(intent({ hook_event_name: 'Nonexistent' })).length === 0);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
