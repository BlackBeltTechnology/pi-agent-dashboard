## 1. Tests first

- [x] 1.1 build-site embeds ui screens/forms and alt flows (red)
- [x] 1.2 build-site refuses dangling UI ref, missing form, duplicate id (red)
- [x] 1.3 check-use-cases refuses unknown screen and missing alt flow (red)

## 2. Implementation

- [x] 2.1 lib.mjs: `checkUi`, use-case `screens`/`altFlows` checks
- [x] 2.2 site.mjs: read `ui/`, embed, alt-flow XML + roles
- [x] 2.3 catalog.js/css: Screens tab, screen + form views, alt flows in the switcher, cross-links
- [x] 2.4 SKILL.md, package AGENTS.md

## 3. Verify

- [x] 3.1 eng-disciplines tests green; biome --error-on-warnings clean
- [x] 3.2 Plantifier catalog rebuilt with UI model; browser check of links

## Notes

- 2026-10-05 Plantifier v2.11.1: `ui/screens/SCR-order.json`, `DLG-task-set-done.json`, `ui/forms/FRM-order-line--plb.json` (from the Delta-Dot `ui-extract` pilot); `use-cases.json` UC-01..04 → `SCR-order`, UC-09 → `DLG-task-set-done`, UC-01/UC-09 `altFlows` "from code". Catalog 5.8 MB; browser-checked: merged UC-01+UC-09 (Screens and forms section, 4 flow tabs incl. "from code", 30 shapes rendered), screen page (4 use cases, actions, 12 dialogs), form page (11 fields, flagged condition), BR-244 → UI actions (guard / ref / effect), requirement → UI action.
- `build-site` now also runs `checkUseCases`, so a package failing `check-use-cases` no longer builds (the documented procedure already required it).
