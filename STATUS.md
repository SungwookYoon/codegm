# cc-bgm — Development Status / Handoff

_Last updated: 2026-06-13_

This is a portable handoff snapshot so development can continue on another
machine. The project is **functionally complete and fully tested** (all suites
pass). What remains is polish, real-music packs, real-session validation, and
npm publish.

## What this is

Game-style (fantasy-RPG) background music + sound effects for **Claude Code**,
driven by Claude Code hooks. A thin Node CLI (`cc-bgm`) controls a bundled
PowerShell WPF audio daemon. Windows-first. Distributed via npm.

Concept (decided with user): warm **village** theme while idle → **quest**
(adventure) music while Claude works → **questclear** chime on turn end.
SFX are restrained (only quest clear / error / save / permission). BGM only
switches on idle↔work transitions (never restarts per tool call).

## Architecture (one-paragraph)

Claude Code fires async hooks → each calls `cc-bgm event` (thin Node dispatcher)
→ reads hook JSON on stdin, consults the trigger map, writes an atomic `.cmd`
file into `%LOCALAPPDATA%\cc-bgm\cmd\` and lazy-starts the daemon →
`daemon/cc-bgm-daemon.ps1` (WPF MediaPlayer, singleton via Named Mutex) drains
the cmd folder on a DispatcherTimer and crossfades BGM / fires SFX. All mutable
state lives under `%LOCALAPPDATA%\cc-bgm\` (package dir is read-only at runtime).

## Load-bearing constraints (DO NOT REGRESS)

1. **Launch the daemon via `powershell.exe` (5.1 Desktop / .NET Framework), NOT
   `pwsh`.** WPF MediaPlayer needs .NET Framework. `src/core/paths.js` resolves
   it from `%WINDIR%`.
2. **Spawn the daemon through `cmd /c start "" /b`, NOT a direct Node detached
   spawn.** Node's `detached:true` sets CREATE_NEW_PROCESS_GROUP which silently
   breaks the WPF Dispatcher (daemon exits 0 with no output). See
   `src/core/daemon.js` → `spawnDaemon()`. This was a hard-won fix.
3. **No UTF-8 BOM in machine-read files.** PS 5.1 `Set-Content -Encoding UTF8`
   writes a BOM that breaks Node `JSON.parse`. The daemon writes state with
   `UTF8Encoding($false)`; `event.js` and `daemon.js` strip a leading BOM
   defensively. (Two bugs were traced to this.)
4. **Debounce lives in the DAEMON.** Hooks send idempotent `ensure <mode>`; the
   daemon no-ops if `CurrentMode` already equals the target (even mid-fade).
5. **settings.json safety:** `init`/`uninstall` touch ONLY the top-level `hooks`
   key, tag entries with `__ccbgm:true`, back up first, abort on unparseable
   JSON. The user's `permissions` (198 entries) must survive. Verified by tests.

## File map

```
package.json              os:win32, bin, files whitelist, npm scripts (test, gen-assets)
.npmignore                excludes test/, *.log
README.md                 user docs
STATUS.md                 this file
bin/cc-bgm.js             CLI entry
src/cli.js                arg router
src/commands/
  event.js                generic hook dispatcher (stdin JSON -> daemon cmds)
  init.js / uninstall.js  safe settings.json hooks merge/unmerge
  control.js              play/stop/sfx/volume/on/off/status
  config.js               config get/set/list/reset (validated, live-apply)
  fetch.js                download a CC0 audio pack from GitHub
  doctor.js               environment diagnostics
  postinstall.js          npm postinstall (banner only; does NOT touch settings)
src/core/
  paths.js                all path resolution + powershellExe()
  config.js               config.json load/save + ensureDataDirs + DEFAULTS
  daemon.js               atomic .cmd writer + lazy spawn (cmd/start) + state read
  settings-merge.js       pure hooks merge/strip + backup + atomic write
  hooks-block.js          canonical hooks block (the __ccbgm-tagged entries)
  triggermap.js           load map (user>default) + resolveIntent()
daemon/cc-bgm-daemon.ps1  the WPF audio daemon (Dispatcher, timers, fade SM, parser)
config/triggermap.default.json   event -> bgm/sfx map (RPG: village/quest)
config/packs/starter.json        CC0 pack manifest (Kenney, raw GitHub URLs)
assets/bgm,sfx/*.wav             PLACEHOLDER sine tones (replace!)
assets/manifest.json             logical name -> file + gain/loop
assets/CREDITS.md                licensing notes
test/                            test suites (see below)
```

## Status: DONE & verified

- Daemon: crossfade, looping, SFX overlap + auto-duck, debounce, auto work→idle,
  idle self-shutdown, clean quit, singleton mutex. (test/daemon-smoke.ps1)
- CLI: init, uninstall, play, stop, sfx, volume, on, off, status, doctor,
  config (get/set/list/reset, validated + live-apply), fetch.
- settings.json merge safety against the real 198-entry file. (test/merge.test.js,
  test/init-uninstall.test.js)
- Trigger map dispatch decision table. (test/dispatch.test.js)
- `cc-bgm fetch starter` downloads 9 real CC0 files from GitHub and the daemon
  plays the real .ogg/.wav (verified live; user files override placeholders).
- `npm test` → ALL SUITES PASSED.

Run the suite: `npm test` (from project root, on Windows).

## Status: TODO (agreed order — "순서대로 권장대로")

1. **Add a `fantasy` pack with longer, properly-looping BGM.** Kenney jingles in
   `starter` are short and loop a bit awkwardly. Find longer CC0 ambient/RTS
   tracks (OpenGameArt CC0) with stable raw URLs and add
   `config/packs/fantasy.json` (same schema as starter.json). BGM-only override
   is fine; keep starter's SFX.
2. **Real-session validation.** Run `cc-bgm init` against the real
   `~/.claude/settings.json`, `cc-bgm fetch starter`, then use a live Claude Code
   session and confirm village↔quest transitions, restrained SFX, debounce,
   Stop→questclear. Then `cc-bgm off`/`on`, and `cc-bgm uninstall` to confirm
   clean removal.
3. **npm publish prep.** Fill package.json author/repository/homepage/version,
   add LICENSE (MIT), `npm pack` and inspect the tarball contains daemon/,
   assets/, config/packs/ and NOT test/. Decide package name availability
   (`cc-bgm` on npm). Then `npm publish`.

## Portability notes for the new machine

- Requires: Windows 10/11, Node 18+, Windows PowerShell 5.1 (built in).
- No native npm deps; `npm install` then `npm test` should just work.
- If asset placeholders are missing, regenerate: `npm run gen-assets`.
- The real downloaded audio is NOT committed (re-fetch with `cc-bgm fetch`).
- Recommend `git init` + first commit when set up on the new machine (this dir
  is not yet a git repo).

## Open design questions / deferrals

- Hot-reload of mid-session asset drops (currently picked up on daemon restart).
- Per-session vs per-machine singleton (`Global\` vs `Local\` mutex) if multiple
  Claude sessions want independent audio.
- macOS/Linux backend (afplay/mpv) is Phase 2; non-Windows currently no-ops
  gracefully.
