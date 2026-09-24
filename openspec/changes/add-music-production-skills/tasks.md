## 1. Package scaffold and repo wiring

- [ ] 1.1 Create `packages/music-production/` with `package.json`. Required fields: name `@blackbelt-technology/pi-dashboard-music-production`, `type: module`, `license: MIT`, `repository.directory`, `publishConfig.access: public`, `keywords` incl. `pi-package`/`pi-skill`, `pi.skills` ×3, `pi.tools` ffmpeg + uv (optional), `files` = `.pi/skills/`, `lib/`, `requirements-*.txt`, `README.md`, `!**/AGENTS.md`, `!**/*.AGENTS.md`, `!**/__pycache__`, `scripts.test = vitest run`. Verify: `publish-tarball-hygiene.test.ts` passes.
- [ ] 1.2 Add `packages/music-production/vitest.config.ts` (include `src/**/__tests__/**/*.test.ts`, node env, forks, `PARALLEL_MAX_WORKERS`; copy from `packages/video-production/vitest.config.ts`) and add `packages/music-production` to root `vitest.config.ts` `projects`. Verify: `npx vitest run --project packages/music-production` collects tests.
- [ ] 1.3 Add `@blackbelt-technology/pi-dashboard-music-production` to the `.github/workflows/publish.yml` `PACKAGES` array. Verify: `publish-allowlist-complete.test.ts` passes.
- [ ] 1.4 Run `pnpm install` to add the `packages/music-production` importer to `pnpm-lock.yaml`. Verify: `pnpm install --frozen-lockfile` succeeds.
- [ ] 1.5 Add a `music-pytest` job to `.github/workflows/ci.yml` (ubuntu-latest, `astral-sh/setup-uv`, `uv venv -p 3.14`, `uv pip install -r packages/music-production/requirements-core.txt pytest`, `pytest packages/music-production/tests packages/video-production/tests/redaction`). Verify: `actionlint` or YAML parse is clean, and test 2.4 passes.
- [ ] 1.6 Create `requirements-core.txt` and `requirements-mir.txt` at the package root, with exact pins taken from `uv pip freeze` of the working BD showreel `.venv` / `.venv-mir` (librosa, numpy, scipy, soundfile, matplotlib | essentia-tensorflow==2.1b6.dev1438, beat-this==1.1.0, demucs==4.1.0, torch==2.11.*, torchaudio==2.11.*). Verify: test 2.1 passes.

## 2. Skill-text and repo invariants (vitest, write first; they fail until sections 4–8 land)

- [ ] 2.1 Author `packages/music-production/src/__tests__/requirements.test.ts` (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: both requirements files. Trigger: parse the lines. Observable: every non-comment line uses `==`, `.*` appears only on torch/torchaudio, and both files sit at the package root. (test-plan #E9)
- [ ] 2.2 Author `packages/music-production/src/__tests__/no-rip.test.ts` (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: all files under the package `.pi/**` and `lib/**`. Trigger: case-insensitive grep `spotdl|yt-dlp|youtube-dl|savefrom|spotify-dl|ytmp3`. Observable: 0 matches. (test-plan #E10)
- [ ] 2.3 Author `packages/music-production/src/__tests__/no-personal-coupling.test.ts` (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: music-production `.pi/**` + `lib/**` and video-production `.pi/skills/{hyperframes-showreel,footage-redaction}/**`. Trigger: case-insensitive grep `/Users/|Projektek|railcargo|becton|blackbelt\.hu`. Observable: 0 matches. (test-plan #E11)
- [ ] 2.4 Author `packages/shared/src/__tests__/ci-music-pytest.test.ts` (exemplar `packages/shared/src/__tests__/ci-vitest-report-artifact.test.ts`). Input: `.github/workflows/ci.yml`. Trigger: read the jobs. Observable: a `music-pytest` job exists, installs `requirements-core.txt` via uv, runs pytest on both suite paths, and never installs `requirements-mir.txt`. (test-plan #E37)
- [ ] 2.5 Author `packages/music-production/src/__tests__/package-wiring.test.ts` (exemplar `packages/shared/src/__tests__/publish-allowlist-complete.test.ts`). Input: package.json, root vitest config, pnpm-lock.yaml. Trigger: read them. Observable: each `pi.skills` dir has a SKILL.md, every `scripts/*.py` named in a SKILL.md exists, `projects` includes `packages/music-production`, and the lockfile has the importer. (test-plan #E36)
- [ ] 2.6 Author `packages/music-production/src/__tests__/skill-music-analysis.test.ts` (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: music-analysis SKILL.md. Trigger: read it. Observable: it contains the acceptable-sources list, `volumedetect`, the −12 dBFS → ~−2 dBFS gain rule plus the note-the-gain rule, the CC BY-NC-SA warning with a quick-tier commercial path, and the third-party weight cache locations. (test-plan #E12)
- [ ] 2.7 Author `packages/music-production/src/__tests__/skill-music-edit.test.ts` (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: music-edit-to-length SKILL.md. Trigger: read it. Observable: it contains the fixed-drop anchor, section-boundary entry, the no-genre-boundary rule, listen-before-lock, and the `_vN` rejection-note rule. (test-plan #E27)
- [ ] 2.8 Author `packages/music-production/src/__tests__/skill-beat-sync.test.ts` (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: beat-sync-video SKILL.md. Trigger: read it. Observable: it contains root duration = music duration, `downbeats_video`, the drop-aligned boundary, the `.cam` inside-sub-composition rule, `immediateRender:false`, `data-layout-allow-overflow`, snapshot-pair verification and the edge-bleed check. (test-plan #E26)
- [ ] 2.9 Author `packages/video-production/src/__tests__/skill-hyperframes-showreel.test.ts` (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: hyperframes-showreel SKILL.md. Trigger: read it. Observable: pipeline steps 1–11 in order; step 3 names `footage-redaction`; step 8 names both music skills and requires regeneration. (test-plan #E28)
- [ ] 2.10 In the same file, add the pitfalls/scope test (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: hyperframes-showreel SKILL.md. Trigger: read it. Observable: it contains the footage-only rule, the screen-blend FX rule, pitfalls (a)–(e), copy-only project scope with global removal gated on explicit confirmation, and the music-production co-install fallback. (test-plan #E29)
- [ ] 2.11 In the same file, add the QA-gate test (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: the hyperframes-showreel skill dir. Trigger: read it. Observable: ffprobe, `loudnorm` and frame-strip commands with criteria (±0.1 s, −14 LUFS note); `references/generator-pattern.md` exists and is linked. (test-plan #E30)
- [ ] 2.12 Author `packages/video-production/src/__tests__/skill-footage-redaction.test.ts` (exemplar `packages/apple-tools/src/__tests__/skill.test.ts`). Input: footage-redaction SKILL.md. Trigger: read it. Observable: it contains the contact-sheet command and the OCR-insufficient warning. (test-plan #E35)

## 3. Shared library

- [ ] 3.1 Implement `packages/music-production/lib/musiclib.py`:
  - audio load;
  - contract load/validate with schema-major check;
  - 1-based bar↔time;
  - source→video mapping via `segments` (drop outside segments);
  - relative-path resolve;
  - atomic JSON write (temp + rename);
  - argv-only ffmpeg runner (injectable);
  - missing-module hint (exit 2);
  - sha256-pinned, size-capped model fetch with an injectable table and fetcher.

  Verify: tests 4.x–6.x import it without error.

## 4. music-analysis (pytest first, then implementation)

- [ ] 4.1 Author `packages/music-production/tests/conftest.py` with synthetic fixtures (numpy + soundfile): click tracks at 124 BPM 4/4 and 120 BPM 3/4, a groove/breakdown/re-entry track, a repeated-block track, a trailing-silence track, and a short 6 s track. Verify: `pytest --collect-only` lists the fixtures.
- [ ] 4.2 Author a quick-map test in `tests/test_analysis.py` (exemplar `packages/document-converter/engine/tests/test_convert_pdf_output.py`). Input: 60 s 124 BPM click wav. Trigger: run quick analysis. Observable: all `music-map/1` fields present, including relative `source`; `tempo.bpm` ∈ [123, 125]; downbeat intervals 1.935 ± 0.030 s; ≤ 3 decimals. (test-plan #E1)
- [ ] 4.3 Author an `--out-dir` test (same exemplar). Input: the same fixture with `--out-dir tmp/x`. Trigger: run. Observable: map and png land in `tmp/x`, and `source` resolves back to the input. (test-plan #E2)
- [ ] 4.4 Author a stable-span test (same exemplar). Input: a grid whose first 4 bars drift 8 %, plus an injected `methods.x` of +2 BPM. Trigger: compute tempo. Observable: `stable_span.start_bar` = 5, `bpm` = grid-mean over the span, and +2 appears only under `methods`. (test-plan #E3)
- [ ] 4.5 Author a meter test (same exemplar). Input: 120 BPM 3/4 click. Trigger: run quick analysis. Observable: `cut_grid.meter` = 3 and `bpm` ∈ [119, 121]. (test-plan #E4)
- [ ] 4.6 Author a 1-based-bars test (same exemplar). Input: click fixture. Trigger: run. Observable: `sections[0].start_bar` = 1, and every section's `downbeats[start_bar-1]` is within 1 beat of `start`. (test-plan #E5)
- [ ] 4.7 Author a drops test (same exemplar). Input: groove, then noise-swell breakdown, then kick+bass re-entry. Trigger: run quick analysis. Observable: `drops[0].bar` = the re-entry bar, the breakdown start has confidence < 0.5, and every `class` is in the enum. (test-plan #E6)
- [ ] 4.8 Author a too-short test (same exemplar). Input: 6 s click (3 downbeats). Trigger: run. Observable: exit ≠ 0, stderr "too short or arrhythmic", no map. (test-plan #E7)
- [ ] 4.9 Author a deep grid-replacement test in `tests/test_analysis_deep.py`, `skipif` essentia/beat_this missing (same exemplar). Input: a quick map, then a deep run. Trigger: deep run. Observable: `cut_grid.source` = beat_this, bar fields re-derived (1-beat rule), `stems.dir` relative. (test-plan #E8)
- [ ] 4.10 Author a missing-dependency test (same exemplar). Input: subprocess with librosa shimmed unimportable. Trigger: run quick analysis. Observable: exit 2 and one stderr line naming `librosa` + `requirements-core.txt`. (test-plan #X1)
- [ ] 4.11 Author a model-verification test (same exemplar). Input: cached file whose bytes ≠ the injected sha256, fetcher mocked. Trigger: verify. Observable: file deleted, error names the model, no network. (test-plan #X2)
- [ ] 4.12 Author a size-cap test (same exemplar). Input: mocked stream of 200 MB + 1 byte. Trigger: fetch. Observable: aborted, no file left, non-zero. (test-plan #X3)
- [ ] 4.13 Implement `.pi/skills/music-analysis/scripts/analyze_music.py` (quick tier, generalized from the BD `analyze_music.py`): `--out-dir`, grid-mean tempo with meter and stable span, 1-based sections with `class`, drop confidence rule (design D5), relative paths, too-short guard. Verify: 4.2–4.8 and 4.10 pass.
- [ ] 4.14 Implement `.pi/skills/music-analysis/scripts/analyze_mir.py` (deep tier, generalized from the BD `analyze_mir.py`): `--map`, beat_this grid replacement with bar re-derivation, 3-profile key vote, Discogs-EffNet heads via the cache + sha256 table (node names from the `.json` schema), demucs stems with relative `dir`. Verify: 4.9, 4.11 and 4.12 pass (4.9 locally with `.venv-mir`).
- [ ] 4.15 Write `.pi/skills/music-analysis/SKILL.md` (frontmatter: quoted description with triggers). Contents: step-0 uv venv setup, quick vs deep tier, map contract summary, no-rip sourcing + ffmpeg extraction + `volumedetect`/gain rule, NC-licence warning, third-party caches, confirm-drop-by-ear. Verify: 2.2, 2.3 and 2.6 pass, and the skill-frontmatter guard passes.

## 5. music-edit-to-length (pytest first, then implementation)

- [ ] 5.1 Author a repeated-block join test in `tests/test_edit.py` (exemplar `packages/document-converter/engine/tests/test_convert_pdf_output.py`). Input: A×2 then B. Trigger: score the loop-back join and the join into B. Observable: chroma and timbre ≥ 0.98, loop-back score > B-join score. (test-plan #E13)
- [ ] 5.2 Author a class-change decision-table test (same exemplar). Input: joins groove→breakdown, groove→groove, drop→build, breakdown→breakdown with equal similarities. Trigger: score. Observable: `class_change` and lower scores exactly for groove→breakdown and drop→build. (test-plan #E14)
- [ ] 5.3 Author a map-`source` resolution test (same exemplar). Input: map with relative `source`, cwd elsewhere. Trigger: score_joins with no audio argument. Observable: runs, and the audio is resolved relative to the map. (test-plan #E15)
- [ ] 5.4 Author an output-length test (same exemplar). Input: 124 BPM fixture with segments `1:9 17:25`. Trigger: edit. Observable: duration 16 × 1.935 ± 0.040 s, 16 `downbeats_video` from 0.0, `segments[1].video_at` = 8 bars, and `audio`/`source`/`map` resolve. (test-plan #E16)
- [ ] 5.5 Author a segment-validation test (same exemplar). Input: `5:5`, `9:3`, `1:999`, `0:4`, `1:END`, `1:12.500`. Trigger: edit. Observable: the first four exit ≠ 0 naming the segment with no output; END and seconds forms are accepted. (test-plan #E17)
- [ ] 5.6 Author a `--preview` test, `skipif` ffmpeg missing (same exemplar). Input: a valid edit. Trigger: `--preview`. Observable: `.m4a` exists, aac, duration within 50 ms. (test-plan #E18)
- [ ] 5.7 Author a click-check test (same exemplar). Input: two sine bars at different phases. Trigger: edit with `--no-xfade`, then with a crossfade. Observable: `click_ok` false, then true. (test-plan #X4)
- [ ] 5.8 Author a trailing-silence test (same exemplar). Input: source with a 5 s silent tail, last segment `…:END`. Trigger: edit. Observable: tail after the last sound ≤ 0.1 s, and the last 50 ms envelope is non-increasing. (test-plan #X5)
- [ ] 5.9 Author an unknown-schema test (same exemplar). Input: map with `music-map/2`. Trigger: score_joins, edit and pick_hits. Observable: each exits ≠ 0 naming the schema. (test-plan #X6)
- [ ] 5.10 Implement `.pi/skills/music-edit-to-length/scripts/score_joins.py` (design D6 factors and composite, `--candidates auto --target-duration --anchor-bar`, `--json`). Verify: 5.1–5.3 pass. Calibration check: run it on the BD COCIHI map locally and confirm the v1/v2 joins rank below v3 (record the result in the PR description).
- [ ] 5.11 Implement `.pi/skills/music-edit-to-length/scripts/edit_music.py` (generalized from the BD `edit_music.py`): 1-based bars, 30 ms equal-power crossfade and `--no-xfade`, click check, tail trim, `--preview` via the argv ffmpeg runner, `music-edit/1` with relative `audio`/`source`/`map` and `joins[]`. Verify: 5.4–5.9 pass.
- [ ] 5.12 Write `.pi/skills/music-edit-to-length/SKILL.md`: procedure (analyse → identify sections/genre blocks → score joins → render → click check → preview → user listens → iterate with `_vN` + reason), splice rules, contract summary. Verify: 2.7 passes, and the frontmatter guard passes.

## 6. beat-sync-video (pytest first, then implementation)

- [ ] 6.1 Author a source→video mapping test in `tests/test_hits.py` (exemplar `packages/document-converter/engine/tests/test_convert_pdf_output.py`). Input: segment `{music_from 45.480, video_at 36.080}`, drops at 45.480 (conf 0.9) and 70.310 (cut out). Trigger: pick_hits. Observable: a big hit at 36.080 ± 0.02 and nothing from 70.310. (test-plan #E19)
- [ ] 6.2 Author a big-hit BVA test (same exemplar). Input: drops at confidence 0.49 and 0.5, with a candidate 1 downbeat after the 0.5 drop. Trigger: pick_hits. Observable: 0.5 → big, snapped to the drop downbeat; 0.49 → mid. (test-plan #E20)
- [ ] 6.3 Author a no-vocals-stem test (same exemplar). Input: map without `stems`. Trigger: pick_hits. Observable: only structural hits, and stderr says hook detection was skipped. (test-plan #E21)
- [ ] 6.4 Author a hook-entry test (same exemplar). Input: vocals bar RMS crossing −30 dB up at bars 5, 13 and 22. Trigger: pick_hits. Observable: `hook` hits at those video times (subject to min-gap). (test-plan #E22)
- [ ] 6.5 Author a de-regularize test (same exemplar). Input: candidates every 8 bars over 48 bars. Trigger: pick_hits. Observable: the modal interval share is ≤ 70 %. (test-plan #E23)
- [ ] 6.6 Author a degenerate/termination test (same exemplar). Input: (a) 2 hits; (b) 6 manual hits every 8 bars and no other candidates. Trigger: pick_hits. Observable: (a) both kept; (b) terminates with the 6 manual hits unchanged. (test-plan #E24)
- [ ] 6.7 Author a manual-preserved and default-path test (same exemplar). Input: `x_hits.json` with 1 manual hit, and `x_edit.json`. Trigger: re-run without `--out`. Observable: writes `x_hits.json` with the manual hit byte-identical. (test-plan #E25)
- [ ] 6.8 Implement `.pi/skills/beat-sync-video/scripts/pick_hits.py` (design D7: structural + hook candidates, priority merge, min-gap, terminating de-regularization, `recipe{}`, default output path, atomic write). Verify: 6.1–6.7 and 5.9 pass.
- [ ] 6.9 Write `.pi/skills/beat-sync-video/SKILL.md`: scene-grid lock, compress/stretch the pre-drop scene, hits contract, punch recipe table, HyperFrames adapter (`.cam` inside each sub-composition, seek-safe `fromTo` with `immediateRender:false`, alternating x, `data-layout-allow-overflow`), and verification (snapshot pair: scale/dy measurement plus edge-bleed check). Verify: 2.8 passes, and the frontmatter guard passes.

## 7. footage-redaction (video-production; pytest first, then implementation)

- [ ] 7.1 Author a spec-validation test in `packages/video-production/tests/redaction/test_redact.py` (exemplar `packages/document-converter/engine/tests/test_convert_pdf_output.py`). Input: 1920×1080 frame size with the BVA specs (min_ratio 0/0.01/1/1.5, tol −1/0/255/256, rgb `[0,0,256]` and `[1.5,0,0]`, x+w 1920/1921, from = to, speed 0). Trigger: validate. Observable: exactly the valid values are accepted; each invalid one exits ≠ 0 naming its field path. (test-plan #E31)
- [ ] 7.2 Author a coordinate/order test (same exemplar). Input: crop top 100, delogo y 50, trim from 10, blur window at source 12–14 s. Trigger: `--dry-run`. Observable: graph order is trim → delogo → blur → crop → setpts → fps, blur enable is `between(t,2,4)`, and delogo is validated against the uncropped frame. (test-plan #E32)
- [ ] 7.3 Author a window-resolution test (same exemplar). Input: pure detection samples with ratio 1.0 in [2.0, 4.0] at 4 fps, `pad_s` 0.25. Trigger: resolve windows. Observable: a single window [1.75, 4.25] ± 0.25. (test-plan #E33)
- [ ] 7.4 Author a real-encode test, `skipif` ffmpeg/ffprobe missing (same exemplar). Input: lavfi 1920×1080 6 s video with a navy box at 2–4 s. Trigger: redact with crop top 100 / bottom 80 + blur_when. Observable: output is 1920×900, and the target-box variance at 3.0 s is lower than at 1.0 s. (test-plan #E34)
- [ ] 7.5 Author a never-active test (same exemplar). Input: all-zero detection samples, with and without `--strict`. Trigger: resolve. Observable: strict → error naming `blur_when[0]`; otherwise a warning and processing continues. (test-plan #X7)
- [ ] 7.6 Author an ffmpeg-failure test (same exemplar). Input: an injected runner that creates `<out>.partial` then returns 1. Trigger: redact. Observable: no `<out>`, no `.partial`, exit ≠ 0. (test-plan #X8)
- [ ] 7.7 Author a shell-safety test (same exemplar). Input: path `a;touch PWNED $(id).mp4`, with the injected runner recording argv. Trigger: redact, dry-run and run. Observable: the path is one literal argv element, no shell, no `PWNED` file. (test-plan #X9)
- [ ] 7.8 Author a dry-run test (same exemplar). Input: a valid spec. Trigger: `--dry-run`. Observable: windows and graph on stdout, and no output file. (test-plan #X10)
- [ ] 7.9 Implement `packages/video-production/.pi/skills/footage-redaction/scripts/redact.py`: stdlib-only, ffprobe frame size, validation, detection via a single `fps=4,crop` rawvideo pipe parsed in pure Python, window merge, trim/delogo/blur/crop/speed/fps graph, `--crf`, `--dry-run`, `--strict`, `.partial` + rename, injectable argv runner. Verify: 7.1–7.8 pass.
- [ ] 7.10 Write `.pi/skills/footage-redaction/SKILL.md` (spec format, coordinate rule, a per-clip caller loop replacing project clip tables, contact-sheet verification, OCR warning). Verify: 2.12 passes, and the frontmatter guard passes.

## 8. hyperframes-showreel and kit update (video-production)

- [ ] 8.1 Write `packages/video-production/.pi/skills/hyperframes-showreel/SKILL.md` covering:
  - the 11-step pipeline with two-pass generation;
  - the footage-only and screen-blend FX rules;
  - pitfalls (a)–(e);
  - the install model per `add-hyperframes-skills`, plus copy-only project scope with confirmation-gated global removal;
  - the music-production co-install fallback;
  - the export QA gate commands.

  Verify: 2.9–2.11 pass, and the frontmatter guard passes.
- [ ] 8.2 Write `.pi/skills/hyperframes-showreel/references/generator-pattern.md` (shot table → scene sub-composition HTML, root duration = edit duration, scene starts from `_edit.json`, punches from `_hits.json`; no project-bound script). Verify: 2.11 passes.
- [ ] 8.3 Add `hyperframes-showreel` and `footage-redaction` to `packages/video-production/package.json` `pi.skills`, and append the "Veo as FX layer over real footage" section to `.pi/skills/veo-showreel-production-kit/SKILL.md` linking `hyperframes-showreel`. Verify: `pnpm test --project packages/video-production` passes, and the section is appended without editing existing lines (`git diff` shows additions only in that file).

## 9. Docs (DOX rows, README)

- [ ] 9.1 Write `packages/music-production/README.md` (skills, tiers, venv setup, contracts, no-rip, NC licence) and `packages/music-production/AGENTS.md` rows for every file (caveman style, `See change: add-music-production-skills`). Verify: every file in the package has a row.
- [ ] 9.2 Update `packages/video-production/AGENTS.md` rows (new skills, redaction tests) and the README skills list. Verify: rows exist for each new file.
- [ ] 9.3 Update `session-retro/01a0d2c2-4309-768a-9a10-c5d91cbac125.md`'s proposal section to point at this change, or remove the untracked retro if the user prefers. Verify: `git status` shows the intended state.

## 10. Verification

- [ ] 10.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and grep for failures. Verify: 0 failed.
- [ ] 10.2 In a fresh `uv venv -p 3.14` with `requirements-core.txt` + pytest, run `pytest packages/music-production/tests packages/video-production/tests/redaction`. Verify: all pass, with deep tests skipped. Then run the deep tests locally in a `.venv-mir`. Verify: E8 passes.
- [ ] 10.3 Run `openspec validate add-music-production-skills --strict` and `node scripts/check-conventions.mjs`. Verify: both clean.
- [ ] 10.4 Run the `review-code` skill on the full diff and fix blocking findings. Verify: the review loop reaches its stop condition.
- [ ] 10.5 Manual (test-plan: manual-only), post-merge: regenerate the BD showreel punches with `pick_hits.py` plus the HyperFrames adapter, and confirm in Studio that the drop and a mid hit read as hits with no frame-edge bleed. (test-plan #F1)
- [ ] 10.6 Manual (test-plan: manual-only), post-merge: re-cut COCIHI with `score_joins.py` + `edit_music.py --preview`, listen to the `.m4a`, and confirm no audible splice or genre jump compared with the approved v3. (test-plan #F2)
