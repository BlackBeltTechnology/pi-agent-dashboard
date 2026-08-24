# ws-ticket.ts — index

Single-use WS upgrade tickets (D11/F4/F6). `WsTicketStore(now?)`: `mint(scope)` high-entropy in-memory ticket (~15s TTL) bound to a `WsRouteScope` (browser/terminal/editor/live); `consume(ticket, scope)` deletes on FIRST attempt (single-use), rejects expired/scope-mismatch. Exports `routeScopeForUrl`, `extractTicket` (URL `?ticket=` or `pi-ticket.<t>` subprotocol). Client mints one per (re)connect; durable bearer never rides WS. See change: add-server-keypair-pairing.

Scopes: `browser | terminal | live | bridge`. `bridge` is the pi-gateway upgrade path (`/ws/bridge`), so a remote bridge authenticates like any other remote client and its ticket can never be replayed against `terminal`/`browser`. `consumeDetailed(ticket, scope)` names the refusal cause (`missing|unknown|expired|wrong-scope`) for server-side logs only — `consume` delegates to it. See change: add-pi-gateway-transport-identity (tasks 6.1/6.3).
