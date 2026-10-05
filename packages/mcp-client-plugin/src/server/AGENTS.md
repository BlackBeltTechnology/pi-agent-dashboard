# DOX — packages/mcp-client-plugin/src/server

Server half of the `mcp-client` plugin: the REST surface over the core service and the plugin
registration. See change: extract-mcp-client-plugin, migrate-mcp-to-pi-builtin.

| File | Purpose |
|------|---------|
| `index.ts` | `registerPlugin(ctx)` — registers the `mcp-client.config` service, mounts the routes behind the host `networkGuard`, provisions nothing. Consumes `host.knownFolderCwds` + `host.isProjectTrusted`; absent `isProjectTrusted` warns once → every project untrusted. See change: migrate-mcp-to-pi-builtin. |
| `pi-runner.ts` | NEW. `createPiMcpListRunner()` — `ToolResolver.resolvePi()` + shared `spawn` (no shell) + `buildSpawnEnvForArgv` (`ELECTRON_RUN_AS_NODE`) + SIGKILL on abort + 4 MiB stdout cap. Feeds `getLiveState`. See change: migrate-mcp-to-pi-builtin. Spawn `detached` (own group); abort → shared `killPidWithGroup(pid,"SIGKILL")` + `killProcess` (win32 `taskkill /T`) — no platform branch / raw `process.kill` (repo lint guards). Test `__tests__/pi-runner.test.ts` (real child). See change: migrate-mcp-to-pi-builtin. |
| `routes.ts` | `mountMcpClientRoutes` + `McpClientRouteDeps`. Routes: `GET /api/mcp-client/effective?cwd=`, `GET /api/mcp-client/live?cwd=&fresh=1`, `GET /schema`, `PUT /servers/:name` `{scope,cwd?,entry,previousName?}`, `DELETE /servers/:name?scope=&cwd=` → `{ok,removed}`, `PUT /servers/:name/enabled` `{scope,cwd?,enabled}`, `POST /servers/:name/convert` `{scope,cwd?}`. Removed `/adapter`, `/settings`, `/disabled`. EVERY route — GET included — sits behind `networkGuard`: mutating bodies become executable config for pi and the effective view returns own-layer credentials. Path name decoded + validated and project cwd admitted (403 `not-allowed` + `reason`/`hint`) BEFORE any IO. Refusals map via `sendRefusal`. See change: migrate-mcp-to-pi-builtin. `PUT /servers/:name` accepts `create: true` (409 `name-collision` when the name exists). See change: migrate-mcp-to-pi-builtin. |
