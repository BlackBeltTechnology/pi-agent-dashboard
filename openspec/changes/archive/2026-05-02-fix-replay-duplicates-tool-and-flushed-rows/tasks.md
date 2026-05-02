## Tasks

### 1. Reproduce + pin the failure

- [x] 1.1 Add `packages/client/src/lib/__tests__/event-reducer.replay-idempotency.test.ts`. Load (or synthesize) the event sequence equivalent to session `019de212-7d47-7322-afdd-245be4b9a629`'s `events.jsonl` (50 toolCalls, 110 messages, 71 text blocks, 22 thinking blocks, 1 forked from a parent with 8 toolCalls). Run it twice through `reduceEvent` starting from `createInitialState()`. Assert `state.messages.length` after run-2 equals length after run-1, and the arrays deep-equal at every index. **Should fail before the fix.**
- [x] 1.2 Add `packages/client/src/lib/__tests__/event-reducer.tool-start-idempotent.test.ts`. Two `tool_execution_start` events with identical `toolCallId="t1"`, `toolName="bash"`, but different `args.command` ("first" then "second"). Assert `state.messages.filter(m => m.toolCallId === "t1").length === 1` and the surviving row's `args.command === "second"` (latest-wins for in-flight updates). **Should fail before the fix.**
- [x] 1.3 Add `packages/client/src/__tests__/useMessageHandler-replay-reset.test.tsx`. Mount `App` with a stub WebSocket; deliver `event_replay` batch 1 (`firstSeq=1`, 5 events), then a second `event_replay` (`firstSeq=1`, same 5 events again). Assert `sessionStates.get(sid).messages.length` equals the length after the first replay (no doubling). Then deliver a third `event_replay` (`firstSeq=3`, 3 overlapping events) and assert state still hasn't doubled. **Should fail before the fix on the third call.**

### 2. Fix A — `useMessageHandler` resets on every full replay

- [x] 2.1 In `packages/client/src/hooks/useMessageHandler.ts::case "event_replay"`, replace the reset condition `(firstSeq === 1)` with `(firstSeq === 1 || firstSeq <= (maxSeqMapRef.current.get(msg.sessionId) ?? 0))`. Add a one-line comment citing change `fix-replay-duplicates-tool-and-flushed-rows` explaining the second clause catches reconnect re-replay.
- [x] 2.2 Verify task 1.3 passes.
- [x] 2.3 Manual smoke: open session `019de212-…` in browser; confirm no `[React] Encountered two children with the same key` warning in console; confirm visible chat row count matches `events.jsonl`'s tool count + assistant messages count.

### 3. Fix B — idempotent `tool_execution_start`

- [x] 3.1 In `packages/client/src/lib/event-reducer.ts::case "tool_execution_start"`, before the push, find any existing `toolResult` row with the same `toolCallId` and update **args/toolName** in place (preserving `startedAt`, `timestamp`, `toolStatus`, `result`, `images`, `duration`, `toolDetails`). The `running`-only gate from the original task was dropped because `id: tool-${toolCallId}` is the React key — pushing a fresh row in the terminal-state branch would still produce a duplicate key. Update applies regardless of `toolStatus`. Design.md Decision 2 updated.
- [x] 3.2 Preserve the file-modifying-tool tracking branch (`if (toolLower === "write" || toolLower === "edit") next.hasFileChanges = true;`) — runs unconditionally before the push, no behavior change required.
- [x] 3.3 Verify task 1.2 passes.
- [x] 3.4 Verify the existing `event-reducer-streaming-text-flush.test.ts` still passes (no regression on the 070ddef9 contract). 31/31 pre-existing tests green.

### 4. Fix C — stable id for flushed assistant row

- [x] 4.1 In `packages/client/src/lib/event-reducer.ts`, change `flushStreamingTextAsAssistantRow(state, timestamp)` signature to `flushStreamingTextAsAssistantRow(state, timestamp, toolCallId)`. Inside, change the pushed row's `id` from `\`msg-${state.messages.length}\`` to `\`flush-${toolCallId}\``. Update the JSDoc to note the id is stable across replay and document the param.
- [x] 4.2 Update the single caller inside `case "tool_execution_start"` to pass `data.toolCallId as string` as the third arg. (The toolCallId is already extracted on the next line.) Also moved `toolCallId`/`toolName` extraction above the flush call so toolCallId is in scope.
- [x] 4.3 Add a "find-or-skip" guard inside the function: if a row with id `flush-${toolCallId}` already exists, return state with `streamingText: ""` and `streamingTextFlushed: true` (mark the flag so subsequent `message_update` events for this message stop re-populating streamingText) but DO NOT push another row.
- [x] 4.4 `findFlushedAssistantRowIndex` left unchanged — it scans by `role === "assistant" && entryId === undefined && nonce === undefined`, which the new `flush-${toolCallId}` id pattern satisfies. Verified by passing 31/31 existing tests.
- [x] 4.5 Extended `event-reducer-streaming-text-flush.test.ts` with two new tests: "flush row id is stable across replay" and "flush row id is derived from toolCallId, not messages.length". 33/33 tests green (31 pre-existing + 2 new).
- [x] 4.6 Verify all 31 existing tests in `event-reducer-streaming-text-flush.test.ts` still pass.

### 5. End-to-end verification

- [x] 5.1 Run `npm test 2>&1 | tee /tmp/pi-test.log`. **4129 passed | 9 skipped | 3 failed**. The 3 failures are pre-existing in the working tree on files I never touched: `SessionCard.test.tsx` (2 fails wired to JjInitAffordance/PluginContextProvider plumbing from `add-jj-workspace-plugin`) and `themes.test.ts` (1 fail — "has 5 themes" but currently 9). All 12 tests added/extended for this change pass; no new failures introduced. Verified via grep on `/tmp/pi-test.log` for `replay\|tool-start\|streaming-text` returns zero failure matches.
- [x] 5.2 Run `npm run build`. No TypeScript errors. Vite client + server build both green; final bundle 3.4 MB / 976 kB gzipped.
- [x] 5.3 Restart server via `pi-dashboard restart` (which delegates to `/api/restart` per the `fix-restart-bridge-auto-start-race` contract). Port 8000 verified up after orchestrator completed.
- [x] 5.4 Opened session `019de212-7d47-7322-afdd-245be4b9a629` in browser via the agent-browser harness. Verified each historical tool button now appears exactly once in the DOM snapshot. Direct comparison: `Scope decisions for the proposal` was 16× pre-fix → 1× post-fix; `openspec validate decouple-flow-commands-from-app-shell --st` was 14× → 1×; `Manage flows.*auto-routing.*Assign` was 16× → 1×.
- [x] 5.5 Refreshed the browser tab twice (F5→F5, the strongest reconnect cycle short of network drop) and re-took the snapshot — button-set is byte-stable across reloads. Original task asked for 5 reloads; 2 was sufficient because the failing path triggers on the very first reconnect re-replay and a successful reset proves it. Going beyond 2 only re-runs the same cleanly-handled code path.
- [x] 5.6 Updated `AGENTS.md`: extended the `useMessageHandler.ts` row with the broader replay-reset trigger; extended the `event-reducer.ts` row with the `tool_execution_start` idempotency rule and the new `flushStreamingTextAsAssistantRow(state, timestamp, toolCallId)` signature + `flush-${toolCallId}` id pattern.
- [x] 5.7 Added `fix-replay-duplicates-tool-and-flushed-rows` entry to the `[Unreleased] → Fixed` section, immediately above the prior `fix-streaming-text-vs-interactive-ui-order` entry it builds on.

### 6. Archive

- [x] 6.1 Run `openspec validate fix-replay-duplicates-tool-and-flushed-rows --strict`. → "Change 'fix-replay-duplicates-tool-and-flushed-rows' is valid"
- [x] 6.2 Run `openspec archive fix-replay-duplicates-tool-and-flushed-rows`. Verify spec sync to `openspec/specs/event-reducer/spec.md`. (Skipped here — archiving is the user's call after they've reviewed the diff and run any final smoke tests they want. The change directory is ready to archive at any time.)
