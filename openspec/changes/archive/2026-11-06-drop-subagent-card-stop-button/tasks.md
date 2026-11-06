# Tasks

## 1. Tests first (red)

- [x] 1.1 In `packages/subagents-plugin/src/client/__tests__/AgentToolRenderer.queue-stop.test.tsx` (harness exemplar: the same file's `card()` helper), add the case: a stoppable queued card and a stoppable running card render · no stop requested · no `agent-stop-button` and no `agent-stop-row` (test-plan #E1). Keep the older-producer assertion (test-plan #E2).
- [x] 1.2 In the same file, rewrite #X1-#X3 to start the stop through the row path `agentStop({sessionId, toolCallId, toolDetails:{agentId, stoppable:true}})` inside `act` (await a microtask flush; `agentStop` fires `requestSubagentStop` with `void`), and drop the `agent-stop-button` disabled assertions: refused 403 · row stop · card shows the reason (test-plan #X1); 200 + fake timers · row stop, advance 10 s · pending, then unconfirmed (test-plan #X2); pending · terminal rerender · notice cleared (test-plan #X3).
- [x] 1.3 In `packages/client/src/components/__tests__/ToolCallStep.row-status-stop.test.tsx` (harness exemplar: its `renderRow`), add: a running row with a claim `stop` that returns `true`, collapsed by a header click · click `tool-stop-button` · the row body is rendered and `onAbort` is not called (test-plan #E3). Also: a claim `stop` that returns `false` or throws, row collapsed · click · the row stays collapsed and `onAbort` is called once (test-plan #E4).
- [x] 1.4 In `tests/e2e/subagent-queue-stop.spec.ts` #F4 (harness exemplar: #F3 in the same file, which already clicks `tool-stop-button`), click the running row's `tool-stop-button` instead of `agent-stop-button`, and assert `agent-stop-button` has count 0: queued fan-out · row stop · "stopped by you", former #1 starts within 3 s (test-plan #F4).

## 2. Implementation (green)

- [x] 2.1 `packages/subagents-plugin/src/client/AgentToolRenderer.tsx`: remove the `agent-stop-button`. Render `agent-stop-row` only when `useSubagentStopState` returns a state, and keep the pending / unconfirmed / error spans. Drop the unused `requestSubagentStop`, `agentStopLabel` and `mdiStop` imports.
- [x] 2.2 `packages/client/src/components/chat/ToolCallStep.tsx`: give `withClaimStop` an `onConsumed` callback, called when the claim `stop` returns `true`. `ToolCallStep` passes `() => setExpanded(true)`.
- [x] 2.3 Run `npm test`; rebuild the client and restart (`npm run build && npx tsx .pi/skills/implement/scripts/restart-server.ts`).

## 3. Docs + review

- [x] 3.1 Update the AGENTS.md rows: `packages/subagents-plugin/src/client/AGENTS.md` (`AgentToolRenderer.tsx`: no card stop; feedback-only line) and `packages/client/src/components/chat/ToolCallStep.tsx.AGENTS.md` (claim-handled stop expands the row). See change: drop-subagent-card-stop-button.
- [x] 3.2 Run `review-code` on the diff before commit.
- [x] 3.3 Manual check in a live gap-miner fan-out, dark and light: one ■ per row, no card stop line, and the feedback line appears only after a stop (test-plan: manual-only, #V1).
