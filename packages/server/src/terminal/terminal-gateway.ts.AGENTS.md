# terminal-gateway.ts — index

WebSocket upgrade handler for `/ws/terminal/:id`. Exports `TerminalGateway` interface, `createTerminalGateway(manager)` — parses terminal ID, validates via manager, `handleUpgrade` attaches WS. Closes all clients on `close()`.

- Identity plane: `handleUpgrade(req, socket, head, authorize?)` — `authorize(termId)=false` destroys the socket like a missing terminal (no owned-vs-missing oracle); `?ticket` stripped from the id. See change: add-multi-user-identity-plane (18.13).

- `handleUpgrade(..., principalExpiresAt?, sessionTier?)`: optional `sessionTier: () => Tier | null` stamped on the socket (`TieredSocket`) so the auth-reload sweep closes it with 4401; absent (ticket/local) ⇒ never swept. See change: close-security-map-high-findings (D3).
