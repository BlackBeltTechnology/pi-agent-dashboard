## Why

`add-craft-apps-core` makes each ArtCraft Crafting App usable on its own. Real media jobs span several tools: the existing `video-production` (Veo, HyperFrames, footage redaction), `video-transcription` (SRT, speaker-id), `music-production` (analysis, edit-to-length, beat-sync) skills, plus FilmCraft, SoundCraft and EffectCraft. The explore spike proved a headless SoundCraft → EffectCraft → FilmCraft round-trip in ≈3 s, and showed that without explicit step verification a pipeline silently produces wrong output. Agents need workflow skills that chain these pieces with fixed hand-off formats and a verification gate per step.

## What Changes

Four workflow skills shipped by `packages/craft-apps` (Layer 2 over the router + app skills):

- **`craft-video-post`** (W1) — footage/Veo clips → optional `footage-redaction` → FilmCraft assembly (sequence, cuts, alpha overlays on V2+) → captions from `video-transcription` SRT → SoundCraft mix → FilmCraft delivery export. HyperFrames remains the choice for code-driven motion; the router picks; the two combine through alpha renders.
- **`craft-beat-cut`** (W2) — `music-analysis` → `music-edit-to-length` → `beat-sync-video` hits → FilmCraft edits on downbeats → EffectCraft punch-ins → delivery export.
- **`craft-podcast-master`** (W3) — recording → `video-transcription` + `speaker-id` → SoundCraft per-speaker tracks, cleanup, loudness target → bounce; optional chapter markers from the SRT.
- **`craft-motion-titles`** (W4) — names/lines from SRT or speaker-id → EffectCraft template (`.ectemplate` + values) → ProRes 4444 alpha renders → FilmCraft overlay.

Every workflow: a step table with input/output file contract, a `pi-craft verify` gate after each artefact-producing step, project files saved after every step (resumable), and **soft references** to sibling skills (detect whether the sibling package is installed; if not, name it and offer the degraded path).

## Capabilities

### New Capabilities
- `craft-media-workflow-skills`: the four media workflow skills, their step contracts, verification gates, soft-reference behaviour and router integration.

### Modified Capabilities
- None. (`craft-app-skills` router lists workflows via a table row added in this change's skill text; no requirement change. `video-production`, `video-transcription`, `music-production` are referenced, not modified.)

## Impact

- Code: 4 new `SKILL.md` (+ small helper scripts only if a step cannot be expressed with existing CLIs) under `packages/craft-apps/.pi/skills/`; `package.json` `pi.skills`; router skill table rows; skill lint/drift tests extended.
- Depends on: `add-craft-apps-core` (must land first).
- Implementation order (group `artcraft-craft-apps`): 2 of 4 — defines the shared job/verify conventions (`craft-jobs/<slug>/`, `job.json`, hand-off formats) that `add-craft-office-workflows` reuses.
- No runtime code in dashboard server/client; no new npm deps.
- Rollback: remove the skills from `pi.skills`.

## Discipline Skills

- `doubt-driven-review` — choosing FilmCraft vs HyperFrames responsibilities and the hand-off format contract is a cross-package design decision.
- `review-code` — before commit (skill lint + any helper script).
- None of `security-hardening` / `performance-optimization` / `observability-instrumentation` apply: no new external calls, inputs or services beyond what `add-craft-apps-core` and the referenced packages already own.
