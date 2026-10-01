## 1. Wire and store

- [ ] 1.1 Add optional `parentToolCallId` to tool-event types in `packages/shared/src/protocol.ts`; add a test that `mapEventToProtocol` carries it for `tool_execution_*`; verify the test passes
- [ ] 1.2 Bridge: skip forwarding `tool_call` / `tool_result` carrying `parentToolCallId`, keeping local handlers (fan-out admission); verify with the two `bridge-extension` scenarios
- [ ] 1.3 `packages/shared/src/state-replay.ts`: copy `nestedCalls` from `toolResult` messages onto the synthesized end; verify with a transcript replay fixture
- [ ] 1.4 `packages/server/src/persistence/memory-event-store.ts`: `nestedCalls` carve-out with the degradation order; verify with the two `in-memory-event-buffer` scenarios (40 records; oversized record)

## 2. Server

- [ ] 2.1 `event-status-extraction.ts`: no `currentTool` change for nested events; verify with the modified `event-status-extraction` and `token-stats-pipeline` scenarios
- [ ] 2.2 `open-tool-calls.ts`: exclude nested starts; verify with the modified `session-end-orphan-heal` scenarios

## 3. Client

- [ ] 3.1 Reducer: root-owned `nested` list, live attach (incl. grandchildren and parent-chain fallback), nested updates, root-end → unfinished, late real end overwrites, replay/record merge, `argumentsBytes` note, `complete:false` notice, orphan drop, window-edge nested starts create no row; verify with `event-reducer` and `on-demand-session-replay` scenario tests (react-expert checkpoint)
- [ ] 3.2 Tool card renders the nested list (collapsed with count, indented by parent); verify with a component test
- [ ] 3.3 `useToolFullResult.ts` encodes the tool-call id; `useStaleToolReconcile.ts` skips nested ids; `selectInflightBashTools` includes nested running `bash`; verify with a server route test for `call_1%2F1` and client unit tests

## 4. Verification

- [ ] 4.1 Real session with `"defaultTools": ["+codemode"]`: run a codemode script that calls `bash`, another tool, and one failing tool (and >20 calls in a loop); verify the nested list live, after reload, and after session end (no stuck cards, no raw-event rows, `currentTool` back to idle)
- [ ] 4.2 Full suite green; update touched `AGENTS.md` rows with `See change: render-nested-tool-calls`; verify `openspec validate render-nested-tool-calls`

## 5. Scenario tests (from test-plan.md)

- [ ] 5.1 L1 reducer test: live nested attach — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; `call_1` running · nested start `call_1/1` · no top-level row, nested running (test-plan #E1)
- [ ] 5.2 L1 reducer test: grandchild under root — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; nested `call_1/1` · start `call_1/1/1` · listed under `call_1` beneath `call_1/1` (test-plan #E2)
- [ ] 5.3 L1 reducer test: nested error — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; nested running · end `isError:true` · nested error, root unchanged (test-plan #E3)
- [ ] 5.4 L1 reducer test: root end then late nested end — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; nested running · root end, then real end · unfinished then complete (test-plan #E4)
- [ ] 5.5 L1 reducer test: nested update — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; nested running · update · partial shown, no top-level row (test-plan #E5)
- [ ] 5.6 L1 replay test: rebuild from `nestedCalls` — see `packages/client/src/__tests__/state-replay.test.ts`; record `ok`/`error`/`unfinished`, `argumentsBytes`, `complete:false` · transcript replay · mapped statuses, omitted-arguments note, not-recorded notice (test-plan #E6)
- [ ] 5.7 L1 reducer test: live/record merge — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; live `call_1/1..3`, record for 1–2 `complete:false` · toolResult · recorded status applied, live results kept, `call_1/3` kept (test-plan #E7)
- [ ] 5.8 L1 reducer test: orphan and parent-chain fallback — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; unknown root; non-conforming id with known nested parent · nested start · dropped without throw; attached to root (test-plan #E8)
- [ ] 5.9 L1 test: window-edge nested start — see `packages/client/src/lib/__tests__/event-reducer.test.ts` backfill-segment cases; nested start without end · segment reduce · no row created or elided (test-plan #E9)
- [ ] 5.10 L1 test: `currentTool` ignores nested — see `packages/server/src/__tests__/event-status-extraction.test.ts`; `currentTool:"codemode"` · nested end · unchanged (test-plan #E10)
- [ ] 5.11 L1 test: heal skips nested — see `packages/server/src/session/__tests__/open-tool-calls.test.ts`; root ended + nested open; both open · `findOpenToolCalls` · nested not healed; only root healed (test-plan #E11)
- [ ] 5.12 L1 test: reconcile skips nested — see `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts`; nested running past `STALE_TOOL_MS` · tick · no request (test-plan #E12)
- [ ] 5.13 L1 test: nested bash counts in-flight — see the `useInflightBashTools` tests next to `packages/client/src/hooks/useInflightBashTools.ts`; nested running `bash` · `selectInflightBashTools` · included (test-plan #E13)
- [ ] 5.14 L1 route test: encoded nested id — see `packages/server/src/__tests__/model-proxy-routes.test.ts` for the `fastify.inject` harness; stored end for `call_1/1` · `GET .../tool-result/call_1%2F1` · 200 with full result (test-plan #E14)
- [ ] 5.15 L1 bridge test: nested `tool_call`/`tool_result` not forwarded — see `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts` for bridge harness; nested `tool_result`; nested `Agent` `tool_call` · handlers · no `event_forward`; admission invoked (test-plan #E15)
- [ ] 5.16 L1 store test: 40 nested records survive — see `packages/server/src/__tests__/memory-event-store.test.ts`; toolResult with 40 records · insert · array of records with `id`/`name`/`status` (test-plan #X1)
- [ ] 5.17 L1 store test: oversized record degrades — see `packages/server/src/__tests__/memory-event-store.test.ts`; record past the per-event ceiling · insert · `arguments` then oldest records dropped, `complete:false`, parent result kept (test-plan #X2)
- [ ] 5.18 L1 component test: nested list rendering — see `packages/client/src/components/session/__tests__/SessionCard-status-shape.test.tsx` for render harness; 3 nested incl. grandchild · render tool card · collapsed count 3, expanded indentation (test-plan #F1)
- [ ] 5.19 Manual: codemode session end-to-end (live, reload, end) readability with no stuck cards or raw rows (test-plan: manual-only, #F2)
