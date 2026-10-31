# Design: fix-backfill-elides-live-tools

## Context

See proposal.md (Why). Current behaviour, with citations:

- **Tail-only replay.** With `replayWindowMode: "tail-only"`, a full-stream subscribe delivers only the newest events. Everything older is a gap the client walks with `history_backfill` (`add-tail-only-replay-window`). A tool started long ago, such as a parallel `Agent` fan-out, has its `tool_execution_start` in that gap.
- **The store holds in-flight starts after a restart.** After a dashboard restart, the live bridge replay re-inserts `tool_execution_start` for in-flight calls of the last assistant message and leaves them without an end (`openspec/specs/session-end-orphan-heal/spec.md:98`, scenario at `:113-119`).
- **Splice.**
  - The `history_backfill_result` splice is documented "Touches `messages[]` and NOTHING ELSE" (`packages/client/src/hooks/useMessageHandler.ts:1151`, handler at `:1158`).
  - It reduces the segment from a fresh state and passes it through `finalizeBackfillSegment(seg.messages)` (`useMessageHandler.ts:1214`).
  - That function stamps every `running` row `elided` (`packages/client/src/lib/chat/event-reducer.ts:1571`).
  - `seg.toolCalls` is discarded.
- **Wrong premise.** The elision doc says a dangling start's end "is always ABOVE the slice — i.e. in content the client already holds" (`event-reducer.ts:1551`). That holds only for a call that has already ended. The archived `fix-lazy-history-backfill-ux` D5 scoped the stamp to backfill segments to spare live mid-run tools. `add-tail-only-replay-window` later moved such starts into backfill.
- **Renderer.**
  - `AgentToolRenderer` short-circuits on `cardStatus === "elided"` ahead of every `details.status` branch (`packages/subagents-plugin/src/client/AgentToolRenderer.tsx:438-458`). Those branches hardcode their shell status from `details.status`, not from `cardStatus`.
  - `ToolCallStep` renders the same "result not loaded" affordance (`packages/client/src/components/chat/ToolCallStep.tsx:265`).
- **No recovery: tick.** The top-level `tool_execution_update` arm (`event-reducer.ts:2539`) only acts `if (partialResult)` (`:2546`). It never touches `toolStatus` except through `reopenSessionEndedRow` (`:637`), which is scoped to `healedBy === "session_ended"`.
- **No recovery: heal.** A real `tool_execution_end` completes the row via `findLastIndex` (`:2640`). A synthesized heal is rejected unless the map entry is `running` (`:2625`), and after the splice the entry is absent.
- **No recovery: reconcile.** The stale reconcile probes only map entries with `startedAt` (`packages/client/src/hooks/useStaleToolReconcile.ts:145`). It closes a row on 200 (end in store) or 410 (end trimmed), and keeps it running on 404/202. Its supersede fallback needs `hasLaterAssistantInference` (`event-reducer.ts:577`), which is false when `emittedAtInferenceSeq` is unset.
- **Agent late ticks.** The Agent finalizer keeps a finished subagent's card terminal on a late tick via `keepTerminalRow` (`packages/subagents-plugin/src/client/toolRowFinalizer.ts:228`, called at `:255` when the prior row was not running). It restores `result` and `toolDetails` terminal keys, but not `toolStatus`.
- **Existing server derivation.** `findOpenToolCalls` (`packages/server/src/session/open-tool-calls.ts:51`) walks backwards to the last non-synthetic `agent_start`. It does not stop at `agent_end` and does not consider a later assistant inference. That is correct for the session-end heal (`packages/server/src/event-wiring.ts:681`), which must close a turn's dangling calls even after the turn ended.
- **Backfill handler.** `handleHistoryBackfill` yields once (`subscription-handler.ts:753`), re-checks the generation, compacts (`:767`) and sends (`:806`). There is no `await` from the post-yield check to `sendTo`.

## Goals / Non-Goals

**Goals:**
- After restart or reload, a call that is still executing renders running, never "result not loaded".
- That row stays closable by:
  - its real end;
  - the `session_ended` heal;
  - the stale reconcile (200/410);
  - the superseded heal, on post-splice inference evidence.
- A start whose call ended, died with its turn, or was superseded keeps resolving to `elided`.

**Non-Goals:**
- Changing the window shape or the backfill walk.
- Changing renderers.
- Nested calls (`parentToolCallId`).
- The initial windowed replay's head seam.
- Changing `findOpenToolCalls` semantics for the session-end heal.

## Decisions

### D1. Serve-time open set on `history_backfill_result`, with a backfill-specific "open" rule

`history_backfill_result` gains optional `openToolCallIds?: string[]`. It is set only on the success path, computed after the post-yield generation check with no `await` before `sendTo`.

**Candidates.** The top-level (`parentToolCallId` absent) `tool_execution_start` ids in `compacted`, i.e. the served events after edge-snapping and compaction. If there are none, skip the computation and omit the field.

**Open rule.** This is a new pure helper, `findBackfillOpenToolCalls(candidates, suffix)`, next to `findOpenToolCalls`, with `suffix = eventStore.getEvents(sessionId, servedFrom)`. A candidate is open iff none of the following is stored after its start:
- a top-level `tool_execution_end` for it;
- a non-synthetic `agent_start` (earlier turn, so dead);
- an `agent_end` (turn over, so nothing still runs: abort or crash residue);
- an assistant `message_start`. pi starts the next inference only after every tool of the previous one ended, so a later inference proves the end was lost. This matches the bridge-replay rule that open calls in earlier assistant messages are dead (`session-end-orphan-heal` spec:98).

`findOpenToolCalls` stays unchanged; the session-end heal needs its wider net.

**Moved sessions.** Omit the field when the session record has `movedTo`. Its calls continue on the new host and this store will never receive their ends (`event-wiring.ts:674-677`), so reporting them open would leave permanent spinners.

**Why serve time.** Event-loop atomicity:
- An end stored before the computation excludes its id. Its live frame was already sent ahead of the result, so the row elides, which is correct because the call is done.
- An end stored after it is sent after the result and completes the `running` row via `findLastIndex`.
- No generation re-check is needed between the computation and `sendTo`, because nothing yields in between.

**Alternatives rejected:**
- Carrying the set on `history_window` (subscribe time): it goes stale before a backfill that can arrive minutes later, and stale ids are permanent spinners.
- Client-only matching via `SessionState.subagents`: `agentId`-bearing ticks may sit in a newer, already-spliced segment where they were dropped as row-less. `SubagentState` has no `toolCallId`, and the approach would not cover non-Agent tools.
- Reusing `findOpenToolCalls` as is: it reports calls whose turn ended (abort residue) and calls superseded within the turn.

**Cost.** `getEvents` copies the store suffix from `servedFrom`, O(suffix) per backfill step. That is bounded by the per-session store cap and the short walk, and skipped on empty slices. No new index.

### D2. Splice honours the set and seeds a complete `toolCalls` entry (explicit splice-invariant exception)

`finalizeBackfillSegment(messages, openToolCallIds?)` skips the elision for listed ids. For each kept-running row lacking a `current.toolCalls` entry, the splice seeds:

`{ toolCallId, toolName, args, status: "running", startedAt: row.startedAt ?? <segment start ts>, emittedAtInferenceSeq: current.assistantInferenceSeq }`

- `startedAt` makes the row visible to the stale reconcile.
- `emittedAtInferenceSeq` is set to the current inference counter. The supersede proof (`>`) therefore starts false, and becomes true only on a strictly later assistant inference observed after the splice, which is genuine evidence the end was lost.
- This is the only bookkeeping the splice touches beyond `messages[]`. The `session-history-backfill` splice requirement is MODIFIED to name the exception, and the "NOTHING ELSE (D10)" comment at `useMessageHandler.ts:1151` is updated to match.

### D3. Revive-on-tick backstop

In the top-level `tool_execution_update` arm, after the nested early-return (`isNestedToolEvent`, `event-reducer.ts:2540`) and before the `if (partialResult)` guard, run `reviveElidedRow`: if the row is `elided`, apply the following.
- Set `toolStatus: "running"`.
- If `toolDetails` exists, set `toolDetails.status: "running"` and drop heal-only keys, mirroring `reopenSessionEndedRow`.
- Seed the map entry exactly as D2 does.

The revive runs before the Agent finalizer call, so `onToolExecution` still hydrates `SessionState.subagents` from the tick. The `turn_settled` keep-terminal block cannot be bypassed, because an `elided` row is only ever stamped from `running`, never from a heal-settled terminal row.

**Late tick for a finished subagent.** `keepTerminalRow` additionally restores the prior row's `toolStatus` and removes or restores the map entry the revive seeded. A late tick for a subagent the client records as terminal therefore leaves the card as it was (contract: no spurious spinner).

**Precedent.** This extends `session-end-orphan-heal` "A live tick SHALL reopen a `session_ended`-healed tool card": core reopens the row, and the `Agent` finalizer runs afterwards. `elided` is neither a heal marker nor a real end, so that requirement's "real terminal row is never reopened" guard is unaffected.

**No live-only gate.** An `elided` row exists only after a splice. Every later update reaching the reducer is either live or part of a delta replay of newer events. Both prove the call ran after the start, and a following end in the same stream closes it.

**Why both D2 and D3.**
- D3 alone fixes ticking `Agent` calls but leaves a brief flash, and never fixes silent tools.
- D2 alone misses an old server.
- They are independent and composable.

### D4. Wire compatibility

The field is optional and additive.

| Server | Client | Outcome |
|---|---|---|
| Old | New | No field. Elision, then D3 revives on the first tick. |
| New | Old | Field ignored. Today's behaviour. |

## Risks / Trade-offs

- **[Risk] A shed live `tool_execution_end` (backpressure).** → The kept or revived row has a seeded entry with `startedAt`, so the stale reconcile closes it on 200/410. If the store still reports 404 and a later inference arrives, the superseded heal closes it (D2 `emittedAtInferenceSeq`).
- **[Risk] O(suffix) copy per backfill step.** → Accepted (D1 Cost). Revisit with a bounded reverse scan only if profiling shows it.
- **[Risk] A pre-tail start whose end was trimmed looks open.** → The store trims oldest-first, so an end cannot be trimmed while its older start survives.
- **[Trade-off] A silent still-running call against an old server** stays `elided` until its end arrives. Same as today.
- **[Trade-off] Superseded-heal eligibility of a seeded entry counts only inferences after the splice.** Pre-splice inference evidence is already applied server-side by the D1 open rule.

## Migration Plan

No data migration. Server and client deploy independently (D4). Rollback means reverting both. A mixed old/new deployment degrades to today's behaviour plus D3.
