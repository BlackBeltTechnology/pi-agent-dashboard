# Fix "No messages yet" flash on large cold-loaded sessions

## Why

Selecting a session card that clearly has context (e.g. 159k tokens, 1h+ runtime)
renders the "No messages yet" placeholder while history is still loading —
sometimes after ~15s, sometimes flashing before partial history paints. The
session is not empty; the empty state is false.

Root cause is a race in the client's history-loading state machine
(`packages/client/src/App.tsx`, `packages/client/src/hooks/useMessageHandler.ts`):

- On `subscribe`, the client sets a per-session `loadingHistory` flag and arms a
  hardcoded **15000 ms** safety-net timer that unconditionally calls
  `clearLoadingHistory` (`App.tsx:651`).
- For a session not in server memory (ended / evicted), the server takes the
  cold path in `subscription-handler.ts`: it emits a priming
  `event_replay { events: [], isLast: false }` marker, then calls
  `directoryService.loadSessionEvents(...)` which parses the **entire** on-disk
  JSONL before any content batch is sent.
- For a large session that parse can exceed 15s (worse under Docker / slow disk
  / event-loop contention). When it does, the 15s timer fires mid-parse, clears
  `loadingHistory`, and `ChatView` falls through to "No messages yet" even though
  hydration is still in flight.

The two observed symptoms map cleanly:

| Observation | Cause |
|---|---|
| "after ~15s, No messages yet" | disk parse > 15s → timer fires before any content batch |
| "sometimes only just part of it" | parse finishes just in time; first batch clears the flag and paints, remaining 50-event batches still streaming |

The state machine already has the signal it needs: the server's priming
`event_replay { events: [], isLast: false }` uniquely marks "cold hydration
started" (a genuinely empty session gets `isLast: true`). The blunt timer just
ignores it.

## What Changes

Two layers, composed via one shared signal.

**C — client re-arm (removes the flash for normal cold loads).** When the client
receives the cold-hydration start marker — an `event_replay` with zero events and
`isLast === false` for a session whose `loadingHistory` flag is set — it cancels
the short 15s subscribe timer and arms a longer "server is hydrating" ceiling.
The short timer keeps its original job (detect a dead link / server that never
acknowledged `subscribe`).

**B — server hydration heartbeat (removes the residual very-large-session race).**
While `directoryService.loadSessionEvents(...)` runs, the server periodically
re-emits the same `event_replay { events: [], isLast: false }` marker to the
subscriber(s) as a keepalive. Each keepalive hits C's re-arm guard on the client,
resetting the hydration ceiling — so an arbitrarily long parse never trips it,
and a mid-parse stall (heartbeats stop) trips the ceiling within one window. The
heartbeat stops as soon as the first content batch is sent, the load fails, or
the subscriber leaves.

Combined lifecycle:

- Short subscribe timer (`SUBSCRIBE_ACK_MS`, 15s): unchanged trigger, now means
  "no acknowledgement at all."
- Cold-hydration start marker (and each heartbeat) → cancel/re-arm
  `HYDRATE_CEILING_MS` (proposed 90s).
- First content batch (`events.length > 0`) → clear + stop heartbeat (existing
  client behavior; new server stop).
- Terminal empty `{ events: [], isLast: true }` → clear + "No messages yet"
  (existing behavior; genuinely empty session).
- `session_updated { dataUnavailable: true }` → clear (existing behavior).

No new message type and no wire-schema change: the heartbeat reuses the existing
`event_replay { events: [], isLast: false }` shape that old clients already
ignore and new clients re-arm on. Backward compatible in both directions (old
server → C's single-arm ceiling still applies; old client → ignores extra empty
markers).

## Impact

- Affected spec: `chat-history-loading-indicator` (MODIFIED — timer lifecycle +
  server heartbeat during cold hydration).
- Affected client code: `packages/client/src/App.tsx` (timer arming),
  `packages/client/src/hooks/useMessageHandler.ts` (`event_replay` handler),
  `packages/client/src/lib/loading-history.ts` (helper for the re-arm).
- Affected server code:
  `packages/server/src/browser-handlers/subscription-handler.ts` (heartbeat
  interval around `loadSessionEvents`, stopped on first batch / failure / leave).
- No new protocol message type, no wire-schema change, no persistence change.
- Risk: low; behavior-preserving for warm/in-memory and genuinely-empty paths;
  heartbeat is an idempotent re-send of an already-ignored empty marker.

## Discipline Skills

- `systematic-debugging` — the fix is rooted in a reproduced timing race;
  confirm the cold-path timeline before and after with evidence.
- `node-inspect-debugger` — runtime state lives in WS-closure timers
  (`loadingHistoryTimersRef`) that `console.log` cannot easily observe.
