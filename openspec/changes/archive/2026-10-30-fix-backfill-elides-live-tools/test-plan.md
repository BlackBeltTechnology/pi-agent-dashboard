# Test Plan: fix-backfill-elides-live-tools

Stage: design   Generated: 2026-10-30

Hard-gate clarifications, resolved via `ask_user`:
- L3 restart regression **included**. It needs a new faux scenario (see New infra).
- Perf budget: open-set computation over a 50k-event suffix **< 25 ms** (L1 timed).

---

## Scenarios

### Edge-case

Server open rule, L1, `packages/server/src/session/__tests__/open-tool-calls.test.ts`:

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | session-history-backfill: open-call report / "still-running served start is reported open" | decision-table (all exclusions false) | L1 | automated | suffix `[start c1, update c1, update c1]` | `findBackfillOpenToolCalls(["c1"], suffix)` | returns `["c1"]` |
| E2 | "served start whose end is stored is not reported open" | decision-table | L1 | automated | suffix `[start c1, end c1]`; second case `[start c1, end c1 {healedBy:"session_ended"}]` | same call | returns `[]` in both cases |
| E3 | "start from an earlier turn is not reported open" | decision-table | L1 | automated | `[start c1, agent_start]` | same call | `[]` |
| E4 | "synthetic re-announcement does not end the turn" | decision-table (boundary: synthetic flag) | L1 | automated | `[start c1, agent_start{synthetic:true}]` | same call | `["c1"]` |
| E5 | "start in an ended turn is not reported open" | decision-table | L1 | automated | `[start c1, agent_end]` | same call | `[]` |
| E6 | "start superseded by a later inference is not reported open" | EP on message role | L1 | automated | (a) `[start c1, message_start{role:"assistant"}]`; (b) `[start c1, message_start{role:"toolResult"}]`; (c) `[start c1, message_start{role:"user"}]` | same call | (a) `[]`; (b) `["c1"]`; (c) `["c1"]` |
| E7 | "nested starts are never reported" | EP | L1 | automated | `[start c1 {parentToolCallId:"p"}]`, candidates `["c1"]` | same call | `[]` |
| E8 | multi-candidate ordering + independence | EP | L1 | automated | `[start c1, start c2, end c1]`, candidates `["c1","c2","c3"]` (c3 absent from suffix) | same call | `["c2"]` only; c3 not invented |

Handler, L1, `packages/server/src/__tests__/subscription-handler-backfill.test.ts`:

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E9 | "only starts actually served are reported" | BVA on slice edge | L1 | automated | gap holding open start `c1` just below the snapped gap-facing edge, and open start `c2` inside the slice | `history_backfill` for the range | result `openToolCallIds` = `["c2"]` |
| E10 | field omitted when nothing served | BVA (empty) | L1 | automated | sparse gap range whose compacted slice is empty | `history_backfill` | result has no `openToolCallIds` key; `getEvents` spy not called |
| E11 | "a refusal carries no open calls" | EP over refusal kinds | L1 | automated | `not_subscribed`, `in_flight`, `out_of_range`, `stale_generation` setups | `history_backfill` | each result has `error` set and no `openToolCallIds` key |
| E12 | "a relocated session reports no open calls" | EP | L1 | automated | session record `movedTo:"other-host"`, open start in slice | `history_backfill` | no `openToolCallIds` key |
| E13 | "an end stored while the request is in flight excludes the call" | state-transition (race) | L1 | automated | open start `c1` in slice | insert `tool_execution_end c1` into the store during the handler's `setImmediate` yield | result lacks `c1` |

Splice finalize, L1, `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts`:

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E14 | event-reducer: "reported-open tool … stays running" + "every unfinished tool … is elided" | decision-table | L1 | automated | folded segment with running rows `a`, `b`, a nested start under `a` | `finalizeBackfillSegment(msgs, new Set(["a"]))` | `a` running, `b` elided, no nested row created |
| E15 | regression of archived E24 (no set) | EP (absent arg) | L1 | automated | same segment | `finalizeBackfillSegment(msgs)` | `a` and `b` elided (identical to pre-change) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D1 Cost (user-set budget) | threshold, timed | L1 | automated | 50,000-event suffix (mixed updates/messages, one `agent_start` at index 0), 20 candidate ids, in `open-tool-calls.test.ts` | median of 5 runs of `findBackfillOpenToolCalls` < 25 ms | single test run, after 1 warm-up |

### Frontend-quirk

Reducer state transitions, L1, `packages/client/src/lib/__tests__/` (new `event-reducer.revive-elided.test.ts`, seeded from the spike test at commit `4dd743584`):

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | event-reducer: "live update revives an elided tool call" | state-transition elided→running | L1 | automated | spliced elided Agent row with `toolDetails{status:"completed", healedBy:"turn_settled"}`, `startedAt:1000`, state `assistantInferenceSeq:3` | top-level `tool_execution_update` with structured `partialResult{details:{status:"running"}}` | row `toolStatus:"running"`; `toolDetails.status:"running"`, no `healedBy`; `toolCalls.get(id)` = `{status:"running", startedAt:1000, emittedAtInferenceSeq:3}` |
| F2 | "…with or without a partial result" | EP on partialResult shape | L1 | automated | spliced elided Bash row | (a) update with no `partialResult`; (b) plain-string `partialResult` | row running in both cases; map entry seeded |
| F3 | "nested update never revives an elided root" | illegal transition | L1 | automated | spliced elided row `r` | `tool_execution_update{parentToolCallId:"r"}` | `r` stays `elided`; no map entry for `r` |
| F4 | revived row closes on its real end | state-transition running→complete | L1 | automated | revived row from F1 | `tool_execution_end{isError:false, result:"done"}` | row `complete`, result `done` |
| F5 | revived/kept row closes on the `session_ended` heal | state-transition running→error | L1 | automated | revived row; separately a splice-kept row | `tool_execution_end{healedBy:"session_ended", isError:true}` | row `error` in both cases (heal gate passes because the map entry is running) |
| F6 | "superseded only by a later inference" | BVA on inference counter | L1 | automated | revived row with `emittedAtInferenceSeq:3` | (a) no new inference; (b) one assistant `message_start` after the revive | `hasLaterAssistantInference`: (a) false; (b) true |
| F7 | real-terminal rows are never revived | illegal transition | L1 | automated | row completed by a real end | late top-level update | stays `complete` |
| F8 | "late update for a finished subagent does not revive" | decision-table (subagent terminal × row elided) | L1 | automated | spliced elided Agent row, subagent `ag-1` `completed` in `SessionState.subagents`, subagents finalizer registered (`toolRowFinalizer.test.ts`) | tick with `details.agentId:"ag-1"` | row `toolStatus:"elided"`; no `running` map entry remains for the call |
| F9 | "revived subagent call still hydrates its subagent" | state-transition | L1 | automated | spliced elided Agent row; subagent unknown to the client; finalizer registered (`test-support/subagents-reducer-slice.ts`) | tick with `details{agentId:"ag-2", status:"running"}` | row running; `subagents.get("ag-2").status === "running"` |

Splice hook, L1, `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`:

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F10 | session-history-backfill: "reported-open spliced call becomes tracked as running" | state-convergence | L1 | automated | windowed session with gap divider placed | `history_backfill_result` with `[start c1]`, `openToolCallIds:["c1"]` | row c1 running; `toolCalls.get("c1")` running with `startedAt` = row startedAt |
| F11 | "Splice leaves live-event bookkeeping untouched" (modified) | invariant | L1 | automated | same as F10 | same | `maxSeqMap` unchanged; `publishSessionEvents` not called; replay persister not written; `toolCalls` gained exactly `c1` |
| F12 | field absent (old server) | EP | L1 | automated | same gap | result without `openToolCallIds` | c1 `elided`; `toolCalls` unchanged |
| F13 | already-tracked id is not overwritten | EP | L1 | automated | `current.toolCalls` already has `c1` with `startedAt:5` | result reporting `c1` open | entry keeps `startedAt:5` |
| F14 | seeded entry is reconcile-eligible | invariant | L1 | automated | state after F10, clock advanced beyond `staleMs` (`useStaleToolReconcile` test glue) | stale-tool selection runs | `c1` is selected for the `tool-result` probe |

End-to-end, L3:

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F15 | proposal Why / on-demand-session-replay "backfilled start the server reports open stays running" | state-transition across restart | L3 | automated | `maxReplayEvents:100`, `replayWindowMode:"tail-only"`; session running new faux `subagent-long-stream-hold` (Agent call streams ≥150 events, then holds ≥60s) | `POST /api/restart`, reload, scroll to load backfill until the Agent row is spliced | Agent card shows a running state; no element with text "result not loaded" for that call; after the hold ends the card converges to completed |
| F16 | same, browser reload only | state-transition | L3 | automated | same arrangement, server not restarted | `page.reload()`, backfill to the Agent row | same invariants as F15 |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design Risk "shed live end" | fault-injection (abort: live end dropped) | L1 | automated | kept-running `c1` (F10 state); live `tool_execution_end` never delivered | stale reconcile probe returns 200 with the stored end (`useStaleToolReconcile` test glue, mocked fetch) | row `complete` with the server result |
| X2 | same, end trimmed | fault-injection (abort) | L1 | automated | as X1 | probe returns 410 | row reaches the terminal state the reconcile assigns for 410 (no lingering `running`) |
| X3 | wire compat: new client, old server | fault-injection (missing field) | L1 | automated | `history_backfill_result` without `openToolCallIds` for a still-ticking Agent | splice, then live tick | elided, then running after the tick (F12 + F1 chained in one hook test) |

---

## Coverage summary

- Requirements covered: 4/4 delta requirements.
  - session-history-backfill ADDED: E1-E13.
  - session-history-backfill MODIFIED splice: F10-F13.
  - event-reducer tool state machine: E14-E15, F1-F9.
  - on-demand-session-replay orphan tolerance: E14, F1, F8, F15-F16.
- Scenarios by class: edge 15 · perf 1 · frontend 16 · error 3
- Scenarios by level: L1 33 · L2 0 · L3 2
- Scenarios by disposition: automated 35 · manual-only 0

## New infra needed

- Faux scenario `subagent-long-stream-hold` in `qa/fixtures/faux-scenarios.ts`: one `Agent` tool call whose subagent streams ≥150 events, then sleeps ≥60s before finishing. Model it on the existing `subagent-streaming-inner` (`qa/fixtures/faux-scenarios.ts:331`) and the hold of `session-death-open-tool`. No new harness, level or container: uses `helpers/windowed-session.ts` + `POST /api/restart`, as `replay-live-tool-not-orphaned.spec.ts` already does.
