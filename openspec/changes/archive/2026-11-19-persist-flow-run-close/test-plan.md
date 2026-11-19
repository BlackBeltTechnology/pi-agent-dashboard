# Test plan — persist-flow-run-close

Simple plugin-only bugfix. All scenarios L1 (vitest) under `packages/flows-plugin/`. Replay itself is exercised through `reduceFlowsSessionState` with the event sequence core replay produces (seq-sorted declared records appended last); core replay is unchanged.

| id | scenario | technique | level | disposition | home | exemplar |
|---|---|---|---|---|---|---|
| T1 | Dismissed run absent after replay: events `flow_started{runId:r1}`…`flow_complete` + `flow_summary_dismissed{runId:r1}` → no `batch:apply` in `flowState`/`flowStates` | state transition | L1 | automated | `src/__tests__/FlowsSessionStateContext.test.tsx` | same file |
| T2 | Close record sorted BEFORE its run's events → run `r1` still excluded | ordering / edge | L1 | automated | `src/__tests__/FlowsSessionStateContext.test.tsx` | same file |
| T3 | Two runs r1 (alpha), r2 (beta); dismiss r1 → beta stays, alpha gone | equivalence partition | L1 | automated | `src/__tests__/FlowsSessionStateContext.test.tsx` | same file |
| T4 | Legacy `flow_summary_dismissed {}` → clear-all as before | regression | L1 | automated | `src/__tests__/FlowsSessionStateContext.test.tsx` | same file |
| T5 | `flow_started{runId}` stores `FlowState.runId` | unit | L1 | automated | `src/__tests__/flow-reducer-seed-on-start.test.ts` | same file |
| T6 | Server `flow.dismiss-summary {runId:"r1"}` → emits `flow:summary-dismissed {runId:"r1"}`; runId missing / non-string / 129 chars → emits `{}` | boundary value | L1 | automated | `src/__tests__/plugin-action-handler.test.ts` | same file |
| T6b | REST `POST /api/plugins/flows/control {action:flow.dismiss-summary, runId:"r1"}` → emits `{runId:"r1"}` | unit | L1 | automated | `src/__tests__/plugin-action-handler.test.ts` | same file |
| T7 | Bridge: `flow:summary-dismissed {runId:"r1"}` → one `appendEntry("flow-run-close", {seq:number, eventType:"flow_summary_dismissed", data:{runId:"r1"}})`; `{}` → no append; appendEntry throws → no throw | unit / error handling | L1 | automated | `src/bridge/__tests__/bridge-entry.test.ts` | same file |
| T8 | Manifest `replayEntryTypes` and `FLOW_REPLAY_ENTRY_TYPES` both contain `flow-event` and `flow-run-close` (kept in sync) | contract | L1 | automated | `src/__tests__/manifest-discoverability.test.ts` | same file |
| T9 | Summary Dismiss (FlowDashboard header and FlowSummaryClaim) sends `plugin_action flow.dismiss-summary` with `payload.runId` of the shown run | unit (render) | L1 | automated | `src/__tests__/flow-dashboard-header-actions.test.tsx` | same file |
| T10 | Idle Close over finished run `r1` → attachment cleared AND `flow.dismiss-summary {runId:"r1"}` sent; Close with no finished run → no dismiss sent; running run beneath → no dismiss | decision table | L1 | automated | `src/__tests__/flow-dashboard-claim-attach.test.tsx` | same file |
| M1 | Live check: dismiss an aborted run in a connected session, reload page + restart server → run stays gone | exploratory | manual | manual-only | — | — |
