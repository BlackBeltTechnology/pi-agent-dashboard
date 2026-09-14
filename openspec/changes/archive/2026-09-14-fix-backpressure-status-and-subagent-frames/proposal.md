## Why

A session running a multi-minute subagent renders as **Idle** in the dashboard
while the server knows it is `streaming`. The card did not pick a wrong value —
it never received the right one.

`session_updated` (the frame carrying `status` / `currentTool`) is
**transcript-class**, so `fanout()` drops it whenever a browser socket sits above
`MAX_WS_BUFFER` (`browser-gateway.ts:791-795`). What makes that drop *visible for
minutes* is not how often it happens — it is that **status is never re-pushed**.

The parent session emits almost no status frames during a subagent call: one
`tool_execution_start{Agent}` → `session_updated{currentTool:"Agent"}`, then
nothing until the tool ends minutes later. **A single dropped frame is therefore
sufficient**, and its staleness lasts until the next status change, a reconnect,
or a reload (`sessions_snapshot` is state-class, which is why a reload always
heals it). There is no per-key resend, no seq, no backfill request, and no
periodic reconcile for `session_updated`.

That is the whole bug: **an unrecoverable frame on a lossy channel.**

Measured on the live instance (uptime 23 897 s ≈ 6.6 h, 11 active bridges):

| Signal (`/api/health`) | Value |
|---|---|
| `droppedFrames.serverToBrowser.total` | 715 154 |
| …for the reported session `01a09cd2-db82-7223-8241-7ee90e7e649e` | 123 075 |
| …not attributable to a session — the mixed broadcast bucket `session_updated` lands in (`fanout` passes `sessionId: undefined`, `:793`) | ~3 300 |
| `storeTrim.subagentTicks` / `subagentTickBytes` | 1 207 994 / 8.5 GB (aggregate, 11 bridges, 6.6 h) |
| `subagentTickThrottle.tickCoalesced` | 0 |

**What these numbers do and do not prove.** The 123 075 session-attributed drops
prove the reported session's socket crossed the threshold heavily. The ~3 300
bucket is **not** evidence about `session_updated` specifically: it is the entire
broadcast transcript population — `sessions_reordered`, `session_added`,
`session_removed`, `session_orphaned`, `file_changed` and `session_updated` share
it, and the `session_updated` fraction is **unknown until lever B's counters
exist**. All counters are cumulative and instance-wide; none is a per-socket
`bufferedAmount` sample, so this change claims no saturation duration.

It does not need to. The premise of the fix is established by **code reading, not
by the counters**: `session_updated` has no resend path, so one shed frame is
unbounded-stale. The subagent tick volume is the load context, not a premise.

## What Changes

**A — status becomes self-healing (the fix).**

Add a per-socket **dirty-status reconcile** at the existing drop site:

- `broadcast()` holds the **typed** message before serialization, so it derives
  `dirtyId = msg.type === "session_updated" ? msg.sessionId : undefined` and
  passes it to `fanout()` as an explicit argument. `fanout()` cannot do this
  itself — it receives only the pre-serialized string and today calls
  `recordDroppedFrame(undefined, undefined, …)` (`:793`), so neither the type
  nor the id is recoverable at the shed site without parsing the payload. The
  new argument is the enabler; `broadcastOpenSpecUpdateImpl` (`:805`) and every
  other `fanout` caller pass `undefined`.
- When `fanout()` sheds a frame carrying a `dirtyId`, it adds that id to a
  per-socket `Set<string>` (**ids only — no queued payload**).
- The dirty set owns **its own timer lifecycle**, parallel to (never borrowed
  from) the pending-state timer: the pending-state interval is created only when
  a *state* frame defers (`:706`) and cleared when that map drains (`:692`), so
  a socket saturated purely by transcript traffic — the incident's exact case —
  has no such timer to reuse. The dirty timer starts when the set becomes
  non-empty, stops when it empties, and is torn down on close (`:1364`), on
  error (`:1387`), and on the `sendState` stalled-socket `ws.terminate()` path
  (`:697-703`).
- On each tick, while the socket is under threshold, the reconcile re-sends a
  `session_updated` rebuilt from `sessionManager.get(id)` — the gateway already
  holds that reference (`:351`) and the server's status is kept current by
  `event-wiring` — and removes the id from the set.
- The reconcile send **carries `ctx.sessionId`**, so if it is itself shed (the
  flood is still running; the socket can re-cross the threshold between the
  check and the `send`), the drop site re-marks the id dirty. The loop is
  idempotent and eventually-delivered rather than check-once.

Why a re-push and not a deferred queue:

- **No merge problem.** The queued-partial approach would have to merge
  successive partial `updates` objects inside `PendingState.map`, which holds
  *pre-serialized strings* precisely so `broadcast()` can serialize once for the
  whole fan-out (`:770-790`). A re-push reads live server state and never
  reconciles two stale partials.
- **No byte-ceiling risk.** `sendState` terminates a socket whose pending map
  exceeds `MAX_WS_BUFFER` (`:697-703`). A set of ids costs ~40 B each and is
  regenerated on flush, so it cannot push a socket into
  `stalledSocketsTerminated` — which a per-session *state-frame* key family
  could, on an instance with many sessions.
- **No bootstrap-ordering change.** The re-push happens strictly after the
  socket drains, and `session_updated` keeps its transcript class, so the
  spec's "no registry frame before `sessions_snapshot`" invariant is untouched.

Accepted limitation, stated as a requirement, not a footnote: the re-push
carries the **final** value, so an intermediate edge that was shed
(`streaming` → `idle` within one flood window) is still not observed. That is
strictly better than today (where the final value is lost too), and the
client's edge-consuming side effects (`useMessageHandler.ts:441-490` — the
`ended`-transition totals, the loading-history clear, the `sessionStates`
mirror) are all convergent on the final value except the `ended` edge, which
the re-push does deliver as an edge whenever the client still holds a
non-`ended` row.

**B — make the back-pressure claim measurable (telemetry only).**

The next incident must not need a six-hour counter read and an inference:

- Sample `ws.bufferedAmount` per browser socket and expose occupancy (max, p95,
  time-above-threshold) on `/api/health`.
- Expose the dirty-status reconcile counters (`statusReconcileQueued`,
  `statusReconcileSent`) so a regression is attributable.

**Non-goals.** No change to subagent tick payloads, the strip allowlist, the
tick throttle, `MAX_WS_BUFFER`, the `seq`/backfill contract, the producer
(`pi-dashboard-subagents`), or the delivery class of any existing frame. Lever B
is instrumentation only: any subagent-payload reduction is a **separate change**
that must first be justified by the `bufferedAmount` series this one adds. The
earlier draft of this proposal claimed `subagentTickThrottle.tickCoalesced === 0`
was an anomaly; at ~4.6 ticks/s/bridge against a 250 ms producer window there is
at most one tick per window per `toolCallId`, so zero coalescing is the
*expected* reading of an already-satisfied `subagent-live-cadence` requirement,
not a defect.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ws-frame-delivery-policy`: adds a recovery obligation for a shed
  **`session_updated`** — and only that frame: it SHALL be reconciled from
  current server state once the socket drains, and the health surface SHALL
  expose socket buffer occupancy plus the reconcile counters. The existing class
  assignments, the replace-only coalesce rule for `state` frames, the byte
  ceiling, and the bootstrap ordering are all **unchanged**.

  Its three registry siblings — `session_added`, `session_removed`,
  `sessions_reordered` — stay transcript-class **and stay unrecovered**. A shed
  `session_added` leaves a session invisible and a shed `session_removed` leaves
  a ghost card, each healing only on reload. That is the same class of bug, left
  deliberately out of scope: each needs its own reconcile semantics (create /
  delete / reorder are not idempotent re-pushes of one row), and the reported
  symptom is a status badge. Lever B's counters are what will size them.

## Impact

- `packages/server/src/pairing/browser-gateway.ts` — `recordDroppedFrame()`
  (dirty-set capture), the `STATE_FLUSH_INTERVAL_MS` timer path (reconcile
  flush), the connection close handler (discard the set), `/api/health` counters.
- No protocol shape change: the re-push is an ordinary `session_updated`.
- No client change: the handler already merges `updates` onto the existing row
  (`useMessageHandler.ts:438-495`). Its `if (existing)` guard makes a reconcile
  for a session the client does not hold a **no-op**, which is what prevents the
  re-push from resurrecting a row a shed `session_removed` should have deleted.
  (Client rows come from `sessions_snapshot` *and* from `session_added`
  (`useMessageHandler.ts:377`), which is itself sheddable — see the sibling
  carve-out above.)

## Discipline Skills

Per the checkpoint tables in `AGENTS.md`, tasks in this change trigger:

- `observability-instrumentation` — lever B is entirely instrumentation, and the
  reconcile counters are the only way this regression stays detectable.
- `performance-optimization` — the reconcile runs on the browser send hot path;
  it must be shown to add no measurable cost to `eventLoopDelay`.
- `doubt-driven-review` — already run once on the first draft; the design
  changed materially (deferred-merge → re-push) as a result.
- `review-code` — non-trivial change on the browser gateway before commit.
