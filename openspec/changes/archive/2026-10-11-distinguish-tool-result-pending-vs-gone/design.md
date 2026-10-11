## Context

See proposal.md (Why). Current state (line numbers approximate):

- **Route** (`packages/server/src/routes/session-routes.ts`, ~`:199-217`): `networkGuard` pre-handler, then `gateHttpSession` (owner gate), then `200` when `eventStore.findToolEndEvent` hits, otherwise `404`. Its deps come through `registerSessionRoutes`, wired in `packages/server/src/server.ts` (~`:2144`).
- **Event drops** in `packages/server/src/persistence/memory-event-store.ts`:
  - `trimBufferToLimit` (~`:373`, two passes: oldest non-essential events, then oldest overall);
  - `dropNonEssentials` (~`:1292`, global-budget fallback when every session is pinned).

  Both already count dropped `tool_execution_end` events (`toolEndDropped`). Whole buffers go via LRU `evictIfNeeded` (~`:1253`) and `deleteEventsForSession` (~`:1832`). Per-buffer state such as `collapseIndex` lives on `SessionBuffer` (~`:276`), so it is freed with the buffer.
- **Why "not in flight" cannot be inferred** (doubt-review cycles 1–2):
  - a live reconnect replay orphan-closes still-running calls (`packages/extension/src/session-sync.ts` → `replayEntriesAsEvents` → `packages/shared/src/state-replay.ts` orphan loop);
  - after a register the status is `active` until the bridge's synthetic `agent_start`, which arrives after `replay_complete`;
  - heartbeat reconcile can flip `streaming`→`idle` mid-turn;
  - `agent_end` is not the turn's terminal signal (`agent_settled` is);
  - user `!` bash can run outside a turn.

  Any status- or registry-based "nothing is running" claim is therefore unsound.
- **Client** (`packages/client/src/hooks/useStaleToolReconcile.ts`):
  - polls every 5 s and probes rows `running` > 25 s, re-armed every 15 s;
  - `!res.ok` counts as a 404;
  - the supersede heal needs ≥2 404s plus a later assistant `message_start`. Its proof is sound because a new inference starts only after every prior tool result is in.

  The reducer's synth guard (`event-reducer.ts`, `tool_execution_end` arm) finalizes only `running` rows and lets a real end overwrite a placeholder.
- **Full output** (`packages/client/src/hooks/useToolFullResult.ts`): on `!res.ok` it shows `body.error` first, so today's `404` prints the server's raw string. The `bash-execution` spec says "result evicted".

## Goals / Non-Goals

**Goals:**
- An in-flight long tool produces no 4xx in the browser.
- A trimmed result finalizes its card on the first probe.
- No new path can finalize a tool that is still running.
- Old tabs keep working.

**Non-Goals:**
- Keeping trimmed results recoverable (the deferred "terminal-event keepalive").
- Changing trim policy or budgets.
- Fixing the reconnect orphan-close of running calls (a pre-existing behaviour, noted for a follow-up).
- Reconciling nested calls.
- Changing the poll cadence.

## Decisions

- **D1 — `410` only from a recorded fact: the evicted-end record.** `SessionBuffer` gains a bounded insertion-ordered set of `toolCallId`s (capacity 512), filled where `toolEndDropped` is counted today (both `trimBufferToLimit` passes and `dropNonEssentials`). The store exposes `wasToolEndEvicted(sessionId, toolCallId)`.
  - Records only **real** ends: an end carrying `healedBy` (the session-end heal in `open-tool-calls.ts`, or the replay orphan-close in `state-replay.ts`, both `healedBy: "session_ended"`) is never recorded, because the orphan-close can describe a call that is still running. Ids over 256 characters are not recorded (byte bound).
  - A live top-level start removes its id from the record (re-emitted or reused ids).
  - Recording happens inside the drop loops. `trimBufferToLimit` and `dropNonEssentials` run on the buffer, so they push to `buf.evictedToolEnds` directly; no return-type change is needed for the callers.
  - Lives and dies with the buffer: LRU eviction and `deleteEventsForSession` free it, so memory is bounded by `maxCachedSessions × 512` ids.
  - Overflow or a freed record only degrades to `404`, which is today's behaviour.
  - A replay that re-stores the end makes rule 1 (`200`) win.

  *Alternatives rejected:*
  - Vouching "not in flight" from status, replay completion or bridge connection (cycles 1–2 found false `410`s on each);
  - a process-wide map (leaks past buffer eviction, the same pattern the `collapseIndex` comment warns about).
- **D2 — The in-flight hint only picks `202` vs `404`.** A module `packages/server/src/session/in-flight-tool-calls.ts`: `observeLive`, `isInFlight`, `clear`; an emptied session is removed. It is fed only in the live (non-replaying) event-forward branch of `event-wiring.ts`; replayed `agent_settled`/ends never reach it. It is cleared on live `agent_settled` (the turn's terminal signal, not `agent_end`), every `session_register`, session end (`sessionManager.onEnded`, next to the open-tool heal) and session removal (`memory-session-manager.ts` `remove`, used by archive). It is capped at 256 ids per session. Clearing on register means a call already running across a reconnect answers `404` (today's behaviour) until it ends. That is accepted: re-seeding from replayed events would reintroduce the orphan-close hazard. Its errors are cosmetic either way: a stale entry gives `202` instead of `404`, and a missing entry gives `404` instead of `202`. Neither finalizes anything (D4).
- **D3 — `202` is opt-in (`pending` must equal `"1"`).** An old client treats any 2xx as a completed result. `410` is non-2xx and needs no opt-in.
- **D4 — Client: `202` counts like `404`; `410` heals at once.** `202` and `410` are branched before the `res.ok` test.
  - `202` increments the unrecovered-probe count (today's not-found count), so the supersede heal still fires once a later inference proves completion. This makes a stale hint harmless. For the heal it is **exactly today's behaviour**: today an in-flight call answers `404`, which already counts. So any pre-existing edge of the inference proof (e.g. a user `!` bash row outside a turn, whose `emittedAtInferenceSeq` is just the current counter) is neither introduced nor widened here; it is recorded for a follow-up.
  - `410` dispatches `synthesizeEvictedEnd` (`healedBy: "result_evicted"`, body "result no longer available"), increments the heal counter, and badges the card. `ToolCallStep.tsx` (~`:100`, today `healedBy === "superseded"` only) gains the eviction badge. The placeholder uses `isError: false`, like the superseded heal: the original outcome is unknown, and the badge says so.
  - The reducer guard is unchanged.
- **D5 — Order of route checks:** stored end → evicted record → in-flight hint (+ opt-in) → `404`. The owner gate runs before all of them.
- **D6 — Observability:** cumulative route counters `{ pending, gone }`, exposed as `toolResult` in `/api/health` (`packages/server/src/routes/system-routes.ts`, next to `storeTrim`) through a stats sink passed as a route dep.
- **D7 — Full output:** `useToolFullResult` maps `404` **and** `410` to `t("tool.resultEvicted")` ahead of the `body.error` fallback, matching the `bash-execution` spec. It does not send `pending=1`.

## Risks / Trade-offs

- [A loss the record cannot see — a dropped live frame while the end is still stored — answers `200`, not `410`] → That is the existing recovery path working as designed.
- [A record overflow (more than 512 ends dropped in one session) brings back the `404` + supersede behaviour for the oldest losses] → It degrades to today's behaviour. The cap is a constant, so it can be raised if `/api/health` `toolResult` shows it matters.
- [The heal counter and badge are not rolled back if a real end later overwrites an eviction placeholder] → Accepted. The overwrite itself is correct.
- ["Show full output" on a still-running call shows "result evicted"] → This is today's `404` behaviour, now made explicit in `bash-execution`. Sending `pending=1` there and adding a "still running" copy is a follow-up.
- [Old tab: "Show full output" on a `410` prints "result no longer available" instead of "tool call still in flight or unknown"] → Accepted. The new text is more accurate, and the old client still treats `410` as an error.

## Migration Plan

No persisted state. The server and client are independently compatible (D3, and a new client against an old server only sees `200`/`404`). Rollback: revert.
