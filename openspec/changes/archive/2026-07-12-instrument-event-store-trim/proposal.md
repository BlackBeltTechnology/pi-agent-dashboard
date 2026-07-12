## Why

`fix-stuck-tool-card-on-dropped-event` instrumented the two transport **drop**
hops (server→browser fanout back-pressure, bridge→server ring eviction) and
surfaced them on `GET /api/health#droppedFrames`. But the third way a terminal
`tool_execution_end` can vanish — the in-memory store **trimming** it under the
per-session cap — is completely **silent**. `MemoryEventStore.trimBufferToLimit`
and `evictIfNeeded` (`memory-event-store.ts`) drop events with no counter and no
log.

This blind spot blocks a real decision. `fix-stuck-tool-card-superseded-heal`
parks a server-side backstop in its design.md "Deferred" — never-evict the
latest `tool_execution_end` per live tool call, or a bounded keepalive ring —
whose gate is "does store eviction actually happen in production." Live evidence
gathering answered the transport hops (0 drops at both, over the instrumented
window + the live health counter) but **could not answer the store-trim
question**: trim is unmeasured by construction.

The trim path is precisely the deferred backstop's failure mode. Per
`preserve-chat-head-on-event-trim`, `trimBufferToLimit` drops the **oldest
non-essential** events first — and `tool_execution_*` is non-essential. So a
long, subagent-heavy session that overshoots the 20 000-event cap can drop an
old tool call's `tool_execution_end`, which makes the client's REST reconcile
404 and forces the supersede *display* heal (a masked result loss). We cannot
justify building (or skipping) the source-level backstop without knowing whether,
and how often, this trim fires against real terminal events.

## What Changes

Add telemetry only — no behavior, protocol, or cap change.

- **Count store trims + evictions (server).** `MemoryEventStore` SHALL maintain
  cumulative counters: total events dropped by `trimBufferToLimit`, of those how
  many were `tool_execution_end` (the Gate-B-relevant signal), per-session trim
  totals, and total sessions dropped by `evictIfNeeded`. Exposed via a new
  `getTrimStats()` on the store handle.

- **Surface on `/api/health` (server).** The health payload SHALL carry a
  `storeTrim` field next to the existing `droppedFrames`, so the same
  diagnostics surface answers "is the store shedding terminal events." Additive;
  existing fields unchanged.

Non-goals: the backstop itself (never-evict / keepalive ring); raising any cap;
changing what `trimBufferToLimit` drops; per-event acks; a client surface (this
is server-side store telemetry).

## Capabilities

- `incremental-event-sync` (ADDED store-trim instrumentation requirement) —
  sibling to the base change's drop-site instrumentation; makes the third
  loss path (store trim/evict) observable.

## Dependencies

- Complements `fix-stuck-tool-card-on-dropped-event`'s drop-site instrumentation
  (same `/api/health` surface, additive field). No ordering constraint on it.
- **Gates** `fix-stuck-tool-card-superseded-heal`'s deferred server-side
  backstop: that follow-up should be decided on this counter's data, not on
  guesswork.

## Discipline Skills

- `observability-instrumentation` — the store-trim counters + health surface are
  the entire change; count the loss so the backstop decision is evidence-driven.
