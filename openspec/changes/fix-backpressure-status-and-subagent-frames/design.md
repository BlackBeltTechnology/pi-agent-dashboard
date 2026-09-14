# Design — fix-backpressure-status-and-subagent-frames

## Context

`browser-gateway` sheds transcript-class frames above `MAX_WS_BUFFER` (4 MB).
`session_updated` is transcript-class and has **no recovery path** — no `seq`, no
backfill, no periodic re-push. During a long tool call (the reported case: a
multi-minute subagent) the parent session emits its status frame once and then
goes quiet, so a single shed frame leaves the card showing the stale value for
the entire call.

Verified against source during review (cycle 2): `extractRawSessionUpdates` has
no `tool_execution_update` arm, `tool_execution_update` is not in
`ACTIVITY_EVENT_TYPES`, and `reconcileAgentLiveness` is inert while
`streaming` + `agentRunning` — so the "one frame, then silence" premise holds.

## Decisions

### D1 — Re-push from live state, not a deferred queued payload

**Rejected:** move `session_updated` to the `state` class so it defers instead of
sheds.

Three independent blockers, all confirmed in source:

1. `PendingState.map` holds **pre-serialized strings** (`browser-gateway.ts:632`)
   precisely so `broadcast()` can serialize once for the whole fan-out
   (`:770-790`). `session_updated.updates` is a **partial**, so latest-wins
   replace would lose fields, and merge would force `JSON.parse` +
   re-`stringify` **per socket per frame** on the hot path — against an
   instance already showing `eventLoopDelay.meanMs` ≈ 20 ms.
2. The pending map **terminates the socket** above its byte ceiling
   (`:697-703`). `session_updated:<sessionId>` is one key *per session*,
   unbounded — a many-session instance would trade a stale badge for
   terminate/reconnect thrash.
3. `state` frames send **immediately** when the socket is under threshold
   (`:686`), which races the connect bootstrap's "no registry frame before
   `sessions_snapshot`" invariant.

**Chosen:** a per-socket `Set<sessionId>` of *debts*. Ids only. On flush, the
frame is rebuilt from `sessionManager.get(id)` — the gateway already closes over
that reference (`:351`). Nothing stale is ever queued, so nothing has to be
merged, and the retained bytes are ~40 B/id instead of a payload.

### D2 — Capture the debt in `broadcast()`, not at the shed site

`fanout()` receives only the serialized string and calls
`recordDroppedFrame(undefined, undefined, …)` (`:793`) — at the shed site the
frame's type and session id are **unrecoverable without parsing**. `broadcast()`
still holds the typed message, so it derives
`dirtyId = msg.type === "session_updated" ? msg.sessionId : undefined` and passes
it to `fanout()` as an explicit argument. Every other `fanout` caller (notably
`broadcastOpenSpecUpdateImpl`, `:805`) passes `undefined`.

### D3 — The debt set owns its own timer

The pending-state interval is created only when a **state** frame defers (`:706`)
and cleared when that map drains (`:692`). A socket saturated purely by
transcript traffic — the incident's exact shape — has no such timer, so the
reconcile cannot borrow it. A parallel timer starts when the set becomes
non-empty and stops when it empties. Teardown set: close (`:1364`), error
(`:1387`), and the stalled-socket `ws.terminate()` path (`:697-703`).

### D4 — The reconcile send carries `ctx.sessionId` (loop-safe)

The socket can re-cross the threshold between the under-threshold check and the
`ws.send`. With `ctx.sessionId` present, a shed reconcile re-enters the debt set
at the drop site, making delivery eventually-consistent instead of check-once.
Re-entry is idempotent (a `Set`), so a persistent flood costs one id, not a
growing queue.

### D5 — Settled-value semantics, stated as a requirement

The reconcile delivers the **current** value. An `idle → streaming → idle`
transition entirely inside a shed window yields one `idle`. This is strictly
better than today (where the final value is lost too) and is spec'd explicitly
rather than left as a footnote.

Client edge-consumers (`useMessageHandler.ts:438-495`) are convergent on the
final value: the `ended`-transition totals, the loading-history clear, and the
`sessionStates` mirror all read the delivered value. The `if (existing)` guard
(`:441`) makes a reconcile for an unknown row a **no-op**, which is what stops a
re-push from resurrecting a row a shed `session_removed` should have deleted.

### D6 — Siblings deliberately out of scope

`session_added`, `session_removed`, `sessions_reordered` stay transcript-class
and stay unrecovered. Each needs different semantics (create / delete / reorder
are not idempotent re-pushes of one row), and the reported symptom is a status
badge. Lever B's counters are what will size that follow-up.

### D7 — Lever B is telemetry only

The earlier draft proposed cutting subagent tick payloads and treated
`subagentTickThrottle.tickCoalesced === 0` as an anomaly. Review showed both
claims were unsupported: at ~4.6 ticks/s/bridge against a 250 ms producer window
there is at most one tick per window per `toolCallId`, so zero coalescing is the
**expected** reading of an already-satisfied `subagent-live-cadence`
requirement; and `subagent-details-payload` already bounds timeline growth
(`subagentFatTicks` 731 of 1.2 M confirms the strip holds). A flat ~7 KB tick is
producer payload *width* — a different problem, for a different change, which
must be justified by the `bufferedAmount` series this change adds.

## Risks

| Risk | Mitigation |
|---|---|
| Reconcile adds work to the browser send path | Ids only, one timer per saturated socket, flush bounded by set size; assert no measurable `eventLoopDelay` change |
| Debt set grows on a many-session instance | One id per session, deduped by `Set`; no payload retained; explicitly asserted not to affect `stalledSocketsTerminated` |
| Timer leak on abnormal teardown | Teardown asserted on all three paths (close, error, stalled-terminate) |
| Reconcile masks a real regression by papering over drops | Queued/sent counters exposed separately from `droppedFrames`, which still counts the original shed |
