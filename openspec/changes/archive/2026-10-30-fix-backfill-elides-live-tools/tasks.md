# Tasks

## 1. Protocol + server open-call report

- [x] 1.1 Add optional `openToolCallIds?: string[]` to `HistoryBackfillResultMessage` in `packages/shared/src/browser-protocol.ts` with a doc comment (serve-time semantics, additive, absent on refusals and relocated sessions); verify `npx tsc --noEmit -p packages/shared` passes
- [x] 1.2 Add pure `findBackfillOpenToolCalls(candidateIds, suffix)` to `packages/server/src/session/open-tool-calls.ts` (open iff no later top-level end, non-synthetic `agent_start`, `agent_end`, or assistant `message_start`); leave `findOpenToolCalls` unchanged; verify by tasks 1.5-1.13
- [x] 1.3 In `handleHistoryBackfill` (`packages/server/src/browser-handlers/subscription-handler.ts`), after the post-yield generation check and with no `await` before `sendTo`, take top-level start ids from `compacted`, skip when none, omit when the session has `movedTo`, else set `openToolCallIds` from `findBackfillOpenToolCalls(ids, eventStore.getEvents(sessionId, servedFrom))`; verify by tasks 1.14-1.18
- [x] 1.4 Update `packages/server/src/session/AGENTS.md`, `packages/server/src/browser-handlers/AGENTS.md` and `packages/shared/src/browser-protocol.ts.AGENTS.md` rows; verify each mentions `fix-backfill-elides-live-tools`
- [x] 1.5 Test (see `packages/server/src/session/__tests__/open-tool-calls.test.ts`): suffix `[start c1, update c1, update c1]` · `findBackfillOpenToolCalls(["c1"], suffix)` · returns `["c1"]` (test-plan #E1)
- [x] 1.6 Test (see `packages/server/src/session/__tests__/open-tool-calls.test.ts`): suffix `[start c1, end c1]` and `[start c1, end c1 healedBy session_ended]` · same call · returns `[]` for both (test-plan #E2)
- [x] 1.7 Test (see `packages/server/src/session/__tests__/open-tool-calls.test.ts`): `[start c1, agent_start]` · same call · `[]` (test-plan #E3)
- [x] 1.8 Test (see `packages/server/src/session/__tests__/open-tool-calls.test.ts`): `[start c1, agent_start synthetic:true]` · same call · `["c1"]` (test-plan #E4)
- [x] 1.9 Test (see `packages/server/src/session/__tests__/open-tool-calls.test.ts`): `[start c1, agent_end]` · same call · `[]` (test-plan #E5)
- [x] 1.10 Test (see `packages/server/src/session/__tests__/open-tool-calls.test.ts`): `[start c1, message_start role assistant|toolResult|user]` · same call · assistant `[]`, toolResult `["c1"]`, user `["c1"]` (test-plan #E6)
- [x] 1.11 Test (see `packages/server/src/session/__tests__/open-tool-calls.test.ts`): `[start c1 parentToolCallId p]`, candidates `["c1"]` · same call · `[]` (test-plan #E7)
- [x] 1.12 Test (see `packages/server/src/session/__tests__/open-tool-calls.test.ts`): `[start c1, start c2, end c1]`, candidates `["c1","c2","c3"]` · same call · `["c2"]` only (test-plan #E8)
- [x] 1.13 Timed test (see `packages/server/src/session/__tests__/open-tool-calls.test.ts`): 50,000-event suffix, 20 candidates, 1 warm-up · median of 5 runs of `findBackfillOpenToolCalls` · < 25 ms (test-plan #P1)
- [x] 1.14 Test (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`): open start c1 just below snapped gap-facing edge, open c2 inside slice · `history_backfill` · `openToolCallIds` = `["c2"]` (test-plan #E9)
- [x] 1.15 Test (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`): sparse range compacting to empty · `history_backfill` · no `openToolCallIds` key and `getEvents` spy not called (test-plan #E10)
- [x] 1.16 Test (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`): `not_subscribed`/`in_flight`/`out_of_range`/`stale_generation` setups · `history_backfill` · `error` set, no `openToolCallIds` key (test-plan #E11)
- [x] 1.17 Test (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`): session `movedTo` set, open start in slice · `history_backfill` · no `openToolCallIds` key (test-plan #E12)
- [x] 1.18 Test (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`): open start c1 in slice · insert `tool_execution_end c1` during the handler's `setImmediate` yield · result lacks c1 (test-plan #E13)

## 2. Client splice + reducer + Agent finalizer

- [x] 2.1 `finalizeBackfillSegment(messages, openToolCallIds?)` in `packages/client/src/lib/chat/event-reducer.ts` skips elision for listed ids; rewrite its doc comment (drop the "end is always ABOVE the slice" claim); verify by tasks 2.7-2.8
- [x] 2.2 Add `reviveElidedRow` in the top-level `tool_execution_update` arm AFTER the `isNestedToolEvent` early-return and BEFORE the `if (partialResult)` guard and the Agent finalizer call: `elided` → `running`, `toolDetails.status` → `running` minus heal-only keys, seed absent map entry `{status:"running", startedAt: row.startedAt, emittedAtInferenceSeq: state.assistantInferenceSeq}`; verify by tasks 2.9-2.15
- [x] 2.3 In `keepTerminalRow` (`packages/subagents-plugin/src/client/toolRowFinalizer.ts`) also restore the prior row's `toolStatus` and the prior map entry state, so a late tick for a terminal subagent leaves an elided card as it was; verify by tasks 2.16-2.17
- [x] 2.4 In the `history_backfill_result` splice (`packages/client/src/hooks/useMessageHandler.ts`) pass `new Set(msg.openToolCallIds ?? [])` and seed the same complete map entry for each kept-running row missing from `current.toolCalls`; update the "NOTHING ELSE (D10)" comment to name the exception; verify by tasks 2.18-2.25
- [x] 2.5 Promote the spike reproduction (commit `4dd743584`, `spike.backfill-elides-live-tools.test.ts`) into new `packages/client/src/lib/__tests__/event-reducer.revive-elided.test.ts`, then remove the spike worktree + branch; verify `git branch --list spike/backfill-elides-live-tools` is empty
- [x] 2.6 Update `packages/client/src/lib/chat/event-reducer.ts.AGENTS.md`, `packages/client/src/hooks/useMessageHandler.ts.AGENTS.md` and `packages/subagents-plugin/src/client/AGENTS.md` rows; verify each mentions `fix-backfill-elides-live-tools`
- [x] 2.7 Test (see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts`): folded segment with running `a`, `b` and a nested start under `a` · `finalizeBackfillSegment(msgs, new Set(["a"]))` · `a` running, `b` elided, no nested row (test-plan #E14)
- [x] 2.8 Test (see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts`): same segment · `finalizeBackfillSegment(msgs)` · `a` and `b` elided, as before the change (test-plan #E15)
- [x] 2.9 Test (see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts`, new `event-reducer.revive-elided.test.ts`): spliced elided Agent row with `toolDetails{status:"completed", healedBy:"turn_settled"}`, `startedAt:1000`, `assistantInferenceSeq:3` · top-level update with structured `partialResult{details:{status:"running"}}` · row running, `toolDetails.status` running without `healedBy`, map entry `{running, startedAt:1000, emittedAtInferenceSeq:3}` (test-plan #F1)
- [x] 2.10 Test (see `event-reducer.revive-elided.test.ts` from 2.5): spliced elided Bash row · update with no `partialResult`, and with a plain-string `partialResult` · row running and map seeded in both cases (test-plan #F2)
- [x] 2.11 Test (see `event-reducer.revive-elided.test.ts`): spliced elided row `r` · `tool_execution_update{parentToolCallId:"r"}` · `r` stays elided, no map entry (test-plan #F3)
- [x] 2.12 Test (see `event-reducer.revive-elided.test.ts`): revived row from #F1 · `tool_execution_end{isError:false, result:"done"}` · row complete with result done (test-plan #F4)
- [x] 2.13 Test (see `event-reducer.revive-elided.test.ts`): a revived row and a splice-kept row · `tool_execution_end{healedBy:"session_ended", isError:true}` · both rows error (test-plan #F5)
- [x] 2.14 Test (see `event-reducer.revive-elided.test.ts`): revived row with `emittedAtInferenceSeq:3` · no new inference vs one assistant `message_start` after the revive · `hasLaterAssistantInference` false vs true (test-plan #F6)
- [x] 2.15 Test (see `event-reducer.revive-elided.test.ts`): row completed by a real end · late top-level update · stays complete (test-plan #F7)
- [x] 2.16 Test (see `packages/subagents-plugin/src/client/__tests__/toolRowFinalizer.test.ts`): spliced elided Agent row, subagent `ag-1` completed, finalizer registered · tick with `details.agentId:"ag-1"` · row stays elided and no running map entry remains (test-plan #F8)
- [x] 2.17 Test (see `packages/client/src/test-support/subagents-reducer-slice.ts` usage in `toolRowFinalizer.test.ts`): spliced elided Agent row, subagent unknown, finalizer registered · tick `details{agentId:"ag-2", status:"running"}` · row running and `subagents.get("ag-2").status` running (test-plan #F9)
- [x] 2.18 Test (see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`): windowed session with divider placed · `history_backfill_result` `[start c1]`, `openToolCallIds:["c1"]` · row c1 running and `toolCalls.get("c1")` running with row `startedAt` (test-plan #F10)
- [x] 2.19 Test (see `useMessageHandler.history-gap.test.tsx`): same as #F10 · same result · `maxSeqMap` unchanged, `publishSessionEvents` not called, replay persister not written, `toolCalls` gained exactly c1 (test-plan #F11)
- [x] 2.20 Test (see `useMessageHandler.history-gap.test.tsx`): same gap · result without `openToolCallIds` · c1 elided, `toolCalls` unchanged (test-plan #F12)
- [x] 2.21 Test (see `useMessageHandler.history-gap.test.tsx`): `current.toolCalls` already holds c1 with `startedAt:5` · result reporting c1 open · entry keeps `startedAt:5` (test-plan #F13)
- [x] 2.22 Test (see `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts`): state after #F10, clock past `staleMs` · stale selection runs · c1 selected for the `tool-result` probe (test-plan #F14)
- [x] 2.23 Test (see `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts`): kept-running c1, live end never delivered · probe mocked 200 with stored end · row complete with the server result (test-plan #X1)
- [x] 2.24 Test (see `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts`): as #X1 · probe mocked 410 · row reaches the reconcile's 410 terminal state, never left running (test-plan #X2)
- [x] 2.25 Test (see `useMessageHandler.history-gap.test.tsx`): result without `openToolCallIds` for a still-ticking Agent · splice, then live tick · elided, then running (test-plan #X3)

## 3. End-to-end restart regression

- [x] 3.1 Add faux scenario `subagent-long-stream-hold` to `qa/fixtures/faux-scenarios.ts` (one Agent call whose subagent streams ≥150 events then holds ≥60s; model on `subagent-streaming-inner` and the `session-death-open-tool` hold); verify the faux scenario unit/type checks pass
- [x] 3.2 E2E (see `tests/e2e/replay-live-tool-not-orphaned.spec.ts` + `tests/e2e/helpers/windowed-session.ts`): `maxReplayEvents:100`, `tail-only`, session running `subagent-long-stream-hold` · `POST /api/restart`, reload, backfill until the Agent row is spliced · card running, no "result not loaded" for that call, converges to completed after the hold (test-plan #F15)
- [x] 3.3 E2E (same exemplars, same spec file): same arrangement without server restart · `page.reload()`, backfill to the Agent row · same invariants as #F15 (test-plan #F16)
- [x] 3.4 Add rows for the new spec and faux scenario to `tests/e2e/AGENTS.md` / `qa/fixtures` AGENTS rows; verify they mention `fix-backfill-elides-live-tools`

## 4. Docs

- [x] 4.1 Delegate (DocScribe, caveman style) a `docs/faq.md` entry "Subagent card says 'result not loaded' after restart while the dock shows it running" naming root cause + fix; verify via `grep -n "result not loaded" docs/faq.md`
