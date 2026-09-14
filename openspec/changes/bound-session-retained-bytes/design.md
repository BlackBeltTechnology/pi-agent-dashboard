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
- Bounding the process-wide total across sessions (LRU eviction by `maxCachedSessions` remains the cross-session bound).
- Measuring the `{ seq }` envelope or `StoredEvent` object overhead; `data` serialized size is the number the ceiling already defines.

## Decisions

### D1 — Size recorded on the `StoredEvent`, total on the `SessionBuffer`

`StoredEvent` gains `bytes: number` (measured once in `insertEvent` after `truncateEventData`); `SessionBuffer` gains `bytes: number`. Every removal decrements by the removed entry's `bytes`. Recording on the entry means a removal never re-measures; a parallel array would drift under `trimBufferToLimit`'s wholesale rebuild.

*Alternative rejected:* a `Map<seq, bytes>` — one more structure to prune on every path, and the buffer already rebuilds its array.

External consumers that construct `{ seq, event }` literals (subscription-handler, browser-gateway, event-wiring) produce WIRE frames, not `StoredEvent`s — they are unaffected. `bytes` is optional on the type only if a test fixture needs it; prefer required and fix fixtures.

### D2 — Measure with `measureBytes(data, ceilingOrLarge)`

When `maxEventDataSize > 0`, `measureBytes(stored.event.data, maxEventDataSize)` is exact by the truncator's guarantee. When the ceiling is `0` (disabled), use `measureBytes(data, Number.MAX_SAFE_INTEGER)` — a full walk, but that configuration already accepted unbounded events. Byte-accurate per `jsonStringByteSize` (UTF-8 + escapes; images at real size) — the same yardstick the ceiling uses, so "64 MiB of events" means the same thing as "256 KiB per event".

### D3 — Generalize `trimBufferToLimit` to a stop predicate

`trimBufferToLimit(buf, { maxEvents, maxBytes })` runs the same two-pass copy: pass 1 drops oldest non-essential while `events.length > maxEvents || bytes > maxBytes`; pass 2 drops oldest essentials while still over either bound. Returns `{ dropped, toolEndDropped, bytesDropped }`. One function, one policy — the byte trim cannot diverge from the count trim by construction.

Trigger in `insertEvent`: `events.length > maxEvents + trimSlack || bytes > maxBytes + byteSlack`, where `byteSlack = min(4 MiB, floor(maxBytes * 0.05))` — mirrors the existing `trimSlack` rule so both bounds are amortized O(1). The trim reclaims to BOTH caps in the single pass.

### D4 — Telemetry: one additive counter

`TrimStats.trimmedBytes` (cumulative bytes released by trims where the byte bound was the active trigger; when both bounds fire in the same pass the bytes are counted — a byte trim happened). Event counts fold into the existing `trimmedEvents.*`. `EMPTY_TRIM_STATS` gets the field (its explicit type makes a miss a compile error, per the existing design note). A TEST-ONLY `getBufferBytes(sessionId)` probe exposes `buf.bytes` for the accounting-exactness test, in the style of `getRangeProbe`.

### D5 — Default 64 MiB

A 20 000-event session of typical 1–3 KiB events is 20–60 MiB, so the default rarely trims an ordinary session, while capping the 5.2 GB pathological case to ~1.2 %. Worst case across 100 cached sessions is 6.4 GB — still the LRU's job, unchanged. Operators tune via `memoryLimits.maxBytesPerSession`; settings control shows MiB and writes bytes (D6).

### D6 — Config threading follows `maxReplayEvents` exactly

`MemoryLimitsConfig.maxBytesPerSession` (browser-safe default in `memory-limits.ts`), loader in `config.ts` (absent/negative/non-numeric → default; explicit `0` preserved), `writeConfigPartial` untouched if `memoryLimits` is already written whole, `server.ts` passes it as the next positional arg to `createMemoryEventStore`. The settings control converts MiB ↔ bytes at the edge; the partial-write test asserts only the changed field is sent.

## Risks / Trade-offs

- [A single event near the ceiling on a tiny configured budget thrashes: insert → over → trim all others → insert …] → the budget floor is the per-event ceiling by construction (a single event is always admitted); document that `maxBytesPerSession` below `4 × maxEventDataSize` is unsupported and clamp the loader to that floor unless `0`.
- [Accounting drift from a removal path added later] → the exactness test walks all four paths; `bytes` lives on the entry so any future `splice` that forgets the decrement is caught by the sum test.
- [Byte trim fires on a session under the count cap and surprises an operator] → `trimmedBytes` on `/api/health` plus the existing `bySession` map name the session; hint text in Settings explains the shed order.
- [`measureBytes` cost on the hot path] → one bounded walk per insert, same walk the truncator already runs; measured against the existing trim-cost probe in the linearity test.

## Migration Plan

1. Additive: absent config → 64 MiB default; `0` opts out. No data migration; store is in-memory.
2. Rollback: set `memoryLimits.maxBytesPerSession: 0`.
