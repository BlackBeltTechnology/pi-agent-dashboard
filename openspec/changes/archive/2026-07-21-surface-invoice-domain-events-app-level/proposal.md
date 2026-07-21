## Why

InvoiceBot lifecycle domain events (`ib_*`) reach the browser only on the
per-session stream: a client must already be subscribed to a specific session
to receive them. A view that tracks many invoices at once cannot open one
subscription per session — it does not scale, and it cannot learn about sessions
it has not yet discovered. What is missing is an app-level broadcast: one
channel, on the browser WebSocket, that streams every lifecycle domain-event
frame to any connected client on a single connection, without a per-session
subscribe.

The server already receives these events per-session (they arrive as forwarded
events and fan out to that session's subscribers). Session lifecycle
(`session_added` / `session_updated` / `session_removed`) already demonstrates
the app-level, no-subscribe push via the gateway's broadcast-to-all seam. This
change mirrors that precedent for InvoiceBot domain events.

## What Changes

- **Add an app-level domain-event channel**: a new `ServerToBrowser` message
  type that carries a forwarded lifecycle `ib_*` domain event to every connected
  browser, independent of per-session subscription.
- **Rebroadcast at the forwarding seam**: when a lifecycle domain event is
  forwarded, the server SHALL also broadcast it app-level via the
  broadcast-to-all path, in addition to the existing per-session fan-out.
- **Carry the originating `sessionId`** on the app-level frame so a consumer can
  drill into the session that produced it.
- **Preserve per-session streaming** — additive; the existing per-session event
  path is unchanged.

## Capabilities

### New Capabilities

- `invoicebot-app-level-events`: the server SHALL rebroadcast forwarded
  InvoiceBot lifecycle domain events to every connected browser on an app-level
  channel, carrying the originating `sessionId` and the event payload, without
  requiring a per-session subscription.

### Modified Capabilities

_(none)_

## Impact

- **Server code**: `packages/server/src/event-wiring.ts` (detect a lifecycle
  domain event in the forward handler and `broadcastToAll` the app-level frame);
  `packages/shared/src/browser-protocol.ts` (new `ServerToBrowser` message type
  + payload type in the union).
- **Tests**: server-side test asserting an emitted lifecycle domain event
  reaches a connected browser on the app-level channel without a per-session
  subscribe, carries the `sessionId`, and does not disturb the per-session
  stream.
- **Docs**: `AGENTS.md` rows for the touched server files + the protocol type.
- **Ordering**: the app-level frame keys off the stable renamed domain-event
  names produced upstream at the bridge; land the bridge rename first so the
  names this channel matches exist.

## Discipline Skills

- `doubt-driven-review` — the no-subscribe fan-out is a new always-on egress
  path; review the gating (only lifecycle domain events, headless-safe, malformed
  event never crashes the gateway) before it stands.
- `observability-instrumentation` — an app-level broadcast path benefits from a
  clear, bounded log/metric so a misfire or flood is visible in prod.
