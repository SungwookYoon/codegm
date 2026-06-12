'use strict';

// Loads the trigger map (user override > bundled default) and resolves a hook
// event payload into an intent: { bgm?: '<mode>'|'__stop', sfx?: '<name>' }.

const fs = require('fs');
const { paths } = require('./paths');

function loadTriggerMap() {
  const p = paths();
  let map = {};
  try {
    map = JSON.parse(fs.readFileSync(p.defaultTriggerMap, 'utf8'));
  } catch {
    map = {};
  }
  // shallow user override per top-level event key
  try {
    const user = JSON.parse(fs.readFileSync(p.userTriggerMap, 'utf8'));
    map = { ...map, ...user };
  } catch {
    /* no user override */
  }
  return map;
}

// hook = parsed stdin JSON. Returns an intent object (possibly empty).
function resolveIntent(map, hook) {
  const event = hook && hook.hook_event_name;
  if (!event || !map[event]) return {};
  const rule = map[event];

  // Tool-keyed events (PreToolUse / PostToolUse)
  if (rule._byTool) {
    const tool = hook.tool_name || '';
    return rule._byTool[tool] || rule._byTool._default || {};
  }

  // Notification-type-keyed events
  if (rule._byType) {
    const type = hook.notification_type || (hook.notification && hook.notification.type) || '';
    return rule._byType[type] || {};
  }

  // Flat rule
  const { bgm, sfx } = rule;
  const intent = {};
  if (bgm) intent.bgm = bgm;
  if (sfx) intent.sfx = sfx;
  return intent;
}

module.exports = { loadTriggerMap, resolveIntent };
