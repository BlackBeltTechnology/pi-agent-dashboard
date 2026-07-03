# DOX — packages/mockup-loop/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `extension.ts` | Pi extension entry `frontendMockupLoop(pi)`. Registers 3 tools: `serve_mockup{dir,port?,stop?}` (node:http static server on 0.0.0.0, returns local+LAN URL, `servers` Map keyed by port), `score_mockup{url,widths?,outDir?}` (dynamic-import playwright chromium, full-page screenshots at widths default [375,768,1440], returns paths + scoring rubric, falls back to install guidance if absent), `init_ui_contract{path?,force?}` (writes `CONTRACT_TEMPLATE` to `ui-contract.md`). Registers `/mockup-loop` command. `session_shutdown` closes all servers. Path-traversal guard in static handler. See change: add-frontend-mockup-loop. Now registers 5 tools: adds `list_design_systems{}` (enumerates registry) + `validate_mockup{system,url?,dir?}` (L1+L2 gates, L3+L4 advisory, returns {gates,advisory,pass}). `init_ui_contract` gains `system?`+`refresh?` (writes DTCG contract from preset snapshot; no system → blank template). `score_mockup` gains `system?` (swaps generic rubric for preset boolean rubric). Imports from src/presets/*. See change: add-selectable-design-systems. |
