## 1. Tests first
- [x] 1.1 `src/__tests__/crud.test.ts`: alias candidates; draft; gate refusals (unknown entity/op/effect, uncovered effect, duplicate, `--complete`); matrix by use case and screen; findings; build-site embedding + refusal; exports. Verify red.

## 2. Implementation
- [x] 2.1 `scripts/crud.mjs`: `aliasIndex`, `crudDraft`, `readCrud`, `checkCrud`, `crudData`, `crudCsv`, `findingsMd`.
- [x] 2.2 `diagrams.mjs` commands `crud-draft`, `check-crud`, `crud`; `site.mjs` embeds `crud`.
- [x] 2.3 `catalog.js`/`.css`: CRUD view, entity + use-case sections. `render.sh` step.
- [x] 2.4 `reverse-spec-for-rebuild/prompts/crud-classifier.md`, SKILL.md step + routing row.

## 3. Docs + pilot
- [x] 3.1 `references/crud-matrix.md`, SKILL.md, AGENTS.md rows.
- [x] 3.2 Pilot app: records for all screens via subagents, `check-crud --complete` passes, browser check.

## Notes

- Pilot: 37 screen records by 7 classifier runs (2 at a time), `check-crud --complete` PASS; 43 entities × 31 screens; findings (never written: ERP-side entities; never read: BatchProcess, ProdOrder; created never deleted: Log; untouched incl. model duplicates and config shapes); config tables without a model entity reported by the classifier. Browser: CRUD view (both toggles), entity + use-case sections, no page errors.
- Found during the pilot (test first): `call` effects write too (`data.createInactivity`) → drafted and gated like write/read/export; topnav class collided with the op badge style → badges renamed `crudop`.
- Pilot also needed 39 UI field keys made IFML-id-safe for the new IFML id gate (3f4e994f3), done by a generator subagent (records are never hand-edited).
- Limit: use cases without `screens` / UI actions have empty matrix columns (Pilot app UC-05..UC-16).
