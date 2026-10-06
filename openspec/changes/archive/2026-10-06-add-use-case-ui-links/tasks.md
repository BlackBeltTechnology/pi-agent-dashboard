## 1. Tests first (red)
- [x] 1.1 `links.test.ts`: draft ranks actions by shared refs; empty draft for a ref-less use case
- [x] 1.2 gate refusals: unknown UC/screen/action, step not a BPMN task, no evidence, bad cite, duplicate, empty links without `noUi`, `noUi` with links
- [x] 1.3 gate `--complete`: missing record listed
- [x] 1.4 build-site: merged `screens`/`uiActions`; CRUD use-case column fills from links; refusal on failing record; unchanged without `uc-links/`

## 2. Implementation
- [x] 2.1 `scripts/links.mjs`: `linkDraft`, `readLinks`, `checkLinks`, `mergeLinks`
- [x] 2.2 `diagrams.mjs uc-link-draft`, `check-uc-links [--complete] [--app]`
- [x] 2.3 `site.mjs` merge before CRUD/IFML/flow assembly; catalog step → action list
- [x] 2.4 `render.sh`: **gate step** `check-uc-links --complete --app` before CRUD (stop on fail)

## 3. Prompt + docs
- [x] 3.1 `prompts/uc-linker.md` (+ `agents/rsfr-uc-linker.md`, routing row, wiring test): read draft + BPMN + action records, link per step, loop on `check-uc-links` until exit 0, never edit `use-cases.json`
- [x] 3.2 SKILL.md (both), `references/uc-links.md`, AGENTS.md rows

## 4. Pilot (Plantifier) — gate steps
- [x] 4.1 linker subagents for UC-01..16 (2 at a time); **gate** `check-uc-links --complete --app` exit 0
- [x] 4.2 **gate** re-run `check-crud --complete` (link actions may add data effects to classify)
- [x] 4.3 **gate** `check-size --strict`, `run-pilot.sh` → `PILOT OK`; CRUD use-case columns non-empty for every UC with links
- [x] 4.4 Browser: use-case page links, screen → use cases; no page errors

## Notes

- `--app` dropped from `check-uc-links`: cite evidence is checked by containment in the action's own handler/effect cite ranges, which the UI gate already resolved against the app.
- Steps = tasks, events, sub-processes, call activities (gateways excluded), main + alternate flows.
- Plantifier pilot: 16 records by 4 linker runs (2 at a time); `check-uc-links --complete` PASS, `check-crud --complete` PASS; CRUD use-case columns 16/16 (was 5/16; UC-01 narrowed from "all SCR-order actions" to its linked actions); no `noUi` (UC-10 links the tasks view's auto generation action). Browser: step → action table with ref chips, screen → use cases; no page errors.
- Linker findings: UC-03 flow is in code but unreachable in v2.11.1 (QUIRK-183); UC-04 quantity-rescale confirm raised inside `data.modifyOrder` (no UI action); UC-14 sheet-parameter modal has no screen record (UI model gap); UC-05/06/08 mostly data-layer steps.
