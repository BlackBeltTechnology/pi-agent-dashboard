## Status

**WIP / unfinished commit.** Tasks below are checkboxed where shipped, unchecked where pending. See proposal.md for the gap list.

Phase 1 (inspector core) is mostly DONE; Phase 1 pending: §7 (App.tsx wiring) and §12 (reducer backfill).

Phase 2 (producer adoption: tintinweb removal, settings surface, agentMdPath) is entirely PENDING — see §13–§16.

## 1. Reducer extensions (DONE)

- [x] 1.1 `SubagentTimelineEntry` discriminated union exported from `event-reducer.ts`.
- [x] 1.2 `SubagentState` extended with optional `entries`, `activity`, `displayName`, `modelName`, `subagentType`, `startedAt`.
- [x] 1.3 `readSubagentDetails(details)` helper pulls these from event payloads.
- [x] 1.4 `subagent_*` event handlers read `data.details` via `readSubagentDetails`.
- [x] 1.5 Unit tests in `event-reducer.test.ts` covering: absent entries, present entries, cumulative-replace semantics, startedAt stamping.

## 2. `SubagentDetailView` component (DONE)

- [x] 2.1 Created `SubagentDetailView.tsx`. Props: `session`, `agentId`, `mode` (`inline`/`popout`/`row`).
- [x] 2.2 Tier 1: renders `entries[]` as kind-specific rows (tool/text/thinking/error).
- [x] 2.3 Tier 2: running, no entries — shows activity + counters + footnote.
- [x] 2.4 Tier 3: completed/failed, no entries — shows result/error block.
- [x] 2.5 Tier 4: no useful data — "No detail available yet."
- [x] 2.6 Row mode renders single-line summary used by anyone consuming the component.
- [x] 2.7 Unit tests in `SubagentDetailView.test.tsx`.

## 3. `AgentToolRenderer` modifications (DONE)

- [x] 3.1 Local `expanded` state; expand toggle (`mdiChevronDown`/`mdiChevronUp`) in card header.
- [x] 3.2 Popout button (`mdiOpenInNew`) next to the expand toggle; disabled when `sessionId` or `agentId` is missing.
- [x] 3.3 Expanded body renders `<SubagentDetailView session={…} agentId={…} mode="inline" />` (collapses prompt/result blocks while expanded).
- [x] 3.4 Unit tests in `AgentToolRenderer.test.tsx`.

## 4. `SubagentPopoutPage` component (DONE)

- [x] 4.1 Created `SubagentPopoutPage.tsx`. Props: `sessionId`, `agentId`, `session`, `subscriptionResolved`, `parentLabel`, `onBack`.
- [x] 4.2 Renders loading / parent-not-found / subagent-not-found / detail-view states.
- [x] 4.3 Updates `document.title` to `<displayName> · <parent> · pi`.
- [x] 4.4 Unit tests in `SubagentPopoutPage.test.tsx`.

## 5. `GetSubagentResultRenderer` modification (DONE)

- [x] 5.1 "Show details" affordance rendered when `args.agent_id` + `context.sessionId` resolvable.
- [x] 5.2 Click opens `/session/<sid>/subagent/<aid>` in a new tab.
- [x] 5.3 Affordance hidden when either id is missing.
- [x] 5.4 Unit tests in `GetSubagentResultRenderer.test.tsx`.

## 6. `ToolContext` extensions (DONE)

- [x] 6.1 `ToolContext` gains optional `sessionId?: string` and `session?: SessionState`.

## 7. App.tsx route + toolContext wiring (PENDING)

- [x] 7.1 Register `useRoute("/session/:sessionId/subagent/:agentId")` alongside the existing diff/folder/openspec routes.
- [x] 7.2 Render `<SubagentPopoutPage>` for matched routes in BOTH the desktop layout (~line 1072) and the mobile shell layout (~line 1361).
- [x] 7.3 Add a `useEffect` that subscribes the parent session in the popout case (so a fresh tab can load `/session/<sid>/subagent/<aid>` without needing the parent tab open elsewhere).
- [x] 7.4 Extend the `toolContext: ToolContext` memo to include `sessionId: selectedId` and `session: sessionStates.get(selectedId)`. Renderers now have access to both.
- [x] 7.5 Both render call-sites of the popout route pass `subscriptionResolved` (derived from `status === "connected" && subscribedRef.current.has(sessionId)`) and `parentLabel` (from `sessions.get(sessionId)?.cwd`).

## 8. Cleanup (DONE)

- [x] 8.1 Removed `BackgroundSubagentsPill.tsx`, `BackgroundSubagentsPanel.tsx`, `BackgroundSubagentsPill.test.tsx`.
- [x] 8.2 Reverted `StatusBar.tsx` pill wiring.
- [x] 8.3 Trimmed `AgentToolRenderer.tsx` background status branch.
- [x] 8.4 Removed `background` from `SubagentState.status` union and removed `isBackground` field.
- [x] 8.5 Removed background-related test cases from `event-reducer.test.ts` and `SubagentDetailView.test.tsx`.

## 11. Plugin extraction (DONE)

- [x] 11.1 Created `packages/subagents-plugin/` workspace package with `package.json`, `tsconfig.json`, `pi-dashboard-plugin` manifest (`id: "subagents"`).
- [x] 11.2 `git mv` of `SubagentDetailView.tsx` + `SubagentPopoutPage.tsx` + their tests into `packages/subagents-plugin/src/client/`.
- [x] 11.3 Created `types.ts` (canonical `SubagentTimelineEntry` + `SubagentState`) and `index.tsx` barrel.
- [x] 11.4 Detached plugin from shell components by switching to `useUiPrimitive(markdownContent)` for markdown rendering.
- [x] 11.5 Shell's `event-reducer.ts` re-exports types from the plugin (single canonical source).
- [x] 11.6 Shell's `AgentToolRenderer` imports `SubagentDetailView` from the plugin.
- [x] 11.7 Added workspace dep on the plugin to `packages/client/package.json`.
- [x] 11.8 Updated plugin tests to use `withUiPrimitiveProvider` from `@blackbelt-technology/dashboard-plugin-runtime/test-support`.
- [x] 11.9 Updated `AgentToolRenderer.test.tsx` to wrap renders in `withUiPrimitiveProvider` (since the imported `SubagentDetailView` uses the primitives registry).
- [x] 11.10 Verified vite plugin-loader discovers `subagents` plugin (build output: "discovered 7 plugin(s): …, subagents, …").
- [x] 11.11 All tests pass; `npm run build` clean.

## 9. Validate (DONE for shipped portion)

- [x] 9.1 `npm test` passes for all 5 new test files (146 tests).
- [x] 9.2 `npm run build` clean.
- [x] 9.3 `openspec validate add-subagent-inspector --strict` clean.

## 10. Producer dependency

- [x] 10.1 Documented in proposal.md that `pi-dashboard-subagents` v0.1.x is the producer.
- [x] 10.2 Cross-referenced the scaffold change in the other repo.
- [x] 10.3 → superseded by §14 (Tier-2 fallback removed wholesale, not just the footnote; SubagentDetailView.tsx no longer has the running-no-entries branch).

## 12. Reducer backfill from `tool_execution_end` (PENDING)

Closes the gap where `session.subagents.get(agentId)` is empty after `/resume` or page refresh, even though the producer persisted the full `AgentDetails` inside the parent's `ToolResultMessage.details`. See design.md Decision 7.

- [x] 12.1 In `packages/client/src/lib/event-reducer.ts`, extend the existing `tool_execution_end` handler (around `event-reducer.ts:1105`) with a backfill branch that fires when `data.toolName === "Agent"` AND `(data.details as Record<string, unknown> | undefined)?.agentId` is a non-empty string.
- [x] 12.2 Inside the branch, build a `SubagentState` patch via the existing `readSubagentDetails(details)` helper plus derived fields:
  - `status`: `"failed"` if `data.isError`, else `"completed"`
  - `result`: `data.result` (string) when `!isError`
  - `error`: `data.result` when `isError`, falling back to `data.details.error`
  - `durationMs`: `data.details.durationMs`
  - `tokens`: `data.details.tokensUsage`
  - `toolUses`: `data.details.toolUses`
- [x] 12.3 Apply the patch with merge semantics: existing fields preserved unless the new payload provides a non-undefined value. Inline implementation via `Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))` over `...existingSub` spread.
- [x] 12.4 Ensure `next.subagents = new Map(next.subagents)` is performed before the `.set(...)` so React equality comparisons detect the change (same pattern as the existing `subagent_*` handlers).
- [x] 12.5 Backfill MUST be a no-op when `toolName !== "Agent"` or `agentId` is absent (preserve existing `tool_execution_end` behavior for unrelated tools and for `@tintinweb/pi-subagents` legacy payloads without `agentId`).
- [x] 12.6 Unit tests in `packages/client/src/lib/__tests__/event-reducer.test.ts` (6 new cases, 141 tests pass):
  - Replayed completed Agent run with `entries[]` populates the subagents map with `status: "completed"` and all derived fields (including `agentMdPath`).
  - Replayed failed Agent run (`isError: true`) populates with `status: "failed"` and `error` from `data.result`.
  - Live `subagent_started` followed by `tool_execution_end` backfill for same `agentId` does not overwrite live-only fields.
  - Backfill is a no-op for `toolName: "bash"`.
  - Backfill is a no-op for `toolName: "Agent"` when `details.agentId` is missing.
  - The existing `next.messages[i].toolDetails` write path remains intact (regression guard).
- [ ] 12.7 Verify end-to-end with a manual replay scenario — deferred until App.tsx wiring (§7) lands so the popout button works.

## 13. Recommended-extensions swap

Swap the dashboard's recommended subagent producer from `@tintinweb/pi-subagents` to `pi-dashboard-subagents`. See design.md Decision 8.

- [x] 13.1 In `packages/shared/src/recommended-extensions.ts`, remove the `tintinweb-pi-subagents` entry entirely from `RECOMMENDED_EXTENSIONS`.
- [x] 13.2 Add a new `pi-dashboard-subagents` entry:
  - `id: "pi-dashboard-subagents"`
  - `source: "https://github.com/BlackBeltTechnology/pi-dashboard-subagents.git"` (producer is not yet published to npm; switch to `npm:pi-dashboard-subagents` when it is)
  - `displayName: "pi-dashboard-subagents"`
  - `fallbackDescription`: one or two sentences describing foreground in-memory subagents with a full streamed timeline
  - `status: "optional"`
  - `unlocks`: `["Agent tool card UI", "Subagent inspector (inline expand + popout)", "agent-md path display"]`
  - `toolsRegistered: ["Agent"]` (foreground-only; no `get_subagent_result` / `steer_subagent`)
  - `autowired: true`
  - `dashboardPlugin: "subagents"` (pairs with the subagents-plugin)
- [x] 13.3 Update `packages/client/src/components/__tests__/UnifiedPackagesSection.test.tsx` and `UnifiedPackagesSection.auto-check.test.tsx`: replace `@tintinweb/pi-subagents` fixtures with `pi-dashboard-subagents`.
- [x] 13.4 Update `README.md` package table (currently lists `@tintinweb/pi-subagents` at line 411).
- [x] 13.5 Confirm the recommended-extensions enricher computes `dashboardPluginInstalled: true` once subagents-plugin is loaded; the install browser should show a `+plugin: subagents` badge on the new entry. (Enricher already handles `dashboardPlugin` per `add-plugin-activation-ui`; no code change needed.)
- [x] 13.6 Add `"pi-dashboard-subagents"` to the `BUNDLED_EXTENSION_IDS` array in `packages/shared/src/recommended-extensions.ts` so the Electron installer ships the producer pre-cached. Gates already pass: source is git (`https://github.com/BlackBeltTechnology/pi-dashboard-subagents.git`), license is MIT.
- [ ] 13.7 Verify the bundle pipeline picks it up: `packages/electron/scripts/bundle-recommended-extensions.sh` clones every id in `BUNDLED_EXTENSION_IDS` into the cache; run it once and confirm `pi-dashboard-subagents` appears under the bundled-extensions output with the 15 MB budget intact.
- [ ] 13.8 First-run activation test: confirm `installBundledExtensions()` (in `packages/electron/src/lib/dependency-installer.ts`) activates the bundled `pi-dashboard-subagents` so a fresh Electron install has the producer registered with pi without an internet round-trip.
- [ ] 13.9 `packages/electron/scripts/test-electron-install.sh` (or the inner Docker variant) SHALL include a check that confirms `pi-dashboard-subagents` is in pi's `packages[]` after first-run wizard completes.

## 14. Remove tintinweb coexistence code

Delete `@tintinweb/pi-subagents`-specific code paths. See design.md Decision 8.

- [x] 14.1 Delete `packages/client/src/components/tool-renderers/GetSubagentResultRenderer.tsx` and its `*.test.tsx` counterpart.
- [x] 14.2 Delete `packages/client/src/components/tool-renderers/SteerSubagentRenderer.tsx` if present and its `*.test.tsx`.
- [x] 14.3 In the tool-renderer registry (`packages/client/src/components/tool-renderers/registry.ts` or equivalent), remove entries for `get_subagent_result` and `steer_subagent`. They fall through to `GenericToolRenderer`.
- [x] 14.4 In `packages/subagents-plugin/src/client/SubagentDetailView.tsx`, delete the Tier-2 branch (the entire `if (sub.status === "running")` block that renders the "Live timeline requires …" footnote). Keep Tier 1 (entries present), Tier 3 (complete/failed with result/error), Tier 4 ("No detail available yet."). Running-with-no-entries-yet collapses into Tier 4 — acceptable because `pi-dashboard-subagents` streams entries from the first `tool_execution_end`.
- [x] 14.5 Refresh header comments in `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx`: `/** Custom renderer for the Agent tool (from @tintinweb/pi-subagents). */` → `/** Custom renderer for the Agent tool (from pi-dashboard-subagents). */`. Same for the `AgentDetails` comment.
- [x] 14.6 Delete `docs/plans/tintinweb-subagents.md` (obsolete revert/reimplementation guide for an integration that no longer exists in this state).
- [x] 14.7 `grep -rE '@tintinweb/pi-subagents|tintinweb' packages/ docs/ README.md` — verify zero residual references (excluding `openspec/changes/archive/` historical records). Remaining mentions are descriptive (CHANGELOG bullet, file-index row noting the removal).
- [x] 14.8 Update unit tests that asserted tintinweb-specific behavior (`SubagentDetailView.test.tsx` Tier-2 cases will be updated in test pass; any `GetSubagentResultRenderer.test.tsx` deleted by 14.1).
- [x] 14.9 Update `docs/file-index-shared.md` to drop the tintinweb mention from the recommended-extensions row.
- [x] 14.10 Update `CHANGELOG.md` Unreleased section noting the removal.

## 15. Surface `agentMdPath` on the inspector

Producer emits `details.agentMdPath` (absolute path to agent `.md` definition) on every `subagents:*` event. Expose it. See design.md Decision 11.

- [x] 15.1 In `packages/subagents-plugin/src/client/types.ts`, add `agentMdPath?: string` to `SubagentState`.
- [x] 15.2 In `packages/client/src/lib/event-reducer.ts`, extend `readSubagentDetails(details)`: `if (typeof details.agentMdPath === "string") out.agentMdPath = details.agentMdPath;`
- [x] 15.3 In `packages/subagents-plugin/src/client/SubagentDetailView.tsx`, in the header (inline + popout share), render the path as a small monospace line directly below the displayName when `sub.agentMdPath` is present. Tailwind: `text-[10px] font-mono text-[var(--text-tertiary)] truncate`. NO click handler. NO copy button. Read-only display.
- [x] 15.4 Apply the same treatment in `SubagentPopoutPage.tsx`'s chrome header.
- [x] 15.5 Unit tests: `agentMdPath` is rendered when present; absent when undefined; passes through `readSubagentDetails`; survives the `tool_execution_end` backfill from §12. (Render tests added to `SubagentDetailView.test.tsx` + `SubagentPopoutPage.test.tsx`; reducer + backfill tests will be added in §12.6.)

## 16. Settings section (canonical plugin-settings flow)

Add one toggle: "Fork parent context into every subagent". See design.md Decisions 9 & 10.

### 16.1 Schema + manifest

- [x] 16.1.1 Create `packages/subagents-plugin/src/configSchema.json`:
  ```json
  {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$id": "@blackbelt-technology/pi-dashboard-subagents-plugin/configSchema",
    "title": "pi-dashboard-subagents plugin config",
    "description": "Mirrors the inheritContext setting from ~/.pi/agent/extensions/pi-dashboard-subagents/config.json. Other producer settings (exposeInheritanceInTool, inheritance.*) remain editable only via the producer file.",
    "type": "object",
    "properties": {
      "inheritContext": {
        "type": "boolean",
        "description": "When true, every subagent inherits a compressed copy of the parent's conversation. When false, subagents start with an empty conversation.",
        "default": true
      }
    },
    "additionalProperties": false
  }
  ```
- [x] 16.1.2 Update `packages/subagents-plugin/package.json` `pi-dashboard-plugin` block:
  - Add `"configSchema": "./src/configSchema.json"`
  - Add `"server": "./src/server/index.ts"`
  - Replace `"claims": []` with `"claims": [{ "slot": "settings-section", "component": "SubagentsSettings", "tab": "general" }]`
  - Add `"requires": { "piExtensions": ["pi-dashboard-subagents"] }`
  - Plus: added `"server"` to exports map; added `dashboard-plugin-runtime` to dependencies.

### 16.2 Plugin server entry

- [x] 16.2.1 Create `packages/subagents-plugin/src/server/producer-file.ts` with pure helpers (`producerFilePath`, `readProducerFile`, `writeProducerFile`, `mergeIntoProducerSettings`, `ProducerSettings` interface).
- [x] 16.2.2 Create `packages/subagents-plugin/src/server/index.ts` (`registerPlugin` default export, startup reconcile, Fastify onResponse hook).
- [x] 16.2.3 Unit tests (16 tests pass): `producer-file.test.ts` covers missing file / malformed JSON / atomic write / parent-dir creation / unexposed-key preservation / round-trip. `index.test.ts` covers startup reconcile (producer file present → push to plugin config; absent → no-op; no-inheritContext → no-op); onResponse hook (fires on POST 200; preserves unexposed keys; no-op on non-200 / non-POST / unrelated URLs).

### 16.3 Client settings component

- [x] 16.3.1 Create `packages/subagents-plugin/src/client/SubagentsSettings.tsx` (single toggle, usePluginConfig read, fetch POST write, error display).
- [x] 16.3.2 Export `SubagentsSettings` from `packages/subagents-plugin/src/client/index.tsx`.
- [x] 16.3.3 Unit test (5 tests pass): checkbox reflects config; defaults to checked when missing; click POSTs with correct body; error path shows message; config doesn't flip on failure.

### 16.4 Wiring + validation

- [x] 16.4.1 Verified plugin discovery picks up the `server` entry. Build output: `[plugin-loader] discovered 7 plugin(s): flows, honcho, jj, roles, subagents, flows-anthropic-bridge, demo`.
- [x] 16.4.2 `validatePluginConfig` runs Ajv against `configSchema.json` on every `POST /api/config/plugins/:id`. With `additionalProperties: false` + `inheritContext: boolean`, a write of `{ inheritContext: "not-a-bool" }` returns HTTP 400 with the Ajv error message. (Existing shared-route behavior; the plugin participates by declaring `configSchema`.)
- [x] 16.4.3 `plugin_config_update` broadcast to clients is handled by the shared `plugin-config-routes.ts` — the plugin participates by going through `POST /api/config/plugins/:id` like every other plugin.
- [ ] 16.4.4 Manual e2e — deferred until running dashboard validates the end-to-end flow.
- [x] 16.4.5 `openspec validate add-subagent-inspector --strict` is clean.
