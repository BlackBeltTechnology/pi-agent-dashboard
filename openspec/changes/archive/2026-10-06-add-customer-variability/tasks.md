## 1. Tests first (red)
- [x] 1.0 `ui-extract.test.ts`: `config-reads.mjs` (fixture profile `configReads` + `variantInfo`; comments ignored; no hook → exit 1)
- [x] 1.1 `variability.test.ts` fixture: 2 customers, 3 variants (one `demo`), `_config-reads.json`, app reading `cfg.*`
- [x] 1.2 draft: code-read paths × variant values, varying + absent flags
- [x] 1.3 gate refusals: uncited/unread path, path absent without `deadEverywhere`, bad op, unresolved affects, duplicate id; `--complete` lists unassigned varying paths
- [x] 1.4 evaluation: each op on each variant; customer roll-up (on/off/mixed); env variants flagged
- [x] 1.5 reachability: action unreachable when its feature is off; findings (dead everywhere, single-customer, constant)
- [x] 1.6 build-site embed/refusal/null; CSV, findings, feature-model.xml exports

## 2. Implementation
- [x] 2.1 `scripts/variability.mjs`: `variabilityDraft`, `checkVariability`, `evaluate`, `reachability`, `variabilityData`, exports
- [x] 2.2 `diagrams.mjs variability-draft`, `check-variability`, `variability <pkg> <outDir>`
- [x] 2.3 catalog Variability view + customer selector (greys unreachable on screen/IFML/CRUD) + feature chips
- [x] 2.4 `render.sh`: **gate step** `check-variability --complete --app` (stop on fail), then export to `diagrams/variability-matrix/`

## 3. Prompt + docs
- [x] 3.1 `prompts/variability-classifier.md` (+ agent def, routing row, wiring test): per top-level key batch, name features from code reads, mark data paths, loop on gate
- [x] 3.2 SKILL.md (both), `references/variability.md`, AGENTS.md rows

## 4. Pilot (Plantifier) — gate steps
- [x] 4.0 Plantifier profile (Delta-Dot): `configReads` `\bCONF((?:\.\w+)+)`, `variantInfo` (dir = customer; prez = demo, local/test/mobile… = env) + profile test
- [x] 4.1 draft; batches by top-level key (planner, orders, views, phases, layout, calendar, …; db/shifts/strings mostly data)
- [x] 4.2 **gate** `check-variability <pkg> plantifier-v2.11.1 --complete` exit 0; **gate** `generic-skills.test.ts` still green (no app names in the skill)
- [x] 4.3 **gate** known facts reproduce: `normalization` dead everywhere; calendar off for plb; `orders.add.unique` only protokon/ivanka/audi (from the UI-model findings)
- [x] 4.4 **gate** `run-pilot.sh` → `PILOT OK`, two runs byte-identical for `variability-matrix/`
- [x] 4.5 Browser: Variability view, customer selector greys DLG-uorder for plb; no page errors

## Notes

- Extraction split from assembly: `config-reads.mjs` (reverse-spec, needs the adapter) writes `ui/_config-reads.json`; diagrams side needs no adapter. `variants` hook became `variantInfo(variantPath)`.
- Gate cite lines read UTF-16 (BOM) sources (found in the pilot: a read site in a UTF-16 file; test first).
- Customer selector greying screens/IFML/CRUD reduced to: customer pages listing unreachable UI and a per-screen feature table with "unreachable for" — same information, less UI state.
- Plantifier: profile `configReads` covers `CONF.a.b` and `_.get(CONF, "a.b")` (the second form found mid-pilot: ERP button config) → 169 read paths, 25 variants (7 customers; audi/ivanka/protokon demo-only). 46 features (3 dead everywhere, 11 single-customer, 10 constant), 45 data paths; `check-variability --complete` PASS; `PILOT OK`; browser: Variability view (customer/variant), plb page (17 unreachable UI), DLG-uorder section; no page errors.
- Corrections found: `planner.normalization` is true in the ctc demo config (BR-311 says the only declaration is false); PLB has `cal_resources` only in non-production variants (calendar off in PLB production still holds); ERP export/import buttons are Granit-only.
