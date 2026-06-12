# cc-bgm

Game-style background music & sound effects for **Claude Code**, reacting to what
your coding agent is doing. Fantasy-RPG vibe: a calm village theme while you're
idle, adventure music when Claude starts working, a quest-clear chime when it
finishes. Windows-first.

> Think of a coding session as a quest. You give Claude an order → the adventure
> music kicks in → tools run → "quest complete!" when the turn ends.

## How it works

Claude Code fires [hooks](https://code.claude.com/docs/en/hooks) on events
(session start, tool use, turn end, errors, permission prompts). cc-bgm installs
tiny `async` hooks that call `cc-bgm event`, a thin Node dispatcher. It reads the
hook JSON, decides what should play, and tells a background **PowerShell audio
daemon** (WPF `MediaPlayer`) to crossfade BGM or fire a sound effect.

```
Claude Code hook ──> cc-bgm event ──> .cmd file ──> daemon.ps1 ──> 🔊
   (async, stdin JSON)   (thin CLI)   (watched folder)  (WPF, looping)
```

Key design points:

- **BGM only switches on state transitions.** Hooks fire on every tool call, but
  the dispatcher sends idempotent `ensure <mode>` commands and the daemon no-ops
  if it's already in that mode — so music never restarts mid-loop.
- **SFX are restrained** — only meaningful moments (quest clear, error, file
  save, permission request), with a per-sound cooldown to avoid bursts.
- **Non-blocking.** Every hook is `async:true`; Claude never waits on audio. If
  cc-bgm is missing or slow, your session is unaffected.
- **Safe install.** `cc-bgm init` only ever touches the `hooks` key in
  `settings.json`, backs it up first, tags its entries, and `uninstall` removes
  exactly those — your `permissions` and everything else are untouched.

## Requirements

- Windows 10/11 (Phase 1 is Windows-only; installs inertly elsewhere)
- Windows PowerShell 5.1 (built in) — **not** PowerShell 7 (`pwsh`); WPF audio
  needs the .NET Framework runtime
- Node 18+

## Install

### Option A: npm

```sh
npm install -g cc-bgm
cc-bgm doctor     # verify the audio stack
cc-bgm init       # install the hooks into ~/.claude/settings.json
```

Start a new Claude Code session and code as usual.

### Option B: GitHub Release (no npm publish required)

1. Download and extract the release zip.
2. Open PowerShell in the extracted folder.
3. Run:

```powershell
.\install.ps1
cc-bgm doctor
cc-bgm init --abs
```

`install.ps1` copies the package into `%LOCALAPPDATA%\Programs\cc-bgm\`, creates
a `cc-bgm.cmd` shim, and adds that bin directory to your user `PATH`.
`--abs` is recommended here so Claude hooks call the installed script by absolute
path even if a future shell session does not pick up your `PATH` immediately.

To remove the release-based install later:

```powershell
.\uninstall.ps1
```

Add `-PurgeData` if you also want to delete `%LOCALAPPDATA%\cc-bgm\`.

## Commands

| Command | What it does |
| --- | --- |
| `cc-bgm init [--dry-run] [--abs]` | Install hooks (backs up settings first) |
| `cc-bgm uninstall [--purge]` | Remove hooks (`--purge` also deletes the data dir) |
| `cc-bgm doctor` | Check Node / PowerShell / WPF / assets / hooks |
| `cc-bgm status [--json]` | Show enabled/volume/daemon/current mode |
| `cc-bgm play <track>` | Manually play `village`, `quest`, `dungeon`, `credits` |
| `cc-bgm stop` | Stop BGM |
| `cc-bgm sfx <name>` | Fire `questclear`, `error`, `save`, `summon`, `fanfare_soft` |
| `cc-bgm volume <0-100>` | Set master volume |
| `cc-bgm off` / `cc-bgm on` | Silence / re-enable without uninstalling |
| `cc-bgm config list` | Show all options and their values |
| `cc-bgm config set <key> <val>` | Change an option (validated, applied live) |
| `cc-bgm config get <key>` | Print one option |
| `cc-bgm config reset [<key>]` | Reset one option, or all, to defaults |
| `cc-bgm fetch [pack]` | Download a CC0 audio pack (default: `starter`) |

To mute for one shell only: set `CC_BGM_DISABLE=1`.

### Adjusting options

After install, all options live in `%LOCALAPPDATA%\cc-bgm\config.json`. The
package code itself is read-only (and replaced on `npm update`), so nothing you
change there is ever lost. The easiest way to change options is the CLI:

```sh
cc-bgm config list                 # see everything
cc-bgm config set crossfade 2500   # slower BGM transitions
cc-bgm config set duckLevel 0.2    # duck BGM more under SFX
cc-bgm config set volume 50
cc-bgm config reset                # back to defaults
```

Changes are validated and applied to the running daemon immediately. Options:
`volume`, `crossfade`, `duckLevel`, `battleIdleMs` (auto work→idle delay),
`idleTimeoutMs` (daemon self-shutdown), `logLevel`, plus `enabled`/`mute`.

### Getting real music

The bundled audio is placeholder tones. Pull a real CC0 pack:

```sh
cc-bgm fetch starter   # Kenney CC0 jingles (BGM) + interface sounds (SFX)
cc-bgm fetch fantasy   # longer fantasy BGM only; keeps your current/default SFX
cc-bgm play quest      # hear it
```

Downloads land in `%LOCALAPPDATA%\cc-bgm\assets\` and override the placeholders.
Or drop your own files there by name — see below.

`starter` is the quick all-in-one pack. `fantasy` is a BGM-only override built
from longer OpenGameArt CC0 tracks for `village`, `quest`, and `dungeon`, so you
can layer it on top of `starter` if you want real music without changing SFX.

## Trigger map (default)

| Claude Code event | BGM | SFX |
| --- | --- | --- |
| SessionStart | village | fanfare_soft |
| UserPromptSubmit | quest | — |
| PreToolUse (Bash/Edit/Write/mcp) | quest | — |
| PreToolUse (Read) | — | — |
| PostToolUse (Edit/Write) | — | save |
| PostToolUseFailure | — | error |
| Notification (permission) | — | summon |
| Notification (idle) | village | — |
| Stop | village | questclear |
| SessionEnd | stop | — |

Edit `%LOCALAPPDATA%\cc-bgm\triggermap.json` to customize (created on `init`).
Changes take effect on the next session — no need to re-run `init`.

## Replacing the music

The bundled audio is **placeholder sine tones** — replace them. Drop your own
files into `%LOCALAPPDATA%\cc-bgm\assets\bgm\` and `...\sfx\` using the same
names (`village.mp3`, `quest.ogg`, `questclear.wav`, …). Any of
`.ogg .mp3 .wav .m4a .flac` works, and user files override the bundled defaults.

See [assets/CREDITS.md](assets/CREDITS.md) for licensing and where to find CC0
fantasy-RPG music. Do not bundle copyrighted game audio.

## Files & data

- Package (read-only at runtime): `bin/`, `daemon/cc-bgm-daemon.ps1`, `assets/`,
  `config/triggermap.default.json`
- User data (writable): `%LOCALAPPDATA%\cc-bgm\` — config, command channel,
  asset overrides, logs (`logs\daemon-*.log`), daemon state

## Troubleshooting

- `cc-bgm doctor` is the first stop.
- Set `CC_BGM_DEBUG=1` before an action to capture the daemon's startup stderr to
  `%LOCALAPPDATA%\cc-bgm\logs\spawn-stderr.txt`.
- Daemon logs: `%LOCALAPPDATA%\cc-bgm\logs\daemon-YYYYMMDD.log`.
- The daemon shuts itself down after 30 min idle, and on `SessionEnd`.

## License

MIT
