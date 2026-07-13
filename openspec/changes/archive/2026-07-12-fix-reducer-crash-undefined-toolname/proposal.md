## Why

Loading a specific session (`019f4456-4d63-7a26-9b82-e237cef4672d`) black-screens the
whole dashboard — the React root unmounts, not the red "Chat view encountered an error"
card. The console shows:

```
Uncaught TypeError: Cannot read properties of undefined (reading 'toLowerCase')
  at reduceEvent (event-reducer)      ← tool_execution_start handler
  at rehydrateSession                 ← re-reduce of the IndexedDB replay cache
  at App useState initializer
```

Traced to a single unguarded cast:

- **`packages/client/src/lib/event-reducer.ts` `tool_execution_start` handler.** It reads
  `const toolName = data.toolName as string` and then, unconditionally,
  `const toolLower = toolName.toLowerCase()`. The `as string` cast is a lie — a live
  `tool_execution_start` event can arrive with `data.toolName === undefined` (pi core
  emits it that way for some tools, e.g. the `Agent` subagent / MCP tools; the bridge
  forwards it **verbatim**, `bridge.ts` applies no default). `undefined.toLowerCase()`
  throws.

- **Why it black-screens instead of showing the error card.** The crash fires inside
  `rehydrateSession` (`lib/rehydrate-session.ts`) → `reduceEvent`, invoked from a
  top-level `useState` initializer in `App.tsx` — **above** the `<ErrorBoundary>` that
  wraps `<ChatView>`. Error boundaries catch only their descendants' render errors, so
  this one escapes and unmounts the entire app. A user-facing hard crash from one
  malformed event.

- **Why only *this* session, and why a full replay is clean.** The crash path re-reduces
  the **durable IndexedDB replay cache** (`pi-dashboard-replay-cache`, change
  `reduce-session-replay-traffic`), which stored the **raw live events** as pi emitted
  them. The server/extension cold-replay path (`state-replay.ts` →
  `replayEntriesAsEvents`) reads the persisted JSONL, where the tool name lives on
  `toolCall.name` (always present) — so a full replay never reproduces it. Only the
  cached live-event shape carries the undefined `toolName`. Clearing the IndexedDB cache
  makes the session load (via full replay) — the workaround, not the fix.

- **Telling inconsistency.** `state-replay.ts` already defaults
  `toolName: msg.toolName ?? "unknown"` for `tool_execution_**end**` — but the
  `**start**` path and the reducer itself do not. The start path was simply missed.

## What Changes

Two layers — fix the specific bug, and remove the class of "one bad cached event
black-screens the whole app".

- **Reducer data-tolerance (the actual bug).** `reduceEvent` SHALL NOT throw on an
  event with an absent/non-string `toolName`. The `tool_execution_start` (and any sibling
  path reading `toolName`) SHALL coalesce to a safe default (`"unknown"`) before any
  string operation, mirroring the existing `tool_execution_end` default. The tool card
  renders with the fallback name instead of crashing.

- **Rehydrate fault-isolation (why it was catastrophic).** `rehydrateSession` re-reduces
  cached events at App level, above every error boundary, so any malformed cached event
  takes down the UI. The cache is an optimization only. The rehydrate reduce SHALL be
  fault-isolated: a throw while re-reducing a cached entry SHALL discard that session's
  cache entry and fall back to a full replay (`lastSeq: 0`) instead of propagating —
  never a black screen.

Non-goals: changing pi core's event shape; normalizing `toolName` in the bridge (the
reducer is the correct, single choke point); altering the replay-cache format or the
delta-subscribe cursor semantics beyond the fallback-on-error path.

## Capabilities

- `event-reducer` (ADDED) — reducer tolerates absent/non-string `toolName`; never throws
  on a malformed tool event.
- `session-replay-persistence` (ADDED) — rehydrate-from-cache is fault-isolated: a
  poisoned cached event falls back to full replay instead of crashing the app.

## Discipline Skills

- `systematic-debugging` — root-caused from the minified stack to the exact reducer line
  and the rehydrate (not full-replay) path before proposing a fix.
- `doubt-driven-review` — the full-replay reproduction was clean; that near-miss surfaced
  the cache/live-shape distinction that the fix depends on.
