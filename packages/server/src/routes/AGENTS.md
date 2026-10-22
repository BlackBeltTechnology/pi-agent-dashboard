# DOX — packages/server/src/routes

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `access-prompt-routes.ts` | Access-prompt review API (add-access-grant-dialog 8.1-8.3, 8b.7a/b, 8b.8, 2b.9). → see `access-prompt-routes.ts.AGENTS.md` |
| `access-routes.ts` | The grant endpoint + Access review API (design D12/D15/D20). → see `access-routes.ts.AGENTS.md` |
| `acme-routes.ts` | ACME cert-source routes: `PUT`/`DELETE /api/tls/acme/:sourceId` (replace ONE entry of `tls.sources` on the… → see `acme-routes.ts.AGENTS.md` |
| `addons-routes.ts` | Add-ons hub REST.… → see `addons-routes.ts.AGENTS.md` |
| `attachment-routes.ts` | `GET /api/sessions/:sessionId/attachments/:attachmentId` — full-resolution original for click-to-zoom. → see `attachment-routes.ts.AGENTS.md` |
| `csp-violations-routes.ts` | `registerCspViolationRoutes` — `POST /api/csp-violations` (network guard, 8 KiB, schema, per-principal burst… → see `csp-violations-routes.ts.AGENTS.md` |
| `custom-event-groups-routes.ts` | `GET /api/custom-event-groups` → `{ groups: [{id,label,default}] }` in resolution order; patterns never transmitted. See change: add-custom-event-group-filters. |
| `doctor-routes.ts` | Fastify plugin. `GET /api/doctor` returns `{checks, summary, generatedAt}`. → see `doctor-routes.ts.AGENTS.md` |
| `file-write-binary-routes.ts` | `registerFileWriteBinaryRoute(fastify,{sessionManager,networkGuard,fileHandlers?})` — `POST… → see `file-write-binary-routes.ts.AGENTS.md` |
| `live-server-routes.ts` | Live-server-preview REST. `registerLiveServerRoutes`. `POST /api/live-server/start {host,port,label}` (SSRF… → see `live-server-routes.ts.AGENTS.md` |
| `file-routes.ts` | REST routes for file read/browse; AsciiDoc render output is DOMPurify-sanitized ( → see `file-routes.ts.AGENTS.md` |
| `folder-project-routes.ts` | `GET /api/folder/project?cwd` → `FolderProject`. `admitCwd` first (400/403/503+`Retry-After`; 404… → see `folder-project-routes.ts.AGENTS.md` |
| `git-routes.ts` | REST routes: git branches, checkout, init, stash-pop. Adds `GET /api/git/head`, `GET /api/git/worktrees`,… →… → see `git-routes.ts.AGENTS.md` |
| `grep-routes.ts` | `GET /api/grep?cwd&q&regex`. Gates: known-session cwd, min-3 q, per-match cwd containment. See change: split-editor-workspace. |
| `host-gate-routes.ts` | `GET /api/host-gate` → `HostGateResponse` (`mode`, `envOverridden`, derived `admitted`, `recent` refusal… → see `host-gate-routes.ts.AGENTS.md` |
| `known-servers-routes.ts` | Known-servers config + mDNS discovery routes. Operator-only mutations/probe/accept-move, identity-pinned entries, `canManage` on GET. → see `known-servers-routes.ts.AGENTS.md` |
| `local-proof-routes.ts` | `registerLocalProofRoutes`: `POST /api/local-proof` (local token only → one-time code) and `GET… → see `local-proof-routes.ts.AGENTS.md` |
| `manifest-route.ts` | Dynamic `/manifest.json` route. Exports `stripPort`, `resolveManifestSource`, `buildManifestBody`,… → see `manifest-route.ts.AGENTS.md` |
| `model-proxy-api-key-routes.ts` | Proxy API key CRUD (JWT-gated management surface). Exports `registerModelProxyApiKeyRoutes`,… → see `model-proxy-api-key-routes.ts.AGENTS.md` |
| `model-proxy-diagnostics-routes.ts` | `GET /api/model-proxy/diagnostics`. JWT-gated, main instance only (NOT second `/v1` proxy port). → see `model-proxy-diagnostics-routes.ts.AGENTS.md` |
| `model-proxy-refresh-routes.ts` | Force-refresh model proxy registry. Exports `registerModelProxyRefreshRoutes`. `POST /api/model-proxy/refresh` → `refreshModelRegistry`; 503 `MODEL_PROXY_RUNTIME_MISSING` on failure. |
| `mermaid-repair-routes.ts` | `POST /api/mermaid/repair` `{code,error}` → `{success,data:{code,model}}`. → see `mermaid-repair-routes.ts.AGENTS.md` |
| `model-proxy-routes.ts` | OpenAI- + Anthropic-compatible proxy endpoints fronting model registry via pi-ai `streamSimple`. → see `model-proxy-routes.ts.AGENTS.md` |
| `models-introspection-routes.ts` | Ungated `GET /api/models` model-introspection surface for in-session agents. → see `models-introspection-routes.ts.AGENTS.md` |
| `nav-intent-routes.ts` | `registerNavIntentRoutes` — `POST /api/nav-intent` (mint for the caller's own principal; blocked url-view… → see `nav-intent-routes.ts.AGENTS.md` |
| `network-interfaces.ts` | `buildNetworkInterfaceList(enumerate)` builds the `/api/network-interfaces` payload — one entry per ADDRESS… → see `network-interfaces.ts.AGENTS.md` |
| `openspec-group-routes.ts` | REST routes for `/api/openspec/groups` CRUD + assignment. → see `openspec-group-routes.ts.AGENTS.md` |
| `openspec-routes.ts` | REST routes: openspec-archive, pi-resources (cwd optional → falls back to `process.cwd()` for the global… →… → see `openspec-routes.ts.AGENTS.md` |
| `package-health-routes.ts` | `registerPackageHealthRoutes`. `GET /api/packages/health` (scan global `packages[]`). → see `package-health-routes.ts.AGENTS.md` |
| `package-routes.ts` | Extension/package management routes. Exports `registerPackageRoutes`. → see `package-routes.ts.AGENTS.md` |
| `pairing-routes.ts` | Server-identity challenge + device-pairing routes. Exports `registerPairingRoutes`,… Operator-only… → see `pairing-routes.ts.AGENTS.md` |
| `pi-changelog-routes.ts` | `GET /api/pi-core/changelog?pkg&from&to`. Whitelist-validates `pkg` against `CORE_PACKAGE_NAMES`. → see `pi-changelog-routes.ts.AGENTS.md` |
| `pi-core-routes.ts` | Pi CLI core package version check + update. Exports `registerPiCoreRoutes`, `PiCoreRouteDeps`. → see `pi-core-routes.ts.AGENTS.md` |
| `pi-retry-routes.ts` | pi retry-policy editor. Exports `registerPiRetryRoutes(fastify,{networkGuard,reloadConnectedSessions})`. → see `pi-retry-routes.ts.AGENTS.md` |
| `pi-settings-routes.ts` | pi global `settings.json` editor: `GET/PUT /api/pi-settings` (typed leaf patch), `PUT /api/pi-settings/raw`… → see `pi-settings-routes.ts.AGENTS.md` |
| `pi-runtime-routes.ts` | Fastify plugin: `GET /api/pi/installs` (every discoverable pi install + per-consumer `usedBy`,… → see `pi-runtime-routes.ts.AGENTS.md` |
| `node-runtime-routes.ts` | Node family discovery + selection. `GET /api/node/installs` (enumerateNodeCandidates with live env +… → see `node-runtime-routes.ts.AGENTS.md` |
| `pi-trust-query-routes.ts` | `POST /api/pi-trust/query`: verified local proof (loopback, no forwarding, endpoint-bound) or operate device;… → see `pi-trust-query-routes.ts.AGENTS.md` |
| `plugin-activation-routes.ts` | REST routes: `GET /api/plugins` (returns `PluginStatus[]` with `displayName`, `requirements`,… → see… → see `plugin-activation-routes.ts.AGENTS.md` |
| `plugin-config-routes.ts` | Plugin partial config write. Exports `registerPluginConfigRoutes`. → see `plugin-config-routes.ts.AGENTS.md` |
| `plugin-runtime-client-routes.ts` | `registerPluginRuntimeClientRoutes(fastify,{networkGuard,broadcast,localTrust?,refreshDiscovery?,log?,repoRoot… → see `plugin-runtime-client-routes.ts.AGENTS.md` |
| `preferences-display-routes.ts` | REST routes `GET /api/preferences/display` (returns `{ global: DisplayPrefs|undefined, sessionOverrides:… → see `preferences-display-routes.ts.AGENTS.md` |
| `preferences-auto-name-routes.ts` | REST routes `GET /api/preferences/auto-name` (returns `{autoNameSessions:boolean}`, default true) + `PATCH… →… → see `preferences-auto-name-routes.ts.AGENTS.md` |
| `preferences-worktree-init-routes.ts` | REST routes `GET /api/preferences/worktree-auto-init` (returns `{autoInitWorktreeOnSpawn:boolean}`) + `PATCH… → see `preferences-worktree-init-routes.ts.AGENTS.md` |
| `provider-auth-routes.ts` | Provider OAuth (delegated to pi-ai) + API-key auth. Exports `registerProviderAuthRoutes`. → see `provider-auth-routes.ts.AGENTS.md` |
| `provider-health-cache.ts` | In-memory per-provider health cache `{ok,status,error,modelCount,testedAt}` (credential-free). → see `provider-health-cache.ts.AGENTS.md` |
| `provider-routes.ts` | Custom LLM provider read/write to `~/.pi/agent/providers.json`. Exports `registerProviderRoutes`. → see `provider-routes.ts.AGENTS.md` |
| `push-routes.ts` | `registerPushRoutes(fastify, {getPush})`. `/api/push/vapid-public-key` (observe), `GET/POST… → see `push-routes.ts.AGENTS.md` |
| `resource-activation-routes.ts` | pi-resource ACTIVATION routes (enable/disable), distinct from install/uninstall. → see `resource-activation-routes.ts.AGENTS.md` |
| `recommended-routes.ts` | Curated recommended-extensions list enriched with npm/GitHub meta, install scope, activeInPi,… → see `recommended-routes.ts.AGENTS.md` |
| `route-deps.ts` | Shared route dependency types. Exports `NetworkGuard` type, `RouteDeps` interface wiring `SessionManager`,… → see `route-deps.ts.AGENTS.md` |
| `runtime-routes.ts` | `registerRuntimeRoutes(fastify, deps)`: `GET /api/runtime/status[?refresh=true]` (runtime health, effective… → see `runtime-routes.ts.AGENTS.md` |
| `session-routes.ts` | Session REST routes. Exports `registerSessionRoutes`. Endpoints: `GET /api/sessions`, `GET… → see `session-routes.ts.AGENTS.md` |
| `system-routes.ts` | REST routes: config, health, shutdown, tunnel. External-editor endpoints `/api/editors`,… → see… → see `system-routes.ts.AGENTS.md` |
| `tls-routes.ts` | `POST /api/tls/issue {sourceId, name?}` — operator "issue now" (Renew now / Try again now / Check now). → see `tls-routes.ts.AGENTS.md` |
| `tool-routes.ts` | REST routes: `GET /api/tools`, `GET /api/tools/:name`, `POST /api/tools/rescan`, `PUT/DELETE… → see `tool-routes.ts.AGENTS.md` |
| `user-routes.ts` | Operator `/api/users*`: `registerUserRoutes(fastify,{service,localToken,localTrust,hostAdmission})`. → see `user-routes.ts.AGENTS.md` |
| `acp-routes.ts` | `GET /api/acp/agents` → `[{id,name}]` (tier `control`); never command/args/env. See change: add-acp-session-driver. |
