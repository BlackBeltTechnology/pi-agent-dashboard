## Why

Opening a session that the client has seen before re-ships the entire chat
history. The transport is event-sourced: `pi → bridge → server in-memory buffer
(seq-numbered) → WS broadcast`. The subscribe protocol is *already* incremental
— `subscribe { sessionId, lastSeq }` makes the server replay only events with
`seq > lastSeq` (`subscription-handler.ts`), and the client tracks the cursor in
`maxSeqMapRef` (`App.tsx`). Two gaps remain:

1. **Full replay on every page reload.** `maxSeqMapRef` and `sessionStates` are
   in-memory only. A reload wipes them, so the client resubscribes with
   `lastSeq: 0` and the server re-sends the whole buffered history (up to
   `MAX_EVENTS_PER_SESSION = 5000`). WS reconnect already delta-replays (it
   reads the live in-memory cursor at `App.tsx:757`); reload does not. This is
   the dominant repeated-traffic cost.

2. **Large tool outputs are both shipped eagerly and silently truncated.** The
   in-memory store truncates every string field to 4 KB and arrays > 20 to
   `[array truncated]` (`memory-event-store.ts`). So replay pays bytes for tool
   results the user never expands, *and* the user can never see a tool result
   larger than 4 KB even when they do expand. Collapse today is pure client
   render state (`useState(false)`) — the (truncated) body is already in client
   memory, so collapsing saves zero bytes.

Both gaps reduce to "send less of what the client either already has or will
never look at," reusing machinery that already exists (`lastSeq` delta replay,
`GET /api/events/:sessionId/:seq`, the `AgentToolRenderer` lazy-expand pattern).

## What Changes

Two orthogonal, composable strategies.

**Strategy A — Persist the replay cursor across reload (primary; bandwidth).**
- Persist `{ schemaVersion, maxSeq, reducedMessages }` per session to IndexedDB
  (localStorage is too small for chat history).
- On page load, rehydrate `sessionStates` + `maxSeqMapRef` from IndexedDB, then
  `subscribe { lastSeq: persistedMaxSeq }` → server delta-replays only the tail.
- Honor the existing `session_state_reset` signal (server restart resets seq→1):
  on receipt, purge that session's persisted entry and fall back to full replay.
- Client-side LRU + `schemaVersion` mismatch → drop entry, full replay. The
  cache is an optimization, never a source of truth; any miss is safe.

**Strategy B — Lazy-expand full-fidelity tool output (feature; fidelity + bytes).**
- Replay ships a *stub* for collapsible heavy tool results:
  `{ seq, entryId, toolName, byteSize, preview }` (preview = first N chars).
- Collapsed card renders header + preview only. On expand, fetch the
  **untruncated** body from a JSONL-backed route and render it.
- Scoped to *finalized* events only; in-flight / streaming results stay inline.
- This is framed as a **full-fidelity feature** (you currently cannot see a tool
  result > 4 KB at all) that also trims replay — NOT as a pure bandwidth play.
  A pure-bandwidth variant (re-fetching the same 4 KB) is explicitly out of
  scope: it would add a round-trip + offline-expand regression for a win
  Strategy A already dominates.

## Capabilities

### New Capabilities
- `session-replay-persistence` — durable per-session replay cursor + reduced
  state in IndexedDB; reload triggers delta replay, not full replay; honors
  `session_state_reset` and schema/version invalidation.
- `lazy-expand-full-fidelity` — collapsed heavy tool results render a stub +
  preview from replay and fetch the full untruncated body on expand.

### Modified Capabilities
- None of the wire-level subscribe contract changes for Strategy A (reuses
  `lastSeq` + `session_state_reset` as-is). Strategy B adds an additive stub
  shape to replayed `tool_execution_end` events and a new full-fidelity fetch
  route; older clients ignore the stub fields and render the inline preview.

## Impact

Affected code:
- `packages/client/src/App.tsx` — rehydrate `sessionStates` + `maxSeqMapRef`
  from IndexedDB on mount; persist on event-reducer commit (debounced).
- `packages/client/src/lib/<new>replay-cache.ts` — IndexedDB read/write/evict,
  schemaVersion gate, LRU by last-access.
- `packages/client/src/hooks/useMessageHandler.ts` — `session_state_reset` →
  purge persisted entry; `event_replay` first-batch reconciliation with
  rehydrated state.
- `packages/server/src/browser-handlers/subscription-handler.ts` — Strategy B:
  emit tool-result stubs during replay (additive).
- `packages/server/src/routes/session-routes.ts` — Strategy B: new JSONL-backed
  full-fidelity event-body route (existing `GET /api/events/:sessionId/:seq` is
  memory-store-backed = truncated, cannot serve this).
- `packages/server/src/memory-event-store.ts` — record `byteSize` pre-truncation
  so stubs can advertise true size (no behavior change to truncation itself).
- `packages/client/src/components/tool-renderers/*` — stub render + lazy fetch
  on expand (mirror `AgentToolRenderer` precedent).
- Tests: replay-cache unit tests (hit / miss / reset / schema drift / LRU),
  subscription-handler stub-emission test, full-fidelity route test, tool
  renderer lazy-fetch test.

## Open Questions
- Strategy A: persist the **reduced `ChatMessage[]`** state, or persist **raw
  events** and re-reduce on load? Reduced is smaller and faster to paint but
  couples the cache to reducer-output schema (more frequent `schemaVersion`
  bumps). Decide in design.md.
- Strategy A: do we also persist the `pi-asset:<hash>` registry? If not, images
  render as placeholders after reload until the next subscribe re-replays the
  registry (it is re-sent on every subscribe). Scope in design.md.
- Strategy B: stub threshold — only stub tool results above what byte size?
  Stub-everything adds round-trips for tiny outputs; stub-only-large keeps small
  results inline. Pick a threshold (e.g. ≥ 4 KB, aligned to the truncation cap).
- Strategy B: seq instability — a stub's `seq` is server-runtime-local. After a
  server restart an expand-fetch by `seq` misses. Use `entryId` (stable, from
  JSONL) as the full-fidelity fetch key instead of `seq`? Confirm `entryId` is
  present on `tool_execution_end` (today it is attached to `message_*`, not tool
  events — may need bridge/replay plumbing). Resolve in design.md.
- Should the two strategies ship as one change or sequence A → B? A is
  self-contained and high-value; B depends on the `entryId` question above.
