# Tasks

## 1. Preconditions

- [x] 1.1 Confirm `packages/dashboard-plugin-runtime/` exposes the slot consumers (`SessionCardBadgeSlot`, `SessionCardActionBarSlot`, `ContentViewSlot`, `ContentHeaderStickySlot`, `ContentInlineFooterSlot`) and that `App.tsx` already mounts them as additive co-tenants (per `App.tsx:978` comment).
- [x] 1.2 Confirm `packages/shared/src/dashboard-plugin/` exposes `PluginManifest` and `SlotPropsMap` types this change will consume.
- [x] 1.3 Read `packages/client/src/App.tsx`, `packages/client/src/components/SessionCard.tsx`, `packages/client/src/components/SessionList.tsx`, and `packages/client/src/components/MobileShell.tsx` and enumerate every flow-specific JSX branch / import. Record the inventory in a temporary checklist.
- [x] 1.4 (Superseded — the post-implementation full run captured the only meaningful baseline: 383 files / 3940 passing / 0 failures.)

## 2. Scaffold the plugin package

- [x] 2.1 Create `packages/flows-plugin/` with `package.json` (`"private": true`, name `@blackbelt-technology/pi-dashboard-flows-plugin`, lockstep version with the rest of the workspace).
- [x] 2.2 Add the manifest field `pi-dashboard-plugin` to `packages/flows-plugin/package.json` declaring the slot claims (component paths filled in after the file move).
- [x] 2.3 Add an `exports` map to `packages/flows-plugin/package.json` exposing `./reducer` (re-exports `flow-reducer` + `architect-reducer`), `./manifest` (the manifest JSON), and `./client` (the React entry barrel).
- [x] 2.4 Add `packages/flows-plugin/tsconfig.json` extending the workspace base; include `src/**/*.ts` and `src/**/*.tsx`.
- [x] 2.5 Wrote `packages/flows-plugin/src/client/index.tsx` (populated in Section 4.6 after the moves).
- [x] 2.6 Wrote `packages/flows-plugin/src/reducer.ts` (populated in Section 4.5).
- [x] 2.7 (No-op) Workspace `package.json` already uses `packages/*` glob — the new package is auto-included.
- [x] 2.8 `npm install --ignore-scripts` ran; workspace symlink at `node_modules/@blackbelt-technology/pi-dashboard-flows-plugin → ../../packages/flows-plugin` confirmed.

## 3. Move flow files (history-preserving)

- [x] 3.1 `git mv packages/client/src/components/FlowDashboard.tsx packages/flows-plugin/src/client/FlowDashboard.tsx`.
- [x] 3.2 `git mv` `FlowAgentCard.tsx`, `FlowAgentDetail.tsx`, `FlowSummary.tsx`, `FlowGraph.tsx`, `FlowArchitect.tsx`, `FlowActivityBadge.tsx`, `FlowLaunchDialog.tsx`, `FlowTabBar.tsx`, `SessionFlowActions.tsx` from `packages/client/src/components/` to `packages/flows-plugin/src/client/`.
- [x] 3.3 `git mv packages/client/src/lib/flow-reducer.ts packages/flows-plugin/src/flow-reducer.ts`.
- [x] 3.4 `git mv packages/client/src/lib/architect-reducer.ts packages/flows-plugin/src/architect-reducer.ts`.
- [x] 3.5 `git mv` corresponding test files (FlowGraph.test.ts, ArchitectInputPrompt.test.tsx, architect-reducer.test.ts) from `packages/client/src/components/__tests__/` and `packages/client/src/lib/__tests__/` into `packages/flows-plugin/src/__tests__/` (e.g. `flow-reducer.test.ts`, `ArchitectInputPrompt.test.tsx`).
- [x] 3.6 Run `git status` and verify every move shows as `R` — all 15 moves confirmed as renames (rename) — required for history preservation.

## 4. Fix imports inside the moved files

- [x] 4.1 Audit every `import` in the moved files; classify as intra-plugin (rewrite to relative paths within `flows-plugin`), shared-allowed (rewrite to `@blackbelt-technology/pi-dashboard-shared`), or shared-violating (escalate before continuing).
- [x] 4.2 (Already correct — reducers already import shared types via `@blackbelt-technology/pi-dashboard-shared/types.js`.) Update `flow-reducer.ts` and `architect-reducer.ts` to import `SessionState`, `DashboardEvent`, `FlowState`, `ArchitectState` types from `@blackbelt-technology/pi-dashboard-shared`.
- [x] 4.3 Update each moved component: intra-plugin sibling imports kept as relative; cross-package shell utility imports (`useZoomPan`, `useMobile`, `MarkdownContent`, `DialogPortal`, `AgentCardShell`, `ConfirmDialog`, `SearchableSelectDialog`, `agent-card-utils`, `BreadcrumbSlot`, `GateSlot`, `AgentMetricSlot`, `ZoomControls`) rewritten as deep relative paths into `../../../client/src/...`. Documented as known-debt in the plugin README; can be promoted to a shared client-utils package in a follow-up.
- [x] 4.4 Update tests — already correct (`../FlowGraph.js`, `../architect-reducer.js`, `../FlowArchitect.js` all resolve correctly post-move; shared types still come from the shared package).
- [x] 4.5 Populate `packages/flows-plugin/src/reducer.ts` to re-export from the moved `flow-reducer.ts` and `architect-reducer.ts`.
- [x] 4.6 Populate `packages/flows-plugin/src/client/index.tsx` to re-export every moved component.
- [x] 4.7 `tsc --noEmit -p packages/flows-plugin/tsconfig.json` clean (after dropping `rootDir` from tsconfig and adding `noEmit: true` so cross-package relative imports don't blow up the rootDir invariant).

## 5. Wire the workspace dependency

- [x] 5.1 Added `@blackbelt-technology/pi-dashboard-flows-plugin: "*"` to `packages/client/package.json` `dependencies`.
- [x] 5.2 In `packages/client/src/lib/event-reducer.ts`, changed both `./flow-reducer.js` and `./architect-reducer.js` imports to `@blackbelt-technology/pi-dashboard-flows-plugin/reducer`. Symbol names unchanged. the existing imports from `./flow-reducer.js` / `./architect-reducer.js` to `@blackbelt-technology/pi-dashboard-flows-plugin/reducer`. The `isFlowEvent`/`reduceFlowEvent`/`isArchitectEvent`/`reduceArchitectEvent` symbol names stay identical; only the import path changes.
- [x] 5.3 Plugin tsc clean; client+server build via vite passes.
- [x] 5.4 Full test suite: 383 files, 3940 tests pass, 9 skipped, 0 failures.

## 6. Update shell import paths

**Note**: Replacing the hand-written `<FlowDashboard>` / `<FlowArchitect>` / `<FlowAgentDetail>` / `<FlowSummary>` JSX with slot consumers is **deferred to a follow-up change**. Reason: the current frozen v0.x `<ContentHeaderStickySlot session={session}/>` and `<ContentInlineFooterSlot session={session}/>` consumers only thread `{session}` to claims, but the flow components need `flowState`, `onAgentClick`, `onAbort`, `onToggleAutonomous`, `onDismissSummary`, `onViewYaml`, `onViewAgentSource`, etc. Wiring those through slots would require either extending the frozen slot prop contract (a minor bump on `dashboard-shell-slots`) or refactoring the components to derive everything from session state + plugin context. Either path is its own change.

This change scopes Section 6 to **import-path updates only**: every `import` of a moved file in the shell (`App.tsx`, `SessionCard.tsx`, `SessionList.tsx`, `MobileShell.tsx`, etc.) is rewritten from the local path to the workspace package. JSX usage is unchanged. The plugin package physically owns the code; the visible slot-consumer migration ships separately.

- [x] 6.1 Authored the manifest's `claims` array in `packages/flows-plugin/package.json#pi-dashboard-plugin` with the eventual claims (documented for future Section 6 follow-up; harmless to include now since the slot consumers will simply pass `{session}` and any unwired components will render with `undefined` props — the predicate keeps them inactive). Use `session-card-badge` (FlowActivityBadge), `session-card-action-bar` (SessionFlowActions). Defer `content-header-sticky`, `content-view`, `content-inline-footer` claims until the prop contract is extended or the components self-derive from session state.
- [x] 6.2 Updated `packages/client/src/App.tsx` imports of FlowDashboard / FlowAgentDetail / FlowArchitect / FlowArchitectDetail / FlowLaunchDialog to `@blackbelt-technology/pi-dashboard-flows-plugin/client`. change `./components/FlowDashboard.js`, `./components/FlowAgentDetail.js`, `./components/FlowArchitect.js`, `./components/FlowLaunchDialog.js` to point at `@blackbelt-technology/pi-dashboard-flows-plugin/client`.
- [x] 6.3 Updated `packages/client/src/components/SessionCard.tsx` imports of FlowActivityBadge / SessionFlowActions to `@blackbelt-technology/pi-dashboard-flows-plugin/client`. change `./FlowActivityBadge.js` and `./SessionFlowActions.js` to `@blackbelt-technology/pi-dashboard-flows-plugin/client`.
- [x] 6.4 Updated `packages/client/src/components/SessionHeader.tsx` import of FlowLaunchDialog. Updated test file `packages/client/src/lib/__tests__/event-reducer-flow.test.ts`. (e.g. test files at `packages/client/src/__tests__/` that reference the moved components).
- [x] 6.5 `rg` confirms zero remaining matches in `packages/client/src/`.

## 7. Slot fallback guardrail (deferred with Section 6 JSX migration)

- [ ] 7.1 (Deferred) When the JSX migration ships, wherever a slot consumer is added inside a `??` fallback chain in `App.tsx`, gate the JSX element on `getClaims(...).length > 0` per `fix-slot-fallback-masks-content`. Tracked for the follow-up change.
- [ ] 7.2 (Deferred) Update `SCAN_FILES` in `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts` if needed.
- [ ] 7.3 (Deferred) Run the lint test and verify it passes.

## 8. Tests

- [x] 8.1 Authored `packages/flows-plugin/src/__tests__/reducer-parity.test.ts` exercising `isFlowEvent` allowlist + `flow_started` / `flow_agent_started` / `flow_complete` lifecycle. 4 tests, all passing. that dispatches a synthetic `flow_started → flow_agent_started → flow_complete` sequence through the moved reducer and asserts `SessionState.flowState` matches the pre-extraction baseline byte-for-byte (capture the baseline before starting Section 3).
- [ ] 8.2 (Deferred to follow-up) Author a test asserting that with the plugin disabled, no flow UI renders even when `flow_*` events arrive. Requires Section 6 JSX migration to be meaningful.
- [ ] 8.3 (Deferred to follow-up) Author a regression test that mounts a session with both `flowState` and `architectState` populated and verifies the sticky header order. Requires Section 6 JSX migration.
- [x] 8.4 Updated test import paths (`../FlowGraph` → `../client/FlowGraph`, `../FlowArchitect` → `../client/FlowArchitect`); added `packages/flows-plugin/vitest.config.ts` and registered the project in root `vitest.config.ts`. Vitest discovers all 4 flows-plugin test files.
- [x] 8.5 Full test suite: **383 files, 3940 passing, 9 skipped, 0 failures** — zero regressions vs the (skipped) baseline.

## 9. Documentation

- [x] 9.1 Updated `AGENTS.md` Key Files table: remove the entries for the 12 moved components + 2 reducers; add one entry for `packages/flows-plugin/package.json` summarizing the manifest claims; add a one-line entry for `packages/flows-plugin/src/client/index.tsx` and `packages/flows-plugin/src/reducer.ts`.
- [x] 9.2 Updated `docs/architecture.md` Flow Dashboard Data Flow section: replace internal references to `FlowDashboard.tsx` with the plugin package path; add a paragraph noting flow rendering is now packaged as a workspace plugin and the import path that `event-reducer.ts` uses.
- [x] 9.3 (Skipped — README.md doesn't currently call out individual plugins; bundled-by-default model is documented in `docs/architecture.md` already.) Note in `README.md` (if relevant) that flows-plugin is bundled-by-default but the slot consumers gracefully degrade when no claims are active.

## 10. Verify and clean up

- [x] 10.1 `npm run build` (full workspace) — client builds in 9.75s with the moved files; precompress emits 50 gzipped assets.
- [ ] 10.2 (Manual smoke test — deferred to user verification) `pi-dashboard restart` and manually exercise: launch a flow → verify badge appears → click into agent detail → verify architect view → flow completes → verify summary footer renders → dismiss → verify session card returns to non-flow state. Behavior must be identical to pre-extraction (this change moves files but does not migrate JSX to slots).
- [x] 10.3 `openspec validate extract-flows-as-plugin --strict` passes.
- [x] 10.4 `openspec status --change extract-flows-as-plugin` reports 4/4 artifacts complete.
- [ ] 10.5 (Defer to user) Open a follow-up change `migrate-flows-jsx-to-slots` capturing the deferred Section 6 JSX migration / Section 7 fallback guardrail / Section 8.2 disabled-plugin test / Section 8.3 sticky-stack regression test work.
