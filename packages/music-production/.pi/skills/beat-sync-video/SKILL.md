---
name: beat-sync-video
description: "Lock a picture edit to a music edit: scene boundaries on downbeats and drops, plus irregular camera-punch hits from bass re-entries and vocal hooks (<stem>_hits.json, schema music-hits/1) with a HyperFrames adapter recipe. Use on \"sync the video to the beat\", \"add camera punches on the drops\", \"cut on the music\", \"make the edit hit the drop\"."
---

# beat-sync-video

Input: an approved `music-edit/1` from `music-edit-to-length`. Output:
`<stem>_hits.json` and a picture edit whose scenes sit on the music grid.
Scripts run in the quick-tier venv (`.venv-music`); `PKG=<this skill dir>/../../..`.

## 1. Lock the scene grid

- The composition's **root duration = music duration** (`duration` of `_edit.json`).
- **Scene starts come from `downbeats_video`** — every scene boundary is a downbeat.
- Put a scene boundary **on each confirmed drop** (the drop-aligned boundary): the new
  scene starts exactly on the drop's video time.
- To land that boundary, compress or stretch the scene **before** the drop (trim or
  speed-ramp its shots, drop a shot, or hold the last one) so that it ends exactly on
  the drop downbeat. Never shift the drop to fit the picture.

## 2. Pick the hits

```bash
.venv-music/bin/python "$PKG/.pi/skills/beat-sync-video/scripts/pick_hits.py" music/track_edit90_edit.json \
    [--min-gap 1.5] [--hook-db -30] [--density 7]
```

- **Structural** hits: downbeats with the largest 30–150 Hz jump on the edited audio.
  One within ±1 downbeat of a confirmed drop (confidence ≥ 0.5) becomes `big`, snapped
  to the drop; the rest are `mid`.
- **Hook** hits (needs a vocals stem from the deep tier): bars where the vocals bar-RMS
  crosses `--hook-db` from below. Without stems the script says hook detection was skipped.
- Spacing is **irregular by construction**: a minimum gap (bars), about one hit per
  `--density` seconds, and a mechanical every-N-bars grid is thinned until ≤ 70 % of
  intervals are identical.
- Hand-placed hits: add `{"t": …, "tier": "big", "source": "manual", "why": "…"}` to
  `_hits.json`. Manual hits are never thinned and survive every re-run.

`music-hits/1`: `schema`, `edit` (relative path), `hits[] {t, tier: big|mid,
source: structural|hook|manual, why}` sorted by video time, `recipe {big, mid}`.

## 3. Punch recipe

| Tier | Scale | y | x | Rotation | Settle | Easing |
|---|---|---|---|---|---|---|
| big | 1.12 | −48 px | ±36 px | 0.8° | 0.6 s | expo.out |
| mid | 1.07 | −28 px | ±18 px | 0.4° | 0.45 s | expo.out |

Read the values from `recipe{}` in `_hits.json` — never duplicate the constants in a
generator. Alternate the horizontal jolt direction per hit (+x, −x, +x …).

## 4. HyperFrames adapter

- Wrap each scene's content in a **`.cam` wrapper INSIDE each sub-composition**
  (`<div class="cam" id="s6-cam">…</div>` in `compositions/s6.html`). Root-level
  transforms do not reach sub-composition content, so a punch on the root host does nothing.
- One seek-safe tween per hit, from the recipe values back to identity, at the
  scene-local time `hit.t − scene.start`:
  ```js
  tl.fromTo("#s6-cam", {scale:1.12, y:-48, x:36, rotation:0.8},
            {scale:1, y:0, x:0, rotation:0, duration:0.6, ease:"expo.out", immediateRender:false}, 0.000);
  ```
  `immediateRender:false` keeps earlier frames untouched when HyperFrames seeks.
- Put `data-layout-allow-overflow` on zoomed shots so the scaled content is not clipped
  by the layout checker.
- Generate the adapter code from `_hits.json`; never hand-edit generated HTML.

## 5. Verification

- **Snapshot pair** per tier: snapshot the hit frame and a settled frame
  (`t + settle + 0.1 s`), measure the scale and vertical offset between them (they must
  match the recipe within a few px).
- **Edge-bleed check**: at peak displacement no frame edge may show the background —
  inspect all four edges of the hit snapshot; raise the shot's zoom or lower the punch
  if one does.
- Watch the drop and one mid hit in the preview before the final render.
