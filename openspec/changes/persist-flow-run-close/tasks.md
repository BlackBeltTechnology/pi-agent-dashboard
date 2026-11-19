## 1. Tests first (red)

- [x] 1.1 Reducer replay tests in `packages/flows-plugin/src/__tests__/FlowsSessionStateContext.test.tsx` (harness: same file). Triples: run r1 events + `flow_summary_dismissed{runId:r1}` · reduce · r1 absent; dismiss before run events · reduce · r1 absent; r1+r2, dismiss r1 · reduce · r2 kept; `flow_summary_dismissed{}` · reduce · cleared (test-plan #T1, #T2, #T3, #T4)
- [x] 1.2 `FlowState.runId` from `flow_started` in `packages/flows-plugin/src/__tests__/flow-reducer-seed-on-start.test.ts` (harness: same file). Triple: `flow_started{runId:"r1"}` · reduce · `runId === "r1"` (test-plan #T5)
- [x] 1.3 Server runId relay in `packages/flows-plugin/src/__tests__/plugin-action-handler.test.ts` (harness: same file). Triple: `flow.dismiss-summary {runId}` valid / missing / non-string / 129 chars · handle · emits `{runId}` or `{}` (test-plan #T6); REST route with body `runId` · POST · emits `{runId}` (test-plan #T6b)
- [x] 1.4 Bridge persistence in `packages/flows-plugin/src/bridge/__tests__/bridge-entry.test.ts` (harness: same file). Triple: `flow:summary-dismissed {runId:"r1"}` / `{}` / throwing appendEntry · emit · one `flow-run-close` entry / none / no throw (test-plan #T7)
- [x] 1.5 Replay type contract in `packages/flows-plugin/src/__tests__/manifest-discoverability.test.ts` (harness: same file). Triple: manifest + `FLOW_REPLAY_ENTRY_TYPES` · read · both contain `flow-event`, `flow-run-close` (test-plan #T8)
- [x] 1.6 Dismiss sends runId in `packages/flows-plugin/src/__tests__/flow-dashboard-header-actions.test.tsx` (harness: same file). Triple: finished run r1 shown · click Dismiss · `plugin_action flow.dismiss-summary payload {runId:"r1"}` (test-plan #T9)
- [x] 1.7 Idle Close dismisses run beneath in `packages/flows-plugin/src/__tests__/flow-dashboard-claim-attach.test.tsx` (harness: same file). Triple: attached over finished r1 / nothing beneath / running beneath · click Close · attachment cleared + dismiss {runId:"r1"} / no dismiss / no dismiss (test-plan #T10)

## 2. Implementation (plugin-only)

- [x] 2.1 `flow-reducer.ts`: store `data.runId` on `FlowState.runId` (types.ts) at `flow_started`
- [x] 2.2 `client/FlowsSessionStateContext.tsx`: collect `closedRunIds` from `flow_summary_dismissed{runId}`; after the loop drop closed runs from `flowStates` and null `flowState` if closed; no-runId dismiss keeps clear-all
- [x] 2.3 `server/flow-control.ts`: validate optional `payload.runId` (string 1..128) → emit `flow:summary-dismissed {runId}` else `{}`; add `runId` to the REST body whitelist
- [x] 2.4 `bridge/`: on `flow:summary-dismissed` with `runId` → `pi.appendEntry("flow-run-close", { seq: Date.now(), eventType: "flow_summary_dismissed", data: { runId } })`, try/catch; wire in `bridge/index.ts`
- [x] 2.5 Add `flow-run-close` to `package.json` `replayEntryTypes` and `FLOW_REPLAY_ENTRY_TYPES` in `bridge/flow-event-forward.ts`
- [x] 2.6 `client/FlowDashboard.tsx` + `FlowSummary.tsx`: send `payload: { runId }` on Dismiss; idle `onClose` = detach + dismiss the non-running finished run beneath (when it has `runId`)
- [x] 2.7 Update `packages/flows-plugin/src/**/AGENTS.md` rows for touched files

## 3. Verify

- [ ] 3.1 `npm test` (flows-plugin) green; `npm run quality:changed` clean
- [ ] 3.2 Manual: dismiss an aborted run in a connected session, reload + restart server, run stays gone (test-plan: manual-only, #M1)
