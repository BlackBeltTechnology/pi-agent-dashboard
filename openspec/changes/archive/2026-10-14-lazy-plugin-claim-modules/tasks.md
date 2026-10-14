## 0. Baseline

- [x] 0.1 After `shrink-client-entry-lazy-islands` lands: `npm run build`; record entry gz, landing-graph total, and a per-plugin-claim raw-size table (source-map attribution) to drive D5.
  - Baseline (develop @ ca8f2c453, local build): entry `index-*.js` raw 2,373,551 B / gz 690,616 B; landing graph gz 1,135,756 B. Plugin source in entry ≈ 560 KB raw (largest: flows 84, automation 62, blackhole 62, mcp-client 57, system-one 52, kb 48, goal 45; `CreateAutomationDialog` 27, `BlackholeSettings` 18, `ServerEditor` 16, `GoalDetailClaim` 15, `KbSettingsPanel` 14).

## 1. Contract + generator (tests first)

- [x] 1.1 Generator tests (`vite-plugin/__tests__`): claim with `module` emits `lazyClaim(() => import(...), "X")` and no static import of `X`; predicate/shouldRender/labelComponent stay static; `module` changes the registry hash.
- [x] 1.2 Generator tests: missing module file, module lacking the export, and main entry also exporting the component each fail with a message naming plugin/slot/component/module.
- [x] 1.3 `manifest-types.ts`: `module?: string` on `PluginClaim` (doc comment); `manifest-validator.ts` shape check (non-empty relative path).
- [x] 1.4 Implement generator emission + validation (D2, D3).

## 2. Runtime

- [x] 2.1 Tests: `lazyClaim` memoizes per (loader, name); consumer renders fallback then component; rejected load is contained by the claim's error boundary while sibling claims render.
- [x] 2.2 `lazy-claim.tsx` + export from runtime `index.ts`.
- [x] 2.3 `slot-consumers.tsx`: Suspense inside `slot-error-boundary` for every claim render path; per-slot fallback option (null default; skeleton for overlay routes / content views).

## 3. First-party adoption

- [x] 3.1 From the 0.1 table, list the claims to make lazy (D5) in this file.
  - **Lazy (`module`)**: settings-section — apple-tools, automation, blackhole, browser, chat-gateway, context-mode-settings, cost-estimator, flows, flows-anthropic-bridge, goal, grammar, mcp-client, quota, roles, subagents, system-one; shell-overlay-route — AutomationBoard, AutomationRunMonitor, GoalsBoardClaim, GoalDetailClaim, KbSettingsClaim, FolderMcpPage, SubagentPopoutClaim; content-view — blackhole `PipelineDetailView`, flows `FlowYamlPreviewClaim`; content-header-sticky — flows `FlowDashboardClaim` (+FlowGraph/dagre/d3/lodash); editor-pane-tab — browser `BrowserPaneTab`; command-route — cost-estimator `CostView`; automation-action-editor — flows `FlowInputWiringClaim`; tool-renderer — flows `FlowWriteToolRenderer`. Plus plugin-internal `lazy()` of `CreateAutomationDialog` in `FolderAutomationSection`.
  - **Stay eager (D5)**: all `session-card-*` badges/chips/subcards, `composer-*`, `sidebar-folder-section`/`worktree-card-section`, custom-entry-renderers (`OmEntryCard`, `WebSearchEntryCard`), `FlowAgentsToolRenderer` (4.5 KB, chat history), predicates, catalogs. Enforced by `lazy-plugin-claims.test.ts` (hot-slot claims never name a module).
  - **Already lazy, unchanged (thin wrappers over an inline `lazy()`)**: gmail, hermes-memory, skill-atlas — a permanent exemption recorded in `THIN_WRAPPER_PLUGINS` of `lazy-plugin-claims.test.ts`. cost-estimator `CostView` + `CostSettings` share one module (`CostEstimator.tsx`, one file ~300 lines) — accepted trade-off vs per-claim independence.
- [x] 3.2 Per plugin: move each listed component into its own module, add `module` to the claim, remove it from the client barrel; run that plugin's tests.
- [x] 3.3 Flows: `FlowDashboardClaim` (+ `FlowGraph`, dagre/d3/lodash) lazy; confirm `FlowSummary`'s use of `FlowGraph` is also behind a lazy claim or moved.
- [x] 3.4 Ensure no plugin client entry statically imports a moved module (generator check 1.2 covers exports; add a build check for the "dynamic import will not move module" warning naming plugin paths).

## 4. Guard + measure

- [x] 4.1 `mdi-chunk-size.test.ts`: dagre marker absent from the landing graph and present in a lazy chunk.
- [x] 4.2 `npm run build`; entry gz and landing-graph total both drop vs 0.1; lower `INDEX_GZ_CAP_BYTES` to measured rounded up to 10 KiB with a measurement comment.
  - Measured: entry gz 690,616 → 584,020 B (−106,596 B, −15.4%); landing graph gz 1,135,756 → 1,028,118 B (−107,638 B). Cap 690 → 580 KiB. Known follow-up: `yaml` (~98 KB raw) stays in the entry via `FrontmatterProperties` + flows `flow-idle-state.ts`.
- [x] 4.3 Full test suite green (done — only pre-existing env failures, same set on develop); manual QA check on throttled network (manual-only): open Settings › each plugin page, automation board, flow dashboard, a flow-write tool row.

## 5. Docs

- [x] 5.1 `dashboard-plugin-scaffold` skill: document `module`, the "don't also export from the main entry" rule, and the dashboard version floor.
- [x] 5.2 DocScribe: plugin authoring doc section on lazy claims (caveman style), architecture note on the registry split.
- [x] 5.3 AGENTS.md rows for touched runtime/generator/shared files and moved plugin modules — `See change: lazy-plugin-claim-modules`.
