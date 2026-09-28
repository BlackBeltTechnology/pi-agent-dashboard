---
name: music-edit-to-length
description: "Cut a music track to a target length on its downbeat grid with scored, click-free joins, writing <out>.wav and a video-time beat grid (<out>_edit.json, schema music-edit/1). Use on \"cut the music to 90 seconds\", \"fit the track to the video\", \"shorten this song on the beat\", \"re-cut the music edit\"."
---

# music-edit-to-length

Input: a `music-map/1` from `music-analysis` (run it first). Output: `<out>.wav`,
`<out>_edit.json` and, with `--preview`, `<out>.m4a` for listening. The edit file
feeds `beat-sync-video` and the picture edit.

Scripts run in the quick-tier venv (`.venv-music`, see `music-analysis` step 0);
`PKG=<this skill dir>/../../..`.

## Procedure

1. **Analyse** — `music-analysis` → `track_map.json`. Read the sections, classes and
   drop candidates; confirm the drop by ear.
2. **Identify blocks** — mark the sections and genre/energy blocks (e.g. tech-house
   groove bars 1–32, trance breakdown/build 33–65, groove again 66–105). Joins may only
   connect material from the same block family.
3. **Score joins** —
   ```bash
   .venv-music/bin/python "$PKG/.pi/skills/music-edit-to-length/scripts/score_joins.py" track_map.json \
       --candidates auto --target-duration 90 --anchor-bar 66
   .venv-music/bin/python "$PKG/.pi/skills/music-edit-to-length/scripts/score_joins.py" track_map.json --from-bar 12 --to-bar 17
   ```
   A join plays through the end of bar A and continues at bar B. Per factor: chroma and
   timbre similarity of the outgoing bars A−1..A against B's run-up in the source
   (B−2..B−1 — a match means the music arrives where B expects it), level jump,
   `section_boundary`, `class_change`. `score = 0.4·chroma + 0.4·timbre − 0.02·|jump dB| − 0.5·[groove/drop ↔
   breakdown/build] + 0.1·[section boundary]`. Prefer ≥ 0.75 with no class change. The
   score is advisory: automatic classes cannot always tell a genre boundary (a trance
   build and a tech-house groove both have drums and bass) — your block marking in step 2
   decides.
4. **Render** —
   ```bash
   .venv-music/bin/python "$PKG/.pi/skills/music-edit-to-length/scripts/edit_music.py" track.wav music/track_edit90 \
       1:13 17:25 25:33 66:82 102:197.0 --preview
   ```
   The map defaults to `<audio stem>_map.json` next to the audio; pass `--map
   music/track_map.json` when it lives elsewhere (e.g. after `analyze_music.py --out-dir`).
   Segments are 1-based `start_bar:end` where `end` is an exclusive bar, `END`, or
   seconds with a decimal point. Joins are 30 ms equal-power crossfades.
5. **Click check** — every join reports `click_ok`; the script warns on stderr when a
   join's sample step exceeds 1.1× the source at the same bar. Pick another join or
   keep the crossfade (`--no-xfade` is diagnostic only).
6. **Preview** — the `.m4a` is written next to the wav.
7. **Listen before lock** — ask the user to listen to the `.m4a` before the picture
   edit is locked to `downbeats_video`. Do not sync video to an unapproved edit.
8. **Iterate** — keep every rejected version with a `_vN` suffix
   (`track_edit90_v1.wav` + `_v1_edit.json`) and write a one-line note of the rejection
   reason next to it (README/AGENTS row), e.g. "v2 rejected: jumps from tech-house
   groove into the trance build at 0:31".

## Splice rules

- **Fixed drop anchor** — the drop is the fixed anchor on the video timeline; cut
  before and after it, never move it.
- **Enter at section boundaries** — enter only at a section boundary or at a
  repeated-block boundary (same 4/8-bar phrase position).
- **No genre boundary** — never splice across a genre or energy boundary (for example
  from a tech-house groove into a trance build), however good the similarity numbers look.
- Trailing silence is trimmed automatically (≥ 1 s below −50 dBFS → 50 ms + fade).

## The edit contract — `music-edit/1` (video time)

| Field | Meaning |
|---|---|
| `schema` | `"music-edit/1"` |
| `source`, `audio`, `map` | source audio, edited wav, source map — **relative to the edit file** |
| `bpm`, `meter`, `duration` | from the map; duration of the edited audio |
| `segments[] {start_bar, end_bar \| end_s, music_from, music_to, video_at}` | source span → video position |
| `joins[] {video_at, source_bar, score, click_ok}` | one per join |
| `downbeats_video[]` | the video-time downbeat grid (first entry 0.0) |

A source time `s` inside segment *i* maps to `video_at_i + (s − music_from_i)`; source
times outside every segment are cut out.

## Verification

- `click_ok` true for every join; the `.m4a` approved by the user.
- `jq '.duration, (.downbeats_video | length)' <out>_edit.json` matches the target.
