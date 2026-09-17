## Context

See `proposal.md` — Why. Relevant store shape today (`packages/server/src/persistence/memory-event-store.ts`):

- `StoredEvent = { seq, event }`; `SessionBuffer = { events, nextSeq, lastAccess, collapseIndex }`.
- `insertEvent`: truncate → push → `collapseSuperseded` → `collapseOnEnd` → count trim (hysteretic, `trimSlack = min(256, 5 %)`) → `evictIfNeeded`.
- Removal paths: `trimBufferToLimit` (rebuilds `buf.events`), `dropIfSuperseded` (one `splice`), `deleteEventsForSession`, `evictIfNeeded` (drops whole buffer).
- `measureBytes(value, cap)` is a bounded early-exit walk returning exact bytes when `≤ cap`, else `cap + 1`; the truncator already guarantees a stored event's `data` is `≤ maxEventDataSize`, so calling it once per insert with `cap = maxEventDataSize` (or a generous cap when the ceiling is `0`) yields an exact size at the cost of one walk the truncator already paid.
- `TrimStats` is additive; `EMPTY_TRIM_STATS` in `system-routes.ts` must carry every field.
- Memory limits live in browser-safe `packages/shared/src/memory-limits.ts` and are threaded through `config.ts` → `server.ts` → `createMemoryEventStore(...)` positionally.

## Goals / Non-Goals

**Goals:**
- Byte bound with the identical shed policy and hysteresis shape as the count trim, so operators reason about one policy.
- Exact accounting: `buf.bytes === Σ stored.bytes` at every observable point; enforced by a test that recomputes the sum after each removal path.
- Zero extra serialization on the hot path beyond the one measurement per insert.

**Non-Goals:**
- Changing WHAT gets shed (essential-set, ordering) — reused verbatim.
- Measuring the `{ seq }` envelope or `StoredEvent` object overhead; `data` serialized size is the number the ceiling already defines.
- **Heap-pressure shedding.** Shedding harder as `heapUsed` approaches `heapSizeLimit` was CUT from this change: it has no defined trigger site, no defined target when a budget is `0`, and at the new defaults the store (768 MiB) cannot reach 85 % of an 8 GiB ceiling — the mechanism would only fire in configurations where its own semantics are undefined. The aggregate budget is the actual fix. Filed as a follow-up change. `heapSizeLimit` is still EXPOSED here (absent today, so no client can compute headroom); only the automatic shed is deferred.
- Serving `history_backfill` from disk — an explicit non-goal of `lazy-load-session-history`, unchanged here. See Risks for the scrollback consequence.

## Decisions

### D1 — Size recorded on the `StoredEvent`, total on the `SessionBuffer`

`StoredEvent` gains `bytes: number` (measured once in `insertEvent` after `truncateEventData`); `SessionBuffer` gains `bytes: number`. Every removal decrements by the removed entry's `bytes`. Recording on the entry means a removal never re-measures; a parallel array would drift under `trimBufferToLimit`'s wholesale rebuild.

*Alternative rejected:* a `Map<seq, bytes>` — one more structure to prune on every path, and the buffer already rebuilds its array.

External consumers that construct `{ seq, event }` literals (subscription-handler, browser-gateway, event-wiring) produce WIRE frames, not `StoredEvent`s — they are unaffected. `bytes` is optional on the type only if a test fixture needs it; prefer required and fix fixtures.

### D2 — Measure with `measureBytes(data, ceilingOrLarge)`

When `maxEventDataSize > 0`, `measureBytes(stored.event.data, maxEventDataSize)` is exact by the truncator's guarantee. When the ceiling is `0` (disabled), use `measureBytes(data, MEASURE_CEILING_FALLBACK)` where the fallback is a large but FINITE cap (16 MiB) — NOT `Number.MAX_SAFE_INTEGER`. `walkSize` early-exits on `cap`; handing it `MAX_SAFE_INTEGER` removes the only bailout and lets one adversarial payload walk an unbounded object graph synchronously on the event loop. A finite fallback keeps the walk bounded; an event above it is accounted at `cap + 1`, which under-counts only in the configuration that already opted out of the per-event ceiling. Byte-accurate per `jsonStringByteSize` (UTF-8 + escapes; images at real size) — the same yardstick the ceiling uses, so "64 MiB of events" means the same thing as "256 KiB per event".

### D3 — Generalize `trimBufferToLimit` to a stop predicate

`trimBufferToLimit(buf, { maxEvents, maxBytes })` runs the same two-pass copy: pass 1 drops oldest non-essential while `events.length > maxEvents || bytes > maxBytes`; pass 2 drops oldest essentials while still over either bound. Returns `{ dropped, toolEndDropped, bytesDropped }`. One function, one policy — the byte trim cannot diverge from the count trim by construction.

Trigger in `insertEvent`:
`(maxEvents > 0 && events.length > maxEvents + trimSlack) || (maxBytes > 0 && bytes > maxBytes + byteSlack)`,
where `byteSlack = min(4 MiB, floor(maxBytes * 0.05))` — mirrors the existing `trimSlack` rule so both bounds are amortized O(1). The trim reclaims to BOTH caps in the single pass. Inside `trimBufferToLimit` a disabled bound is treated as `+Infinity`, so `{ maxEvents: 20000, maxBytes: 0 }` behaves exactly like today's count trim.

**Reclaim TARGET is the budget, not the trigger threshold.** The trigger is
`maxBytes + byteSlack`; the pass reclaims down to `maxBytes`. Trimming only back
to the trigger would satisfy the postcondition invariant while re-firing a full
two-pass O(n) rebuild on essentially every subsequent insert — hysteresis in
name only. Reclaiming to the budget buys a whole slack window of inserts before
the next pass, which is what makes the amortization claim true. This mirrors the
existing count trim exactly (`trimBufferToLimit(buf, maxEventsPerSession)` trims
to the cap, while the trigger is `cap + trimSlack`). Same rule for the global
budget (D7) and the all-pinned fallback.

**The `maxBytes > 0` guard is load-bearing, not defensive.** With `maxBytes = 0`
("unlimited") the slack is `min(4 MiB, floor(0 * 0.05)) = 0`, so an unguarded
`bytes > maxBytes + byteSlack` reads `bytes > 0` — true on the first event ever
stored, trimming every session to nothing in exactly the configuration that
asked for NO byte bound. The count side already carries this guard
(`maxEventsPerSession > 0 &&`, `memory-event-store.ts:1428`); the byte side
mirrors it, and so does the global budget.

### D3a — Pass 2 becomes reachable; the invariant is restated, not weakened

Pass 2 (drop oldest ESSENTIALS when essentials alone exceed the bound) is
documented today as "pathological; cap is 20000 so never hit in practice"
(`memory-event-store.ts:259-260`). A byte budget that BINDS by design makes it
reachable: a long chat of large `message_*` events can exceed 32 MiB on
essentials alone, and then `message_start`/`message_end` — the chat head
`preserve-chat-head-on-event-trim` protects — start dropping.

Accepted, not designed around: the alternative is exceeding the budget, which is
the OOM this change exists to prevent. The POLICY is unchanged (the non-goal
holds — pass 2 already did this for counts); what changes is that it now
happens. Called out so the spec asserts it rather than a future reader
discovering it, and so the existing invariant is read correctly: the chat head
survives every trim where non-essentials can still be shed, which is every
ordinary session.

### D4 — Telemetry: one additive counter, and where the GAUGE goes

`TrimStats.trimmedBytes` (cumulative bytes released by trims where the byte bound was the active trigger; when both bounds fire in the same pass the bytes are counted — a byte trim happened). Event counts fold into the existing `trimmedEvents.*`.

**Attribution is defined exhaustively, so an operator can reconcile the number:**

| release path | `trimmedBytes` | `trimmedEvents.*` |
|---|---|---|
| byte bound was a trigger of the pass (alone or with the count bound) | += bytes released by that pass | += events dropped |
| count bound was the ONLY trigger | unchanged | += events dropped |
| global whole-buffer eviction | unchanged — see `evictedBytes` | unchanged (eviction is not a trim) |
| all-pinned fallback byte reclaim | += bytes released (it IS a byte trim) | += events dropped |

Bytes released by a count-only pass are deliberately NOT in `trimmedBytes`: the
counter answers "did the byte bound ever bind", and folding count-trim bytes in
would make it always non-zero and answer nothing. `residentBytes` is the gauge
that covers the other question.

**`evictedBytes` accompanies `evictedSessions`.** `evictedSessions` is a session
COUNT, so with only that field the single largest byte sink this change
introduces — whole-buffer global reclaim — is invisible in bytes, and an operator
watching `residentBytes` fall cannot attribute the drop. The counters are not
claimed to close the books exactly (collapse splices and `deleteEventsForSession`
also shed bytes and are deliberately uncounted — they are ordinary lifecycle, not
budget pressure); `residentBytes` is the ground truth, and the counters exist to
attribute PRESSURE, not to balance to zero. Stated explicitly so nobody later
reads the set as a complete byte ledger.

**Store-derived retention signals get their OWN block; `storeTrim` stays
counters-only.** `TrimStats` is documented "cumulative … never reset on read"
(`memory-event-store.ts:73-79`) and `EMPTY_TRIM_STATS` exists to keep that shape
honest — a gauge, a config constant and a boolean latch in a monotonic-counter
struct all break the invariant it is named for. A new sibling `storeRetention`
block carries the three store-derived signals together:

| field | kind | why here |
|---|---|---|
| `residentBytes` | gauge | current global total |
| `effective.maxBytesPerSession` / `.maxTotalEventBytes` / `.maxCachedSessions` | config constants | floor clamp runs in the store, so configured ≠ enforced |
| `globalBudgetExceeded` | latch | budget is below the live pinned working set |

`heapSizeLimit` is process-derived, not store-derived, so it sits beside
`server.rss` / `server.heapUsed` — with `storeRetention.residentBytes` that is
still the row an operator reads for headroom. `EMPTY_TRIM_STATS` gets the field (its explicit type makes a miss a compile error, per the existing design note). A TEST-ONLY `getBufferBytes(sessionId)` probe exposes `buf.bytes` for the accounting-exactness test, in the style of `getRangeProbe`.

### D5 — Default 32 MiB (revised from 64 MiB by measurement)

A 20 000-event session of typical 1–3 KiB events is 20–60 MiB. The original 64 MiB default was chosen so it would rarely trim an ordinary session — but a heap snapshot of the live server measured **36 MB per pegged session**, i.e. BELOW 64 MiB. A default that never binds on the observed workload does not bound anything: the sessions that filled the heap were each individually legal. 32 MiB binds on exactly those sessions while still admitting a normal one.

**32 MiB < the measured 36 MB is the intent, not an oversight.** Existing pegged
sessions WILL be trimmed on the first insert after restart. That is the change
working; a default above the observed occupancy is a default that never fires.
The measurement is used as a floor-finder, not as a forecast — occupancy is
unbounded under the count cap alone (20 000 × up to 256 KiB), so "64 MiB would
never bind" is true of TODAY's workload only, which is precisely why the number
is pinned below it rather than above.

**Floor clamp lives in the STORE, not in the shared loader.**
`maxEventDataSize` is not part of `MemoryLimitsConfig` — it is a top-level
`DashboardConfig` field resolved at `server.ts:918`, and `memory-limits.ts` is
deliberately browser-safe, so the shared loader CANNOT compute
`4 × maxEventDataSize`. `createMemoryEventStore` receives both values, so it is
the only place that can. The loader does type/negative validation only
(garbage → default, explicit `0` preserved); the store applies the floor.

The clamp has two carve-outs, both load-bearing:

- **`0` is never clamped.** `0` means unlimited and is numerically below every
  floor, so an unqualified "clamp up to the floor" would silently ENABLE a byte
  bound in the one configuration that asked for none — the same class of bug as
  the missing `maxBytes > 0` trigger guard in D3.
- **The floor is computed from the EFFECTIVE per-event ceiling**, i.e.
  `4 × (maxEventDataSize > 0 ? maxEventDataSize : MEASURE_CEILING_FALLBACK)`.
  A literal `4 × maxEventDataSize` collapses to `0` exactly when the ceiling is
  disabled — the only configuration where a single event is unbounded, so the
  only one where the floor actually matters. Left uncorrected, a small budget
  plus a disabled ceiling pins every session at the one-event floor of D9 while
  accounting each event at `MEASURE_CEILING_FALLBACK + 1`, enforcing the budget
  against a proxy that can sit arbitrarily far below real bytes.

That split means the configured value and the EFFECTIVE value can differ, so
the effective budgets are published on `/api/health` rather than left implicit —
otherwise Settings would render a bound the store does not enforce.

The original note said the 6.4 GB cross-session worst case was "still the LRU's job, unchanged." **That assumption is now disproved**: live telemetry reports `evictedSessions = 0` — the LRU has never fired once in 35.8 h, because it triggers on session COUNT (100) and only ~19 buffers are ever resident. The LRU cannot do the job it was assumed to do, which is why D7 adds a global byte budget.

### D7 — Global byte budget is the binding constraint

Per-session budgets multiply: the real envelope is `maxBytesPerSession × maxCachedSessions`. At the shipped values that is 64 MiB × 100 = 6.4 GB, above BOTH observed crash ceilings (~4093 MB and ~8130 MB), so the per-session cap alone cannot prevent the OOM it was written for. `maxTotalEventBytes` (default 768 MiB, sized to the 686 MB currently resident) bounds the sum directly.

Global reclaim evicts whole buffers LRU-first and reuses the existing `isSessionPinned` predicate, so it degrades idle sessions before attached ones. It deliberately does NOT byte-trim every session proportionally: dropping one idle session's tail entirely is cheaper and less destructive to the sessions a user is actually watching.

**Global reclaim is hysteretic too.** `byteSlack` as defined in D3 is per-session
only; without a global equivalent, a store sitting at the budget would sort the
buffer map and run reclaim on EVERY subsequent insert — O(sessions log sessions)
per event, destroying the amortization D3 is built around.
`globalSlack = min(64 MiB, floor(maxTotalEventBytes * 0.05))`, same shape as the
other two: reclaim fires only above `budget + globalSlack`, and reclaims down to
`budget` (not to `budget + globalSlack`), so consecutive passes are separated by
a whole slack window of inserts. Guarded by `maxTotalEventBytes > 0`, per D3.

**The true ceiling is therefore `maxTotalEventBytes + globalSlack`, plus one
admitted oversized event.** The "768 MiB" figure is the budget, not the
high-water mark; the high-water mark is ~806 MiB. Stated here so the number is
not quoted as an absolute elsewhere.

**All-pinned fallback, bounded.** `isSessionPinned` is
`piGateway.isSessionConnected(id) || browserGateway.getSubscriberCount(id) > 0`
(`server.ts:922-924`) — so EVERY active session is pinned and this path is
ordinary under load, not exotic. It must therefore be specified tightly:

- It byte-reclaims the least-recently-accessed PINNED buffer down to
  `budget - globalSlack` worth of global total, not to exactly `budget`, so the
  next insert does not immediately re-trigger it (the thrash mode).
- It may drop only NON-essential events. Unlike the per-session pass it does NOT
  fall through to essentials: a session under its own budget being stripped of
  its chat head to serve an unrelated session is a loss no operator asked for.
  If non-essentials alone cannot bring the total under budget, the store
  ACCEPTS the overshoot and records it (`globalBudgetExceeded` on the trim
  stats) rather than eating chat heads across every pinned session.
- It is the only path that trims a session which is WITHIN its own per-session
  budget. That is a deliberate exception to D3's policy, named here because the
  per-session spec (R2) does not authorize it on its own.

**The accepted-overshoot state must LATCH, or it becomes a per-insert scan.**
Once non-essentials are exhausted across every pinned session, the fallback's
precondition (all pinned ∧ total over threshold) stays true on every subsequent
insert — so an unlatched implementation re-walks every buffer per event, the
exact O(sessions × buffer)-per-insert cost the hysteresis exists to avoid. The
store therefore sets a `globalBudgetExceeded` latch when a fallback pass frees
nothing, and skips further fallback passes until the latch clears. It clears on
any event that can change the outcome: a buffer is evicted or deleted, a session
unpins, or the global total drops below the budget. `globalBudgetExceeded` is
surfaced as a `storeRetention` field on `/api/health` — it is the signal that the
budget is configured below what the live pinned working set needs.

**Eviction of a whole idle buffer is not a chat-head violation.** Global reclaim
drops an unpinned session's buffer entirely, chat head included, triggered by a
DIFFERENT session's insert. That is the LRU policy that already exists today
(`evictIfNeeded`), merely driven by a second dimension: an evicted session is
not degraded, it is non-resident, and it rehydrates from its transcript on
reopen. Chat-head protection governs what survives WITHIN a retained buffer; it
was never a promise that a buffer stays resident.

### D8 — `maxCachedSessions` becomes configurable, default 100 → 32

`server.ts:925` passes `undefined, // maxCachedSessions (use default)`, hardcoding 100 — the single largest multiplier in the envelope, and the only memory knob with no operator control. It is threaded from config like its siblings. Default 32 covers the observed 13 active / 19 pegged with headroom; evicted sessions rehydrate from their transcript on reopen via the existing hydration path, so the cost is latency on an old session, not data loss.

**One default, not two.** `DEFAULT_MAX_CACHED_SESSIONS` (the store constant,
`memory-event-store.ts:204`) moves 100 → 32 TOGETHER with the config default, so
a direct `createMemoryEventStore(...)` call site (tests, the separately packaged
Electron server) cannot silently get 100 while the dashboard gets 32. A test
asserts the two constants are equal, since they live in different packages
(`memory-limits.ts` is browser-safe and cannot import the store) and nothing
else keeps them in step.

The two new bounds are complementary and both retained: the count cap is a cheap O(1) guard, the byte budget is the correct-but-costlier one. Worst case under the new defaults is `min(32 × 32 MiB, 768 MiB)` = 768 MiB.

### D9 — "Never exceeds budget + slack" has exactly one exception

Two requirements as first drafted were flatly contradictory: the budget invariant
said the total *"SHALL never exceed budget + slack after an insert returns"*,
while the admission rule said *"a single event larger than the budget SHALL
still be admitted"*. Both cannot hold: admit a 5 MiB event under a 4 MiB budget
and the total is over, with nothing left to shed.

The invariant is restated with its exception made explicit:

> After `insertEvent` returns, `buf.bytes <= maxBytes + byteSlack` **OR** the
> buffer retains exactly one event.

The one-event floor is what makes the store total rather than lossy: a bound
that could refuse an event would silently drop live transcript data. Reclaim
therefore stops when the buffer is down to a single entry, whatever its size.
The same exception applies to the global budget (`globalSlack`), where the floor
is one non-empty buffer.

The floor clamp (`4 × maxEventDataSize`) makes the exception rare rather than
impossible: it cannot be relied on at the constructor, only at the loader, and
`createMemoryEventStore` is called directly by tests and the Electron server
with arbitrary values — which is exactly why the exception is specified instead
of assumed away.

### D6 — Config threading follows `maxReplayEvents` exactly

`MemoryLimitsConfig.maxBytesPerSession` (browser-safe default in `memory-limits.ts`), loader in `config.ts` (absent/negative/non-numeric → default; explicit `0` preserved), `writeConfigPartial` untouched if `memoryLimits` is already written whole, `server.ts` passes it as the next positional arg to `createMemoryEventStore`. The settings control converts MiB ↔ bytes at the edge; the partial-write test asserts only the changed field is sent.

## Risks / Trade-offs

- [A single event near the ceiling on a tiny configured budget thrashes: insert → over → trim all others → insert …] → the budget floor is the per-event ceiling by construction (a single event is always admitted); document that `maxBytesPerSession` below `4 × maxEventDataSize` is unsupported and clamp the loader to that floor unless `0`.
- [Accounting drift from a removal path added later] → the exactness test walks all four paths; `bytes` lives on the entry so any future `splice` that forgets the decrement is caught by the sum test.
- [Byte trim fires on a session under the count cap and surprises an operator] → `trimmedBytes` on `/api/health` plus the existing `bySession` map name the session; hint text in Settings explains the shed order.
- [`measureBytes` cost on the hot path] → one bounded walk per insert, same walk the truncator already runs; measured against the existing trim-cost probe in the linearity test.
- [**Scrollback gets shallower — accepted trade-off**] → `history_backfill` reads ONLY the in-memory store, never disk (`browser-handlers/subscription-handler.ts:532-533`; serving backfill from disk is an explicit non-goal of `lazy-load-session-history`), and cold-load hydration re-inserts the transcript through `insertEvent` (`:959`) — so the byte budget now caps BOTH how far back a user can scroll and how much of a reopened session is restored. Today's bound is 20 000 events; under a 32 MiB budget a chatty session holds fewer. This is a real user-visible regression and it is accepted: the alternative currently observed is a fatal OOM that loses every session's history at once. It degrades gracefully — backfill already returns what remains and the client already renders a gap — and a spec scenario asserts that rather than leaving it to chance. Operators who value depth over headroom raise `maxBytesPerSession` or set it to `0`.
- [Serialized bytes are not heap bytes] → the budget is denominated in serialized `data` bytes; the crash ceiling is denominated in V8 heap bytes, and `rss` ran 1867 MB against `heapUsed` 818 MB. The snapshot says strings are 86 % of the live set, so the two track closely for THIS workload — but a 768 MiB budget means roughly 1 GiB heap and ~2 GiB RSS, not 768 MiB of host memory. The defaults are sized against the 8192 MB stamp with that factor already applied; the ratio is documented so nobody re-derives the budget as if it were an RSS figure.
- [`createMemoryEventStore` reaches 8 positional parameters] → accepted for this change: D6 threads the new keys exactly like `maxReplayEvents`, and converting the signature to an options bag would touch every existing call site and test for no behavioural gain. Noted as a follow-up refactor, not bundled here.

## Migration Plan

1. Additive: absent config → 32 MiB / 768 MiB / 32 defaults; `0` opts out of either byte bound. No data migration; store is in-memory.
2. Rollback: set `memoryLimits.maxBytesPerSession: 0` and `maxTotalEventBytes: 0`, and restore `maxCachedSessions: 100`.
3. `serverHeap` MUST remain 8192 until this lands — lowering the ceiling under an unbounded store converts a slow leak into a fast outage.
