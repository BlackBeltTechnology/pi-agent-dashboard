# Design

## Context

Ingest path for a forwarded event (all synchronous, inside the bridge socket
read callback — the exact crash stack):

```
bridge WS: event_forward  (subagent full timeline embedded)
  → event-wiring.ts:460   msg.type === "event_forward"
  → eventStore.insertEvent()              memory-event-store.ts:197
      → truncateEventData(event)          createTruncator()  ← per-field cap only
  → browserGateway.broadcastEvent()       browser-gateway.ts:825
      → sendTo() → JSON.stringify(msg)    browser-gateway.ts:298  ← OOM here
```

The OOM is in the broadcast `JSON.stringify`, but the root cause is that
`truncateEventData` let an unbounded payload through. Fixing it at the truncator
(before `insertEvent` stores it) protects every downstream consumer at once:
persist, broadcast, replay, on-demand load.

## Goals / Non-Goals

- **Goal:** no single forwarded event can cause an unbounded allocation on the
  server, regardless of nesting depth or field count.
- **Goal:** the guard is bounded-cost on the hot path (runs per event).
- **Non-goal:** changing the count-based trim, the forward protocol, image
  preservation, or introducing chunked delivery.

## Decisions

### 1. Enforce `MAX_EVENT_DATA_SIZE` as a hard per-event ceiling

After the existing per-field `truncateStrings` pass, estimate the serialized
size of `event.data`. If it exceeds `MAX_EVENT_DATA_SIZE` (default 20 000),
replace `event.data` with a bounded placeholder:

```ts
{ __truncated: true, reason: "event data exceeded MAX_EVENT_DATA_SIZE",
  approxBytes: <n>, eventType: event.eventType }
```

- Applied inside `createTruncator` so it runs once, at ingest, covering persist
  AND broadcast.
- The placeholder is tiny and stable, so the downstream `JSON.stringify` can
  never allocate an unbounded string.
- `MAX_EVENT_DATA_SIZE` becomes a constructor-injectable parameter (mirrors
  `maxStringFieldSize`), `0` = disabled, so tests can force small caps.

### 2. Bounded-cost size measurement (must not OOM while measuring)

Measuring by `JSON.stringify(data).length` would re-allocate the very giant
string we are trying to avoid. Instead use an **early-exit size walk**: a
recursive byte accumulator that stops and returns as soon as the running total
crosses `MAX_EVENT_DATA_SIZE` (it never needs the exact size — only "over or
under"). Worst case it visits nodes until it accumulates `cap` bytes, then
bails — O(cap), not O(payload).

Alternative considered — `Buffer.byteLength(JSON.stringify(data))`: rejected,
it materializes the full string (the exact allocation that OOMs).

### 3. Close the depth-4 escape in `truncateStrings`

Today `if (depth > 4) return obj;` returns deep sub-trees raw. Change so that at
the depth limit the value is **summarized** rather than returned whole:
- string past the limit → truncate to `maxSize` as elsewhere;
- array/object past the limit → collapse to `"[truncated: deep]"`.

This removes the smuggling path so decision #1's ceiling is rarely hit for
normal-but-deep events, and #1 remains the hard backstop for the rest. Image
preservation (`data` + sibling `mimeType`) is checked before any collapse.

### 4. Headroom (defensive)

Set `--max-old-space-size` for the server process (documented default, e.g.
4096→8192) so a pathological event degrades rather than killing the process.
Not a substitute for #1; strictly belt-and-braces.

## Risks / Trade-offs

- **Legitimately large events** (e.g. a big non-image tool result) now render as
  a placeholder. Mitigation: the cap is per *event*, generous (20 KB serialized)
  after per-field truncation; the transcript head and normal chat are
  unaffected. Acceptable vs. crashing the whole server.
- **Measurement cost** on every event. Mitigation: early-exit walk is O(cap),
  and the common case (small event) exits almost immediately.

## Migration / Compatibility / Rollback

- **Migration:** none — in-memory store, no schema, no persisted format change.
- **Compatibility:** protocol unchanged; the placeholder is ordinary event data,
  so existing clients render it as text with no new message type.
- **Rollback:** set the injected `MAX_EVENT_DATA_SIZE` to `0` (disabled) to
  restore prior behavior without code changes; or revert the change entirely.

## Open Questions

- Placeholder shape: object (`{ __truncated: true, ... }`) vs. a plain string
  marker. Leaning object so the client can style it distinctly, but a string is
  simpler and needs no client awareness. Confirm during implementation.
