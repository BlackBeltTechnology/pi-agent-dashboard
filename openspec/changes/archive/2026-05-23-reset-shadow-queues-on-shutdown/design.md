## Context

The bridge owns shadow steering + follow-up queues per session (`bridgeSteering`, `bridgeFollowUp` in `packages/extension/src/bridge.ts`). Pi does not forward `queue_update` to extensions, so the bridge is the source of truth for what the dashboard renders.

Three boundaries currently mutate the shadows:
1. Per-entry drain on user `message_start` (mirrors pi's internal drain).
2. Explicit clear/edit/promote/remove handlers from browser messages.
3. Session-change reset (new/fork/resume) — hard reset both arrays to `[]`, emit once.

A fourth boundary — **session shutdown** — is currently a silent process exit. `bridge.shutdown` calls `cachedCtx.shutdown()` then schedules `setTimeout(process.exit, 500)`. Nothing tells pi to drain its native queues; nothing tells the dashboard the queues are gone.

This design adds shutdown as a fourth shadow-mutation boundary, modeled on the session-change reset (rule 3), which is the closest analog.

## Goals / Non-Goals

**Goals:**
- Bridge teardown leaves no stale chips in the browser cache.
- Pi's native queues are explicitly cleared on dashboard-initiated shutdown (defensive — not relying on `cachedCtx.shutdown()`'s internal behavior).
- Spec `mid-turn-prompt-queue` covers the shutdown boundary explicitly.
- Zero impact on server, client, or protocol.

**Non-Goals:**
- Changing abort semantics (separate UX question, deferred).
- Persisting queues across restarts.
- Changing per-entry drain or session-change reset behavior.
- Adding a confirmation modal for "shutdown with queued messages".

## Decisions

### Decision 1: Reset, do not drain

When the user clicks Shutdown, they want the session to stop — not for queued steers/follow-ups to be delivered through additional turns. Treat shutdown the same way session-change is treated: the queue is meaningless going forward, so reset to `[]`.

**Alternatives considered:**
- *Deliver remaining*: let pi flush queues through additional turns before exit. **Rejected** — contradicts user intent, introduces unbounded shutdown delay, and conflicts with the existing 500 ms exit timer.
- *Warn-then-reset*: prompt the user before discarding. **Rejected** — adds UX friction for a near-edge case; the messages are user-typed and recoverable from `messageHistory`.

### Decision 2: Defensively clear pi's queues in addition to the shadows

The bridge does not know whether `cachedCtx.shutdown()` clears pi's internal queues. To make the contract independent of pi's teardown internals, call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` explicitly **before** invoking `cachedCtx.shutdown()`.

Both calls are best-effort:
- `if (typeof pi.clearSteeringQueue === "function")` guard for pi-version skew.
- `try { … } catch {}` — never let teardown throw.

**Alternatives considered:**
- *Skip the pi clear, trust `cachedCtx.shutdown()`*: works in current pi but couples bridge correctness to pi internals. **Rejected** — cheap to be defensive on a teardown path.

### Decision 3: Emit one final `queue_update` only when the shadows were non-empty

Guard the emit:

```ts
if (bridgeSteering.length > 0 || bridgeFollowUp.length > 0) {
  bridgeSteering = [];
  bridgeFollowUp = [];
  emitQueueUpdate();
}
```

Mirrors the session-change handler's pattern (`bridge.ts:1709-1714`). Avoids a spurious `queue_update` for sessions that shut down with empty queues — keeps the wire quiet on the common path.

**Alternatives considered:**
- *Always emit*: simpler code but adds wire noise for every shutdown. **Rejected** — match the existing pattern.

### Decision 4: pi-clear runs regardless of shadow emptiness

The defensive `pi.clearSteeringQueue()` / `pi.clearFollowUpQueue()` calls run **unconditionally** (the shadow-empty guard only gates the shadow reset + emit). Reason: external (non-dashboard) consumers could have mutated pi's queues without the bridge knowing. The shadows being empty does not prove pi's queues are empty.

Both pi calls are idempotent and cheap on empty queues per the existing `clear_steering_queue` handler's "safe no-op" scenario.

### Decision 5: Run reset BEFORE `cachedCtx.shutdown()`

Order matters: `cachedCtx.shutdown()` may trigger pi's own teardown which can fire events the bridge no longer should process. Clear the shadow + emit the final `queue_update` while the bridge is still in a known-good state.

```
1. clear pi queues (defensive)
2. reset shadows + emit final queue_update (if non-empty)
3. cachedCtx.shutdown()
4. setTimeout(process.exit, 500)   ← unchanged
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `pi.clearSteeringQueue` / `clearFollowUpQueue` throws on some pi version | Wrapped in `try/catch`. Logs warning, continues teardown. |
| `connection.send` (inside `emitQueueUpdate`) races the WS close + the 500 ms `process.exit` | Acceptable: the worst case is the final `queue_update` doesn't arrive, which puts us in the same place as today (stale chips). No regression. |
| Bridge in RPC-keeper mode treats `process.exit` differently | The reset runs before `cachedCtx.shutdown()`, before any RPC-keeper-specific teardown path. Independent of exit mechanism. |
| `pi` object somehow `undefined` during shutdown | Guard with `if (pi)` around the two clear calls (defensive — should never happen on a session that successfully registered). |

## Migration Plan

Pure additive bridge change. No persistence, no protocol, no client. Rolls out with the next bridge reload (`npm run reload`). No rollback complexity — reverting the patch restores prior behavior.

## Open Questions

None. The abort question is intentionally out of scope (see proposal).
