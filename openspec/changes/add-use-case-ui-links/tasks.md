## 1. Tests first (red)
- [ ] 1.1 `links.test.ts`: draft ranks actions by shared refs; empty draft for a ref-less use case
- [ ] 1.2 gate refusals: unknown UC/screen/action, step not a BPMN task, no evidence, bad cite, duplicate, empty links without `noUi`, `noUi` with links
- [ ] 1.3 gate `--complete`: missing record listed
- [ ] 1.4 build-site: merged `screens`/`uiActions`; CRUD use-case column fills from links; refusal on failing record; unchanged without `uc-links/`

## 2. Implementation
- [ ] 2.1 `scripts/links.mjs`: `linkDraft`, `readLinks`, `checkLinks`, `mergeLinks`
- [ ] 2.2 `diagrams.mjs uc-link-draft`, `check-uc-links [--complete] [--app]`
- [ ] 2.3 `site.mjs` merge before CRUD/IFML/flow assembly; catalog step → action list
- [ ] 2.4 `render.sh`: **gate step** `check-uc-links --complete --app` before CRUD (stop on fail)

## 3. Prompt + docs
- [ ] 3.1 `prompts/uc-linker.md` (+ `agents/rsfr-uc-linker.md`, routing row, wiring test): read draft + BPMN + action records, link per step, loop on `check-uc-links` until exit 0, never edit `use-cases.json`
- [ ] 3.2 SKILL.md (both), `references/uc-links.md`, AGENTS.md rows

## 4. Pilot (Plantifier) — gate steps
- [ ] 4.1 linker subagents for UC-01..16 (2 at a time); **gate** `check-uc-links --complete --app` exit 0
- [ ] 4.2 **gate** re-run `check-crud --complete` (link actions may add data effects to classify)
- [ ] 4.3 **gate** `check-size --strict`, `run-pilot.sh` → `PILOT OK`; CRUD use-case columns non-empty for every UC with links
- [ ] 4.4 Browser: use-case page links, screen → use cases; no page errors
