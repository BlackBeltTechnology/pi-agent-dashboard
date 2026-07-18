# terminal-gateway.ts — index

WebSocket upgrade handler for `/ws/terminal/:id`. Exports `TerminalGateway` interface, `createTerminalGateway(manager)` — parses terminal ID, validates via manager, `handleUpgrade` attaches WS. Closes all clients on `close()`.
