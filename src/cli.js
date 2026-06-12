'use strict';

// Hand-rolled arg router (no deps — keeps `cc-bgm event` startup fast, since it
// runs on every Claude tool call).

const HELP = `cc-bgm — game-style BGM/SFX for Claude Code (Windows)

Usage: cc-bgm <command> [args]

Setup
  init [--dry-run] [--abs]   install hooks into ~/.claude/settings.json
  uninstall [--purge]        remove hooks (--purge also deletes data dir)
  doctor                     check the audio stack and config

Control
  play <track>               play a BGM track (village, quest, dungeon, credits)
  stop                       stop BGM
  sfx <name>                 fire a sound effect (questclear, error, save, ...)
  volume <0-100>             set master volume
  on | off                   enable / silence without uninstalling
  status [--json]            show current state

Options
  config list                show all options
  config get <key>           print one option
  config set <key> <value>   change an option (applies live)
  config reset [<key>]       reset one option or all to defaults
  fetch [pack]               download a CC0 audio pack

Internal (called by hooks)
  event                      dispatch from hook JSON on stdin
`;

async function main(argv) {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(HELP);
      return;

    case 'event':
      return require('./commands/event')();

    case 'init':
      return require('./commands/init')(rest);

    case 'uninstall':
      return require('./commands/uninstall')(rest);

    case 'doctor':
      return require('./commands/doctor')();

    case 'play':
      return require('./commands/control').play(rest);
    case 'stop':
      return require('./commands/control').stop(rest);
    case 'sfx':
      return require('./commands/control').sfx(rest);
    case 'volume':
      return require('./commands/control').volume(rest);
    case 'on':
      return require('./commands/control').on(rest);
    case 'off':
      return require('./commands/control').off(rest);
    case 'status':
      return require('./commands/control').status(rest);

    case 'config':
      return require('./commands/config')(rest);

    case 'fetch':
      return require('./commands/fetch')(rest);

    case '_postinstall':
      return require('./commands/postinstall')();

    default:
      console.error(`cc-bgm: unknown command '${cmd}'. Run 'cc-bgm --help'.`);
      process.exitCode = 1;
  }
}

module.exports = { main };
