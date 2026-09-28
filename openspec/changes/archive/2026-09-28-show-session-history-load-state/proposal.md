## Why

The chat view claims "No messages yet" in three situations where it does not
know that: while the IndexedDB replay cache is read before `subscribe` is sent,
while the WebSocket is disconnected, and after the loading safety-net times out.
The session card never shows whether its history is loading at all, so a user
clicking a large ended session sees no feedback in the sidebar. Both violate
visibility of system status (Nielsen H1) and make a slow load look like data
loss.

## What Changes

- Chat view: arm the loading state at session **selection**, before the async
  replay-cache read, so the skeleton (shown immediately, as today) covers the
  pre-subscribe gap.
- Chat view: new **"Waiting for connection"** state when the session has no
  messages and the dashboard is disconnected — static, no spinner.
- Chat view: new **slow-load notice** after 10 s of loading with no content —
  "Still loading history · Ns" + Retry, above the skeleton.
- Chat view: new **"Couldn't load history"** state + Retry when the load safety
  net times out or the server reports data unavailable. **Replaces** today's
  fall-through to "No messages yet" on timeout (behaviour change to the
  `chat-history-loading-indicator` capability).
- Retry performs a full re-request: drop the persisted replay cache, reset
  in-memory state and cursor, re-subscribe from `lastSeq: 0` (the existing
  chat-refresh path).
- Session card: **ring indicator** around the 16 px status chip (design A in
  `mockups/index.html`): spinning accent arc while loading/streaming, dashed
  static ring while waiting for connection, solid error ring on failure. The
  chip tooltip gains the state text + screen-reader text names it. Cards never
  opened show nothing. Desktop and mobile card layouts both get the ring.

## Capabilities

### New Capabilities
- `session-card-history-indicator`: the session card's ring indicator for its
  history load phase (loading / waiting / failed), its delay, tooltip, a11y and
  reduced-motion behaviour.

### Modified Capabilities
- `chat-history-loading-indicator`: loading state entry moves to selection time
  (covers the cache read); a safety-net timeout now surfaces a failed state
  instead of the empty placeholder; adds the waiting-for-connection, slow-load
  and retry requirements.

## Impact

- Client only: `packages/client/src/App.tsx` (flag arming, new per-session
  failed + started-at maps, threading to `SessionList`), `hooks/useMessageHandler.ts`
  (`dataUnavailable` / ceiling timeout → failed; batches clear failed), `lib/replay/loading-history.ts` (timeout
  callback), new `lib/replay/history-load-phase.ts` (pure phase derivation),
  `components/chat/ChatView.tsx`, `components/session/SessionList.tsx`,
  `components/session/SessionCard.tsx`, `useNow` moved to `lib/time/use-now.ts`
  (re-exported), server-switch cleanup in `clearInMemoryState`, i18n strings.
- No server, protocol, wire-schema, persistence or migration change. Rollback
  = revert the client commit; an old client against this server is unaffected.
- Mockup + UX rationale: `mockups/index.html`.

## Discipline Skills

- **`review-code`** — non-trivial client change across ≥3 components before commit.
- None of security-hardening, performance-optimization, observability-instrumentation
  or doubt-driven-review apply: no untrusted input, no new endpoint, no
  irreversible step; the per-card render cost is covered by a design decision
  (D6) rather than a perf budget.
