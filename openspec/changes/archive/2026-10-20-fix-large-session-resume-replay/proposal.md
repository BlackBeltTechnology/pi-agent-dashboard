## Why

Issues:
- https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/929 — resume of a large session freezes the UI (full bridge replay, forced wipe, unwindowed `event_replay` flush).
- https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/928 — replay safety timeout leaks replayed history as live events; the OpenSpec "Replace attached proposal?" dialog reopens and stacks on resume.

Both defects sit on the same path: bridge replay on `session_register` → `replayingSessions` → `replay_complete` / 5 s safety timeout in `packages/server/src/event-wiring.ts`. The issues cross-reference each other ("fix first or together"), so one change is used.

Root causes, **reproduced on develop** with a real-server vitest spike (`openspec/changes/fix-large-session-resume-replay/spike/`):

1. **Absolute 5 s safety timeout ends replay mode too early (#928, S1b).** A replay that runs longer than 5 s ends `replayingSessions` while replayed `event_forward`s are still arriving. Those historical events then take the live path: they set `pendingReplaceProposal` (confirmed: `"change-b"`, broadcast), mark unread, bump `lastActivityAt`, and run OpenSpec detection. Nothing clears `pendingReplaceProposal` on replay exit.
2. **Timers are never cleared between registers (S2).** Each `session_register` arms a fresh 5 s `setTimeout`, and none is cleared. A first register's stale timer ends a second register's replay early, so the same leak happens after a re-register within 5 s.
3. **Unwindowed flush (#929 F2, S3).** The `replay_complete` flush and the timeout flush send `eventStore.getEvents(sessionId, 1)` as one `event_replay` frame. That bypasses the `maxReplayEvents` / tail-only windowing that subscribe uses (`sendEventBatches` in `packages/server/src/browser-handlers/subscription-handler.ts`). Measured: 3,000 events → one 466 KB frame with no `history_window`; the issue reports one 82.5 MB frame for 15,213 events.
4. **Wipe never skipped after a browse (#929 F3, S4).** `canSkipWipe` requires `msg.eventCount === session.lastEntryCount`. Only a bridge register sets `lastEntryCount`. Cold disk hydration never does, so resuming a session the user just viewed always wipes and re-stores every event.
5. **Hydration/register race (#929 R, S5).** A cold disk load that is in flight when the bridge replays is inserted on top of the bridge replay (measured: 20,000 hydrated + 50 bridge-replayed events = 20,050 stored; a real bridge replays all 20,000, which would double the transcript). `cancelLoad` only stops a job still inside the worker; a load already resolved and in its async fan-out still inserts.

## What Changes

- **Per-event replay marker (additive).** The bridge sets `replay: true` on every `event_forward` of a history replay (fresh register, reconnect, session switch, ACP event-log replay). The server treats a marked event as replayed whatever its timers say: never live (no broadcast, unread, push, `lastActivityAt`, OpenSpec detection, canvas), and never re-inserted when the register skipped the wipe. A marked event that arrives after an early exit reopens replay mode so the next exit still flushes it. This closes #928 for current bridges without depending on replay duration.
- **Replay mode timers as the fallback, one set per session.** For unmarked events (old bridges) and for when exit work runs if `replay_complete` is lost: replay mode ends on `replay_complete`, after 5 s with no processed bridge message for the session (idle; re-checked after queued input is processed), or 60 s after register (cap). Timers are cleared on `replay_complete` and on every new register, so a stale timer cannot end a newer replay. One exit implementation for all causes (`complete` / `idle` / `cap` / `unregister`), each logged. Measured: the issue-sized replay (15,213 events, ~80 MB) takes 741 ms on the server.
- **No replay-raised `pendingReplaceProposal`, no clear on exit.** Detection never runs on replayed events, and a replay exit does not touch the field, so a live suggestion raised before a reconnect and a user accept/dismiss during the replay stand. (A snapshot/restore was considered and dropped: unreachable for replayed writes, and it would undo a user accept made during the replay.)
- **Windowed, abortable exit flush.** The exit flush goes through `sendEventBatches(..., maxReplayEvents, replayWindowMode)` per browser subscriber (which already sends `session_state_reset` + `history_window` when a window applies) and ends with `isLast: true`, even for an empty store. In-process subscribers (`deliverInProcess`, chat gateway) keep the full stream. A flush still draining when the session re-registers or unregisters stops before its next batch and unmutes the socket; the flush stays pending, so the next exit sends it in full even after a skipped register.
- **Skip-wipe fingerprint, learned from cold hydration too.** Cold hydration records branch entry count, leaf entry id (server reader rule; none ⇒ no fingerprint) and the store's highest seq after the insert. A skip (bridge-learned or hydration-learned) requires the register to carry `leafEntryId`, so an old bridge always wipes. A register skips the wipe for a hydration fingerprint only when `eventCount` and the new optional `leafEntryId` match, the new optional `liveTailOpen` is `false`, and the store has not changed since. Cold hydration closes open calls with fabricated `session_ended` ends, so the liveness check keeps a mid-turn resume on the full wipe. The bridge computes branch and `liveTailOpen` once per path and uses the same values for register and replay. Any mismatch or missing field ⇒ today's full wipe.
- **Register supersedes cold hydration; no hydration during a bridge replay.** `session_register` bumps a per-session generation and calls `cancelLoad`; the hydration re-checks the generation right before inserting and drops a stale result. A subscribe that arrives during a bridge replay with an empty store starts no cold load; it gets the priming marker and heartbeats and is served by the exit flush (or by the unregister path).
- **Protocol (additive, optional).** `EventForwardMessage.replay?: true`; `SessionRegisterMessage.leafEntryId?: string`, `liveTailOpen?: boolean`.

## Capabilities

### Modified Capabilities
- `event-wiring` — a marked replayed event is never live; replay mode timers (5 s idle with busy re-check, 60 s cap, one set per session) as the fallback for unmarked events; unregister ends the replay and releases its state; exit cause logged; unread/push exclusion reworded for bridge replay mode.
- `incremental-event-sync` — the bridge marks replayed events; skip-wipe fingerprint (count + `leafEntryId` + `liveTailOpen: false` + unchanged store) learned from cold hydration; a register supersedes an in-flight cold hydration; no cold hydration during a bridge replay.
- `on-demand-session-replay` — on-demand disk load is not started during a bridge replay (MODIFIED); the replay-exit flush is windowed for browsers, full stream in-process, abortable, and pending until delivered.
- `proposal-attachment` — a bridge replay neither raises nor clears `pendingReplaceProposal`.
- `fork-from-message` — OpenSpec state is cleared on every replay exit, not only `replay_complete`.
- `prompt-derived-tool-state` — "Every replay exit reconciles…" covers the idle and cap exits (was "both exits"); unregister exempt.
- `server-session-reader` — no disk load and no `dataUnavailable` while a bridge is replaying the session (MODIFIED).
- `chat-history-loading-indicator` — keepalives while a subscriber waits for a bridge replay, stopped before the terminal batch (ADDED).

(`openspec-detection` is the artifact-status capability, not activity detection; not touched. `session-history-backfill` client behaviour is unchanged.)

## Non-goals

- Bridge emitting events newest-first. It breaks the seq-reset rule and the passes that need the whole branch (orphan tool-call closing, usage stats, compaction boundaries, replay compaction).
- Making bridge→server replay itself cheaper.
- The legacy notify-shaped `prompt_request` path, which appends to the notify log during replay today. Pre-existing and independent of #928/#929; follow-up.
- Changing `ReplaceProposalDialog` mounting. The dialog renders from one place per `SessionOpenSpecActions` (card, or board popover when open); the reopen/stack symptom comes from the server leak, not from mount duplication. Not touching it also avoids a conflict with `add-project-workflows` task 5.4.

## Discipline Skills

- `performance-optimization` — latency/size budget on resume. Measure frame size and time-to-interactive before and after on a large transcript (spike baseline: 466 KB per 3 k events, unbounded flush).
- `systematic-debugging` — root causes are now reproduced (see `spike/`); keep the spike test as the regression seed.
- `node-inspect-debugger` — replay state across WS + timers is opaque at runtime; use it to verify timer clearing across re-registers.
- `doubt-driven-review` — the skip-wipe fingerprint can show a different branch than the agent sees, and the liveness guard is a correctness hazard; the mismatch fallback must hold.
- `security-hardening` — not expected, but the new `leafEntryId` is an untrusted bridge field; validate its shape server-side.
- `observability-instrumentation` — log the replay exit cause (`complete` / `idle` / `cap` / `unregister`) and the skip-wipe decision, so fallback exits on old bridges are visible.
- `review-code` — before commit.

## Impact

- `packages/shared/src/protocol.ts` — additive optional `EventForwardMessage.replay`, `SessionRegisterMessage.leafEntryId` + `liveTailOpen`.
- `packages/extension/src/session-sync.ts`, `packages/extension/src/bridge-handlers/lifecycle.ts`, `packages/extension/src/bridge.ts` — mark replayed `event_forward`; send `leafEntryId` + `liveTailOpen` on the fresh, reconnect and session-switch paths, computed once and shared with the replay.
- `packages/server/src/acp-bridge/acp-session-adapter.ts` — mark the event-log replay; comment update (no fingerprint fields ⇒ full wipe, unchanged).
- `packages/server/src/session/replay-exit-controller.ts` (new) — per-session idle/cap timers, busy re-check, skip flag, flush epoch + pending.
- `packages/server/src/session/hydration-state.ts` (new) — hydration fingerprint + register generation.
- `packages/server/src/event-wiring.ts` — `isReplayedForward` classification for `event_forward` guards (`replayingSessions` Set kept, membership owned by the controller), single `exitReplay`, `canSkipWipe` fingerprint rule + skip only with `leafEntryId`, register generation + `cancelLoad`, release on unregister/remove.
- `packages/server/src/browser-handlers/subscription-handler.ts` — record fingerprint after hydration; generation check before insert; waiting path during bridge replay; `sendEventBatches` optional `isStale` abort.
- `packages/server/src/session/session-load-worker.ts`, `packages/server/src/directory-service.ts` — `entryCount` + `leafEntryId` on `LoadResult` (local and retained arms).
- `packages/server/src/pairing/browser-gateway.ts` — `replayStoreToSubscribers` (windowed per WS subscriber, full stream in-process, abort unmutes).
- Compatibility: additive optional fields only. New server + old bridge ⇒ timer fallback and full wipe; timer/flush/hydration fixes still apply. Old server + new bridge ⇒ fields ignored. `history_window` already exists. Rollback = revert either side. No persisted-data migration.
