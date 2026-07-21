# Design

## Context

The browser gateway supports two fan-out modes:

- **Per-session** (`broadcastEvent` → `getSubscribers(sessionId)`): reaches only
  browsers that sent `subscribe { sessionId }`. This is how forwarded events
  reach the chat timeline today.
- **App-level** (`broadcast` / `broadcastToAll`): reaches every connected
  browser regardless of subscription. Used by `session_added` /
  `session_updated` / `session_removed` and `sessions_reordered`.

Lifecycle domain events currently travel only the per-session path, so a
many-invoice view cannot receive them on one connection. This change adds an
app-level path for them alongside the existing per-session fan-out.

## Decisions

### D1 — Single envelope, not one message type per event

One `ServerToBrowser` message type carries any lifecycle domain event, keyed by
its renamed type string, rather than 15 distinct message types.

- **Chosen**: `{ type: "ib_domain_event", sessionId, event: { eventType, data } }`
  where `eventType` is the stable renamed name (`ib_invoice_state_changed`, …)
  and `data` is the payload verbatim.
- **Rejected**: a distinct message type per domain event — 15 union members, 15
  client subscribe points, and every future engine event forces a protocol
  edit. The envelope adds new event kinds without a protocol change.

### D2 — Rebroadcast at the existing forward seam

The event-forward handler already inspects each forwarded event. Add the
app-level `broadcastToAll` there, gated to the lifecycle domain-event names, in
addition to (never replacing) the per-session `broadcastEvent`.

- Keeps one observation point; no second listener, no duplicate plumbing.
- Additive: the per-session stream is byte-for-byte unchanged.

### D3 — Inject `sessionId` server-side

The engine payload has no `sessionId`; the server knows which session forwarded
the event. The app-level frame carries that `sessionId` so a consumer can drill
into the originating session.

### D4 — Deltas only; no snapshot responsibility

The app-level channel streams live deltas. A (re)connecting client begins
receiving current events immediately; it is expected to re-sync its baseline out
of band (the data plane). This change does NOT replay historical domain events
on connect and does NOT persist a domain-event log.

- A dropped connection loses only in-flight deltas; reconnect resumes the live
  stream. No server state is corrupted by a disconnect.

### D5 — Headless-safe / defensive

- No connected browser → `broadcastToAll` is a no-op (existing gateway
  behaviour), never throws.
- A malformed or payload-less domain event must not crash the gateway: guard the
  rebroadcast so a bad frame is skipped, not fatal.

## Risks

- **Egress volume**: source-item events can be frequent. The channel is a live
  delta stream with no per-session gate, so every connected browser receives
  every frame. Mitigation: the gateway's existing back-pressure / readyState
  guards apply to `broadcast`; keep the frame small (renamed type + payload +
  sessionId). Revisit filtering only if a measured flood appears.
