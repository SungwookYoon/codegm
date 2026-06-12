'use strict';

// The canonical hooks block cc-bgm writes into ~/.claude/settings.json.
//
// Design:
//  - Every entry is async:true (fire-and-forget; Claude never waits on audio).
//  - Every entry calls the single generic dispatcher `cc-bgm event`, which reads
//    the hook JSON on stdin to decide what to play. One dispatcher means future
//    trigger-map changes never require re-running `init`.
//  - Each hook object carries `__ccbgm: true` — our ownership marker. Claude
//    Code ignores unknown keys; uninstall filters on it exactly, so we never
//    touch hooks the user authored themselves.
//
// `command` defaults to the bare `cc-bgm event` (resolved via the npm global
// shim on PATH). With { abs: true } we emit an absolute `node <path> event`
// invocation for environments where PATH lacks the npm global bin.

const path = require('path');

const OWNER_KEY = '__ccbgm';

function buildHooksBlock({ abs = false } = {}) {
  const command = abs
    ? `"${process.execPath}" "${path.join(__dirname, '..', '..', 'bin', 'cc-bgm.js')}" event`
    : 'cc-bgm event';

  const entry = (matcher) => {
    const e = { [OWNER_KEY]: true };
    if (matcher) e.matcher = matcher;
    e.hooks = [{ type: 'command', async: true, command }];
    return e;
  };

  return {
    SessionStart: [entry()],
    UserPromptSubmit: [entry()],
    PreToolUse: [entry('Bash'), entry('Edit|Write'), entry('mcp__.*')],
    PostToolUse: [entry('Edit|Write'), entry('*')],
    PostToolUseFailure: [entry()],
    SubagentStart: [entry()],
    SubagentStop: [entry()],
    Notification: [entry('permission_prompt'), entry('idle_prompt')],
    Stop: [entry()],
    SessionEnd: [entry()],
  };
}

module.exports = { buildHooksBlock, OWNER_KEY };
