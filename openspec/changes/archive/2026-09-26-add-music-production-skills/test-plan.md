# Test Plan — add-music-production-skills

Stage: design   Generated: 2026-09-24

Hard gate resolved (user, 2026-09-24):

- **Q1:** Python-behaviour scenarios run in a new `ci.yml` `music-pytest` job (quick-tier pytest, uv + `requirements-core.txt`). The deep tier stays local with `skipif`.
- **Q2:** Redaction is tested via resolved windows and the filter-graph string (pure). Only one test does a real ffmpeg encode, and it is `skipif` when ffmpeg/ffprobe are missing.
- **Q3:** The HyperFrames punch visual check and the join listening test are `manual-only`, verified post-merge on the BD showreel.

Levels used:

- **`L1`**: vitest (`packages/music-production/src/__tests__/`, `packages/video-production/src/__tests__/`, `packages/shared/src/__tests__/`).
- **`L1-py`**: pytest collected by the `music-pytest` CI job (`packages/music-production/tests/`, `packages/video-production/tests/redaction/`).
- **`L1-py-deep`**: pytest that is `skipif` when essentia/beat_this/demucs are not importable. It runs locally only.

Harness exemplars:

- L1 skill-text invariants: `packages/apple-tools/src/__tests__/skill.test.ts` (content assertions over SKILL.md).
- L1 repo-lint over workflow/manifest: `packages/shared/src/__tests__/ci-vitest-report-artifact.test.ts`, `publish-allowlist-complete.test.ts`, `publish-tarball-hygiene.test.ts`.
- L1-py: `packages/document-converter/engine/tests/test_convert_pdf_output.py` (pytest layout). Fixtures are synthesized in-test with numpy + soundfile (audio) or ffmpeg `lavfi` (video).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | music-analysis: Quick-tier map | EP | L1-py | automated | synthetic 60 s click track, 124 BPM 4/4, accented downbeats, 44.1 kHz wav | run quick analysis | map has `schema: "music-map/1"`, `source` (relative), `duration`, `sr`, `tempo`, `cut_grid{source:"librosa",meter:4,downbeats}`, `beats`, `key`, `band_level_db_rel` with 5 bands, `sections`, `drops`; `tempo.bpm` ∈ [123, 125]; every downbeat interval ∈ 1.935 ± 0.030 s; all times have ≤ 3 decimals |
| E2 | music-analysis: Quick-tier map (`--out-dir`) | EP | L1-py | automated | same fixture, `--out-dir tmp/x` | run | `tmp/x/<stem>_map.json` and `_analysis.png` exist; `source` resolves from `tmp/x` to the input |
| E3 | music-analysis: Authoritative tempo | BVA | L1-py | automated | a grid whose first 4 bars drift by 8 % and are stable after that; an injected `tempo.methods.x` of +2 BPM | compute tempo | `stable_span.start_bar` is 5; `tempo.bpm` equals the grid-mean over the span; the +2 BPM value appears only under `methods` |
| E4 | music-analysis: Authoritative tempo (meter) | EP | L1-py | automated | 3/4 click track at 120 BPM with accented beat 1 | run quick analysis | `cut_grid.meter` = 3; `tempo.bpm` ∈ [119, 121] (it is not 4/3 × the true value) |
| E5 | music-analysis: Bars are 1-based | BVA | L1-py | automated | click fixture | run | `sections[0].start_bar` = 1; for every section, `cut_grid.downbeats[start_bar-1]` is within 1 beat of `start` |
| E6 | music-analysis: Sections class + drops | EP | L1-py | automated | fixture: 8 bars groove (kick+bass), 4 bars loud noise-swell breakdown (no low band), 8 bars kick+bass re-entry | run quick analysis | `drops[0].bar` = the re-entry bar; the breakdown start, if present, has confidence < 0.5; every section has `class` in the 6-value enum |
| E7 | music-analysis: Too little rhythm | BVA | L1-py | automated | 6 s click track (3 downbeats) | run quick analysis | exit ≠ 0; stderr contains "too short or arrhythmic"; no map file |
| E8 | music-analysis: Deep grid replacement re-derives bars | state-transition | L1-py-deep | automated | quick map of the click fixture, then a deep run | deep run | `cut_grid.source` = `beat_this`; every section `start_bar` satisfies the 1-beat rule against the new grid; `stems.dir` is relative |
| E9 | music-analysis: Pinned requirements | EP | L1 | automated | `requirements-core.txt`, `requirements-mir.txt` | parse lines | every non-comment line matches `==`; `.*` only on `torch` and `torchaudio`; both files exist at the package root |
| E10 | music-analysis: No-rip rule | EP | L1 | automated | all files under music-production `.pi/**` and `lib/**` | case-insensitive grep `spotdl\|yt-dlp\|youtube-dl\|savefrom\|spotify-dl\|ytmp3` | 0 matches |
| E11 | music-analysis: No personal/client coupling | EP | L1 | automated | music-production `.pi/**`, `lib/**`; video-production `.pi/skills/{hyperframes-showreel,footage-redaction}/**` | grep `/Users/\|Projektek\|railcargo\|becton\|blackbelt\.hu` (ci) | 0 matches |
| E12 | music-analysis: Sourcing + NC-licence + quiet-recording text | EP | L1 | automated | music-analysis SKILL.md | read | contains the acceptable-sources list, `volumedetect`, the −12 dBFS → −2 dBFS gain rule plus the note-the-gain rule, the CC BY-NC-SA warning with a quick-tier commercial path, and the third-party weight cache locations |
| E13 | music-edit: Join scoring (repeated block) | EP | L1-py | automated | fixture: block A (4 bars) ×2, then a different-texture block B | score the loop-back join (end of A₁ → start of A₁) and the join into B | chroma ≥ 0.98, timbre ≥ 0.98; loop-back `score` > B-join `score` |
| E14 | music-edit: Join scoring (genre boundary) | decision-table | L1-py | automated | map with classes; joins groove→breakdown, groove→groove, drop→build, breakdown→breakdown, with identical similarity inputs | score | `class_change` reported for groove→breakdown and drop→build; those scores are lower than groove→groove; breakdown→breakdown has no class-change penalty |
| E15 | music-edit: Join scoring audio via map `source` | EP | L1-py | automated | map whose `source` is relative; cwd ≠ map dir | score_joins | runs without an audio argument; the audio is resolved relative to the map |
| E16 | music-edit: Output length + grid | BVA | L1-py | automated | 124 BPM fixture; segments `1:9 17:25` | edit | `duration` = 16 × 1.935 ± 0.040 s; `downbeats_video` has 16 entries, `[0]` = 0.0; `segments[1].video_at` = 8 bars; `audio`/`source`/`map` resolve to existing files |
| E17 | music-edit: Segment validation | BVA | L1-py | automated | segments `5:5`, `9:3`, `1:999`, `0:4`, `1:END`, `1:12.500` | edit | first four → exit ≠ 0 naming the segment, no output written; `END` and seconds forms accepted |
| E18 | music-edit: `--preview` | EP | L1-py | automated | valid edit with `--preview` (skipif ffmpeg missing) | edit | `<out>.m4a` exists, and ffprobe reports aac with duration within 50 ms of `duration` |
| E19 | beat-sync: Source→video mapping | BVA | L1-py | automated | edit segments `{music_from 45.480, video_at 36.080}`; map drop at 45.480 (conf 0.9) and another at 70.310 in a cut-out range | pick_hits | a big hit at 36.080 ± 0.02; no hit derived from 70.310 |
| E20 | beat-sync: Big-hit rule | BVA | L1-py | automated | drops with confidence {0.49, 0.5}, each at a downbeat with a low-band jump; a structural candidate 1 downbeat after the 0.5 drop | pick_hits | the 0.5 drop → `big`, snapped to the drop's downbeat; the 0.49 drop → `mid` |
| E21 | beat-sync: No vocals stem | EP | L1-py | automated | map without `stems` | pick_hits | only `source: structural` hits; stderr says hook detection was skipped |
| E22 | beat-sync: Hook entries | EP | L1-py | automated | map with vocals `bar_rms_db` crossing −30 dB upward at bars 5, 13 and 22 | pick_hits | `hook` hits at those bars' video times (subject to min-gap) |
| E23 | beat-sync: De-regularize | decision-table | L1-py | automated | structural candidates exactly every 8 bars over 48 bars | pick_hits | the modal interval accounts for ≤ 70 % of intervals |
| E24 | beat-sync: Degenerate/termination | BVA | L1-py | automated | (a) 2 hits; (b) 6 manual hits exactly every 8 bars, no other candidates | pick_hits | (a) both emitted, no thinning; (b) terminates, the 6 manual hits are emitted unchanged |
| E25 | beat-sync: Manual preserved + output path | state-transition | L1-py | automated | existing `x_hits.json` with 1 manual hit; the edit `x_edit.json` | re-run without `--out` | writes `x_hits.json`, and the manual hit is byte-identical |
| E26 | beat-sync: Scene-grid + adapter text | EP | L1 | automated | beat-sync-video SKILL.md | read | contains root duration = music duration, `downbeats_video`, the drop-aligned boundary, the `.cam` inside-sub-composition rule, `immediateRender:false`, `data-layout-allow-overflow`, snapshot-pair verification and the edge-bleed check |
| E27 | music-edit: Rules text | EP | L1 | automated | music-edit-to-length SKILL.md | read | contains the fixed-drop anchor, section-boundary entry, the no-genre-boundary rule, listen-before-lock and the `_vN` rejection-note rule |
| E28 | hyperframes-showreel: Pipeline + two-pass | EP | L1 | automated | hyperframes-showreel SKILL.md | read | steps 1–11 in order; step 3 names `footage-redaction`; step 8 names both music skills and requires regeneration |
| E29 | hyperframes-showreel: Footage-only + pitfalls | EP | L1 | automated | same | read | footage-only rule; screen-blend FX rule; pitfalls (a)–(e); copy-only project scope with global removal gated on confirmation; co-install fallback |
| E30 | hyperframes-showreel: QA gate + generator ref | EP | L1 | automated | skill dir | read | ffprobe, `loudnorm`, frame-strip commands with criteria (±0.1 s, −14 LUFS note); `references/generator-pattern.md` exists and is linked |
| E31 | redaction: Spec validation | EP+BVA | L1-py | automated | 1920×1080 source; specs: min_ratio ∈ {0, 0.01, 1, 1.5}; tol ∈ {−1, 0, 255, 256}; rgb `[0,0,256]` and `[1.5,0,0]`; delogo x+w = 1920 vs 1921; `from` = `to`; speed 0 | validate | accepted: min_ratio 0.01 and 1, tol 0 and 255, x+w = 1920; everything else → exit ≠ 0 naming the field path (e.g. `blur_when[0].detect.min_ratio`) |
| E32 | redaction: Coordinate space + order | EP | L1-py | automated | spec: crop top 100, delogo y 50, trim from 10, a blur window at source 12–14 s | `--dry-run` | filter graph order is trim → delogo → blur → crop → setpts → fps; the blur enable becomes `between(t,2,4)`; the delogo box is validated against the uncropped frame |
| E33 | redaction: Conditional blur windows | BVA | L1-py | automated | detection samples (pure fn input): navy ratio 1.0 at t ∈ [2.0, 4.0], 0 elsewhere, 4 fps, `pad_s` 0.25 | resolve windows | a single window [1.75, 4.25] ± 0.25 |
| E34 | redaction: Crop real encode | EP | L1-py | automated | lavfi 1920×1080 6 s video with a navy box at 2–4 s (skipif ffmpeg/ffprobe missing) | redact with crop top 100 bottom 80 + blur_when | output 1920×900; a frame at 3.0 s has lower variance in the target box than the frame at 1.0 s |
| E35 | redaction: Visual-verification text | EP | L1 | automated | footage-redaction SKILL.md | read | contains the contact-sheet command and the OCR-insufficient warning |
| E36 | repo wiring | EP | L1 | automated | `publish.yml`, root `vitest.config.ts`, `pnpm-lock.yaml`, music-production `package.json` | existing guards + new repo-lint | allowlist-complete and tarball-hygiene pass; `projects` includes `packages/music-production`; the lockfile has the importer; `pi.skills` dirs each have a SKILL.md, and every `scripts/*.py` named in a SKILL.md exists |
| E37 | ci: music-pytest job | EP | L1 | automated | `.github/workflows/ci.yml` | repo-lint read | the job exists, installs `requirements-core.txt` via uv, and runs pytest on both suite paths; no `requirements-mir.txt` install |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | none | — | — | — | No latency or throughput requirement exists (offline batch). See design Risks; `performance-optimization` is not triggered. | — | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | beat-sync: HyperFrames punch adapter | visual/subjective | — | manual-only | BD showreel regenerated from the new skills | play the drop and a mid hit in Studio | [judgment: the punch reads as a hit, with no frame-edge bleed visible] |
| F2 | music-edit: listen-before-lock | subjective | — | manual-only | an edit of COCIHI produced with `score_joins` + `edit_music` | listen to the `.m4a` | [judgment: no audible splice or genre jump; compare with the approved v3] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | music-analysis: Missing dependency | fault-injection (abort) | L1-py | automated | `librosa` made unimportable (subprocess with an `-I` env stub, a `sys.modules` shim) | run quick analysis | exit 2; one stderr line naming `librosa` and `requirements-core.txt` |
| X2 | music-analysis: Model verification | fault-injection (corrupt) | L1-py | automated | a cached model file whose bytes ≠ the table sha256 (table injected via a test hook) | the verify function | the file is deleted; the call raises and the CLI path exits ≠ 0 naming the model; no network call (fetch mocked) |
| X3 | music-analysis: Model size cap | BVA | L1-py | automated | a mocked download stream of 200 MB + 1 byte | fetch | aborted, no file left, exit ≠ 0 |
| X4 | music-edit: Click check | fault-injection | L1-py | automated | two sine bars at different phases, `--no-xfade` | edit | the join's `click_ok` = false; the same join with a crossfade → true |
| X5 | music-edit: Trailing silence | BVA | L1-py | automated | source ending with 5 s of digital silence; the last segment `…:END` | edit | the output tail after the last sound is ≤ 0.1 s; the last 50 ms is a fade (monotone non-increasing envelope) |
| X6 | music-edit: Unknown schema major | EP | L1-py | automated | map with `schema: "music-map/2"` | score_joins / edit / pick_hits | each exits ≠ 0 naming the unsupported schema |
| X7 | redaction: Never-active detector | fault-injection | L1-py | automated | detection samples all zero (pure) + `--strict`; the same without `--strict` | resolve | strict → error naming `blur_when[0]`; non-strict → warning, and processing continues |
| X8 | redaction: ffmpeg failure | fault-injection (abort) | L1-py | automated | injected runner returning exit 1 after creating `<out>.partial` | redact | no file at `<out>` or `<out>.partial`; exit ≠ 0 |
| X9 | redaction: Shell-safety | EP | L1-py | automated | input path `a;touch PWNED $(id).mp4` (injected runner records argv) | redact `--dry-run` and a real run via the injected runner | the argv list contains the path as one literal element; no `shell=True`; no `PWNED` file created |
| X10 | redaction: Dry run writes nothing | EP | L1-py | automated | a valid spec | `--dry-run` | stdout has the windows and the graph; the output path does not exist |

---

## Coverage summary

- Requirements covered: 26/26
  - music-analysis 8/8, music-edit 4/4, beat-sync 4/4, hyperframes-showreel 5/5, footage-redaction 5/5.
  - hyperframes-showreel is covered by skill-text invariants only: guidance, no code.
- Scenarios by class: edge 37 · perf 0 · frontend 2 · error 10
- Scenarios by level: L1 12 · L1-py 34 · L1-py-deep 1 · manual 2
- Scenarios by disposition: automated 47 · manual-only 2

## New infra needed

- **pytest level (`L1-py`)**: a new `music-pytest` job in `.github/workflows/ci.yml` (uv, Python 3.14, `requirements-core.txt` + pytest), guarded by a repo-lint vitest (E37). No existing CI job runs pytest.
- `packages/music-production/vitest.config.ts` and a root `projects` entry (E36).
