# @blackbelt-technology/pi-dashboard-mcp-core

Host-free library over pi's built-in MCP configuration (pi ≥ 1.0.0). **Not a dashboard plugin** (no `pi-dashboard-plugin` manifest), so the dashboard server and any plugin may import it.

| Export | Purpose |
|---|---|
| `.` | Barrel: `createMcpClientConfigService`, `createRealConfigIO`, `MCP_CLIENT_CONFIG_SERVICE_KEY` (`"mcp-client.config"`), readers/writers, types |
| `./pi-rules.js`, `./types.js`, … | Per-file subpaths (browser-safe ones are imported by the mcp-client plugin client) |
| `./schema/mcp-config.schema.json` | Published server-entry schema |

Consumers: dashboard server (Radius MCP), `mcp-client-plugin` (provides the running service), `mcp-server-plugin` (legacy migration), `apple-tools` (installer CLI + `ctx.consume(MCP_CLIENT_CONFIG_SERVICE_KEY)`).

Extracted from `mcp-client-plugin/src/core`; that plugin keeps a deprecated `./core` re-export for one minor release.
