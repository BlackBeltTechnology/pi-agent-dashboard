## Context

Crash reproduced from session `019f4456-4d63-7a26-9b82-e237cef4672d` (idle, ~1.7 MB,
303 messages, incl. two 225 KB inline `browser` screenshots). The size was a red
herring — the transcript is virtualized (`@tanstack/react-virtual`), and text renderers
truncate. The killer is a single event, not volume.

### Failure path (verified)

```
cold page-load of the session
   │
   ▼
App.tsx  (top-level useState initializer)
   │  rehydrateSession(sid, replayCache)
   ▼
lib/rehydrate-session.ts
   │  for (const { event } of entry.payload) state = reduceEvent(state, event)
   ▼
lib/event-reducer.ts  — tool_execution_start handler
   │  const toolName = data.toolName as string        // undefined at runtime
   │  const toolLower = toolName.toLowerCase()         // ← throws TypeError
   ▼
error propagates ABOVE the <ChatView> ErrorBoundary  →  root unmount  →  black screen
```

### Evidence

- Minified stack: `qr` (= `reduceEvent`, identified by the `isLive` option + the
  `toolName:d … status:"running" … const u=d.toLowerCase()` start handler) called from a
  `useState` initializer — i.e. `rehydrateSession`, not the async full-replay path.
- `replayEntriesAsEvents` run over the session JSONL emits 153 `tool_execution_start`
  events, **0 with undefined `toolName`** → the JSONL/full-replay path is clean.
- All 153 JSONL `toolCall` blocks carry `part.name` → the undefined originates from the
  **live** event shape stored in IndexedDB, not from persisted history.
- `bridge.ts` forwards `tool_execution_start` verbatim (no `toolName` default).
- `state-replay.ts` already defaults `toolName ?? "unknown"` for `tool_execution_end`
  (line ~140) but not for `_start` (line ~85) — asymmetry confirms the miss.

## Decisions

### 1. Fix at the reducer, not the bridge or pi core

The reducer is the single choke point every event path funnels through
(full replay, delta replay, rehydrate, live). Defaulting `toolName` there fixes all
paths at once and matches the existing `tool_execution_end` treatment. Normalizing in
the bridge would fix only future live events, not the already-poisoned caches; changing
pi core is out of scope and wouldn't heal existing data.

- `const toolLower = (toolName ?? "").toLowerCase();`
- store `toolName: toolName ?? "unknown"` in the `toolCalls` map and `currentTool`, so
  the card renders a stable fallback label rather than `undefined`.
- Audit sibling `toolName`-reading paths in the reducer for the same unguarded pattern
  (`event-status-extraction`, update/end handlers) and apply the same coalesce.

### 2. Fault-isolate the rehydrate reduce

Even with (1), the architectural hazard remains: `rehydrateSession` runs above all error
boundaries, so **any** future malformed cached event would black-screen the app. The
replay cache is explicitly "an optimization only — any miss/reset falls back to full
replay". Make that contract hold under a *throw*, not just a miss:

- wrap the per-entry re-reduce in try/catch;
- on throw: drop the offending session's cache entry (so it can't re-poison), log once,
  and return `null` so the caller cold-subscribes with `lastSeq: 0` (full replay).

This converts a total UI crash into a silent, self-healing cache miss.

### 3. Regression coverage

- **Unit (reducer):** `reduceEvent(createInitialState(), { eventType: "tool_execution_start",
  data: { toolCallId, toolName: undefined } })` does not throw and yields a `running`
  tool card with a `"unknown"` (or empty) name. Repeat for a non-string `toolName`.
- **Unit (rehydrate):** `rehydrateSession` over a cache payload containing one
  undefined-`toolName` event returns `null` (fallback) — or a valid state if (1) alone
  suffices — and never throws.

## Risks / Trade-offs

- A tool card showing `"unknown"` for a genuinely nameless event is a cosmetic
  degradation — strictly better than a black screen, and such events are already
  malformed upstream.
- Discarding a cache entry on any reduce throw could mask a real reducer bug behind a
  full replay. Mitigated by the one-shot log on the fallback path so the underlying
  malformed event stays observable.

## Deferred

- Broader "reduce under an error boundary" hardening for the App-level state machine —
  out of scope; the targeted try/catch in rehydrate covers the known crash surface.
