---
name: soundcraft
description: Headless audio editing and mixing with SoundCraft (DAW-style commands), provisioned on demand by pi-craft - import audio, clip gain, fades, normalise, multi-track mixes, bounce with a loudness/peak report, save .scraft sessions. Use for "make this audio 6 dB quieter", "fade in and out this clip", "mix these two tracks", "bounce the session to a wav".
---

# SoundCraft — headless audio editing and mixing

SoundCraft is ArtCraft's DAW-style editor (sessions, tracks, clips, fades, mixer). `pi-craft` provisions the
headless `soundcraft-cli` (no desktop app). Choosing between apps, the discover → execute → save → verify loop
and the MCP policy live in `craft-studio`; this skill is the SoundCraft dialect and its traps.

## What it is for / formats

Imports and bounces `wav aiff flac` (bounce: `format`, `bit_depth` 16/24/32f); `info FILE` summarises an audio
file or a session. Project file: **`.scraft`** (the session; its audio lives in an `Audio Files/` folder beside it).
Hand-off to a video editor: bounce `wav` (see `craft-studio`).

## CLI dialect

`pi-craft soundcraft exec <args…>` passes `<args…>` to `soundcraft-cli` verbatim. Unlike FilmCraft there is no
`exec <id>`: one invocation = one **`run`** (a list of `--cmd`s, optional bounce).

```bash
pi-craft soundcraft exec commands [FILTER]                  # list ids; FILTER is positional (see Traps)
pi-craft soundcraft exec describe <id>                      # params + "enabled" now / "disabled_reason"
pi-craft soundcraft exec run [--in S.scraft | --demo] --cmd ID[=JSON] [--cmd …] [--bounce OUT.wav] [--start SEC --end SEC] [--save S.scraft]
pi-craft soundcraft exec script FILE [--in S] [--save S] [--bounce OUT]   # FILE: one `ID JSON` per line
pi-craft soundcraft exec info FILE.wav|S.scraft             # file or session summary (track/clip listing)
pi-craft soundcraft exec run --in S.scraft --inspect        # session JSON: selection, sources, tracks
pi-craft soundcraft exec convert IN OUT [--bit-depth 16|24|32f] [--rate HZ] [--normalize]
```

- Commands run in order and **stop at the first failure** (exit `1`, no bounce written).
- Each command prints `id: {json}` on stdout; `--bounce` prints one JSON line last:
  `{"lufs":…,"peak_db":…,"true_peak_db":…,"seconds":…,"path":…}` — read it, then confirm with `pi-craft verify`.
- Params after `=` are one JSON object (`--cmd 'clip.gain={"db":-6}'`); a bare id has no params (`--cmd edit.select_all`).
- Positions (`at`, `length`, `start`, `end` *inside commands*) are **samples** (48000 = 1 s at 48 kHz);
  `--start/--end` of `run` are **seconds**. Relative file paths are accepted.

## State and persistence

A `run` without `--in` starts empty and, without `--save`, **forgets everything** when it exits (only the
bounce file remains). To continue later: `--save mix.scraft` (or the `session.save` command with
`{"path":…}`), then open it with `--in mix.scraft`. The session is a text file that points to `Audio Files/…`
next to it — move or copy the folder together, not the `.scraft` alone. Gain, fades, track layout, clip positions
and the current edit selection are saved (a session saved after `edit.select_all` reopens with that selection).

## Discovery first

```bash
pi-craft soundcraft exec commands fades                   # positional filter
pi-craft soundcraft exec describe edit.fades_create       # params; "disabled_reason": "make an edit selection first"
pi-craft soundcraft exec describe file.import_audio
pi-craft soundcraft exec describe file.bounce_mix
```

## Traps

- **Many `clip.*` / `edit.*` commands need a selection**: `clip.gain` fails with "nothing is selected" until
  you run `edit.select_all` (or `edit.select` with tracks/clips). Alternatively pass the clip id:
  `clip.gain={"clips":[3],"db":-6}`. The `file.import_audio` result lists the new `clip` id; `describe <id>` shows
  `enabled` and `disabled_reason`. Fades by clip id (`edit.fades_create` with `clip`, `side`, `length`) need no selection.
- `clip.gain` with `db` **sets** the gain (running it twice does not add up); `delta_db` adds.
- Every `file.import_audio` makes a **new track** (`new_tracks` defaults to true). Two imports = two tracks that
  play at once — that is how you mix. `at` (samples) offsets the clip on its track.
- A **mono** clip bounced to the stereo main bus is 3 dB quieter than the file (pan law): a sine with a −18.1 dBFS
  peak bounced at −21.1 dBFS. Trust the bounce report, do not compute from the source level.
- `commands --filter word` prints **nothing** in SoundCraft (the filter is positional: `commands fades`).
  `--filter` is for the other apps.
- `file.bounce_mix` as a `--cmd` takes `{"path":…,"normalize":true}`; normalise = peak **−0.1 dBFS**, not a LUFS target.
  `run --bounce` takes no such flag — use the command, or `convert IN OUT --normalize` for a plain file.
- A bounce longer than 4 hours is refused; `--start/--end` in samples are wrong (they are seconds).
- Linux needs glibc ≥ 2.34 (SoundCraft; the others 2.35).

## MCP route (opt-in)

`pi-craft soundcraft mcp --register` adds a `craft-soundcraft` entry (17 tools: `new_session`, `open_session`,
`import_audio`, `execute`, `bounce_mix`, `save_session`, … plus `ui_*`). SoundCraft ≥ 0.7.0 is **path-confined**:
the proxy runs it with `--automation-read-root/--automation-write-root` set to the project directory, so
sessions, imports and bounces must lie under it (`exec`/`run` have no such limit). Bridging to a running GUI
(`--connect`) is out of scope.

## Recipes

```bash recipe: gain-bounce-loudness
ffmpeg -v error -y -f lavfi -i sine=frequency=440:duration=3 -ar 48000 tone.wav
pi-craft soundcraft exec commands gain | head -3
pi-craft soundcraft exec run \
  --cmd session.new \
  --cmd 'file.import_audio={"path":"tone.wav"}' \
  --cmd edit.select_all \
  --cmd 'clip.gain={"db":-6}' \
  --bounce quiet.wav
pi-craft verify quiet.wav --duration 3±0.1 --max-peak -25 --loudness -27.7±1
```

```bash recipe: fade-in-out
# 1 s fade-in and fade-out on one clip (lengths are samples). Prove the fade by bouncing only the first 50 ms.
ffmpeg -v error -y -f lavfi -i sine=frequency=440:duration=3 -ar 48000 tone.wav
pi-craft soundcraft exec run \
  --cmd session.new \
  --cmd 'file.import_audio={"path":"tone.wav"}' \
  --cmd 'edit.fades_create={"clip":3,"side":"in","length":48000}' \
  --cmd 'edit.fades_create={"clip":3,"side":"out","length":48000}' \
  --bounce head.wav --start 0 --end 0.05
pi-craft verify head.wav --duration 0.05±0.01 --max-peak -35
```

```bash recipe: mix-two-tones-and-save
# Two imports = two tracks; the second starts at 1 s (48000 samples). Save the session, reopen it, add gain, bounce.
ffmpeg -v error -y -f lavfi -i sine=frequency=440:duration=3 -ar 48000 a.wav
ffmpeg -v error -y -f lavfi -i sine=frequency=660:duration=2 -ar 48000 b.wav
pi-craft soundcraft exec run \
  --cmd session.new \
  --cmd 'file.import_audio={"path":"a.wav"}' \
  --cmd 'file.import_audio={"path":"b.wav","at":48000}' \
  --save mix.scraft
pi-craft soundcraft exec info mix.scraft | grep -c Unmuted
pi-craft soundcraft exec run --in mix.scraft --cmd edit.select_all --cmd 'clip.gain={"db":-6}' --bounce mix.wav
pi-craft verify mix.wav --duration 3±0.1 --loudness -25.4±1.5 --max-peak -20
```

```bash recipe: normalise-bounce
# Peak-normalise on bounce (target −0.1 dBFS) through the file.bounce_mix command.
ffmpeg -v error -y -f lavfi -i sine=frequency=440:duration=3 -ar 48000 tone.wav
pi-craft soundcraft exec run \
  --cmd session.new \
  --cmd 'file.import_audio={"path":"tone.wav"}' \
  --cmd 'file.bounce_mix={"path":"loud.wav","normalize":true}'
pi-craft verify loud.wav --duration 3±0.1 --max-peak -0.05 --loudness -0.8±0.5
```
