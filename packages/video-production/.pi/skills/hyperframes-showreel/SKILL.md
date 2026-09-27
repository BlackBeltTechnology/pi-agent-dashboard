---
name: hyperframes-showreel
description: "Turn real screen and site footage into a rhythmic showreel rendered with HyperFrames: sampling, edit script, redacted clips, a generated composition, Veo only as additive FX, music edit + camera punches, delivery render and export QA. Use on \"make a showreel from these recordings\", \"build the HyperFrames video\", \"assemble the footage edit\", \"render and QA the showreel\"."
---

# hyperframes-showreel

End-to-end pipeline from real footage to a delivered HyperFrames showreel. HyperFrames
is used only through its public CLI (`npx hyperframes …`); none of its skills or code
is vendored here. Last verified with HyperFrames 0.8.72 (2026-09-24) — a data point,
not a pin.

## Ground rules

- **Footage-only rule** — every process shown on screen comes from real footage. No AI
  insert may depict a process that has no footage; if there is no recording of it, the
  beat is cut from the script.
- **Screen-blend FX rule** — Veo output is used only as an additive FX layer: rendered
  on a black background and composited with `mix-blend-mode: screen` over the footage
  (light, particles, flares, scan lines). It never replaces a shot.

## Pipeline

1. **Footage sampling** — contact sheets of every source (`ffmpeg -i src.mov -vf "fps=1/2,scale=480:-2,tile=6x6" sheet_%02d.png`); note sensitive regions and usable moments with timecodes.
2. **Edit script** — acts, shots, source timecodes, on-screen copy, FX layer map. Every shot names its source clip and in/out.
3. **Clip cutting with redaction baked in** — one call per clip via the `footage-redaction` skill (crop / delogo / timed blur in source-frame coordinates), then contact-sheet verification of every clip.
4. **Generated composition, pass 1** — a generator script turns the shot table into `index.html` + one scene sub-composition per act, with provisional scene durations and a temp track or none. See [references/generator-pattern.md](references/generator-pattern.md).
5. **Optional Veo FX layers** — black-background renders (e.g. `veo-showreel-production-kit` + `veo-generator`), screen-blended per the rule above.
6. **`npx hyperframes check` and snapshots** — `check` must report 0 errors; `npx hyperframes snapshot --at <t1>,<t2>,…` at scene midpoints to verify framing.
7. **Preview and user review** — `npx hyperframes preview`; the user approves the picture before music is fitted.
8. **Music, punches, generation pass 2** — cut the music with `music-edit-to-length` (listen-before-lock), pick hits with `beat-sync-video`, then **regenerate the composition**: re-run the generator with scene starts from `_edit.json` (`downbeats_video`, a boundary on each drop), punches from `_hits.json`, and root duration = the edit's `duration`.
9. **Delivery render** — `npx hyperframes render . -o ../export/showreel_v1.mp4 --fps 30 --quality delivery --video-frame-format png`.
10. **Export QA** — the gate below; a render is not "done" until it passes.
11. **Upload** — copy the export (and its subtitles) to the agreed share; record the location next to the file.

**Music skills not installed?** Step 8's music skills ship in
`@blackbelt-technology/pi-dashboard-music-production`
(`pi install npm:@blackbelt-technology/pi-dashboard-music-production`). Without them,
continue with the unedited music track and no punches: set the root duration to the
track length and skip the pass-2 punch step.

## Pitfalls

- **(a) Install scope.** Default: follow the upstream installer —
  `npx hyperframes skills update` installs into the universal store `~/.agents/skills`,
  which pi reads; the router installs further workflows there lazily. Only when the user
  wants **project-only scope**: after every `init`, `init --skill` or `skills update`
  (including the router's lazy workflow installs), **copy** the directories just
  installed into the user project's `.pi/skills/`. Do **not** modify the global store by
  default — it is machine-wide, other projects may use it, and the router re-installs
  into it anyway. Warn that project and global copies may then coexist at different
  versions. Remove global copies only after the user explicitly confirms (`ask_user`)
  that no other project uses them, and only the directories and lock entries that call
  just created. Never apply this to the dashboard repository's own `.pi/skills`.
- **(b) Blend on the wrapper.** `mix-blend-mode` and any `opacity` go on the FX wrapper
  (`.fxw`); never put opacity on a wrapper whose inner video carries the blend — the
  blend then composites against the wrapper, not the footage.
- **(c) Audio needs an id.** Every `<audio>` element needs an `id`, or the render is silent.
- **(d) Never hand-edit generated files.** Composition HTML is generated; change the
  generator and re-run it (and `check`).
- **(e) Flash snapshots.** A snapshot landing exactly on a flash tween looks washed
  out — expected; snapshot a few frames later before judging.

## Export QA gate

```bash
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate:format=duration -of json export/showreel_v1.mp4
ffmpeg -hide_banner -i export/showreel_v1.mp4 -af loudnorm=print_format=json -f null - 2>&1 | tail -12
ffmpeg -v error -ss <drop_t> -i export/showreel_v1.mp4 -vf "fps=8,scale=480:-2,tile=8x1" -frames:v 1 qa_drop_strip.png
ffmpeg -v error -sseof -4 -i export/showreel_v1.mp4 -vf "fps=2,scale=480:-2,tile=8x1" -frames:v 1 qa_end_strip.png
```

Pass criteria:

- one video + one audio stream; resolution and fps as specified; `duration` equals the
  music edit's `duration` **±0.1 s**;
- integrated loudness (`input_i`) and true peak (`input_tp`) reported; note the platform
  target (**−14 LUFS** integrated for web platforms, true peak ≤ −1 dBTP) and whether a
  final `loudnorm` pass is needed;
- frame strips at the drop and at the end card inspected: the drop cut lands on the
  beat, the end card holds with the logo fully visible, no redaction leak.
