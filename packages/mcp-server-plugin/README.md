# Pi Dashboard MCP Server Plugin

Built-in Pi Dashboard plugin exposing a stateless MCP endpoint at `POST /mcp`.

Implements protocol revision `2026-07-28`: no `initialize` handshake, no session
ids, `server/discover`, and `subscriptions/listen` streaming over a curated
allowlist of `ServerPluginContext` verbs. Every request is authenticated —
including loopback.

> **Bundled plugin.** This package ships inside the dashboard and is discovered at
> build time by a scan of `packages/*` — *not* from `node_modules`. Installing it
> standalone from npm does not activate it in an existing dashboard install. It is
> published so plugin authors can read the source and depend on its types.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
