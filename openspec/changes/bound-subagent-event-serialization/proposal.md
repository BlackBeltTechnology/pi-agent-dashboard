# bound-subagent-event-serialization

## Why

A single `Agent` (subagent) call crashed the **whole dashboard server** with a
fatal V8 out-of-memory. Confirmed from `~/.pi/dashboard/server.log`:

```
Last GC: Mark-Compact 4042.6 (4130.5) MB   ← heap maxed at the ~4 GB default cap
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
 8: v8::internal::JsonStringify(...)          ← died serializing one object to JSON
33: node::StreamBase::CallJSOnreadMethod       ← inside a bridge-socket read callback
```

The crash frame is conclusive: the server ran out of heap **inside a single
`JSON.stringify`**, invoked synchronously from the bridge WebSocket read
callback. That is the `event_forward` ingest path in `event-wiring.ts:460` →
`browserGateway.broadcastEvent()` → `sendTo()` → `JSON.stringify(msg)`
(`browser-gateway.ts:298`). Per the `Agent` tool contract, a subagent's **full
timeline** (tool calls, reasoning, assistant text) is embedded in the returned
result and forwarded to the dashboard as event data. Serializing that one
oversized, deeply-nested payload allocated a multi-GB string → FATAL → the
entire server process died (no graceful shutdown, all 8 sessions dropped).

The event store (`memory-event-store.ts`) already truncates, but has three holes
that let a subagent payload through nearly whole:

1. **`MAX_EVENT_DATA_SIZE = 20_000` is dead code.** The constant that was meant
   to cap an individual event's *total serialized size* is declared (line 92)
   and **never referenced** anywhere. Confirmed by grep. Only the per-*string-
   field* cap (`DEFAULT_MAX_STRING_SIZE = 4_000`) is enforced — which bounds
   each field but never the aggregate of thousands of fields.
2. **Recursion bails at depth 4 and returns the sub-tree raw.** `truncateStrings`
   has `if (depth > 4) return obj;`. A subagent result nests deep
   (`data.result.timeline[].data.result…`); everything past depth 4 — huge
   strings and arrays alike — escapes truncation entirely.
3. **The array guard only fires while recursion is active (≤ depth 4).** A large
   timeline array sitting at depth 5+ is returned whole rather than collapsed to
   `"[array truncated]"`.

The `preserve-chat-head-on-event-trim` change bounded the event **count** per
session, but count trimming does nothing for a *single* oversized event — the
buffer can hold one 500 MB event and still be under the 20 000-count cap. This
is the orthogonal per-event **byte-size** gap.

## Why now

The failure is a full-server crash triggered by an ordinary, first-class feature
(subagents / the `Agent` tool). Every subagent-heavy turn risks re-triggering
it; at the time of the crash the auto-restarted server was already back at
~2 GB heap with 8 sessions. This is a reliability P0, not a nice-to-have.

## What Changes

- **Enforce the already-intended total-serialized-size cap per event.** Wire in
  `MAX_EVENT_DATA_SIZE`: after per-field truncation, measure the serialized size
  of `event.data`; if it still exceeds the cap, replace `event.data` with a
  bounded placeholder that preserves `eventType` and a short truncation notice.
  This happens in `truncateEventData`/`createTruncator`, so it applies once at
  ingest and protects **both** the persist (`insertEvent`) and broadcast
  (`broadcastEvent` → `JSON.stringify`) paths.
- **Close the depth-4 escape.** Deep sub-trees are truncated (or collapsed to a
  placeholder) instead of returned raw, so nesting can no longer smuggle an
  unbounded payload past the truncator. The image-data preservation rule
  (`data` + sibling `mimeType`) is retained.
- **Measure safely.** Size estimation must not itself OOM — bound the work
  (e.g. an early-exit byte counter / incremental serialize with a ceiling)
  rather than `JSON.stringify` the whole giant object just to measure it.
- **Headroom (defensive, not the fix).** Document / set a higher
  `--max-old-space-size` for the server so a pathological event degrades instead
  of killing the process. The size cap is the real fix; this is belt-and-braces.
- **No protocol changes. No client changes.** Over-cap events render as a
  truncated placeholder in chat; the transcript head and normal events are
  unaffected.

- **Non-goals**:
  - Do NOT change the per-session event **count** cap or trim policy
    (`preserve-chat-head-on-event-trim` owns that).
  - Do NOT alter what the bridge forwards, or the `event_forward` protocol.
  - Do NOT truncate base64 image data (existing preservation rule stays).
  - Do NOT add streaming/chunked event delivery (larger redesign; out of scope).

## Discipline Skills

- `systematic-debugging` — reproduce the OOM with a crafted oversized/deep event
  before fixing; confirm the fix from a failing test, not by eyeballing.
- `performance-optimization` — the size-measurement and truncation run on the
  hot ingest path (every forwarded event); the guard must be bounded-cost and
  must not itself allocate an unbounded string.

## Capabilities

### Modified Capabilities

- **in-memory-event-buffer** — add a per-event total-serialized-size bound and
  close the depth-limited truncation escape.
