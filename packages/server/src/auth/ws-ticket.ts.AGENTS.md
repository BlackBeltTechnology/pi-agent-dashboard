# ws-ticket.ts — index

Single-use WS upgrade tickets (D11/F4/F6). `WsTicketStore(now?)`: `mint(scope)` high-entropy in-memory ticket (~15s TTL) bound to a `WsRouteScope` (browser/terminal/editor/live); `consume(ticket, scope)` deletes on FIRST attempt (single-use), rejects expired/scope-mismatch. Exports `routeScopeForUrl`, `extractTicket` (URL `?ticket=` or `pi-ticket.<t>` subprotocol). Client mints one per (re)connect; durable bearer never rides WS. See change: add-server-keypair-pairing.
