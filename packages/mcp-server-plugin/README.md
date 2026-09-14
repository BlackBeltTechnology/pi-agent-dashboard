# Pi Dashboard MCP Server Plugin

Built-in Pi Dashboard plugin exposing a dual-era MCP endpoint at `POST /mcp`.

Implements dual-era protocol support:
- **Modern (`2026-07-28`):** stateless, handshake-free, no session ids, `server/discover`, and `subscriptions/listen` streaming over curated allowlist of `ServerPluginContext` verbs (`list_sessions`, `send_prompt`, `spawn_session`, `abort`).
- **Legacy (`2025-03-26`, `2025-06-18`, `2025-11-25`):** Streamable-HTTP handshake via `initialize`, echoes negotiated version or negotiates down to `2025-11-25` on unknown version (modern `2026-07-28` on `initialize` refused with 404 / `-32601`), returns opaque unrecorded `Mcp-Session-Id` header, accepts `notifications/*` with 202, returns `{}` on `ping`. Streaming refused (404 `MethodRemoved`).
- **Negotiation:** resolved once per request in `routes.ts` before streaming interceptor. Repeated or comma-joined header returns 400 `AmbiguousHeader`. Absent version markers default to legacy `2025-03-26`. Header and `params._meta` must agree when both present. Pi-global `mcp.json` provisioning stays pinned to `2026-07-28`.

Every request is authenticated — including loopback:
- Bridge session tokens minted via `mcp/mint-token` over session WebSocket.
- Paired-device bearer tokens passed via `Authorization: Bearer <token>`. External MCP clients (Claude Code, Cursor) mint bearer tokens via operator-gated `POST /api/paired-devices` (login session, `X-Pi-Local-Token`, or genuine local loopback + Host admission). Plaintext token returned once; stored as SHA-256 hash in `paired-devices.json` with `source: "manual"`.

> **Bundled plugin.** This package ships inside the dashboard and is discovered at
> build time by a scan of `packages/*` — *not* from `node_modules`. Installing it
> standalone from npm does not activate it in an existing dashboard install. It is
> published so plugin authors can read the source and depend on its types.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
