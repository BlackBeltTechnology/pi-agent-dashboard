## 1. Tests first (red)
- [ ] 1.1 `variability.test.ts` fixture: 2 customers × 2 variants (one `demo`), fixture profile with `configReads` + `variants`, app reading `cfg.a.b` / `cfg.c`
- [ ] 1.2 draft: code-read paths × variant values, varying + absent flags
- [ ] 1.3 gate refusals: uncited/unread path, path absent without `deadEverywhere`, bad op, unresolved affects, duplicate id; `--complete` lists unassigned varying paths
- [ ] 1.4 evaluation: each op on each variant; customer roll-up (on/off/mixed); env variants flagged
- [ ] 1.5 reachability: action unreachable when its feature is off; findings (dead everywhere, single-customer, constant)
- [ ] 1.6 build-site embed/refusal/null; CSV, findings, feature-model.xml exports

## 2. Implementation
- [ ] 2.1 `scripts/variability.mjs`: `variabilityDraft`, `checkVariability`, `evaluate`, `reachability`, `variabilityData`, exports
- [ ] 2.2 `diagrams.mjs variability-draft`, `check-variability`, `variability <pkg> <outDir>`
- [ ] 2.3 catalog Variability view + customer selector (greys unreachable on screen/IFML/CRUD) + feature chips
- [ ] 2.4 `render.sh`: **gate step** `check-variability --complete --app` (stop on fail), then export to `diagrams/variability-matrix/`

## 3. Prompt + docs
- [ ] 3.1 `prompts/variability-classifier.md` (+ agent def, routing row, wiring test): per top-level key batch, name features from code reads, mark data paths, loop on gate
- [ ] 3.2 SKILL.md (both), `references/variability.md`, AGENTS.md rows

## 4. Pilot (Plantifier) — gate steps
- [ ] 4.0 Plantifier profile (Delta-Dot): `configReads` `CONF\.([\w.]+)`, `variants` (prefix = customer, prez/local/test = env) + profile test
- [ ] 4.1 draft; batches by top-level key (planner, orders, views, phases, layout, calendar, …; db/shifts/strings mostly data)
- [ ] 4.2 **gate** `check-variability --complete --app plantifier-v2.11.1 --adapter <profile>` exit 0; **gate** `generic-skills.test.ts` still green (no app names in the skill)
- [ ] 4.3 **gate** known facts reproduce: `normalization` dead everywhere; calendar off for plb; `orders.add.unique` only protokon/ivanka/audi (from the UI-model findings)
- [ ] 4.4 **gate** `run-pilot.sh` → `PILOT OK`, two runs byte-identical for `variability-matrix/`
- [ ] 4.5 Browser: Variability view, customer selector greys DLG-uorder for plb; no page errors
