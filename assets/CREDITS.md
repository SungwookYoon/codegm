# Audio asset credits & licensing

## ⚠️ Placeholder assets (current)

The `.wav` files currently shipped in `bgm/` and `sfx/` are **synthesized
placeholder tones** generated programmatically (simple sine waves). They exist
so the system works out of the box and so playback/crossfade/ducking can be
tested. They are deliberately boring — replace them.

These placeholders are original generated output and carry no license
restrictions (treat as CC0 / public domain).

## Replacing with real game-style music

Two options:

1. **Drop your own files** into `%LOCALAPPDATA%\cc-bgm\assets\bgm\` and
   `...\sfx\` using the same logical names (`town`, `battle`, `boss`, `credits`
   for BGM; `victory`, `error`, `build_complete`, `unit_ready`, `attention`,
   `start` for SFX). Any of `.ogg .mp3 .wav .m4a .flac` works. User files take
   precedence over these bundled defaults automatically.

2. **Bundle real CC0 assets** into this package's `assets/` folder before
   publishing. Recommended sources:
   - OpenGameArt.org — filter by **CC0** license, search "sci-fi loop",
     "RTS", "ambient", "space".
   - Kevin MacLeod / incompetech.com — CC-BY (requires attribution).
   - Freesound.org — filter by CC0 for SFX (blips, chimes, alerts).

## Copyright note

Do **not** bundle or redistribute StarCraft (or any Blizzard) audio — it is
copyrighted. Using your own legally-obtained copies privately on your own
machine via option (1) above is your responsibility; this package neither
ships nor distributes such files.
