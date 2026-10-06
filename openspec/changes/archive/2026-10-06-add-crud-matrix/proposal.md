## Why

A rebuild team needs to see, per entity, who creates, reads, updates and deletes it. Empty rows
point at dead data or data written outside the UI (ERP import), a create without a delete or a
write without a read point at gaps; the matrix also scopes migration and test data. The UI model
holds the evidence (`write`/`read`/`export`/`call` effects with cites) but only as prose targets, which a
text matcher maps ambiguously (Plantifier: 49 of 54 writes match, 20 of them more than two entities).

## What Changes

- `diagrams.mjs crud-draft <pkg> <SCR-id> <out.json>`: deterministic draft listing every
  `write`/`read`/`export`/`call` effect of a screen with entity candidates from an alias index built
  from `model.md` (entity name, plural, collection and table names, `CONF.db.tables` keys in
  `Persistence`).
- Records `diagrams/crud/<screen>.json`: `entries [{effect: "<ACT-id>#<n>", entity, op: C|R|U|D, note}]`
  and `unmapped [{effect, reason}]`, written by one classifier subagent per screen batch
  (`reverse-spec-for-rebuild` `prompts/crud-classifier.md`).
- Gate `check-crud <pkg> [--complete]`: screen, action and effect index exist; entity exists in
  `model.md`; op is C/R/U/D; no duplicate entry; every `write`/`read`/`export`/`call` effect of the
  screen is classified or unmapped; `--complete`: every screen with such effects has a record.
- Assembly (`build-site`, `crud <pkg> <outDir>`): entity × use case matrix (actions via the use
  case's UI actions, else its screens), entity × screen matrix, findings for persistent entities
  (never written, never read, created but never deleted, untouched by the UI); exports
  `crud.csv`, `crud-screens.csv`, `crud-findings.md`. `build-site` refuses failing records.
- Catalog: CRUD header button (matrix, toggle use cases / screens, findings), CRUD section on
  entity and use-case pages. `render.sh` gates and exports when `diagrams/crud/` exists.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `rebuild-package-diagrams`: CRUD matrix (draft, gate, assembly, catalog, export).
- `reverse-spec-for-rebuild`: CRUD classifier prompt and phase step.

## Impact

- New `scripts/crud.mjs`; `diagrams.mjs`, `site.mjs`, `templates/catalog.{js,css}`, `render.sh`,
  SKILL.md files, a reference, tests. No dependency. Packages without `diagrams/crud/` build
  unchanged. Rollback = revert.

## Discipline Skills

- `review-code` — inline review.
