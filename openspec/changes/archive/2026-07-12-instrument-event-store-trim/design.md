## Context

`memory-event-store.ts` exposes a factory `createMemoryEventStore(maxCachedSessions,
maxEventsPerSession)` returning a store handle. Two shed paths run inside
`insertEvent`:

- `trimBufferToLimit(buf, cap)` (free function, line ~71) — per-session cap;
  drops oldest non-essential events (`tool_execution_*`, `subagent_*`, `flow_*`,
  reasoning, stats, streaming deltas), preserving `message_start`/`message_end`
  (change: `preserve-chat-head-on-event-trim`).
- `evictIfNeeded()` (closure, line ~337) — cross-session LRU when
  `buffers.size > maxCachedSessions`; deletes whole session buffers.

Both are silent today. The base change's drop counters live on `browserGateway`
(`getDroppedFrameStats()`) and per-bridge heartbeats; this change adds the
symmetric counter on the store handle.

## Decisions

### D1 — Counters live in the store closure; the two shed functions report counts
`trimBufferToLimit` returns the number of entries it dropped (and, counted in the
same pass, how many were `tool_execution_end`). `evictIfNeeded` returns the number
of sessions it evicted. `insertEvent` accumulates both into closure state:

```
trimmedEventsTotal        // cumulative events dropped by trim
trimmedToolEndTotal       // of those, tool_execution_end (the Gate-B signal)
trimmedEventsBySession    // Map<sessionId, number>
evictedSessionsTotal      // cumulative session buffers evicted by LRU
```

Cumulative for process lifetime, never reset on read — mirrors
`droppedFramesTotal`. A monotonic counter is enough to answer "does trim ever
fire, and does it ever hit a terminal event."

`getTrimStats()` returns:
```
{ trimmedEvents: { total, toolExecutionEnd, bySession },
  evictedSessions: total }
```

### D2 — `trimBufferToLimit` counts tool-ends in its existing single pass
The drop already iterates every entry once. Count `tool_execution_end` among the
dropped entries in that same loop — no second scan, preserves the O(n)-amortized
contract the `preserve-chat-head-on-event-trim` change established. The `bySession`
tally is incremented by `insertEvent` (which knows the sessionId), not by the free
function.

### D3 — Surface via a new `eventStore` dep on `registerSystemRoutes`
`server.ts` already holds `eventStore` in scope and passes it to
`registerSessionRoutes`; `registerSystemRoutes` currently does not receive it. Add
`eventStore` to that call's deps and read `eventStore.getTrimStats()` in the
`/api/health` handler, emitting a `storeTrim` field beside `droppedFrames`.
Optional-chain the accessor (`eventStore.getTrimStats?.()`) for the same defensive
shape the drop stats use.

## Risks / Trade-offs

- **Counter overhead** — an integer increment inside an already-O(n) trim pass;
  negligible. `bySession` is a bounded `Map` (evicted with its session buffer).
- **Same-file merge with `add-bundle-immutable-health-flag`** — both add a field
  to the `/api/health` handler in `system-routes.ts`. Different fields, no
  semantic conflict; a trivial textual merge if both land.

## Migration

No protocol/schema/cap change. Purely additive health field + store accessor.
No client changes required to ship the telemetry (a future dashboard surface can
read `storeTrim`, out of scope here).
