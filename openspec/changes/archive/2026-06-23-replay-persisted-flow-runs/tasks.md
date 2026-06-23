# Tasks

## 1. Replay branch (load-bearing) — `packages/shared/src/state-replay.ts`

- [x] 1.1 Write a test in `packages/shared/src/__tests__/` that feeds `replayEntriesAsEvents` a synthetic entry list containing `type:"custom"` `customType:"flow-event"` records (seq 0,1,2 → `flow_started`, `flow_agent_started`, `flow_tool_call`) and asserts three `event_forward` messages emitted in `seq` order with `data` verbatim. Verify it FAILS first.
- [x] 1.2 Add tests for: non-`flow-event` custom entries ignored; malformed record (missing/non-string `eventType`) skipped without throw; out-of-order `seq` sorted ascending; existing `message`/`model_change` replay unaffected when interleaved.
- [x] 1.3 Implement the branch in `replayEntriesAsEvents`'s entry loop: collect `flow-event` records, sort by `seq`, emit one `makeEvent(sessionId, rec.eventType, ts, rec.data)` each; guard missing/non-string `eventType`. Duck-type the record; no import from pi-flows. → verify: tasks 1.1–1.2 tests pass.

## 2. Bridge map entry — `packages/extension/src/flow-event-wiring.ts`

- [x] 2.1 Add `"flow:agent-error": "flow_agent_error"` to `FLOW_EVENT_MAP` (after `flow:auto-decision`). → verify: existing `flow-event-wiring` tests still pass; map contains the new key.

## 3. Reducer case — `packages/flows-plugin/src/flow-reducer.ts`

- [x] 3.1 Write a test asserting `reduceFlowEvent` handles `flow_agent_error { agentName, stepId, text }` by appending `{ kind:"error", text }` to the matched agent's `detailHistory`; assert empty `text` is a no-op; assert agent `status` is NOT changed. Verify it FAILS first.
- [x] 3.2 Add the `case "flow_agent_error":` (after `flow_thinking_text`): find agent via `findAgent(agents, agentName, stepId)`, append `{ kind:"error", text }` to `detailHistory`, return updated state; ignore empty `text`. → verify: task 3.1 tests pass.

## 5. Client replay → plugin event-store rehydration

Server replay (section 1) produces the events, but the flow card reads `useSessionEvents` (plugin-runtime store), which only the live `event` path feeds. The `event_replay` handler must mirror the batch into the plugin store or the slot never reattaches on cold load.

- [x] 5.1 Add `publishSessionEvents(sessionId, events: readonly DashboardEvent[])` (plural) to `packages/dashboard-plugin-runtime/src/session-events-store.ts`: one `Object.freeze([...current, ...events])` + one `notify`. Export it from the runtime barrel. Add a runtime store test (mirror `use-session-events.test.tsx`) asserting one notification for an N-event publish and correct final array. → verify: new test passes.
- [x] 5.2 Write a client test (mirror `packages/client/src/hooks/__tests__/useMessageHandler.replay-reset.test.tsx`) feeding an `event_replay` batch with `flow_started`+`flow_tool_call`; assert `getSessionEvents(sid)` contains them AND `reduceFlowsSessionState(getSessionEvents(sid)).flowState` is non-null. Verify it FAILS first.
- [x] 5.3 Add tests: re-replay full sweep (`shouldReset` true) does NOT duplicate events; paginated continuation (`shouldReset` false) appends without clearing.
- [x] 5.4 In `useMessageHandler.ts` `case "event_replay"`, after the `setSessionStates` block, reuse the already-computed `shouldReset`: if `shouldReset` call `clearSessionEvents(msg.sessionId)`, then `publishSessionEvents(msg.sessionId, msg.events.map((e) => e.event))`. → verify: 5.2–5.3 pass; `flows`/`goal` slots rehydrate on cold load.
- [x] 5.5 Actions-subcard availability rehydration (Option A, client-only): `flowsAvailability.sessionHasFlowEvents(sid)` (ref-memoized, sticky-true) reads the session-events store; `shouldRenderFlowsSubcard` ORs it with `getFlowsAvailabilitySync`, so the FLOWS subcard reattaches on cold load when a flow ran even before live `flows_list`/`commands_list` re-publish. Tested in `flowsAvailability.test.ts`.

## 4. Verification & rebuild

- [x] 4.1 Type-check + full test run: `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` — zero failures.
- [x] 4.2 `openspec validate replay-persisted-flow-runs --strict` passes.
- [x] 4.3 Rebuild all three components: `npm run build` (client incl. flows-plugin) → `curl -X POST http://localhost:8000/api/restart` (shared replay) → `npm run reload` (bridge map). → verify: `/api/health` returns ok.
- [x] 4.4 Manual end-to-end (depends on sections 1 + 5): run a flow with the dashboard attached, trigger a step-level agent failure, then refresh the browser / restart the server / `/resume` the pi session. → verify: flow card reappears with the full per-agent timeline including the `{ kind:"error" }` entry. (If the card stays blank but `grep -c flow-event <session>.jsonl` is non-zero, the gap is section 5 — plugin-store delivery — not persistence.)
