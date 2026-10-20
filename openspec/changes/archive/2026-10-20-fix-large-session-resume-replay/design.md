# Design

## Context

See proposal.md (Why) and `spike/spike.md` for the reproduced causes. Current shape of the path:

- `session_register` (`packages/server/src/event-wiring.ts:1555`): adds to the event-wiring `replayingSessions` set (`:740`, `:1570`), arms an anonymous 5 s `setTimeout` that is never stored or cleared (`:1572`), decides `canSkipWipe` from `eventCount === lastEntryCount && hasEvents` (`:1605-1606`), then either wipes + `broadcastSessionStateReset` or marks `skipReplayInsert` (`:1611-1617`). Provisional registers never get here: `pi/pi-gateway.ts:825` intercepts them first.
- `replay_complete` (`:1500`) and the timeout (`:1572-1600`) run near-identical exit code (two copies): `reconcileAndRecomputeOnReplayExit`, a status broadcast, and one `event_replay` frame of the whole store via `browserGateway.sendToSubscribers` (`:1542-1550`, `:1589-1597`), which also feeds in-process subscribers (`pairing/browser-gateway.ts:2645-2650`). Only `replay_complete` clears `openspecPhase` / `openspecChange` (`:1513-1519`). The exit deletes `skipReplayInsert` (`:1574`), so in a skipped replay every later replayed event is inserted again (`:1089`).
- ~25 guards read the event-wiring `replayingSessions.has(sessionId)` (`event-wiring.ts:664, 988, 1080-1293, 1389-1469, 2062, 2456-2546`), including the unread/push caller (`:1189`), canvas (`:1287`), OpenSpec detection (`:1293`, `:1389`). The gateway has a different, per-socket `replayingSessions` map (`pairing/browser-gateway.ts:701`) used by `markReplaying` / `clearReplaying` (`:1969-1985`); it is not changed.
- `EventForwardMessage` (`packages/shared/src/protocol.ts:391-395`) carries no replay marker. The bridge replays synchronously: `replaySessionEntries` (`extension/src/session-sync.ts:211-219`) loops `send`, then `replay_complete`. Three register paths: fresh (`bridge-handlers/lifecycle.ts:536-629`), reconnect (`bridge.ts:1268` `sendStateSync` → `session-sync.ts:131`; replay `bridge.ts:1287`; pending-prompt re-send `:1296-1301`; `replay_complete` `:1302`), session switch (`session-sync.ts:253-296`, replays without `liveTailOpen`). ACP adapter: register `acp-bridge/acp-session-adapter.ts:134`, no `eventCount`; reattach replays its event log (`:455-466`).
- Cold hydration (`browser-handlers/subscription-handler.ts:919-1052`): priming `event_replay {isLast:false}` + heartbeats, `loadSessionEvents` (worker) or `readRetainedTranscript`, unconditional insert loop (`:1019-1028`), windowed fan-out via `sendEventBatches` (`:1052`). `sendEventBatches` (`:329`) already sends `session_state_reset` + `history_window` whenever a window applies (`:376-380`) and yields between batches.
- The load worker replays the branch without `liveTailOpen` (`session/session-load-worker.ts:105`) and returns `entryCount` (`:103-106`), used only for metrics (`directory-service.ts:922-973`).

Measured (`spike/spike-replay-walltime.test.ts`, loopback): 15,213 events (~80 MB, issue-shaped) take 741 ms on the server from register to flush; the bridge send loop takes 157 ms.

## Goals / Non-Goals

**Goals:**
- Replayed vs live decided per event for current bridges; timers only a fallback for old bridges.
- One replay exit implementation (four causes), one timer set per session.
- Reuse subscribe-time windowing (`sendEventBatches`) for the exit flush.
- Skip-wipe after a cold browse only when it is the same branch, same store, no open turn.

**Non-Goals:**
- Persisting fingerprints across a server restart (a restart drops the store anyway).
- Client changes. `history_window`, reset and backfill handling already exist.
- Skip-wipe for ACP sessions (no `eventCount`; unchanged full wipe).
- The legacy notify-shaped `prompt_request` path (`event-wiring.ts:2431`, `handleNotify` `:817-844`), which appends and broadcasts during replay today. Pre-existing and independent of #928/#929; follow-up.

## Decisions

### D1 — Per-event replay marker (additive)
`EventForwardMessage` gains `replay?: true`. The bridge sets it on every `event_forward` of a history replay: `replaySessionEntries` (covers fresh, reconnect and session-switch paths) and the ACP event-log replay. Live forwards never set it.
Server classification, one helper `isReplayedForward(sessionId, msg)`: `msg.replay === true || replayingSessions.has(sessionId)`. Every `event_forward` guard that reads the event-wiring `replayingSessions.has` today uses the helper instead, so a marked event takes every replay-mode path: no live broadcast, unread/push (`:1189-1208`), card order (`:1227-1236`), liveness stamp (`:1246-1260`), lifecycle timestamps (`:1274`), canvas (`:1287`), OpenSpec detection (`:1293`, `:1389`), in-flight tracking (`:1116`). Guards on other message types keep `replayingSessions.has`. The `replayingSessions` Set keeps its name and meaning (replay mode); the controller (D2) owns its membership, so main-spec text naming it stays accurate.
A marked event arriving after an exit (idle/cap fired early) re-enters replay mode for that register (`controller.reopen`): it is stored, and the next exit — normally the late `replay_complete` — flushes it. Without that, a marked event stored after the exit would reach no browser. A marked event is replayed whatever the timers say, so a late first event, a slow link, an idle false positive or a cap exit cannot leak it (spec `event-wiring` "A marked replayed event is never live").
Skipped replay: the register's skip flag lives until the next register (not cleared at exit), and a marked event in a skipped replay is never inserted. A skip is granted only to a register carrying `leafEntryId` — which a bridge sends only together with the marker (D7) — so an old bridge always wipes and its unmarked tail after an early exit cannot duplicate a kept store. This tightens today's bridge-learned skip (`:1605-1606`) for old bridges.
- Alternative: server-only idle + cap (cycle-1 design). Rejected after two review cycles: the server cannot tell replayed from live without a marker, so any exit before the last replayed event leaks history and, on a skipped replay, duplicates the tail.
- Alternative: fail closed after idle/cap until the next register. Rejected: a genuine live event after a lost `replay_complete` would never mark unread or push until reconnect.

### D2 — Replay mode controller (fallback + exit work)
New module `packages/server/src/session/replay-exit-controller.ts`, injected `now` / timers / `setImmediate`. Per-session record `{ idleTimer, capTimer, lastTouchAt, skipped, flushEpoch, flushPending }`.
- `begin(sessionId, { skipped })` clears any previous record's timers, bumps `flushEpoch` (stales a draining flush), arms idle 5 s and cap 60 s. A wipe sets `flushPending`; a skip leaves it as it was.
- `touch(sessionId)` on any bridge message for the session while replaying (not only `event_forward`: prompt re-sends count).
- `reopen(sessionId)` after an exit, for a marked event of the same register: re-adds to `replayingSessions` and re-arms idle (cap is not re-armed; a reopened replay exits on `replay_complete` or idle).
- Idle fire: one `setImmediate` re-check (runs after the next poll phase has handled input already read); exit only if `now() - lastTouchAt >= 5 s`, otherwise re-arm for the remainder. Best effort: a frame still partly unread can be missed; only unmarked classification depends on it.
- Waiters: subscribers waiting for the replay (D6) are registered on the record with their keepalive; any exit or `release` stops the keepalive before flushing to them.
- `complete` (cause `complete`), timers (`idle`, `cap`), `release` (cause `unregister`: bump `flushEpoch`, flush waiters, delete record).
- First exit deletes the timers; a later exit for the same replay finds none and is a no-op.
For marking bridges the timers only bound when the exit work runs if `replay_complete` is lost; classification no longer depends on them. For old bridges they keep today's behaviour, improved (re-armed, one per session).
`event-wiring.ts` keeps ONE `exitReplay(sessionId, cause)`: clear OpenSpec phase/change, `reconcileAndRecomputeOnReplayExit` (reconcile → recompute → drain of the collected prompt ids, `:878-890`), ONE `session_updated` broadcast, flush if `flushPending` (D4), log `[replay] exit <id> cause=<cause>` (warn for idle/cap). The idempotent OpenSpec clear on a late `replay_complete` (`:1513-1519`) stays.

### D3 — `pendingReplaceProposal`: suppression only
OpenSpec detection (`event-wiring.ts:1293`, `:1389`) runs only for live forwards (D1), so replay cannot set `pendingReplaceProposal`. The exit does not touch the field: a live suggestion raised before a reconnect, and a user accept/dismiss during the replay, stand. A snapshot/restore was dropped: unreachable for replayed writes, and it would undo a user accept made during the replay.

### D4 — Windowed, abortable exit flush
New `BrowserGateway.replayStoreToSubscribers(sessionId, isStale)`: per WebSocket subscriber, `markReplaying` → `sendEventBatches(ws, id, stored, sendTo, maxReplayEvents, replayWindowMode, isStale)` → `clearReplaying(ws, id, lastReplayedSeq)` (existing catch-up). In-process subscribers keep today's single full `event_replay` via `deliverInProcess` (user decision). It sends even for an empty store (`sendEventBatches` emits one terminal empty batch), which releases waiting browsers. Called fire-and-forget from `exitReplay` with a caught + logged rejection; on completion it clears `flushPending` if `flushEpoch` is unchanged.
- Exactly one `session_state_reset` per subscriber: `sendEventBatches` resets when a window applies (`subscription-handler.ts:376-380`); when none applies the gateway sends the reset itself first. The store can be head-trimmed (first seq > 1), so the client's seq-1 reset rule cannot be relied on.
- `markReplaying` for every subscriber runs synchronously before the first `await` and before `exitReplay`'s `session_updated`, so no live event slips in between.
- Abort: `sendEventBatches` gains optional `isStale?: () => boolean`, checked before each batch; when stale it stops and the gateway unmutes the socket (`clearReplaying` without catch-up), so live events reach it. `flushPending` stays set, so the next exit sends the full flush even when the new register skipped the wipe.

### D5 — Fingerprint
`LoadResult` (local + retained arms) gains `entryCount` and `leafEntryId` from the server reader (`session/session-file-reader.ts:parseSessionEntries`), which is authoritative. For pi-written files it matches pi-core `getBranch()` (leaf = last entry with an id, `session-manager.js:732-741`); where it differs (`type:"leaf"` pointer, `session-file-reader.ts:91-94`; cyclic fallback) the value does not match and the register wipes. No id on the last branch entry ⇒ no fingerprint. pi-core's in-memory leaf can differ from the file: `branch()` moves `leafId` without writing (`session-manager.js:1161-1165`), so a resume after navigation without a new entry mismatches and wipes (fail safe). Assumes pi entry ids are immutable once written (append-only JSONL); same-ids-different-content is not detected.
Subscription-handler records `{ entryCount, leafEntryId, storeMaxSeq }` after a successful insert in a server-only `packages/server/src/session/hydration-state.ts` (a `Map`, not on `DashboardSession`, which is broadcast). `canSkipWipe` on register: existing bridge-learned rule unchanged, OR `fp && eventCount === fp.entryCount && leafEntryId === fp.leafEntryId && liveTailOpen === false && hasEvents && storeMaxSeq === fp.storeMaxSeq`. `storeMaxSeq` invalidates the fingerprint after any non-replay insert (e.g. session-end heal events, `event-wiring.ts:656-666`). Every register clears the fingerprint after deciding. `leafEntryId` accepted only as a string of length 1–128.
The kept store equals the bridge replay's apart from timestamps (`state-replay.ts:61`, `:282`) and context-window metadata (hydration passes `knownContextWindow`, `session-load-worker.ts:105`; the bridge does not). Both are accepted differences; the parity test normalises exactly these. Retention trimming between hydration and register is not detected by `storeMaxSeq`; the kept store is then head-trimmed, which the client already handles as a gap.

### D6 — Register vs cold hydration
`HydrationState` keeps a per-session `registerGeneration`. `session_register` increments it and calls `directoryService.cancelLoad(sessionId)`. Subscription-handler captures the generation when it decides to hydrate — before `loadSessionEvents` or `readRetainedTranscript` — and re-checks immediately before the insert loop; on mismatch it drops the result and settles retained followers the way the cancel path does, keeping the socket in the waiting state below. The hydration fan-out (`:1052`) passes `isStale = () => generation changed` to `sendEventBatches`, so a register landing mid-fan-out stops its remaining batches.
**No hydration during a bridge replay.** The check runs before the load-source choice (`subscription-handler.ts:920`), so it also covers sessions with no `sessionFile` (which would otherwise get `isLast:true` + `dataUnavailable`, `:1116-1120`). A subscribe that finds `replayingSessions.has(sessionId)` and an empty store starts no load. It gets the priming `event_replay {isLast:false}` and keepalives on the cold-load heartbeat interval, is marked replaying, and is registered as a waiter on the controller (D2), which stops its keepalive before the exit flush or the unregister terminal batch. Spec `on-demand-session-replay` "On-demand session loading via server" is scoped accordingly (MODIFIED).

### D7 — Protocol + bridge
`SessionRegisterMessage` gains `leafEntryId?: string` and `liveTailOpen?: boolean`; `EventForwardMessage` gains `replay?: true`. All optional. On the fresh (`lifecycle.ts`) and reconnect (`bridge.ts:1268-1302`, threading the value through `sendStateSync`) paths the bridge computes `getBranch()` and `isLive(…)` ONCE and uses the same values for the register fields and the replay call. The session-switch path (`session-sync.ts:253-296`) deliberately never leaves the tail open (`:293-295`); it sends `liveTailOpen: false` and keeps its closed-tail replay, so register and replay agree. The ACP adapter marks its replay but sends no fingerprint fields (full wipe, unchanged); its "or for 5 s" comment (`acp-session-adapter.ts:426-427`) is updated.

## Risks / Trade-offs

- [Old bridge (no marker): an unmarked replay that outlasts the cap, or a >5 s bridge-side gap before the first event, still leaks] → bounded by idle re-arm + 60 s cap; cap/idle exits are warning-logged; ships with the bridge in the same release.
- [Lost `replay_complete` on a live socket delays exit work (flush, reconcile) by up to 5 s idle / 60 s cap] → only on a broken socket, which re-registers.
- [Single `setImmediate` re-check misses a frame that spans several poll iterations] → only affects unmarked (old-bridge) classification; marked events are unaffected.
- [Hydrated vs bridge streams differ in timestamps / context window] → accepted (D5); parity test normalises them.
- [Waiting browser and a bridge that dies without unregister] → idle exit flushes within 5 s of silence; the client's replay-pill ceiling covers the rest.

## Migration Plan

Additive only. Server and bridge ship in the same release. Mixed-version limitation: a new server with an old bridge keeps the timer fallback, so an unmarked replay that outlasts the cap, or a >5 s bridge-side gap before the first event, still leaks (warning-logged); upgrading the bridge (`npm run reload`) removes it. New server + old bridge: no marker, no fingerprint fields → idle/cap fallback and full wipe; the timer, flush and hydration-race fixes still apply. Old server + new bridge: extra fields ignored. Rollback: revert either side independently. No persisted data changes.
