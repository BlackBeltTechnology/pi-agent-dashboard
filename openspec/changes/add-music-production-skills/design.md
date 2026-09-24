## Context

See proposal.md (Why). The code being generalized is the BD showreel project scripts in `~/Documents/Projektek/Zenit/AMR-BectonDickinson/Videos/showreel/`:

- `music/analyze_music.py`: librosa pass.
- `music/analyze_mir.py`: essentia, beat_this, Discogs-EffNet, demucs.
- `music/edit_music.py`: soundfile/numpy. It uses 0-based downbeat indices labelled as "bars".
- `cut_clips.py`: redaction baked into a project-specific clip table.
- `build_hf.py`: HyperFrames generator. It reads `_edit.json` and `_hits.json` at generation time.

The join scoring, hit picking and click checks existed only as inline bash in the session.

Repo constraints:

- Skill packages register via `package.json` `pi.skills`.
- `.github/workflows/publish.yml` publishes an explicit `PACKAGES=(…)` allowlist, guarded by `packages/shared/src/__tests__/publish-allowlist-complete.test.ts`.
- CI installs with `pnpm install --frozen-lockfile`, so a new workspace needs a `pnpm-lock.yaml` importer.
- Root `vitest.config.ts` collects only the packages listed in `test.projects`. `packages/apple-tools` is a pre-existing unlisted package whose `skill.test.ts` never runs; that is out of scope here, but we must not copy the mistake.
- Python precedent: `packages/document-converter/engine/` with pytest tests excluded from `files`.

Related open changes:

- `add-hyperframes-skills` documents the upstream HyperFrames install into the universal store `~/.agents/skills`, which pi reads, with no project relocation.
- `add-pi-video-gen-export` edits `packages/video-production/{package.json (pi.tools), README.md, AGENTS.md, .pi/skills/veo-showreel-production-kit/SKILL.md}`.

## Goals / Non-Goals

**Goals:**
- Three versioned file contracts (`music-map/1`, `music-edit/1`, `music-hits/1`) that decouple analysis, editing and sync. Each consumer reads only its producer's file plus the files that file references.
- Project-agnostic scripts: CLI arguments only, and paths inside the JSON relative to the JSON file.
- Graceful degradation: every script works with the quick tier alone. Deep-tier fields are optional, and consumers fall back when they are missing.
- Deterministic pytest suites on synthetic fixtures that need only the quick tier. Wired vitest invariant tests for the skill texts.

**Non-Goals:**
- A TypeScript wrapper or bin.
- Auto-installing Python deps.
- CI for the deep-tier pytest (multi-GB deps). It stays local, with `skipif`.
- Renderers other than HyperFrames for the punch adapter. The hits contract itself is renderer-neutral.
- Changing the HyperFrames install model decided in `add-hyperframes-skills`.

## Decisions

### D1 — Package split
`music-analysis`, `music-edit-to-length` and `beat-sync-video` go in the new `packages/music-production`. `hyperframes-showreel` and `footage-redaction` go in `packages/video-production`. The user chose this split. Music analysis is useful beyond showreels, while redaction and HyperFrames are video-pipeline steps that sit next to the Veo kit. `beat-sync-video` lives with the music skills because it consumes their contracts. We rejected one mega-package (it would mix the audio-ML story into the Veo package) and five tiny packages (overhead with no benefit).

**Cross-package skill references.** `hyperframes-showreel` names `music-edit-to-length` and `beat-sync-video`, but no npm dependency is added. A package dependency does not register the other package's skills in pi, so it would be a false edge. Instead, the skill states the co-install (`pi install npm:@blackbelt-technology/pi-dashboard-music-production`). It also degrades gracefully: without those skills, the procedure skips the punch step and uses the music file as-is.

### D2 — Shared library at package root, scripts per skill
Layout:

- `packages/music-production/lib/musiclib.py` holds the shared code: audio load, contract load/validate (`schema` major check), 1-based bar↔time mapping, source↔video time mapping through `_edit.json` segments, and argv-safe ffmpeg invocation.
- Each skill's `scripts/*.py` does `sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "lib"))` (scripts → skill → skills → .pi → package root).
- `requirements-core.txt` and `requirements-mir.txt` sit at the package root.

All three skills ship in one package, so the relative layout is stable in both the monorepo and the tarball. This satisfies the repo's DRY rule; the alternative of duplicating the contract validation across three skills was rejected. The video-production `redact.py` is standalone and **stdlib-only** (plus ffmpeg/ffprobe). Detection parses raw RGB bytes from a small crop at 4 fps in pure Python, so footage-redaction needs no venv.

### D3 — Python environments: user-project venvs via `uv`
Step 0 of each music skill resolves `PKG=<skill-dir>/../../..`. It then creates `<project>/.venv-music` (core tier) with `uv venv -p python3.14 && uv pip install -r $PKG/requirements-core.txt`, and optionally `<project>/.venv-mir` (deep tier, `requirements-mir.txt`). The deep tier gets its own venv so its multi-GB torch/TF runtime and exact pins never touch the core venv; this is what the session did (`.venv` intact, `.venv-mir` added beside it).

Every requirement is pinned exactly to the versions verified on 2026-09-24:

- **Core tier:** librosa, numpy, scipy, soundfile, matplotlib.
- **Deep tier:** `essentia-tensorflow==2.1b6.dev1438`, `beat-this==1.1.0`, `demucs==4.1.0`, `torch==2.11.*` and `torchaudio==2.11.*` as a pair.

Implementation reads the exact versions from the working `.venv`/`.venv-mir` via `uv pip freeze`. The verified platform is Python 3.14 on macOS arm64. Scripts never call pip. A missing module prints a one-line stderr hint that names the requirements file, and the script exits 2.

`pi.tools` in music-production declares `ffmpeg` (optional; used for the `.m4a` preview and for audio extraction) and `uv` (optional).

### D4 — ML model weights: user cache, hash-pinned
Discogs-EffNet embedding and head files (`.pb` + `.json`) are downloaded on the first deep run into `${XDG_CACHE_HOME:-~/.cache}/pi-music-production/models/`. The download list is a fixed table `{url on essentia.upf.edu, sha256}` built into `lib/musiclib.py`. A file is verified before use. A mismatch deletes the file and exits non-zero. A size cap of 200 MB applies per file. Head input and output node names come from each model `.json` `schema`, never hard-coded; hard-coded `model/Placeholder` failed in the session. The models are CC BY-NC-SA 4.0 (MTG). The skill says so and notes that they are fetched, not redistributed. The table covers only the files the skill fetches itself. demucs and beat_this fetch their own weights into their own caches (torch hub / package cache); the skill names those locations but does not pin them (trade-off, see Risks). The tag models are non-commercial (CC BY-NC-SA 4.0). The skill warns about this and points commercial deliverables to the quick tier plus stems, without tags.

### D5 — Contract shapes (versioned)
Every contract carries `"schema": "<name>/1"`, and consumers reject an unknown major version. Times are seconds (float, 3 dp). Bars are **1-based**: bar *n* starts at `cut_grid.downbeats[n-1]`.

**`music-map/1`** (source time)

- `schema`, `source` (the analysed audio, relative to the map), `duration`, `sr`, `beats[]`, `key {label, strength}`, `band_level_db_rel {sub, bass, low_mid, high_mid, air}`.

- `cut_grid {source: "beat_this"|"librosa", meter, downbeats[]}` is the single authoritative grid.
- `tempo.bpm = 60·meter·(k−1)/(t_k−t_1)` over the **stable span**: the longest run of downbeat intervals within ±5 % of their median. `tempo.stable_span {start_bar, end_bar}` records that span. Per-method estimates go under `tempo.methods`, because the beat_this median IBI is quantized to 20 ms (130.4 vs a true 133.0 in the session). `meter` comes from beat_this's downbeat spacing when available; otherwise 4.
- `sections[] {start, end, start_bar, end_bar, rms_db, bass_db, class}` with `class` ∈ `intro|groove|breakdown|build|drop|outro`.
- `drops[] {time, bar, confidence}`. Candidates are section starts with a positive RMS or low-band (30–150 Hz) jump against the preceding 2 bars. Confidence = min(1, max(0, sustained low-band gain over the next 2 bars in dB + drum-stem re-entry dB when stems exist) / 24). A start whose low-band gain is not sustained gets < 0.5. A breakdown start has a high RMS jump but no sustained low-band gain, so it scores low. This is the failure the session hit: max `rms+bass` section jump picked a breakdown.
- `stems {dir (relative to the map file), energy_share{}, bar_rms_db{}}` is optional.
- **Grid replacement.** When the deep tier swaps `cut_grid`, every bar-indexed field (`sections[].start_bar/end_bar`, `drops[].bar`, `stable_span`, per-bar stem arrays) is re-derived from its time value against the new grid. Time-valued fields are kept. Fewer than 8 downbeats → exit non-zero, no map.

**`music-edit/1`** (video time)

- Top-level fields: `schema`, `source` (the source audio path relative to this file), `audio` (the edited wav, relative), `map` (the source map, relative), `bpm`, `meter`, `duration`.
- `segments[] {start_bar, end_bar|end_s, music_from, music_to, video_at}`.
- `joins[] {video_at, source_bar, score, click_ok}`.
- `downbeats_video[]`.

**`music-hits/1`** (video time)

- `schema`, `edit` (relative path).
- `hits[] {t, tier: big|mid, source: structural|hook|manual, why}`.
- `recipe {big, mid}`.

**Source → video mapping.** Map-derived source times (drops, stem bar levels) are converted through `segments`. A source time *s* inside segment *i* maps to `video_at_i + (s − music_from_i)`. Source times that fall outside every segment are dropped. This is implemented once, in `musiclib`.

### D6 — Join scoring, click check, preview
`score_joins.py <map> --from-bar A --to-bar B` (audio resolved via the map's `source`) (or `--candidates auto --target-duration T --anchor-bar D`) computes the outgoing context (bars A−1…A) against the incoming context (bars B…B+1):

- chroma cosine and MFCC 1–13 cosine similarity;
- RMS jump in dB;
- `section_boundary`;
- `class_change {from, to}`.

Composite score = 0.4·chroma + 0.4·timbre − 0.02·|jump dB| − 0.5·[class_change across {groove,drop} ↔ {breakdown,build}] + 0.1·[section_boundary]. The weights are tuned so that the session's v1 and v2 joins rank below the v3 joins on the session track. That is a documented calibration, not a test.

`edit_music.py` renders equal-power 30 ms crossfades (`--no-xfade` is the test seam for a hard butt-join). For the click check, the edit value is the maximum |Δsample| within ±20 ms of the join in the output. The reference value is the same window around **the incoming bar's downbeat** in the source. `click_ok` means edit ≤ 1.1 × reference.

Tail trim: at the first ≥ 1 s run below −50 dBFS after the last segment's final downbeat, cut 50 ms after the run starts, with a 50 ms fade-out.

`--preview` writes `<out>.m4a` via ffmpeg (AAC 256k) for the listening loop.

### D7 — Hit picking is irregular by construction
`pick_hits.py <edit.json>` reads the map through `edit.map` and the edited audio through `edit.audio`. The process:

1. **Structural candidates.** Take the edited-audio downbeats with the largest low-band (30–150 Hz) bar-over-previous-bar jump.
2. **Big hits.** Candidates within 1 downbeat of a mapped `drops[]` entry with confidence ≥ 0.5 become `big`, with `t` snapped to the downbeat nearest the drop; the rest are `mid`.
3. **Hook candidates.** These need a vocals stem: downbeats where the mapped vocals bar-RMS crosses `--hook-db` (default −30 dB) from below.
4. **Merge and space.** Merge the candidates in priority order `manual > big > hook > structural-mid` under `--min-gap` (default 1.5 bars).
5. **De-regularize.** While more than 70 % of the inter-hit intervals equal the modal interval (±1 downbeat) **and** a non-manual hit remains on the modal grid, drop the lowest-priority one (ties go to the smallest low-band jump).

The budget is roughly 1 hit per 7 s (`--density`). With fewer than 3 hits, step 5 is skipped. It stops when regularity ≤ 70 % or no removable hit remains, so it runs at most one step per non-manual hit. Output goes to `--out`, defaulting to the edit path with `_edit.json` → `_hits.json`. Manual hits are read from that existing file and kept verbatim, and the new file is written to a temp path and then renamed.

The recipe defaults are the values approved in the session. They are written into `recipe{}` so adapters never duplicate the constants.

| Tier | Scale | y | x | Rotation | Settle | Easing |
|---|---|---|---|---|---|---|
| big | 1.12 | −48 px | ±36 px | 0.8° | 0.6 s | expo.out |
| mid | 1.07 | −28 px | ±18 px | 0.4° | 0.45 s | expo.out |

### D8 — HyperFrames guidance, not code; install model deferred to `add-hyperframes-skills`
`hyperframes-showreel` follows the install model documented by `add-hyperframes-skills` (`docs/hyperframes.md`): upstream `npx hyperframes skills update` into `~/.agents/skills`, which pi reads.

It adds one **optional** path, used when the user asks for project-only scope, as the user did in the session. After every `init`, `init --skill` or `skills update` (including the router's lazy installs), **copy** the dirs just installed into the user project's `<project>/.pi/skills`. The global store is left untouched by default. It is machine-wide, other projects may use it, and the router re-installs into it lazily anyway (the duplicate-copy risk that `add-hyperframes-skills` D1 names). The skill therefore warns that project and global copies may coexist at different versions. Global removal of just-created dirs and lock entries happens only after the user explicitly confirms (`ask_user`) that no other project uses them; in the session, the user wanted exactly that. This never touches this repo's `.pi/skills`.

The upstream version is unpinned (per `add-hyperframes-skills`). The skill records "last verified 0.8.72 (2026-09-24)" only as a data point.

**Two-pass generation.**

- **Pass 1** (after the edit script): the composition uses provisional scene durations and a temp or no track.
- **Pass 2** (after `music-edit-to-length` and `beat-sync-video`): the generator is re-run with scene starts from `_edit.json` and punches from `_hits.json`. The root duration becomes the edit's `duration`.

This matches the session. The generator itself is documented by `references/generator-pattern.md` and is never shipped as code, because `build_hf.py` was bound to one edit script's shot tables.

### D9 — Redaction: JSON spec → one ffmpeg graph
`redact.py <in> <out> --spec redact.json` (spec fields in footage-redaction-skill spec). It also cuts clips, covering what `cut_clips.py` did per clip: `trim {from,to}`, `speed`, `fps`, and `--crf` (default 16). The caller keeps its own shot table and calls redact.py once per clip.

**Coordinates and order.** Every box is in source-frame pixels, before crop and scale. Every time is on the untrimmed source timeline and is shifted by `trim.from`. The graph order is trim → delogo → blur → crop → setpts(speed) → fps → encode. The session mixed coordinate spaces: WMS blur boxes were post-crop, Z2 delogo was pre-crop. The contract picks one space.

**Validation:**
- every number is finite and ≥ 0;
- `rgb` is three integers from 0 to 255;
- `0 < min_ratio ≤ 1` and `0 ≤ tol ≤ 255`;
- boxes lie inside the frame (probed via ffprobe);
- `from < to`;
- `speed > 0`.

**Detection.** Detect windows are computed with a single ffmpeg pass: `fps=4,crop=<detect box>` decodes to raw RGB (`-f rawvideo -pix_fmt rgb24`), which pure Python reads from a pipe (`bytes` slicing, no numpy). Its cost is O(duration) decode of a small crop; this is accepted, see Risks. If a `blur_when` entry never becomes active, redact.py prints a warning; with `--strict` it exits non-zero instead.

**Output.** Written to `<out>.partial` and renamed on success; on failure the partial file is deleted. ffmpeg always runs via an argv list. `--dry-run` prints the windows and the filter graph and writes nothing. The skill mandates contact-sheet verification, because OCR missed the flashing status-bar URL in the session.

### D10 — Tests and wiring
**pytest** (`packages/music-production/tests/`, `packages/video-production/tests/redaction/`) builds its fixtures in-test:

- a click track at 124 BPM with accented downbeats;
- a fixture with a breakdown followed by a bass+drums re-entry;
- a repeated 4-bar block;
- a trailing-silence tail;
- a `lavfi` video with a navy box between 2 and 4 s.

Deep-tier tests are `skipif` when their modules are not importable. The pytest suites are excluded from npm `files`.

**CI (user decision, 2026-09-24).** A new `music-pytest` job in `.github/workflows/ci.yml` runs on ubuntu-latest:
- `astral-sh/setup-uv`;
- `uv venv -p 3.14`;
- `uv pip install -r packages/music-production/requirements-core.txt pytest`;
- `pytest packages/music-production/tests packages/video-production/tests/redaction`.

The deep tier is never installed there. Redaction tests assert the resolved windows and the filter-graph string (pure). One real-encode test is `skipif` ffmpeg/ffprobe are missing. A repo-lint vitest (`packages/shared/src/__tests__/`, exemplar `ci-vitest-report-artifact.test.ts`) asserts that the job exists and runs both suites.

**vitest.** `packages/music-production/vitest.config.ts` uses `PARALLEL_MAX_WORKERS`, and `packages/music-production` is added to root `vitest.config.ts` `projects`. The tests pin skill-text invariants:

- each `pi.skills` dir has a `SKILL.md`;
- every `scripts/*.py` named in a SKILL.md exists;
- the no-rip grep (`spotdl|yt-dlp|youtube-dl`) finds nothing under the package's `.pi/skills/**`;
- the rule phrases required by the specs are present.

The video-production equivalents go in its existing `src/__tests__/`.

**Invariants (vitest).** Besides the skill-text checks:
- a no-rip grep over the package's `.pi/**` and `lib/**` for `spotdl|yt-dlp|youtube-dl|savefrom|spotify-dl|ytmp3`;
- a personal- and client-coupling grep (`/Users/`, `Projektek`, `railcargo`, `becton`, `blackbelt.hu`) over the new skill trees and `lib/`, per the `authoring-skills` no-personal-coupling rule.

**Repo wiring.** The package is added to `publish.yml` `PACKAGES`, and `pnpm-lock.yaml` is regenerated via `pnpm install`. `package.json` carries `license: MIT`, `repository.directory`, `publishConfig.access: public`, and an explicit `files` allowlist: `.pi/skills/`, `lib/`, `requirements-*.txt`, `README.md`, `!**/AGENTS.md`, `!**/*.AGENTS.md`, `!**/__pycache__`. These are required by `publish-tarball-hygiene.test.ts`. `tests/` and `src/__tests__/` are excluded simply by not being listed.

## Risks / Trade-offs

- [A future Python or torch release breaks the deep stack] → exact pins, the verified platform documented, and a quick tier that is fully functional on its own.
- [Stem-derived section classes are wrong for some genres] → `class` is advisory. The listen-before-lock step is mandatory, and `score_joins` output is explainable per factor.
- [The irregularity rule drops a musically important hit] → `manual` hits are never thinned and survive re-runs.
- [Redaction detection decodes the whole clip (O(duration))] → accepted. It runs offline in batch at 4 fps on a small crop, and `--dry-run` lets the user iterate on the spec without encoding. No latency budget exists, so `performance-optimization` is not triggered.
- [A redaction spec silently never fires] → the no-activity warning, `--strict`, and mandatory contact-sheet verification.
- [Model files tampered with or corrupted] → sha256 pin, size cap, delete on mismatch.
- [demucs and beat_this weights are fetched by those libraries and not hash-pinned] → accepted. They are well-known upstream packages at pinned versions using their own documented caches. The skill names the cache locations.
- [Deep-tier behaviour (beat_this grid, stems, tags, drop confidence with stems) is not tested in CI] → accepted. The deps are multi-GB. The quick tier plus the contract logic is CI-gated, and deep tests run locally with `skipif`.
- [Tag models are non-commercial] → the skill warning, plus a commercial path without tags.
- [Overlap with `add-pi-video-gen-export` on 4 video-production files] → our edits are additive rows or sections; the second change to land rebases. Listed in the proposal Impact.
- [Divergence from `add-hyperframes-skills`] → we defer to its install model and only add the opt-in project-scope procedure.

## Migration Plan

This change is additive. The new package enters the publish allowlist and ships with the next release. The existing BD showreel project scripts are not migrated. Rollback: revert the merge. The only state outside user projects is the model cache, which is safe to delete.
