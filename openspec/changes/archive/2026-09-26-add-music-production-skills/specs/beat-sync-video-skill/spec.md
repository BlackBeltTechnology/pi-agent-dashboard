## Purpose

The `beat-sync-video` pi skill locks a picture edit to a music edit's rhythm. It places scene boundaries on downbeats and drops, and adds irregular camera-punch hits on structural and vocal-hook accents, with a HyperFrames adapter recipe.

## ADDED Requirements

### Requirement: Hits are picked from structure and hooks
The skill SHALL provide a hit-picking script that reads a `music-edit/1` file, the edited audio it references (`audio`) and the source map it references (`map`), and writes the hits file containing the fields below. The hits file is `--out`, defaulting to the edit file's path with the `_edit.json` suffix replaced by `_hits.json`. It SHALL be written to a temporary path and renamed:
- `"schema": "music-hits/1"`;
- `hits[] {t, tier: big|mid, source: structural|hook|manual, why}` sorted by `t`;
- a `recipe {big{scale,y,x,rot,settle,ease}, mid{...}}`.

Hit sources:
- **Structural candidates** SHALL be downbeats with the largest 30–150 Hz energy jump measured on the edited audio.
- A structural candidate within ±1 downbeat of a mapped `drops[]` entry with confidence ≥ 0.5 SHALL be tier `big`, with its `t` snapped to the downbeat nearest that drop.
- **Hook candidates**, only when a vocals stem exists, SHALL be bars where the vocals bar-RMS crosses `--hook-db` (default −30 dB) from below.

Map-derived source times (drops, stem bar levels) SHALL be converted to video time through the edit's `segments`. A source time *s* inside segment *i* maps to `video_at_i + (s − music_from_i)`. Source times outside every segment SHALL be ignored.

#### Scenario: Source drop mapped to video time
- **WHEN** a map drop lies at source 45.480 s inside a segment with `music_from` 45.480 and `video_at` 36.080
- **THEN** the corresponding big hit has `t` = 36.080 ± 0.02

#### Scenario: Drop cut out of the edit
- **WHEN** a map drop lies in a source range that no segment covers
- **THEN** no hit is derived from it

#### Scenario: Bass re-entry becomes a big hit
- **WHEN** a fixture edit has a bass-and-drums re-entry at a downbeat mapped to a `drops[]` entry
- **THEN** a hit with `tier: "big"` and `source: "structural"` exists within 20 ms of that downbeat

#### Scenario: No vocals stem
- **WHEN** the map has no `stems.bar_rms_db.vocals`
- **THEN** only structural hits are emitted, and a stderr note says hook detection was skipped

### Requirement: Hit spacing is irregular by construction
The picker SHALL enforce a minimum gap between hits (`--min-gap`, default 1.5 bars). It SHALL then thin the result when more than 70 % of the inter-hit intervals equal a single value (±1 downbeat), because that pattern is a mechanical grid. `manual` hits SHALL never be thinned and SHALL be preserved across re-runs. With fewer than 3 hits, no de-regularization SHALL run. Each step removes the lowest-priority non-manual hit that lies on the modal interval grid; among equal priority, it removes the one with the smallest low-band jump. The loop SHALL stop when the regularity is ≤ 70 % or no removable non-manual hit remains, so it runs at most as many steps as there are non-manual hits.

#### Scenario: Every-8-bars grid is broken up
- **WHEN** the structural candidates fall exactly every 8 bars across 48 bars
- **THEN** the emitted hits do not have more than 70 % identical intervals

#### Scenario: All-manual regular grid terminates
- **WHEN** the existing file holds 6 manual hits spaced exactly 8 bars apart and no other candidates qualify
- **THEN** the picker terminates and emits the 6 manual hits unchanged

#### Scenario: Manual hit survives re-run
- **WHEN** `_hits.json` holds a `source: "manual"` hit and the picker is re-run
- **THEN** that hit is present, unchanged, in the new file

### Requirement: Scene grid locks to the music edit
The skill text SHALL instruct that:
- the composition's root duration equals the music edit's `duration`;
- scene start times are taken from `downbeats_video`;
- a scene boundary is placed on each confirmed drop.

It SHALL describe how to compress or stretch the scene before a drop so that the next scene starts exactly on it.

#### Scenario: Skill text names the lock rules
- **WHEN** the skill markdown is read
- **THEN** it states root duration = music duration, scene starts from `downbeats_video`, and the drop-aligned scene boundary

### Requirement: HyperFrames punch adapter
The skill SHALL document the HyperFrames adapter:
- a per-scene `.cam` wrapper INSIDE each sub-composition, because root-level transforms do not reach sub-composition content;
- a seek-safe `fromTo` tween per hit, from the `recipe` values back to identity, with `immediateRender:false`;
- the horizontal jolt direction alternating per hit;
- `data-layout-allow-overflow` on zoomed shots.

It SHALL document the verification step: snapshot the hit frame and a settled frame, measure the scale and vertical offset between them, and check that no frame edge shows the background at peak displacement.

#### Scenario: Adapter guidance present
- **WHEN** the skill markdown is read
- **THEN** it contains the inside-sub-composition `.cam` rule, the snapshot-pair verification and the edge-bleed check
