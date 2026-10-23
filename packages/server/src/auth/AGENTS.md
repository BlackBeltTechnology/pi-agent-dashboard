# DOX — packages/server/src/auth

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `approval-refusal.ts` | `describeApprovalRefusal(request, {loginAvailable, configPort, hostAdmitted, localTrust?})`: pure; `null`… → see `approval-refusal.ts.AGENTS.md` |
| `auth-plugin.ts` | `registerAuthPlugin` now returns `{hasUsableOAuthProvider}` (live, non-empty `clientId`; exists even on the… → see `auth-plugin.ts.AGENTS.md` |
| `auth.ts` | OAuth2 core: providers (GitHub, Google, Keycloak, generic OIDC via `.well-known` discovery), JWT sign/verify,… → see `auth.ts.AGENTS.md` |
| `bearer-auth.ts` | Bearer device-auth branch (D5/D7). `registerBearerAuth(fastify,{registry})` adds an `onRequest` hook… → see… → see `bearer-auth.ts.AGENTS.md` |
| `begin-flow.ts` | `beginFlow(params)` — shared OAuth start robustness for `POST /api/provider-auth/start` + plugin seam:… → see `begin-flow.ts.AGENTS.md` |
| `bind-reachability-service.ts` | Server inputs to the shared reachability predicate. `initBindReachability({resolvedBindHost, hostFlag})`… → see `bind-reachability-service.ts.AGENTS.md` |
| `bridge-ticket-eligibility.ts` | WHO may mint a `bridge`-scoped WS ticket.… → see `bridge-ticket-eligibility.ts.AGENTS.md` |
| `bypass-urls.ts` | Import-free leaf: `isBypassed(url, bypassUrls)` — `auth.bypassUrls` prefix match (`startsWith`). → see `bypass-urls.ts.AGENTS.md` |
| `cors-origin.ts` | Pure CORS origin allow-decision extracted from the `@fastify/cors` callback in `server.ts` so it is… Adds… → see `cors-origin.ts.AGENTS.md` |
| `csp-report-paths.ts` | Shared path contract: `CSP_REPORT_PREFIX`, `CSP_REPORT_POLICIES` (baseline|strict|trusted-types), `isCspReportPolicy`, `cspReportPath`, `cspReportEndpointName`. Imported by `csp.ts` + `csp-report-sink.ts` so `report-uri` cannot drift from the route. See change: harden-cors-and-csp-reporting. |
| `csp-report-sink.ts` | `registerCspReportSink(fastify,{store,networkGuard})`: `POST /__pi/csp-report/:policy` in own Fastify scope. Own byte-counting read (8 KiB, chunked incl., 5 s deadline → 408). Refusal order 404→405→429→415→413/408/400. `PeerLimiter` token bucket (cap 20, 1/s, per socket peer, loopback not exempt, idle-full eviction). Refused reports bump `dropped`. Content-encoded bodies 400, never decompressed. Also `POST /api/csp-reports/reset` (operate). Throttled log line `[csp] violation policy=<l> directive=<d>`; reports never logged/reflected. See change: harden-cors-and-csp-reporting. |
| `csp-report-store.ts` | `CspReportStore`: persisted counters `~/.pi/dashboard/csp-reports.json` (0600, atomic tmp+rename, ≤1 write/5 s, flush on close). Policy×directive counts (fixed allow-set else `other`; TT in `require-trusted-types-for`), `dropped`, `since`, bounded top-N document paths. Corrupt file → `.corrupt`; write failure → one warning per fault episode. `strictScriptSrcMeasure`. See change: harden-cors-and-csp-reporting. |
| `csp.ts` | Baseline Content-Security-Policy (defense in depth). `buildCsp()` (default-src/object-src… → see `csp.ts.AGENTS.md` |
| `dashboard-credential-store.ts` | `DashboardCredentialStore` — pi-ai `CredentialStore` over auth.json for the single runtime. → see `dashboard-credential-store.ts.AGENTS.md` |
| `dashboard-state-caller.ts` | `stateCallerFor(request, localTrust)` → `StateCaller {gatedAdmitted(), unproven()}`, lazily from the SAME… → see `dashboard-state-caller.ts.AGENTS.md` |
| `host-admission.ts` | Pure Host-admission decision + admitted-source classifier (issue #637, D1). → see `host-admission.ts.AGENTS.md` |
| `host-gate.ts` | The Host-admission gate + operator state (issue #637, D1/D4/D5/D8). → see `host-gate.ts.AGENTS.md` |
| `identity.ts` | Persistent Ed25519 server identity (D2, TOFU pinning). `ensureServerIdentity(path?)` generates/loads keypair… → see `identity.ts.AGENTS.md` |
| `local-credential.ts` | Local credential verifier + edge stamp.… → see `local-credential.ts.AGENTS.md` |
| `local-proof-refusal-log.ts` | `createLocalProofRefusalLogger` — one bounded line `[local-proof] refused peer=… host=<sanitized> method=…… → see `local-proof-refusal-log.ts.AGENTS.md` |
| `local-proof.ts` | Opt-in strict local proof (`requireLocalProof`). Exports `LocalTrustContext {strict(), localToken,… → see `local-proof.ts.AGENTS.md` |
| `local-token.ts` | Local-IPC allowlist token (D10, narrowed). `ensureLocalToken(dir?)` writes high-entropy secret to… → see `local-token.ts.AGENTS.md` |
| `localhost-guard.ts` | Network access guard: `createNetworkGuard(trustedNetworks, {localToken?})`… → see… → see `localhost-guard.ts.AGENTS.md` |
| `locked-json-file.ts` | Path-parameterised lock primitives shared by `auth.json` + `plugin-credentials.json`: `LOCK_OPTIONS`… → see `locked-json-file.ts.AGENTS.md` |
| `loopback.ts` | Import-free leaf: `LOOPBACK_ADDRESSES` set + `isLoopback(ip)`; `isLoopbackRange(ip)` = `127.0.0.0/8` ∪ `::1`… → see `loopback.ts.AGENTS.md` |
| `mutation-origin-gate.ts` | Cross-site MUTATION gate (issue #625). `createMutationOriginGate(getOpts)` → Fastify `onRequest` hook: gates… → see `mutation-origin-gate.ts.AGENTS.md` |
| `nav-intent.ts` | `NavIntents` — per-process-key HMAC navigation intents: `mint(principal, kind, target)` →… → see `nav-intent.ts.AGENTS.md` |
| `network-trust-telemetry.ts` | In-memory network-only admission counters (`noteNetworkOnlyAdmission`, `networkOnlySnapshot`,… → see `network-trust-telemetry.ts.AGENTS.md` |
| `node-guard.ts` | Re-exports `isAffectedNode`/`isOutOfEnginesRange` from shared `node-version.ts` (public API unchanged). → see `node-guard.ts.AGENTS.md` |
| `operate-required.ts` | `hasOperateAuthority(request, localTrust?)` (operate device bearer, session, principal, or… → see `operate-required.ts.AGENTS.md` |
| `pi-legacy-credentials.ts` | Plain-text API keys in pi `settings.json`… → see `pi-legacy-credentials.ts.AGENTS.md` |
| `pi-oauth-types.ts` | Local structural types for the slice of pi-ai's OAuth surface the server drives: `LoginPrompt`… → see `pi-oauth-types.ts.AGENTS.md` |
| `plugin-credential-store.ts` | `createPluginCredentialStore(pluginId, path?)` over `~/.pi/agent/plugin-credentials.json`… → see `plugin-credential-store.ts.AGENTS.md` |
| `plugin-server-trust.ts` | `isPluginServerTrusted(id, entries)` (entry with `server:true`), `readServerTrustEntries()` (loose read of… → see `plugin-server-trust.ts.AGENTS.md` |
| `plugin-trust-store.ts` | The ONE reader/writer of `auth.trustedPlugins`. `readTrustedPlugins()` (typed, live), `findTrustEntry`,… → see `plugin-trust-store.ts.AGENTS.md` |
| `provider-auth-adapter.ts` | `AuthInteraction` adapter + in-memory flow store. `notify` sets sticky `authUrl` / `device_code` pending /… → see `provider-auth-adapter.ts.AGENTS.md` |
| `provider-auth-handlers.ts` | Barrel re-export: `OAuthRegistryEntry` type + `getOAuthRegistry` from `provider-auth-registry.ts`. Keeps the storage/routes import surface stable. → see `provider-auth-handlers.ts.AGENTS.md` |
| `provider-auth-registry.ts` | OAuth provider registry built from the server's SINGLE `ModelRuntime`, injected via… → see `provider-auth-registry.ts.AGENTS.md` |
| `provider-auth-storage.ts` | Reads/writes `~/.pi/agent/auth.json` for pi provider credentials via `proper-lockfile` + atomic write. → see `provider-auth-storage.ts.AGENTS.md` |
| `request-principal.ts` | `requestPrincipalKey(request)` → `identity:<iss>\0<sub>` | `device:<id>` | `session:<sha256>` | `local-operator`. See change: harden-client-sinks. |
| `runtime-provider-catalogue.ts` | `buildRuntimeCatalogue(source, {customIds, authData, env})` → `ProviderInfo[]` from the server runtime's… → see `runtime-provider-catalogue.ts.AGENTS.md` |
| `secret-rotation.ts` | `rotateSecretsOnce()` at start of `createServer` (after `decideBootTrustMode`): link-claimed… → see `secret-rotation.ts.AGENTS.md` |
| `serve-app-host.ts` | Host side of `ctx.serveApp`. `readBundledPluginDirs()` (server `package.json#piDashboard.bundledPlugins`,… → see `serve-app-host.ts.AGENTS.md` |
| `spawn-token.ts` | Spawn correlation token. Exports `mintSpawnToken()` (UUIDv4), `SPAWN_TOKEN_ENV_VAR =… → see `spawn-token.ts.AGENTS.md` |
| `test-env-guard.ts` | Exports `isUnsafeTestHomeScan()` — defense-in-depth against destructive PID-registry sweeps during vitest… → see `test-env-guard.ts.AGENTS.md` |
| `trust-mode.ts` | Trust-mode resolver. `effectiveTrustMode()`, `trustModeOf`, `admissionTrustedNetworks(fallback)` = live… → see `trust-mode.ts.AGENTS.md` |
| `trust-mode-boot.ts` | `decideBootTrustMode({write?,load?})`, called first in `createServer`. → see `trust-mode-boot.ts.AGENTS.md` |
| `ws-ticket.ts` | Single-use WS upgrade tickets (D11/F4/F6). `WsTicketStore(now?)`: `mint(scope)` high-entropy in-memory ticket… → see `ws-ticket.ts.AGENTS.md` |
| `radius-mcp.ts` | Radius MCP follow-up (pi `/login` parity). `RADIUS_MCP_URL` (drift-tested vs pi), `RADIUS_MCP_CODES`… → see `radius-mcp.ts.AGENTS.md` |
| `radius-override.ts` | `isRadiusOverridden()` — true iff Pi-global `models.json` has `providers.radius` `oauth:"radius"` +… → see `radius-override.ts.AGENTS.md` |
| `scan-legacy-provider-ids.ts` | `PI_RENAMED_PROVIDER_IDS` (`azure-openai-responses`→`azure`, single source) +… → see `scan-legacy-provider-ids.ts.AGENTS.md` |
| `route-tier-gate.ts` | `createRouteTierGate`, `tierRefusalFor`, `sendTierRefusal`. → see `route-tier-gate.ts.AGENTS.md` |
| `ws-upgrade-reject-log.ts` | `createWsUpgradeRejectLogger({windowMs=60_000,maxKeys=256,now,log})` → `{log(rejection), trackedKeys()}`. → see `ws-upgrade-reject-log.ts.AGENTS.md` |
