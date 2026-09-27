# DOX — packages/music-production

Files in this package. One row per file. Python skill scripts + pytest; vitest for skill-text invariants.

| File | Purpose |
|------|---------|
| `.gitignore` | Ignores `__pycache__/`, project `.venv*/`. |
| `.pi/skills/beat-sync-video/SKILL.md` | Skill: lock picture to music edit. Root duration = music duration, scene starts from `downbeats_video`, boundary on each confirmed drop. Hits via `pick_hits.py`. Punch recipe table (big 1.12/−48/±36/0.8°/0.6 s, mid 1.07/−28/±18/0.4°/0.45 s, expo.out). HyperFrames adapter: `.cam` inside each sub-composition, `fromTo` + `immediateRender:false`, alternating x, `data-layout-allow-overflow`. Verify: snapshot pair + edge-bleed check. See change: add-music-production-skills. |
| `.pi/skills/beat-sync-video/scripts/pick_hits.py` | `music-edit/1` → `<stem>_hits.json` (`music-hits/1`). Structural = ≥3 dB 30–150 Hz bar jump; `big` within ±1 downbeat of drop conf ≥0.5, snapped. Hook = vocals bar-RMS crossing `--hook-db`. `merge` priority manual>big>hook>mid, `--min-gap` bars, `--density` budget. `deregularize` thins >70 % modal intervals, prefers grid-breaking removals, never manual. Manual hits kept verbatim. Atomic write, default path `_edit.json`→`_hits.json`. See change: add-music-production-skills. |
| `.pi/skills/music-analysis/SKILL.md` | Skill: step-0 uv venvs (core / separate mir), no-rip sourcing + ffmpeg extraction + `volumedetect` gain rule (<−12 dBFS → ~−2 dBFS, note gain), quick vs deep tier, `music-map/1` contract table, CC BY-NC-SA tag warning + `--no-tags` commercial path, model + torch hub cache locations, confirm drop by ear. See change: add-music-production-skills. |
| `.pi/skills/music-analysis/scripts/analyze_mir.py` | Deep tier (`requirements-mir.txt`). beat_this grid replaces `cut_grid`; `rederive_bars` re-derives section/drop bars from times; essentia tempo + 3-profile key vote; Discogs-EffNet `tags` via `ml.fetch_model` (node names from model `.json` schema); demucs `htdemucs_6s` stems, relative `stems.dir`; section levels + classes re-derived on new grid (stem-aware drops when stems). `--map`, `--no-stems`, `--no-tags`, `--device auto`. See change: add-music-production-skills. |
| `.pi/skills/music-analysis/scripts/analyze_music.py` | Quick tier (librosa) → `<stem>_map.json` + `_analysis.png`. `stable_span`/`grid_tempo` (grid-mean BPM × meter), `detect_meter` (3 vs 4 from beat accents), `section_bounds` (energy novelty strongest-first + agglomerative, ≥2 bars apart), `build_sections`, `drop_candidates` (sustained low-band gain /24). <8 downbeats → exit 1 "too short or arrhythmic". `--out-dir`. See change: add-music-production-skills. |
| `.pi/skills/music-edit-to-length/SKILL.md` | Skill: analyse → blocks → score joins → render → click check → preview → listen before lock → `_vN` + rejection reason. Splice rules: fixed drop anchor, enter at section boundary, never across genre/energy boundary. `music-edit/1` contract table. See change: add-music-production-skills. |
| `.pi/skills/music-edit-to-length/scripts/edit_music.py` | Render 1-based `start:end` segments (bar exclusive / `END` / seconds) → `<out>.wav` + `<out>_edit.json`. `parse_segments` (SegmentError names segment, no output), `render` 30 ms equal-power xfade or `--no-xfade`, click check ±20 ms vs source at incoming downbeat (≤1.1×), `trim_tail` (≥1 s < −50 dBFS → 50 ms + fade), `--preview` m4a via argv ffmpeg. Relative `source`/`audio`/`map`. See change: add-music-production-skills. |
| `.pi/skills/music-edit-to-length/scripts/score_joins.py` | Join A→B scoring. Run-up measure: outgoing bars A−1..A vs B's source run-up B−2..B−1 (B..B+1 when B ≤ 2); calibrated on session track (approved joins > rejected). `composite` = 0.4 chroma + 0.4 timbre − 0.02 |jump| − 0.5 groove/drop↔breakdown/build + 0.1 boundary. `BarFeatures` resolves audio via map `source`. `auto_candidates` single-join edits within ½ bar of `--target-duration`, keeping `--anchor-bar`. Table or `--json`. See change: add-music-production-skills. |
| `AGENTS.md` | This file. |
| `README.md` | Package overview: 3 skills, uv venvs, contracts table, no-rip + NC-licence rules, tests. |
| `lib/musiclib.py` | Shared helpers. `require` (exit 2 hint), `load_contract` (schema-major check, `ContractError`), `resolve_rel`/`rel_to`, `write_json_atomic`, `bar_start`/`time_to_bar`/`bar_containing` (1-based), `source_to_video`, `bar_spans`/`bar_levels` (guarded frames, low band floored −60 dBFS), `classify_sections`, argv `run_ffmpeg` (`FFMPEG_TIMEOUT_S` 600 → RuntimeError), `MODEL_TABLE` (sha256 pins) + `fetch_model`/`verify_model` (200 MB cap). Scripts import via `parents[4]/lib`. See change: add-music-production-skills. |
| `package.json` | Manifest `@blackbelt-technology/pi-dashboard-music-production`. `pi.skills` ×3, `pi.tools` ffmpeg + uv (optional). `files` = `.pi/skills/`, `lib/`, `requirements-*.txt`, README, minus AGENTS/pycache. |
| `requirements-core.txt` | Quick-tier pins: librosa, numpy, scipy, soundfile, matplotlib (`==`). |
| `requirements-mir.txt` | Deep-tier pins: core + essentia-tensorflow 2.1b6.dev1438, beat-this 1.1.0, demucs 4.1.0, torch/torchaudio 2.11.* pair. |
| `src/__tests__/files.ts` | Test helpers: `PKG`, `REPO`, `SKILLS`, `walk` (skips caches/venvs), `read`, `skill`. |
| `src/__tests__/no-personal-coupling.test.ts` | #E11: no `/Users/`, client or project names in the new skill trees + `lib/`. |
| `src/__tests__/no-rip.test.ts` | #E10: no stream-ripping tool named under `.pi/` or `lib/`. |
| `src/__tests__/package-wiring.test.ts` | #E36: `pi.skills` SKILL.md present, named scripts exist, `files` allowlist, root vitest project, lockfile importer. |
| `src/__tests__/requirements.test.ts` | #E9: both requirements files at root, `==` pins, `.*` only torch/torchaudio. |
| `src/__tests__/skill-beat-sync.test.ts` | #E26: scene-grid lock + adapter + verification phrases. |
| `src/__tests__/skill-music-analysis.test.ts` | #E12: sources, `volumedetect` gain rule, NC licence + commercial path, cache locations. |
| `src/__tests__/skill-music-edit.test.ts` | #E27: fixed drop anchor, section-boundary entry, no genre boundary, listen before lock, `_vN`. |
| `tests/conftest.py` | pytest fixtures: synthetic click tracks (124 4/4, 120 3/4, 6 s), groove/breakdown/re-entry, repeated block, silence tail; `run` (CLI subprocess), `load_script` (import by path). |
| `tests/test_analysis.py` | E1–E7 quick tier, X1 missing module (shim), X2 sha256 mismatch deletes, X3 size cap. |
| `tests/test_analysis_deep.py` | E8 deep grid replacement; skipped unless essentia/beat_this/demucs importable. |
| `tests/test_edit.py` | E13–E18 join scoring + edit rendering, X4 click check, X5 tail trim, X6 unknown schema major. |
| `tests/test_hits.py` | E19–E25: source→video drops, big-hit threshold, hooks, de-regularize, manual preserved. |
| `vitest.config.ts` | Vitest config: `src/**/__tests__/**/*.test.ts`, node, forks, `PARALLEL_MAX_WORKERS`. |
