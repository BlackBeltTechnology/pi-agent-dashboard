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

Every intermediate update is redundant. The client reducer
(`event-reducer.ts:1821`, the ONLY consumer) **assigns** rather than
accumulates — `result` and `toolDetails` are overwritten from each event — and
the code states the invariant outright: the `details` "carry the full running
snapshot … on every ~250 ms tick". Therefore
`replay(u₁ … uₙ) ≡ replay(uₙ)`. Retaining `u₁ … uₙ₋₁` buys nothing.

## What Changes

Collapse superseded `tool_execution_update` events **at retention time, inside
`insertEvent`**: when an update for `toolCallId T` is stored, drop the
previously retained update for `T` from the same session buffer.

- **Retention only — transmission is untouched.** `event-wiring.ts:717` inserts
  and then re-reads (`eventStore.getEvent(sessionId, seq) ?? prepared.event`)
  before broadcasting. Collapse removes *predecessors*, never the event being
  inserted, so every 250 ms tick still reaches subscribers. Live streaming UX is
  unchanged.
- **The newest update per `toolCallId` is retained even after
  `tool_execution_end`.** A LIVE end event carries **no `details`** — it mutates
  the `toolDetails` already on the message row, which was written by the final
  update. Only the replay path (`state-replay.ts`) synthesizes `details` onto the
  end event. Dropping the last update would blank completed subagent cards on
  refresh, re-opening the "Subagent not found" class of bug that
  `add-subagent-inspector` §12 and `fix-subagent-live-detail-durable-hydration`
  exist to prevent.
- **Instrumentation**, mirroring `instrument-event-store-trim`: a cumulative
  `collapsedUpdates` counter on `getTrimStats()` so the shed path is observable
  and provably fires.

Expected effect on the measured sessions: ~6 000 retained updates across a few
dozen `toolCallId`s → one per in-flight call, ≈ **1 200 MB → ~4 MB per session**;
server heap ≈ **5.75 GB → ~3.3 GB**.

**Explicitly out of scope** (each is a separate change):

- Bridge-side / wire-level reduction. Rejected as the layer for *this* fix: at
  send time no successor exists, so the bridge cannot distinguish a live tick
  from a soon-to-be-superseded one. Saving those bytes means throttling the tick
  rate or moving to deltas — a wire-protocol change that trades away the live
  streaming the 250 ms tick exists to provide. It would also miss the four
  non-bridge ingresses below.
- The `subagent_started` / `subagent_*` full-`details` payload (~55 MB measured).
- Any retuning of `MAX_CACHED_SESSIONS`, `MAX_EVENTS_PER_SESSION`,
  `MAX_STRING_SIZE`, or `MAX_EVENT_DATA_SIZE`.
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
