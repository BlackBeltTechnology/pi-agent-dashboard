# DOX — packages/server/src/routes

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `attachment-routes.ts` | `GET /api/sessions/:sessionId/attachments/:attachmentId` — full-resolution original for click-to-zoom. → see `attachment-routes.ts.AGENTS.md` |
| `doctor-routes.ts` | Fastify plugin. `GET /api/doctor` returns `{checks, summary, generatedAt}`. → see `doctor-routes.ts.AGENTS.md` |
| `live-server-routes.ts` | Live-server-preview REST. `registerLiveServerRoutes`. `POST /api/live-server/start {host,port,label}` (SSRF… → see `live-server-routes.ts.AGENTS.md` |
| `file-routes.ts` | REST routes for file read/browse. `/api/file` decodes leading `file://` on `path` via `decodeFileUri`. → see `file-routes.ts.AGENTS.md` |
| `git-routes.ts` | REST routes: git branches, checkout, init, stash-pop. Adds `GET /api/git/head`, `GET /api/git/worktrees`,… → see `git-routes.ts.AGENTS.md` |
| `goal-routes.ts` | REST routes for folder GoalRecords. `parseJudge(raw)` validates `judge` on POST/PATCH (clamp-or-reject,… → see `goal-routes.ts.AGENTS.md` |
| `grep-routes.ts` | `GET /api/grep?cwd&q&regex`. Gates: known-session cwd, min-3 q, per-match cwd containment. See change: split-editor-workspace. |
| `known-servers-routes.ts` | Known-servers config + mDNS discovery routes. Exports `registerKnownServersRoutes`. → see `known-servers-routes.ts.AGENTS.md` |
| `manifest-route.ts` | Dynamic `/manifest.json` route. Exports `stripPort`, `resolveManifestSource`, `buildManifestBody`,… → see `manifest-route.ts.AGENTS.md` |
| `model-proxy-api-key-routes.ts` | Proxy API key CRUD (JWT-gated management surface). Exports `registerModelProxyApiKeyRoutes`,… → see `model-proxy-api-key-routes.ts.AGENTS.md` |
| `model-proxy-diagnostics-routes.ts` | `GET /api/model-proxy/diagnostics`. JWT-gated, main instance only (NOT second `/v1` proxy port). → see `model-proxy-diagnostics-routes.ts.AGENTS.md` |
| `model-proxy-refresh-routes.ts` | Force-refresh model proxy registry. Exports `registerModelProxyRefreshRoutes`. `POST /api/model-proxy/refresh` → `refreshModelRegistry`; 503 `MODEL_PROXY_RUNTIME_MISSING` on failure. |
| `model-proxy-routes.ts` | OpenAI- + Anthropic-compatible proxy endpoints fronting model registry via pi-ai `streamSimple`. → see `model-proxy-routes.ts.AGENTS.md` |
| `models-introspection-routes.ts` | Ungated `GET /api/models` model-introspection surface for in-session agents. → see `models-introspection-routes.ts.AGENTS.md` |
| `network-interfaces.ts` | `buildNetworkInterfaceList(enumerate)` builds the `/api/network-interfaces` payload — one entry per ADDRESS… → see `network-interfaces.ts.AGENTS.md` |
| `openspec-group-routes.ts` | REST routes for `/api/openspec/groups` CRUD + assignment. → see `openspec-group-routes.ts.AGENTS.md` |
| `openspec-routes.ts` | REST routes: openspec-archive, pi-resources (cwd optional → falls back to `process.cwd()` for the global… → see `openspec-routes.ts.AGENTS.md` |
| `package-routes.ts` | Extension/package management routes. Exports `registerPackageRoutes`. → see `package-routes.ts.AGENTS.md` |
| `pairing-routes.ts` | Server-identity challenge + device-pairing routes. Exports `registerPairingRoutes`,… → see `pairing-routes.ts.AGENTS.md` |
| `pi-changelog-routes.ts` | `GET /api/pi-core/changelog?pkg&from&to`. Whitelist-validates `pkg` against `CORE_PACKAGE_NAMES`. → see `pi-changelog-routes.ts.AGENTS.md` |
| `pi-core-routes.ts` | Pi CLI core package version check + update. Exports `registerPiCoreRoutes`, `PiCoreRouteDeps`. → see `pi-core-routes.ts.AGENTS.md` |
| `pi-retry-routes.ts` | pi retry-policy editor. Exports `registerPiRetryRoutes(fastify,{networkGuard,reloadConnectedSessions})`. → see `pi-retry-routes.ts.AGENTS.md` |
| `pi-runtime-routes.ts` | Fastify plugin: `GET /api/pi/installs` (every discoverable pi install + per-consumer `usedBy`, sync/divergence, floor) and `POST /api/pi/runtime` (BOTH consumer selections in ONE `OverridesStore.setMany` transaction; `null` = Automatic, clearing that consumer's pin in the same write). Both carry the same `networkGuard` as `/api/tools`. Validates each path via `validatePiOverridePath` and 400s naming the failed check. Rescans `pi` + `pi-coding-agent` after a successful persist — `setOverrides` bypasses `setOverride`, so without this the registry would keep serving the OLD argv while the UI showed the new selection. Logs an audit line on every applied selection. Two sequential PUTs were rejected: a crash between them splits the runtime in half. See change: select-pi-runtime-install (design D7). |
| `plugin-activation-routes.ts` | REST routes: `GET /api/plugins` (returns `PluginStatus[]` with `displayName`, `requirements`,… → see `plugin-activation-routes.ts.AGENTS.md` |
| `plugin-config-routes.ts` | Plugin partial config write. Exports `registerPluginConfigRoutes`. → see `plugin-config-routes.ts.AGENTS.md` |
| `preferences-display-routes.ts` | REST routes `GET /api/preferences/display` (returns `{ global: DisplayPrefs|undefined, sessionOverrides:… → see `preferences-display-routes.ts.AGENTS.md` |
| `preferences-auto-name-routes.ts` | REST routes `GET /api/preferences/auto-name` (returns `{autoNameSessions:boolean}`, default true) + `PATCH… → see `preferences-auto-name-routes.ts.AGENTS.md` |
| `preferences-worktree-init-routes.ts` | REST routes `GET /api/preferences/worktree-auto-init` (returns `{autoInitWorktreeOnSpawn:boolean}`) + `PATCH… → see `preferences-worktree-init-routes.ts.AGENTS.md` |
| `provider-auth-routes.ts` | Browser-based pi provider OAuth + API-key auth. Exports `registerProviderAuthRoutes`. → see `provider-auth-routes.ts.AGENTS.md` |
| `provider-health-cache.ts` | In-memory per-provider health cache `{ok,status,error,modelCount,testedAt}` (credential-free). → see `provider-health-cache.ts.AGENTS.md` |
| `provider-routes.ts` | Custom LLM provider read/write to `~/.pi/agent/providers.json`. Exports `registerProviderRoutes`. → see `provider-routes.ts.AGENTS.md` |
| `resource-activation-routes.ts` | pi-resource ACTIVATION routes (enable/disable), distinct from install/uninstall. → see `resource-activation-routes.ts.AGENTS.md` |
| `recommended-routes.ts` | Curated recommended-extensions list enriched with npm/GitHub meta, install scope, activeInPi,… → see `recommended-routes.ts.AGENTS.md` |
| `route-deps.ts` | Shared route dependency types. Exports `NetworkGuard` type, `RouteDeps` interface wiring `SessionManager`,… → see `route-deps.ts.AGENTS.md` |
| `session-routes.ts` | Session REST routes. Exports `registerSessionRoutes`. Endpoints: `GET /api/sessions`, `GET… → see `session-routes.ts.AGENTS.md` |
| `system-routes.ts` | REST routes: config, health, shutdown, tunnel. External-editor endpoints `/api/editors`,… → see `system-routes.ts.AGENTS.md` |
| `tool-routes.ts` | REST routes: `GET /api/tools`, `GET /api/tools/:name`, `POST /api/tools/rescan`, `PUT/DELETE… → see `tool-routes.ts.AGENTS.md` |
