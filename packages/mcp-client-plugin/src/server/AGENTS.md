# DOX — packages/mcp-client-plugin/src/server

Server half of the `mcp-client` plugin: the REST surface over the core service and the plugin
registration. See change: extract-mcp-client-plugin.

| File | Purpose |
|------|---------|
| `index.ts` | `registerPlugin(ctx)` — registers the `mcp-client.config` service, mounts the routes behind the host `networkGuard`, and provisions nothing (the mcp-server-plugin owns provisioning). |
| `routes.ts` | `mountMcpClientRoutes` + `McpClientRouteDeps`. Routes: `GET /api/mcp-client/effective?cwd=` (view + adapter verdict; 403 `not-allowed` on an unadmitted cwd, 504 `adapter-timeout`), `GET /schema`, `GET /adapter[?fresh=1]`, `PUT /servers/:name` (`{scope,cwd?,set,unset?}`), `DELETE /servers/:name`, `PUT /servers/:name/disabled`, `PUT /settings`. EVERY route — GET included — sits behind `networkGuard`: mutating bodies become executable config for pi and the effective view returns own-layer credentials. Schema validation runs before any IO; refusals map to 400/403/409/500 via `sendRefusal`. |
