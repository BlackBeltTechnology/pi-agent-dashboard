## Why

Every paired/remote device (phone browser, installed PWA) is unable to open the
main dashboard WebSocket, so after a successful QR pairing the client shows
**"Offline"** and never receives session data. Root cause: the WS upgrade handler
routes on `request.url === "/ws"` (exact equality), but paired devices connect to
`/ws?ticket=<t>` (F6 — the durable bearer never rides the socket, so a single-use
ticket is appended to the URL). The query string breaks the exact match, the
request falls through every route branch to `else { socket.destroy() }`, and the
socket is killed *after* the ticket already validated. Same-machine browsers with
no bearer connect to bare `/ws` (no ticket) and work — which is why the defect
was invisible locally and shipped with the pairing feature.

## What Changes

- Fix `packages/server/src/server.ts` WS upgrade routing to match the URL **path**
  (ignoring the query string) instead of `request.url === "/ws"`. Route on the
  already-computed `scope` from `routeScopeForUrl()` (which strips the query), or
  on `request.url.split("?")[0]`. The `/ws/terminal/`, `/editor/`, `/live/`
  branches already use `startsWith` and are unaffected.
- Add a regression test asserting a **ticketed** `/ws?ticket=<valid>` upgrade
  reaches the browser gateway and returns `101 Switching Protocols` (not a
  destroyed socket). Cover both the auth-enabled and no-auth-configured upgrade
  branches.
- No client change required; `useWebSocket` already appends `?ticket=` correctly.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `bearer-device-auth`: the "WebSocket auth via single-use ticket before upgrade"
  requirement gains an explicit guarantee that, once a ticket validates, the
  server COMPLETES the upgrade by routing on the URL path (query string
  tolerated) — closing the regression where a validated ticketed upgrade was
  destroyed by an exact-match route check.

## Impact

- Code: `packages/server/src/server.ts` (the `fastify.server.on("upgrade", …)`
  handler, ~line 1801) — one routing condition. Plus a server WS-upgrade test.
- Behavior: restores remote access for all paired devices (browser + PWA) over
  LAN and tunnel; no protocol or client change.
- Severity: high — the entire QR-pairing remote-access feature is currently
  non-functional for its intended (remote) use.
- Secondary (out of scope, no action needed): the server.log shows brief zrok
  reserved-share churn, but the status codes are upstream 5xx from the hosted
  service (`clientVersionCheck` 502/503/504, `[POST /share][500]`) — a transient
  zrok.io outage/overload, NOT a client-version problem. Installed zrok is
  v1.1.11 (current); the share retried and self-healed (0 failures in the recent
  log tail, tunnel currently healthy). No reinstall/upgrade required.

## Discipline Skills

- `systematic-debugging` — used to isolate the root cause from runtime evidence
  (ticketless-vs-ticketed upgrade probes against the live tunnel).
- `security-hardening` — the touched code is the WebSocket authentication/upgrade
  gate; the fix must preserve every existing refusal path (no-ticket, reused
  ticket, wrong-scope ticket, tunnel-as-loopback) while admitting valid tickets.
