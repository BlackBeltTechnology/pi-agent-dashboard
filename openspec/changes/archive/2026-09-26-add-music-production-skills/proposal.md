## Why

The BD ETO showreel session (pi session `01a0d2c2`, 2026-09-24; retro in `session-retro/01a0d2c2-4309-768a-9a10-c5d91cbac125.md`) produced a working pipeline for music analysis, cutting music to length on the beat grid, locking the video to the music's rhythm, and assembling real footage in HyperFrames with Veo used only for FX layers. None of it is reusable yet. It lives as project-specific scripts with hard-coded paths, plus throw-away inline bash (join scoring, hit picking, click checks). The lessons cost several rejected iterations: a trance-boundary splice, a wrong auto-detected drop, root-level transforms that never reached sub-compositions, globally-installed vendor skills, and an OCR miss on a flashing URL. They should be packaged as skills so the next video starts from them.

## What Changes

- **New package `packages/music-production`** (`@blackbelt-technology/pi-dashboard-music-production`): a pi skill package that ships Python scripts and no TypeScript runtime code. It contains three skills:
  - `music-analysis`: analyzes a local audio file and writes `<stem>_map.json` plus `<stem>_analysis.png`. The map holds tempo (multi-method, with the downbeat-mean BPM authoritative), beats and downbeats (beat_this grid preferred, librosa fallback), key (essentia 3-profile vote), band levels, style/instrument/mood tags (Discogs-EffNet), demucs stems with per-bar activity, and bar-snapped sections. It has two tiers: a quick one (librosa, `requirements-core.txt`) and a deep one (`requirements-mir.txt`: essentia-tensorflow, beat-this, demucs, torch/torchaudio pair). Both requirements files are exact-pinned and live at the package root; the stack is verified on Python 3.14 / macOS arm64. The skill documents the no-rip rule: audio must be a local file the user supplies, and nothing is downloaded from Spotify or YouTube.
  - `music-edit-to-length`: cuts music to a target length on the downbeat grid. `score_joins.py` ranks candidate joins by per-bar chroma and timbre similarity, level jump, and section/genre-boundary flags. `edit_music.py` does equal-power crossfade joins and writes `<out>_edit.json` with a video-time downbeat grid. A click check compares the join transient against the original at the same bar, trailing silence is trimmed, and an `.m4a` preview is written for the listening loop. Rules: only enter at section boundaries, never splice across a genre/energy boundary, and keep the drop as the fixed anchor.
  - `beat-sync-video`: locks the scene grid to `_edit.json` downbeats. `pick_hits.py` writes `<stem>_hits.json` with two hit sources: structural hits (the largest 30–150 Hz energy jump on a downbeat, tier `big` for drops) and vocal-hook entries (vocals-stem bar RMS crossing a threshold, tier `mid`). It enforces a minimum spacing and rejects a mechanical every-N-bars grid. The skill documents the camera-punch recipe (per-tier scale/y/x/rotation/settle, alternating direction) and the HyperFrames adapter (`.cam` wrapper inside each sub-composition), verified by snapshot pairs and an edge-bleed check.
- **`packages/video-production` gains two skills**:
  - `hyperframes-showreel`: real footage becomes a HyperFrames showreel. Steps: frame sampling and contact sheets, edit script, clip cutting with baked redaction, a generated composition (never hand-edit generated HTML), Veo as additive screen-blend FX only, `check`/`snapshot`/preview, then music (`music-edit-to-length`) and punches (`beat-sync-video`), `render --quality delivery`, and export QA (ffprobe, loudnorm LUFS/true-peak, frame strip). It follows the HyperFrames install model of `add-hyperframes-skills` and adds an opt-in project-scope relocation procedure. Generation runs in two passes: provisional first, then re-generated on the music grid.
  - `footage-redaction`: `redact.py` takes a JSON redaction spec and applies fixed crops, time-windowed `delogo`, and a conditional blur that is active only while a detected UI region (pixel-colour ratio) is on screen. The skill verifies redaction on contact sheets, because OCR misses transient status-bar text.
- **`veo-showreel-production-kit` SKILL.md** gains a short "Veo as FX layer over real footage" mode that points to `hyperframes-showreel`.
- Repo wiring: `pi.skills` entries, README and AGENTS.md rows, and pytest suites over synthetic audio and video fixtures (excluded from the published `files`, following the `document-converter/engine/tests` precedent).

Non-goals: vendoring HyperFrames skills or code; adding a TypeScript CLI; downloading or ripping audio from any streaming service; music generation (Suno/Lyria stay documented project practice); publishing ML model weights (fetched on first use into a user cache).

## Capabilities

### New Capabilities
- `music-analysis-skill`: the audio-analysis scripts, the `<stem>_map.json` contract, the quick and deep tiers, and the no-rip sourcing rule.
- `music-edit-skill`: join scoring, beat-grid edit rendering, the `_edit.json` contract, click and silence checks, and the splice rules.
- `beat-sync-video-skill`: hit picking, the `_hits.json` contract, scene-grid locking, and the camera-punch recipe with its HyperFrames adapter.
- `hyperframes-showreel-skill`: the end-to-end footage → HyperFrames → export pipeline and the vendor-skill install scope.
- `footage-redaction-skill`: the JSON redaction spec, `redact.py`, and the verification procedure.

### Modified Capabilities
None. The `veo-showreel-production-kit` SKILL.md edit is guidance-only, and no `video-production-*` spec requirement changes.

## Impact

- New: `packages/music-production/` with:
  - package.json (`pi.skills` ×3; `pi.tools` ffmpeg + uv, both optional);
  - README.md, AGENTS.md;
  - `lib/musiclib.py` (shared contract, time-mapping and ffmpeg helpers);
  - `requirements-core.txt` and `requirements-mir.txt` (exact pins);
  - `.pi/skills/{music-analysis,music-edit-to-length,beat-sync-video}/`;
  - `tests/` (pytest) and `src/__tests__/` + `vitest.config.ts` (skill-text invariants).
- New in `packages/video-production`: `.pi/skills/{hyperframes-showreel,footage-redaction}/` and `tests/redaction/` (pytest).
- Modified in `packages/video-production`: `package.json` (`pi.skills` +2), `.pi/skills/veo-showreel-production-kit/SKILL.md` (appended section), `README.md`, `AGENTS.md`, `src/__tests__/` (skill-text invariants).
- Repo wiring:
  - `.github/workflows/publish.yml` `PACKAGES` gains `@blackbelt-technology/pi-dashboard-music-production` (guarded by `publish-allowlist-complete.test.ts`);
  - `pnpm-lock.yaml` importer added (CI uses `--frozen-lockfile`);
  - root `vitest.config.ts` `projects` gains `packages/music-production`;
  - `.github/workflows/ci.yml` gains a `music-pytest` job (quick-tier pytest for music-production plus video-production redaction), guarded by a repo-lint vitest in `packages/shared`.
- **Overlap with `add-pi-video-gen-export`:** both changes touch video-production `package.json` (`pi.skills` here, `pi.tools` there), `README.md`, `AGENTS.md` and the kit `SKILL.md`. All our edits are additive (rows or an appended section). The second change to land rebases.
- **Alignment with `add-hyperframes-skills`:** that change owns the HyperFrames install model (upstream installer → `~/.agents/skills`). `hyperframes-showreel` defers to it and adds only an opt-in project-scope relocation procedure.
- Cross-package skill references: `hyperframes-showreel` names the music skills and documents co-installing music-production. No npm dependency edge is added, because a dependency does not register skills.
- Dependencies: no new npm deps. The user installs Python deps into project venvs via `uv`; scripts never run pip. ML model weights (CC BY-NC-SA, MTG) are fetched, sha256-verified, into a user cache and are not redistributed.
- No persistence or migration. Rollback is a revert; the change is additive.

## Discipline Skills

- `doubt-driven-review`: the `music-map/1`, `music-edit/1` and `music-hits/1` contracts are shared across three skills and user projects. Reviewed during planning, before they stand.
- `security-hardening`:
  - `redact.py` and the `.m4a` preview / audio extraction shell out to ffmpeg with user-supplied paths and JSON specs. Use argv lists only, never a shell; range-validate the redaction spec; write atomically; warn when a redaction never fires.
  - Model downloads use a fixed URL table with sha256 pins and a size cap.
  - The skills must hold the no-rip line.
- `review-code`: before commit, per project doctrine.
- Not triggered:
  - `performance-optimization`: offline batch scripts with no latency budget. Redaction detection is O(duration) at 4 fps on a small crop; this is accepted and documented in design Risks.
  - `observability-instrumentation`: no endpoint, job or service call is added; the model fetch is a one-time cache fill.
