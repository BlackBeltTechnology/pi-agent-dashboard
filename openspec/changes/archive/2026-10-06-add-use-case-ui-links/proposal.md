## Why

Use cases without UI links leave the CRUD matrix, IFML scoping, flow views and (next) usage and
variability columns empty. Pilot app: only UC-01..04 and UC-09 name `screens`; UC-05..16 have
no screen or UI action, although the UI model (39 records, 287 actions) holds them. Linking by
hand drifts; linking by text match over-matches. The UI actions and the use cases already share
requirement refs (BR/QUIRK/GAP), which gives deterministic candidates; an LLM decides, a gate checks.

## What Changes

- `diagrams.mjs uc-link-draft <pkg> <UC-id> <out.json>`: deterministic candidates — actions whose
  guard/effect refs intersect the use case's `refs`/`requirements` (ranked by overlap), plus the
  screens of those actions and of the use case's `entities` (via CRUD records when present).
- Record `diagrams/uc-links/<UC-id>.json`:
  `{useCase, links: [{action: "<SCR>#<ACT>", step, evidence: {refs:[..]} | {cite:"file:line"}}], noUi: reason|null}`,
  written by a linker subagent (`reverse-spec-for-rebuild` `prompts/uc-linker.md`, agent `rsfr-uc-linker`).
- **Gate `check-uc-links <pkg> [--complete]`**:
  - use case, screen and action exist; `step` names a task id of the use case's BPMN (main or alternate flow);
  - evidence: either ≥1 ref shared by the action and the use case, or a cite inside the action's
    handler/effect cites (resolved against the app with `--app`);
  - no duplicate link; `links` empty ⇔ `noUi` reason given (e.g. timer-driven UC-10);
  - `--complete`: a record for every use case.
- Assembly: `build-site` merges `screens ∪ link screens` and `uiActions ∪ link actions`
  (BPMN `ui:` lines keep working); CRUD, IFML and flows use the merged set. Refuses failing records.
- Catalog: use-case page lists linked actions per BPMN step with evidence; screen page lists use cases.

## Capabilities

### Modified Capabilities
- `rebuild-package-diagrams`: use-case UI links (draft, gate, merge, catalog).
- `reverse-spec-for-rebuild`: linker prompt, routing row, UI-phase step.

## Impact

`scripts/links.mjs` (new), `diagrams.mjs`, `site.mjs`, `catalog.js`, `render.sh`, SKILL.md files,
`agents/rsfr-uc-linker.md`, tests. No dependency. `use-cases.json` is never rewritten; packages
without `diagrams/uc-links/` build unchanged. Rollback: delete the directory.

## Discipline Skills

`doubt-driven-review` (merge semantics change CRUD/IFML scoping).
