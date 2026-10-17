## Why

`add-craft-apps-core` (landed, `openspec/changes/archive/2026-10-14-add-craft-apps-core/`) makes each ArtCraft Crafting App usable on its own. Real media jobs span several tools: the sibling skills `veo-generator`, `hyperframes-showreel`, `footage-redaction` (package `video-production`), `video-transcription`, `speaker-id` (package `video-transcription`), `music-analysis`, `music-edit-to-length`, `beat-sync-video` (package `music-production`), plus FilmCraft, SoundCraft and EffectCraft. The core change's spike proved a headless SoundCraft → EffectCraft → FilmCraft round-trip (bounce ≈ instant, alpha render 0.9 s, assembly + export 1.0 s; `archive/2026-10-14-add-craft-apps-core/design.md:23`) and showed that without explicit step verification a pipeline silently produces wrong output. Agents need workflow skills that chain these pieces with fixed hand-off formats and a verification gate per step.

## What Changes

Four workflow skills shipped by `packages/craft-apps` (Layer 2 over the router + app skills):

- **`craft-video-post`** (W1) — footage/Veo clips → optional `footage-redaction` → FilmCraft assembly (sequence, cuts, alpha overlays on V2+) → captions from a `video-transcription` SRT (FilmCraft `captions.*` track when probe 0.1 confirms it, else EffectCraft-rendered caption overlays) → SoundCraft mix → FilmCraft delivery export. HyperFrames (`hyperframes-showreel`) stays the choice for code-driven motion; when probe 0.5 confirms an alpha render it is overlaid in FilmCraft, otherwise it is placed as a full-frame segment.
- **`craft-beat-cut`** (W2) — `music-analysis` → `music-edit-to-length` → `beat-sync-video` hits (`music-hits/1`) → FilmCraft edits on downbeats → FilmCraft scale-keyframe punch-ins on the hits (probe 0.3; no EffectCraft round trip) → delivery export. Footage-timeline counterpart of `hyperframes-showreel`'s beat-synced composition; the router states the split.
- **`craft-podcast-master`** (W3) — recording → `video-transcription` + `speaker-id` → SoundCraft per-speaker tracks, cleanup, bounce → loudness target (ffmpeg `loudnorm`; SoundCraft only normalises to peak) → `pi-craft verify --loudness`; optional chapter markers from the SRT.
- **`craft-motion-titles`** (W4) — names/lines from SRT or speaker-id → EffectCraft project from a template (`templates.*` / `file.newFromTemplate` / `essential.importTemplate`, exact path fixed by probe 0.4) with values set via `describe`-discovered commands → `render --format prores --prores 4444 --channels rgba` → FilmCraft overlay.

Every workflow: a step table with input/output file contract, a `pi-craft verify` gate after each media-producing step (a documented check for text artefacts such as srt/json), project files saved after every step (resumable via the shared **Craft jobs** convention defined once in the `craft-studio` router), and **soft references** to sibling skills (detect whether the sibling is available; if not, name its package and offer the degraded path).

## Capabilities

### New Capabilities
- `craft-media-workflow-skills`: the four media workflow skills, their step contracts, verification gates, soft-reference behaviour and router integration.

### Modified Capabilities
- `craft-app-skills`: **Router skill** additionally lists the workflow skills and owns the shared Craft jobs convention (`craft-jobs/<slug>/`, `job.json`); **Skills declared in the package manifest** grows from 14 to 18 skills; **One skill per app**, **Recipes are verified** and **Skill drift check** are scoped so workflow skills are linted as workflows (recipes verified, ids checked against the union of driven apps), not as app skills.

## Impact

- Code: 4 new `SKILL.md` under `packages/craft-apps/.pi/skills/` (no helper script: probe 0.3 showed the `music-hits/1` → FilmCraft edit translation is expressible as `jq` recipes); `package.json` `pi.skills` (14 → 18); `craft-studio` router: workflow table + "Craft jobs" section.
- Tests that pin the skill set change: `packages/craft-apps/src/__tests__/helpers/skills.ts` (new `WORKFLOW_SKILL_NAMES`; `SKILL_NAMES` stays router + apps), `packaging.test.ts` (14 → 18 declared / packed), `skills-recipes.test.ts` (workflow recipes behind a separate opt-in); a separate workflow lint set is added to `skills.test.ts`.
- Sibling change `add-craft-office-workflows` now depends on this change (its proposal is updated).
- Depends on: `add-craft-apps-core` (landed).
- Implementation order (group `artcraft-craft-apps`): 2 of 4 — the Craft jobs / verify conventions it puts in the router are what `add-craft-office-workflows` reuses.
- No runtime code in dashboard server/client; no new npm deps.
- Rollback: remove the 4 skills from `pi.skills`, revert the router section and test counts.

## Discipline Skills

- `doubt-driven-review` — choosing FilmCraft vs HyperFrames responsibilities and the hand-off format contract is a cross-package design decision.
- `review-code` — before commit (skill lint + any helper script).
- `security-hardening` / `performance-optimization` / `observability-instrumentation`: not applicable. No new external calls, services or secrets — media/API inputs (Veo, transcription APIs, redaction) stay owned by their sibling packages. New input surfaces are the job slug (mapped to `[a-z0-9-]`, design D4) and `job.json` read back on resume (data only; recorded paths re-validated to sit under `craft-jobs/<slug>/`); input media paths flow into `pi-craft … exec` exactly as in the app skills today.
