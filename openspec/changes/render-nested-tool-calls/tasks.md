## 1. Wire and store

- [x] 1.1 No protocol type change (`DashboardEvent.data` is untyped); pin that `mapEventToProtocol` carries `parentToolCallId` for `tool_execution_*` with the 5.21 forwarder test
- [x] 1.2 `packages/shared/src/state-replay.ts`: copy `message.nestedCalls` from `toolResult` messages onto the synthesized `tool_execution_end`; verify with 5.6
- [x] 1.3 `packages/server/src/persistence/memory-event-store.ts`: `truncateStrings` recognizes the `nestedCalls` envelope, skips the >20 array clobber for `calls`, and truncates each record as its own root (not a ceiling exemption); verify with 5.22 and 5.23

## 2. Server

- [x] 2.1 `event-status-extraction.ts`: `extractRawSessionUpdates` returns `null` for nested `tool_execution_start`/`tool_execution_end`; verify with 5.15 (covers `event-status-extraction`, `token-stats-pipeline`, `prompt-derived-tool-state` deltas)
- [x] 2.2 `open-tool-calls.ts`: exclude nested starts; verify with 5.16

## 3. Client

- [x] 3.1 Reducer: `NestedCallState` (`running|complete|error|unfinished`, `startedAt`), root-owned `nested` list, classification by `parentToolCallId` only, live attach incl. grandchildren and parent-chain fallback, record-sourced parent from id segments, nested updates, record merge from live toolResult `message_start`/`message_end` and replay end, "no running nested entry under a terminal/elided root" invariant, `argumentsBytes` note, incomplete-record notice, orphan drop, no flush and no `SessionState.currentTool` change for nested events, nested result truncation; verify with 5.1–5.14 (react-expert checkpoint)
- [x] 3.2 Tool card renders the nested list (collapsed with count, indented by `parentId`, `unfinished` neutral, incomplete-record notice); verify with 5.24
- [x] 3.3 `useToolFullResult.ts` encodes the tool-call id; `useStaleToolReconcile.ts` skips nested ids; `selectInflightBashTools` walks nested lists for running `bash`; verify with 5.17–5.20

## 4. Verification

- [x] 4.1 Full suite green; update touched `AGENTS.md` rows with `See change: render-nested-tool-calls`; verify `openspec validate render-nested-tool-calls --strict`

## 5. Scenario tests (from test-plan.md)

Landed test files (the `see …` pointers are exemplars): 5.1–5.5 and 5.7–5.14 → `packages/client/src/lib/__tests__/event-reducer.nested-tool-calls.test.ts`; 5.20 → `packages/client/src/hooks/__tests__/useToolFullResult.test.ts`; 5.24 → `packages/client/src/components/__tests__/NestedToolCallList.test.tsx`; the rest in the named files.

- [x] 5.1 L1 reducer test: live nested attach — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; `call_1` running · nested start `call_1/1` parent `call_1` · no top-level ToolCallState, `call_1.nested` has `call_1/1` running (test-plan #E1)
- [x] 5.2 L1 reducer test: grandchild under root — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; nested `call_1/1` · start `call_1/1/1` parent `call_1/1` · listed under `call_1` with `parentId` `call_1/1` (test-plan #E2)
- [x] 5.3 L1 reducer test: nested error — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; nested running · end `isError:true` · nested `error`, root unchanged (test-plan #E3)
- [x] 5.4 L1 reducer test: root end then late nested end — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; `call_1/1` running · root end, then real end · `unfinished` then `complete` (test-plan #E4)
- [x] 5.5 L1 reducer test: nested update — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; nested running · `tool_execution_update` · latest partial shown, no top-level row (test-plan #E5)
- [x] 5.6 L1 replay test: transcript rebuild — see `packages/shared/src/__tests__/state-replay.test.ts` (synthesis) and `packages/client/src/__tests__/state-replay.test.ts` (reduce); toolResult with records ok / grandchild error / unfinished with `argumentsBytes:9000`, `complete:false` · synthesis then reduce · end carries `nestedCalls`, mapped statuses, grandchild `parentId` `call_1/1`, "arguments omitted (9000 bytes)", incomplete-record notice (test-plan #E6)
- [x] 5.7 L1 reducer test: live record merge — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; live `call_1/1..3`, root ended · toolResult `message_end` record for 1, 2, 4 with `complete:false` · 1 keeps live result, 2 error, 4 created, 3 `unfinished`, none running (test-plan #E7)
- [x] 5.8 L1 reducer test: classification, orphan and fallback — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; unknown root / non-conforming id with known nested parent / top-level `call_7/a` without `parentToolCallId` · start · dropped without throw / attached to root / top-level row created (test-plan #E8)
- [x] 5.9 L1 reducer test: window-edge nested start — see `packages/client/src/lib/__tests__/event-reducer.test.ts` backfill-segment cases; nested start without end · segment reduce · no row created or elided (test-plan #E9)
- [x] 5.10 L1 reducer test: window-edge orphan end with record — see `packages/client/src/lib/__tests__/event-reducer.test.ts` backfill-segment cases; segment begins with `call_1` end carrying `nestedCalls` · segment reduce · no throw, no row, no nested entries (test-plan #E10)
- [x] 5.11 L1 reducer test: late nested start under terminal or elided root — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; `call_1` complete / elided · nested start `call_1/2` · created `unfinished` (test-plan #E11)
- [x] 5.12 L1 reducer test: nested start does not flush — see the streaming-flush cases in `packages/client/src/lib/__tests__/event-reducer.test.ts`; non-empty `streamingText` · nested start · no assistant row, `streamingText`/`streamingTextFlushed` unchanged (test-plan #E12)
- [x] 5.13 L1 reducer test: client `currentTool` ignores nested — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; `currentTool:"codemode"` · nested `bash` start then end · stays `codemode` (test-plan #E13)
- [x] 5.14 L1 reducer test: long nested result truncated — see the truncation cases in `packages/client/src/lib/__tests__/event-reducer.test.ts`; result one line over the truncation limit · nested end · last lines + omission marker, full-output affordance (test-plan #E14)
- [x] 5.15 L1 server test: `currentTool` ignores nested — see `packages/server/src/__tests__/event-status-extraction.test.ts`; nested start/end with `hasPendingPrompt` false and true · `extractSessionUpdates` · `null` in all cases; top-level end with pending prompt still `ask_user` (test-plan #E15)
- [x] 5.16 L1 server test: heal skips nested — see `packages/server/src/session/__tests__/open-tool-calls.test.ts`; root ended + nested open / both open · `findOpenToolCalls` · empty / only root (test-plan #E16)
- [x] 5.17 L1 client test: reconcile skips nested — see `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts`; nested running past `STALE_TOOL_MS` · tick · no request (test-plan #E17)
- [x] 5.18 L1 client test: nested bash in-flight — see `packages/client/src/hooks/__tests__/useInflightBashTools.test.ts`; nested running `bash` with `startedAt`/`args.command` · `selectInflightBashTools` · included with command and `startedAt` (test-plan #E18)
- [x] 5.19 L1 route test: encoded nested id — see `packages/server/src/__tests__/session-routes-tool-result.test.ts`; stored end for `call_1/1` · `GET .../tool-result/call_1%2F1` and raw `call_1/1` · 200 with stored result / 404 (test-plan #E19)
- [x] 5.20 L1 client test: `useToolFullResult` encodes the id — see `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts` for fetch mocking; nested `call_1/1` · full-result fetch · URL ends `/tool-result/call_1%2F1` (test-plan #E20)
- [x] 5.21 L1 extension test: forwarder carries `parentToolCallId` — see `packages/extension/src/__tests__/event-forwarder.test.ts`; pi `tool_execution_start` with `parentToolCallId:"call_1"` · `mapEventToProtocol` · `data.parentToolCallId === "call_1"` (test-plan #E21)
- [x] 5.22 L1 store test: 40 nested records survive generic truncation — see `packages/server/src/__tests__/memory-event-store.test.ts`; toolResult `message_end` with 40 records, one with 6-level-deep `arguments` · insert · 40 records with `id`/`name`/`status`, deep `arguments` summarized not raw (test-plan #X1)
- [x] 5.23 L1 store test: not a ceiling exemption — see `packages/server/src/__tests__/memory-event-store.test.ts`; `nestedCalls` event over a 20000 test ceiling · insert · no throw, stored data within the ceiling (test-plan #X2)
- [x] 5.24 L1 component test: nested list rendering — see `packages/client/src/components/tool-renderers/__tests__/BashToolRenderer.test.tsx` for the render harness; 3 nested incl. grandchild and one `unfinished`, `nestedComplete:false` · render tool card · collapsed count 3, expanded indentation, neutral `unfinished`, incomplete-record notice (test-plan #F1)
- [ ] 5.25 Manual: real session `"defaultTools": ["+codemode"]` running a script that calls `bash`, another tool, a failing tool and >20 calls in a loop — nested list readable live, after reload and after session end, with no stuck cards or raw rows (test-plan: manual-only, #F2)
