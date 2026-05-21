## 1. Shared slot taxonomy

- [x] 1.1 Add `"shell-overlay-route"` to the `SlotId` union in `packages/shared/src/dashboard-plugin/slot-types.ts`.
- [x] 1.2 Add the `SLOT_DEFINITIONS["shell-overlay-route"]` entry: `{ multiplicity: "many", payloadTier: "react-only", description: "..." }`.
- [x] 1.3 Add `"shell-overlay-route"` to the `SessionScopedSlot` union in `slot-types.ts` so predicates (if any) receive a session.
- [x] 1.4 Add `SlotPropsMap["shell-overlay-route"]` to `packages/shared/src/dashboard-plugin/slot-props.ts`:
  ```ts
  "shell-overlay-route": {
    params: Record<string, string>;
    session?: DashboardSession;
    onBack: () => void;
    pluginContext: AnyPluginContext;
  };
  ```
- [x] 1.5 Confirm the type-level test `_AssertAllSlotsCovered` still type-checks after the additions.

## 2. Manifest validator

- [x] 2.1 In `packages/dashboard-plugin-runtime/src/manifest-validator.ts`, recognise `claim.slot === "shell-overlay-route"`.
- [x] 2.2 Require `claim.component: string` (non-empty) for `shell-overlay-route` claims.
- [x] 2.3 Require `claim.config.path: string` starting with `/`. Reject missing or non-rooted paths with `ManifestValidationError`.
- [x] 2.4 Accept optional `claim.config.sessionParam: string`; default to `"sid"` in the normalised output.
- [x] 2.5 Forbid duplicate `config.path` values within a single plugin's claims.
- [x] 2.6 Add validator unit tests in `packages/dashboard-plugin-runtime/src/__tests__/manifest-validator.test.ts` covering: well-formed claim accepted, missing path rejected, non-rooted path rejected, duplicate paths rejected, default `sessionParam` applied.

## 3. Runtime — `<ShellOverlayRouteSlot>` + hooks

- [x] 3.1 Create `packages/dashboard-plugin-runtime/src/shell-sessions-context.tsx` exporting `ShellSessionsContext`, `ShellSessionsProvider`, and `useShellSession(sessionId): DashboardSession | undefined`. Strict-hook contract: throw if used outside the provider.
- [x] 3.2 In `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`, add `<ShellOverlayRouteSlot>`:
  - Pulls all `shell-overlay-route` claims from the registry.
  - For each claim, calls `useRoute(claim.config.path)`.
  - Renders the first match's component with `{ params, session: useShellSession(params[sessionParam]), onBack, pluginContext }`.
  - Renders `null` when no claim matches.
- [x] 3.3 In the same file, add `useShellOverlayRouteMatched(): boolean` that walks every `shell-overlay-route` claim and returns true if any matches the current URL.
- [x] 3.4 Re-export `ShellOverlayRouteSlot`, `useShellOverlayRouteMatched`, `ShellSessionsProvider`, and `useShellSession` from `packages/dashboard-plugin-runtime/src/index.ts`.
- [x] 3.5 Add `withShellSessionsProvider(sessions: Map<string, DashboardSession>, children)` test helper in `packages/dashboard-plugin-runtime/src/test-support/`.
- [x] 3.6 Unit tests: `ShellOverlayRouteSlot` first-match-wins; `useShellOverlayRouteMatched` aggregation; `useShellSession` returns expected DashboardSession; `useShellSession` throws outside provider.

## 4. Subagents plugin — reducer migration

- [x] 4.1 Create `packages/subagents-plugin/src/subagent-reducer.ts` exporting `isSubagentEvent(eventType)` and `reduceSubagentEvent(map, event)`. Port the four `subagent_*` arms + the `entry_persisted` backfill arm verbatim from `packages/client/src/lib/event-reducer.ts`.
- [x] 4.2 Create `packages/subagents-plugin/src/reducer.ts` barrel re-exporting `isSubagentEvent` and `reduceSubagentEvent`.
- [x] 4.3 Add `"./reducer"` subpath export to `packages/subagents-plugin/package.json`.
- [x] 4.4 Create `packages/subagents-plugin/src/client/SubagentsSessionStateContext.tsx` exporting:
  - `reduceSubagentsSessionState(events)` — pure folder over an event stream.
  - `useSubagentsSessionState(sessionId): { subagents: ReadonlyMap<string, SubagentState> }` — calls `useSessionEvents(sessionId)` from the runtime, folds via `reduceSubagentsSessionState`, memoises.
  - `EMPTY_STATE` frozen constant for the no-events case.
- [x] 4.5 Export `useSubagentsSessionState` from `packages/subagents-plugin/src/client/index.tsx`.
- [x] 4.6 Port the relevant test cases from `packages/client/src/lib/__tests__/event-reducer.test.ts` (the `subagent_created` / `subagent_started` / `subagent_completed` / `subagent_failed` cases plus the entry_persisted backfill) into `packages/subagents-plugin/src/__tests__/subagent-reducer.test.ts`. Delete the ported arms from the shell test file.

## 5. Shell — strip subagent state

- [x] 5.1 In `packages/client/src/lib/event-reducer.ts`:
  - Remove `import type { SubagentState, SubagentTimelineEntry } from "@blackbelt-technology/pi-dashboard-subagents-plugin/client";` (the type-only import).
  - Remove `export type { SubagentTimelineEntry, SubagentState } from "@blackbelt-technology/pi-dashboard-subagents-plugin/client";`.
  - Remove `subagents: Map<string, SubagentState>` from `SessionState`.
  - Remove `subagents: new Map()` from `createInitialState`.
  - Remove `case "subagent_created"`, `case "subagent_started"`, `case "subagent_completed"`, `case "subagent_failed"` blocks.
  - Remove the `entry_persisted` arm portion that writes to `next.subagents` (preserve the rest of that case, which still stamps `entryId` on messages).
  - Remove `readSubagentDetails` helper (now lives in the plugin reducer).
- [x] 5.2 Update every consumer of `session.subagents` to use `useSubagentsSessionState(session.id)` instead:
  - `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx` (inline subagent expand).
  - Any other consumer surfaced by `rg -n "session\.subagents|\.subagents\." packages/client/src/`.
- [x] 5.3 Update tests that constructed `SessionState` with a `subagents` field to instead mock `useSubagentsSessionState` via test-support helpers from the plugin.

## 6. Subagents plugin — popout claim

- [x] 6.1 Create `packages/subagents-plugin/src/client/SubagentPopoutClaim.tsx`:
  - Reads slot props `{ params: { sessionId, agentId }, session, onBack, pluginContext }`.
  - On mount, calls `pluginContext.send({ type: "subscribe", sessionId: params.sessionId, lastSeq: 0 })` exactly once (use `useRef` to guard).
  - Reads subagent state via `useSubagentsSessionState(params.sessionId)`.
  - Renders the existing `SubagentPopoutPage` body with `{ sessionId, agentId, session: { subagents }, subscriptionResolved: <state.subagents.size > 0 || <subscribe-ack received>>, parentLabel: session?.cwd, onBack }`.
  - Re-evaluate `subscriptionResolved` derivation — see design Decision 5; the claim can simply render "Loading parent session…" when `subagents.size === 0` AND `session === undefined`.
- [x] 6.2 Export `SubagentPopoutClaim` from `packages/subagents-plugin/src/client/index.tsx`.
- [x] 6.3 Add the manifest claim to `packages/subagents-plugin/package.json`:
  ```json
  { "slot": "shell-overlay-route",
    "component": "SubagentPopoutClaim",
    "config": { "path": "/session/:sessionId/subagent/:agentId", "sessionParam": "sessionId" } }
  ```
- [x] 6.4 Tests in `packages/subagents-plugin/src/client/__tests__/SubagentPopoutClaim.test.tsx` covering the four empty-state branches plus the resolved render.

## 7. Flows plugin — popout claim + popout button (and remaining drafts)

- [x] 7.1 Confirm `packages/flows-plugin/src/client/FlowAgentCard.tsx` has the `mdiOpenInNew` popout button (already drafted in the prior implementation).
- [x] 7.2 Confirm `packages/flows-plugin/src/client/FlowAgentPopoutPage.tsx` body component exists (chrome header + `FlowAgentDetail` + empty-state branches).
- [x] 7.3 Create `packages/flows-plugin/src/client/FlowAgentPopoutClaim.tsx`:
  - Reads slot props `{ params: { sid, flowId, agentId }, session, onBack, pluginContext }`.
  - Cold-open subscribe on mount via `pluginContext.send`.
  - Reads flow state via `useFlowsSessionState(params.sid)`.
  - Looks up `flowStates.get(decodeURIComponent(params.flowId))` and `flow.agents.get(params.agentId)`.
  - Renders `<FlowAgentPopoutPage sessionId={...} flowId={...} agentId={...} session={...} subscriptionResolved={...} parentLabel={session?.cwd} onBack={onBack} />`.
- [x] 7.4 Export `FlowAgentPopoutClaim` from `packages/flows-plugin/src/client/index.tsx`.
- [x] 7.5 Add the manifest claim to `packages/flows-plugin/package.json`:
  ```json
  { "slot": "shell-overlay-route",
    "component": "FlowAgentPopoutClaim",
    "config": { "path": "/session/:sid/flow/:flowId/agent/:agentId", "sessionParam": "sid" } }
  ```
- [x] 7.6 Tests in `packages/flows-plugin/src/client/__tests__/FlowAgentPopoutClaim.test.tsx` (mirror `SubagentPopoutClaim.test.tsx`).
- [x] 7.7 Popout-button unit test in `FlowAgentCard.test.tsx`: button renders, opens correct URL via `window.open` spy, disabled when ids missing.

## 8. Shell — strip plugin route knowledge + mount the slot

- [x] 8.1 In `packages/client/src/App.tsx`:
  - Remove `import { SubagentPopoutPage } from "@blackbelt-technology/pi-dashboard-subagents-plugin/client";`.
  - Remove (if previously added) `import { FlowAgentPopoutPage } from "@blackbelt-technology/pi-dashboard-flows-plugin/client";`.
  - Remove the `useRoute("/session/:sessionId/subagent/:agentId")` call and its `subagentPopoutSessionId` / `subagentPopoutAgentId` decoders.
  - Remove (if previously added) the `useRoute("/session/:sid/flow/:flowId/agent/:agentId")` call and its decoders.
  - Remove the subagent popout's `useEffect` cold-open subscribe.
  - Remove (if previously added) the flow popout's `useEffect` cold-open subscribe.
  - Remove the subagent popout dispatch arm inside `sessionDetail` (the block around line 1072).
  - Remove the subagent popout dispatch arm inside `MobileShell.detailPanel` (around line 1378).
  - Remove (if previously added) the flow popout dispatch arms in both layouts.
  - Replace `hasShellOverlayRoute = !!archiveMatch || ... || !!subagentPopoutMatch || ...` with `const hasShellOverlayRoute = useShellOverlayRouteMatched();`.
- [x] 8.2 Wrap the tree in `<ShellSessionsProvider value={sessions}>`. Place the provider just inside the `PluginContextProvider` (or wherever sessions-Map is in scope).
- [x] 8.3 Mount `<ShellOverlayRouteSlot />` at the top of the desktop overlay switch — BEFORE the `archiveMatch` / `specsMatch` / etc. chain. When it returns non-null, render it as the entire main content; otherwise fall through.
- [x] 8.4 Mount `<ShellOverlayRouteSlot />` at the top of `MobileShell.detailPanel`. Same fall-through pattern.
- [x] 8.5 Verify `getMobileDepth` still gets `hasOverlayRoute: <useShellOverlayRouteMatched()>` so detail-depth calculation works.
- [x] 8.6 Type-check the file. No dangling references.

## 9. BackgroundSubagentsPanel (and any other shell consumer of `session.subagents`)

- [x] 9.1 Audit `rg -n "subagents" packages/client/src/` to find lingering consumers of the removed `SessionState.subagents` field.
- [x] 9.2 For each consumer: convert to `useSubagentsSessionState(sessionId)` if it has a sessionId in scope; otherwise lift the call up to a parent that does.

## 10. Repo-lint: no plugin-page imports in the shell

- [x] 10.1 Add `packages/client/src/__tests__/no-plugin-page-imports-in-app-tsx.test.ts`:
  - Reads `packages/client/src/App.tsx` as a string.
  - Asserts it does NOT contain `from "@blackbelt-technology/pi-dashboard-subagents-plugin"` for `SubagentPopoutPage` / `SubagentPopoutClaim`.
  - Asserts it does NOT contain `from "@blackbelt-technology/pi-dashboard-flows-plugin"` for `FlowAgentPopoutPage` / `FlowAgentPopoutClaim`.
  - Asserts it does NOT contain `useRoute("/session/:*/subagent/...")` or `useRoute("/session/:*/flow/...")`.
- [x] 10.2 The test SHALL fail before step 8 strip and pass after.

## 11. Smoke tests

- [x] 11.1 Desktop routing smoke test: navigate `/session/<sid>/subagent/<aid>` on desktop viewport → render asserts `SubagentPopoutPage` or its `data-testid` is present AND `LandingPage` is NOT present.
- [x] 11.2 Desktop routing smoke test: same for `/session/<sid>/flow/<flow>/agent/<agent>` → `FlowAgentPopoutPage`.
- [x] 11.3 Mobile routing smoke test: same URLs on mobile viewport, both render inside `MobileShell.detailPanel`.
- [x] 11.4 Cold-open subscription test: render the claim with no prior session subscription → assert `pluginContext.send({ type: "subscribe", sessionId, lastSeq: 0 })` is called exactly once.

## 12. Documentation

- [x] 12.1 Delegate to a subagent (per AGENTS.md): add file-index rows in `docs/file-index-plugins.md` for:
  - `packages/subagents-plugin/src/subagent-reducer.ts`
  - `packages/subagents-plugin/src/reducer.ts`
  - `packages/subagents-plugin/src/client/SubagentsSessionStateContext.tsx`
  - `packages/subagents-plugin/src/client/SubagentPopoutClaim.tsx`
  - `packages/flows-plugin/src/client/FlowAgentPopoutPage.tsx`
  - `packages/flows-plugin/src/client/FlowAgentPopoutClaim.tsx`
- [x] 12.2 Delegate: add file-index rows in `docs/file-index-shared.md` (or relevant split) for `slot-types.ts` / `slot-props.ts` referencing the new slot.
- [x] 12.3 Delegate: add file-index rows in `docs/file-index-runtime.md` (or relevant split) for:
  - `packages/dashboard-plugin-runtime/src/shell-sessions-context.tsx`
  - the `ShellOverlayRouteSlot` + `useShellOverlayRouteMatched` exports
- [x] 12.4 No AGENTS.md backbone changes (slot system already pointed at; new slot is one row in the taxonomy).

## 13. Verification

- [x] 13.1 `openspec validate add-flow-agent-popout --strict` passes.
- [x] 13.2 `npm run build` succeeds.
- [x] 13.3 `npm test` — all suites green.
- [x] 13.4 Manual smoke: spawn or attach to a session with both flow + subagent activity; verify popout buttons open the right tab; verify cold-open works (close tab, reopen URL).
- [x] 13.5 Inspect `packages/client/src/App.tsx` after the change — line-count delta SHOULD be net negative (more removed than added).
