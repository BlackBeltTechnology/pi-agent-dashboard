## Why

The dashboard server's heap is dominated by event-history that is **already dead
on arrival**: superseded `tool_execution_update` snapshots. Measured on a live
standalone server (pid 8347, `v0.7.0`, uptime 2311 s, 10 active sessions), not
hypothesised:

| Probe | Value |
|---|---|
| `/api/health` `server.rss` | `7 651 557 376` (7.65 GB) |
| `/api/health` `server.heapUsed` | `5 748 458 928` (5.75 GB) |
| `heapUsed` sampled every 10 s for 70 s | oscillates 5.72 → 5.96 GB, **floor never drops below 5.75 GB** |
| `server.activeSessions` / `totalSessions` | 10 / 3269 |

The GC-immune floor rules out collectable garbage: this is live retained data.
The plateau (5.7 GB reached in 38 min, then flat) rules out an unbounded leak —
it is a cache that filled to its ceiling.

Attribution was measured in-process via CDP `Runtime.queryObjects` against a
`SIGUSR1`-opened inspector (no restart — a restart destroys the evidence):

| Holder | Measured |
|---|---|
| Buffer A — `{seq, event}[]` | 8 122 events × 151 145 B/event = **1 227.6 MB** |
| Buffer B — `{seq, event}[]` | 8 157 events × 145 625 B/event = **1 187.9 MB** |
| All 36 other big arrays | ~92 MB combined |
| Session-metadata `Map` (3 269 entries) | 2.7 MB — **innocent** |

Breaking Buffer A/B down by event type:

| Event type | Share of buffer | Avg size | Est. retained |
|---|---|---|---|
| `tool_execution_update` (A) | 72.7 % | 190.7 KB | 1 153.3 MB |
| `tool_execution_update` (B) | 95.0 % | 155.5 KB | 1 213.0 MB |
| `subagent_started` (A) | 3.4 % | 192.2 KB | 55.0 MB |
| everything else | — | ≤ 8.7 KB | < 12 MB |

The heavy field is `partialResult` (200 450 B in the sampled maximum), and the
tool is **`Agent`** — `partialResult` is `{ content, details }` where `details`
is the subagent's entire running timeline. It reaches that size legitimately:
`createTruncator` detects subagent-timeline events BEFORE the generic 4 000-byte
per-string pass and returns them **unchanged** when under the 256 KiB per-event
ceiling (`bound-subagent-event-serialization`,
`head-tail-truncate-subagent-event-timeline` D1/D4).

That carve-out is correct **per event**. The gap is multiplication: pi emits a
`tool_execution_update` carrying the *cumulative* timeline roughly every 250 ms,
and the store retains **every one of them**. ~6 000 ticks × ~187 KB = ~1.2 GB per
session. The invariant that was reasoned about was `1 event ≤ 256 KiB`; the one
that governs heap is `N events × 187 KB`, and nothing bounds `N` by bytes.

The existing shed policies are **not** at fault and MUST NOT be retuned by this
change — they are nowhere near binding:

| Cap | Value | Observed | Binding? |
|---|---|---|---|
| `DEFAULT_MAX_CACHED_SESSIONS` | 100 | 11 sessions | no |
| `DEFAULT_MAX_EVENTS_PER_SESSION` | 20 000 | 8 122 events | no |
| `DEFAULT_MAX_STRING_SIZE` | 4 000 | bypassed by the carve-out | n/a |
| `DEFAULT_MAX_EVENT_DATA_SIZE` | 262 144 | ~150–200 KB/event — just under | the ceiling being paid 6 000× |

**The same events break a second consumer: the server→browser socket.** The
heap is where they are retained; the WebSocket is where they are re-sent. Both
fail on the same axis, and the transport half was previously unattributed.
Measured from the same server's `server.log`:

| Probe | Value |
|---|---|
| `sendTo` back-pressure drops (session-scoped) | 459 |
| `fanout` broadcast drops | 32 — the flood is per-session, not fan-out |
| `openspec_update` payload (the suspected fat broadcast) | 1 580 B — **innocent** |
| peak `ws.bufferedAmount` | `224 897 855` (225 MB) against `MAX_WS_BUFFER = 4 194 304` |
| drops with `bufferedAmount` < 8 MB | 439 — the guard working as designed |
| drops with `bufferedAmount` > 64 MB | 4 — the guard **bypassed** |

That distribution is bimodal, and the tail is the tell. `sendTo` consults
`ws.bufferedAmount` *before* a send and never the size of the frame it is about
to enqueue, so one oversized frame passes the gate unmeasured. The frame is
`event_replay`: `clearReplaying` builds the catch-up tail as
`eventStore.getEvents(sessionId, lastReplayedSeq + 1)` and sends **all of it in
one frame** — while the main replay path chunks. The arithmetic closes against
the per-event sizes measured above:

```
225 MB ÷ 155.5 KB/event ≈ 1 446 events  →  ~6.0 min of 250 ms ticks
225 MB ÷ 190.7 KB/event ≈ 1 179 events  →  ~4.9 min of 250 ms ticks
```

So the 225 MB frame needs no pathological session — five minutes of ordinary
subagent work suffices. Downstream the browser cannot drain it, the tab stops
painting, the socket drops, the client reconnects, re-subscribes, and
`clearReplaying` rebuilds the same frame. Reloading every bridge at once
(`npm run reload`) triggers that path on all sessions simultaneously, which is
why the freeze reads as reload-correlated.

This is the same root cause the heap analysis found — `N events × 187 KB` with
nothing bounding `N` by bytes — surfacing one layer out. It is recorded here
rather than in its own change so the two consequences stay attached to the one
cause; the transport-layer *mechanism* is still deferred (see out of scope).

Intermediate updates are **mostly** redundant, and the qualifier is load-bearing.
The client event reducer (`event-reducer.ts:1821`) is the only code that folds a
stored update — no server-side reader exists (`bridge.ts:1479` is a
forward-list entry, i.e. a producer). It handles an update in two parts, and
only one of them is idempotent-latest:

| Reducer target | Semantics | Safe to collapse on? |
|---|---|---|
| `messages[idx].result` / `.toolDetails` | unconditional overwrite (`:1841-1845`) | yes |
| `next.subagents` | **accumulative** — `{...existingSub}` merged with a patch whose every field is extracted CONDITIONALLY (`readSubagentDetails:363-389`) | **only when the newer tick subsumes the older** |

So `replay(u₁ … uₙ) ≡ replay(uₙ)` does **not** hold in general. Counter-examples
that exist in the current tree:

- `agentSessionId` is emitted only by a v7+ producer (`:385-386`) and drives the
  **dual-index** in `setSubagentState` (`:402-410`). Collapsing onto a tick that
  omits it silently drops the second map key — the lookup-by-session-id miss
  that `resolve-subagent-inspector-by-session-id` exists to prevent.
- `readSubagentDetails` carries an explicit `entries: []` guard (`:369-373`)
  *because* an initial or late/reordered frame legitimately arrives empty.
  Collapsing onto such a tick leaves an empty timeline where the full fold
  retained one.

This change therefore does not assume the equivalence — it **enforces** it with a
superset gate (design D7): a predecessor is dropped only when the successor
demonstrably subsumes it. Ticks that are full snapshots (the overwhelmingly
common case, and the entire ~6 000-tick flood measured above) collapse; a
non-subsuming tick retains both.

## What Changes

Collapse superseded `tool_execution_update` events **at retention time, inside
`insertEvent`**: when an update for `toolCallId T` is stored, drop the
previously retained update for `T` from the same session buffer.

- **Retention only — transmission is untouched.** `event-wiring.ts:717` inserts
  and then re-reads (`eventStore.getEvent(sessionId, seq) ?? prepared.event`)
  before broadcasting. Collapse removes *predecessors*, never the event being
  inserted, so every 250 ms tick still reaches subscribers. Live streaming UX is
  unchanged.
- **Collapse is superset-gated** (D7). A retained predecessor is dropped only
  when the incoming update subsumes it: every key of the predecessor's resolved
  subagent `details` is present in the successor's, a non-empty `entries` is not
  replaced by an empty one, and extractable `partialResult.content` text is not
  lost (`content` is a sibling of `details`, and it is what populates the
  rendered `result`). Otherwise both are retained.
- **The entry-creating update is pinned** (D7). `type` and `description` are
  FIRST-wins in the consumer — supplied by whichever update creates the subagent
  map entry and never overwritten — so a key-presence gate cannot protect them.
  The first `agentId`-bearing update per call is therefore retained
  structurally, rather than enumerating which fields are first-wins. Retention
  is at most two events per call: creating + newest.

Together these make the replay equivalence a checked precondition rather than an
assumption about emitter behaviour.
- **The newest update per `toolCallId` is retained even after
  `tool_execution_end`.** Note this is a conservatism choice, NOT a necessity:
  a live end event **does** carry top-level `details` for Agent tools — the
  bridge lifts `result.details` onto it (`bridge.ts:1876-1884`, change
  `flow-agents-readable-list`). Dropping updates on completion is therefore a
  plausible additional saving, but it is deferred: it needs its own verification
  that a live end's `details` is equivalent to the final running snapshot for
  every producer version, and the marginal gain is one event per completed call
  once collapse is in place.
- **Instrumentation**, mirroring `instrument-event-store-trim`: a cumulative
  `collapsedUpdates` counter on `getTrimStats()` so the shed path is observable
  and provably fires. `getTrimStats()` is wire-exposed — `/api/health` serializes
  it as `storeTrim` (`system-routes.ts:569`) — so this is an **additive**
  response field, and it obliges updating the hardcoded shape annotation
  (`system-routes.ts:122-124`) and the exact-shape `toEqual` assertion
  (`memory-event-store.test.ts:540`).

- **The catch-up replay frame is measured, not assumed to shrink.** Collapse
  reduces the buffer that `clearReplaying` reads, so the `event_replay` frame
  shrinks as a *consequence* — which is exactly the kind of side effect that
  silently regresses because nothing asserts it. This change therefore adds a
  verification that a collapsed buffer's catch-up frame serializes below
  `MAX_WS_BUFFER`, and records the drop counters against the baseline. It adds
  **no new transport mechanism** (see out of scope).

Expected effect on the measured sessions: ~6 000 retained updates across a few
dozen `toolCallId`s → one per in-flight call, ≈ **1 200 MB → ~4 MB per session**;
server heap ≈ **5.75 GB → ~3.3 GB**. On the transport, the catch-up frame falls
from ~1 400 updates to one per in-flight `toolCallId` — from ~225 MB to under
the 4 MB `MAX_WS_BUFFER`, removing the freeze at its source rather than by
dropping frames.

**Explicitly out of scope** (each is a separate change):

- Bridge-side / wire-level reduction. Rejected as the layer for *this* fix: at
  send time no successor exists, so the bridge cannot distinguish a live tick
  from a soon-to-be-superseded one. Saving those bytes means throttling the tick
  rate or moving to deltas — a wire-protocol change that trades away the live
  streaming the 250 ms tick exists to provide. It would also miss the four
  non-bridge ingresses below.
- The `subagent_started` / `subagent_*` full-`details` payload (~55 MB measured).
- **A byte budget on the transport itself.** Collapse shrinks the catch-up frame
  but does not *bound* it: the frame is still `N toolCallIds × ~190 KB` with no
  ceiling, so a session with enough concurrent calls can re-cross
  `MAX_WS_BUFFER`. The durable fixes — chunk `clearReplaying`'s catch-up the way
  the main replay path already chunks, and measure the serialized frame in
  `sendTo` instead of only the pre-send buffer — belong in a transport change
  that is correct independently of how large events happen to be. Filed as a
  follow-up (task 6.4) rather than folded in, because it is a different layer
  with a different failure mode. Note the unguarded `ws.send` in
  `terminal-manager.ts:294` / `:321` (PTY firehose and ring-buffer replay, no
  `MAX_WS_BUFFER` consultation at all) belongs to that same follow-up.
- Any retuning of `MAX_CACHED_SESSIONS`, `MAX_EVENTS_PER_SESSION`,
  `MAX_STRING_SIZE`, or `MAX_EVENT_DATA_SIZE`.
- Dropping a completed call's final update on `tool_execution_end` (see above).
- Storing event bodies outside the V8 heap (tmpfs / RAM-disk / file spill). This
  was the original hypothesis and is recorded here so the next investigator does
  not chase it: tmpfs is RAM-backed page cache (and absent on `darwin`), V8
  cannot page a reachable object to a file, and the bytes in question are
  redundant duplicates — deleting beats relocating.

## Discipline Skills

- `performance-optimization` — measure-first; the baseline above is the gate, and
  the fix must be re-measured against it rather than assumed.
- `observability-instrumentation` — the shed path needs a counter, or the next
  investigator repeats this whole probe.
- `review-code` — touches the single choke point every event ingress funnels
  through.
