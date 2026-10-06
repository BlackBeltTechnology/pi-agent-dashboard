## 1. Gate first (red)
- [x] 1.1 `generic-skills.test.ts`: forbidden app/customer names + app conventions outside `adapters/`/`assets/`; `ng-` in non-adapter scripts; app file paths in built-in adapters — fails today

## 2. Adapter contract (tests first)
- [x] 2.1 loader: `parent` merge (dialect key-wise), helpers incl. `parseLiteralAt`, `encoding` → legacy decode
- [x] 2.2 `screen-plan.mjs` dialect hooks; plain-HTML default; optional `shell` (+`toolbarId`); `language`; dialog/view classes
- [x] 2.3 built-in `angularjs.mjs` (routes from `$routeProvider`/ui-router, ng-* patterns, dialect); unit tests use a neutral fixture profile extending it
- [x] 2.4 remove `angularjs-hta.mjs`; profile-specific tests leave the package
- [x] 2.5 `forms.mjs` label language from adapter

## 3. Diagrams side
- [x] 3.1 `crud.mjs` generic aliases (test)
- [x] 3.2 `objects-from-db` job `encoding` + BOM (test)

## 4. Neutral docs
- [x] 4.1 prompts, references, SKILL.md (adapter profile + dialect contract), tests' fixture names; AGENTS rows

## 5. Pilot — gate steps
- [x] 5.1 Plantifier profile in the pilot project (`parent: "angularjs"`), its own `node --test` (statics, never executes app code)
- [x] 5.2 **gate** `generic-skills.test.ts` green; full suite + biome clean
- [x] 5.3 **gate** pilot `PILOT OK` and the 177 baseline files byte-identical

## Notes

- Profile key is `parent` (not `extends`: reserved word, a profile could not `export const extends`).
- Added during implementation (test first): trigger-kind vocabulary gate (`lib.mjs` `TRIGGER_KINDS`, `gate.mjs`), since kinds carried framework/app names (`ng-click`, `v-click`, `opbar`). Pilot records migrated by a deterministic script in the pilot project (122 kinds, 23 records).
- CRUD alias rule: segments of dotted identifiers minus config stop words (the "last segment" wording of the first draft would miss `cfg.tables.orders.name`).
- Pilot gates: before the vocabulary migration all 177 baseline files byte-identical except `_inventory.json` `adapter` id; after it, differences only in renamed kinds (IFML part ids, legend "where", 23 records; `SCR-views` change groups merged), control/unlinked counts identical, 44 parts / 8 areas, 0 over budget; re-run byte-identical.
- Not changed: `lib.mjs` `PERSISTENT_RE` tolerates the misspelling `colection` (typo tolerance, not an app convention).
