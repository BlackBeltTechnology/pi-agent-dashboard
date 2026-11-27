# DOX — packages/server/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `__tests__/device-nonce-store.test.ts` | `DeviceNonceStore` (single-use, 60 s TTL, 10 000 bound, consumed on any proof) + `verifyNonceProof` (E4). See change: device-key-mutual-check. |
| `__tests__/device-status-limiter.test.ts` | `DeviceStatusLimiter` (60/min/peer, 1024 peers) + `RevokedAnswerLog` throttle (E5, E17). See change: device-key-mutual-check. |
| `__tests__/event-wiring-preferences-before-initial-prompt.test.ts` | #E10: real server + fake bridge WS; compat on + queued initial prompt → `preferences_update {claudeSubscriptionCompat:true}` arrives before `send_prompt`. See change: retire-anthropic-messages-bridge. |
| `__tests__/host-project-trust.test.ts` | Legacy decision table + real pi, plus shared decision, #E24 agent dir, #X10 boot log, #E27 no trust.json… → see `__tests__/host-project-trust.test.ts.AGENTS.md` |
| `__tests__/paired-devices-keys.test.ts` | Registry key + companion API: bind/replace/held, cap, `deviceKeyStatus`. See change: device-key-mutual-check. |
| `__tests__/paired-devices-revoked.test.ts` | Held revoked store `revoked-devices.json`: restore, delete-now, purge, quarantine, crash rule. See change: device-key-mutual-check. |
| `__tests__/pairing-device-key-routes.test.ts` | `POST /api/pair/device-key` (E10) + operator revoked/restore/delete-now/companion routes (E14). See change: device-key-mutual-check. |
| `__tests__/pairing-device-keys.test.ts` | Knock/redeem key + companion intake, bind on approve, discard on deny/expiry/lockout, uniqueness, `allowCompanion`, audit (E2, E6, E7, E9, E17, X16). See change: device-key-mutual-check. |
| `__tests__/pairing-device-status.test.ts` | Challenge `deviceNonce`, device-status answers, uniform `unverified`, observe tier, credential boundary (E3, E12, E13, E17). See change: device-key-mutual-check. |
| `__tests__/pi-trust-mirror-service.test.ts` | #E1 #E3 #E4 #E19 #E20 #E22 #E26 #X5–#X9: registry, snapshot content, ordering and fault behaviour. See change: mirror-dashboard-trust-to-pi. |
| `__tests__/preferences-claude-compat-routes.test.ts` | #E11: Fastify inject + fake gateway; PATCH broadcasts one full snapshot per session, later register gets new value, non-boolean → 400 without broadcast. See change: retire-anthropic-messages-bridge. |
| `__tests__/remote-bridge-ticket-origin.test.ts` | #E14: remote bridge on the real two-port topology. `createTestServer` + paired-device bearer;… → see `__tests__/remote-bridge-ticket-origin.test.ts.AGENTS.md` |
| `__tests__/resource-toggle-trust-mirror.test.ts` | #E17 #E18: pre-selection, recorded refusal, ancestor refusal, never, always → see `__tests__/resource-toggle-trust-mirror.test.ts.AGENTS.md` |
| `__tests__/session-diff.perf.test.ts` | #P1: `buildSessionDiff` + git enrichment over a REAL temp repo with 200 changed files (server `MAX_FILES`);… → see `__tests__/session-diff.perf.test.ts.AGENTS.md` |
| `__tests__/session-routes-ui-links.test.ts` | #E6 owner-filtered rows with `uiUrl`/`diffUrl`, nothing persisted; #E7 `?id=` filter (prefix floor, case, owner gate, 400 on repeat). See change: add-session-ui-deep-links-for-agents. |
| `__tests__/setup/subagents-reducer-slice.ts` | Vitest `setupFiles` shim (server project): registers the subagents plugin's reducer slice + Agent finalizer… → see `__tests__/setup/subagents-reducer-slice.ts.AGENTS.md` |
| `__tests__/event-wiring-model-state.test.ts` | Model/thinking replay regression: marked history cannot overwrite the live register (normal, skip-wipe, late… → see `__tests__/event-wiring-model-state.test.ts.AGENTS.md` |
| `auto-name-outcome-store.ts` | Bounded (500) in-memory retention of the last auto-naming outcome per session. → see `auto-name-outcome-store.ts.AGENTS.md` |
| `browse.ts` | Directory-browse logic: `listDirectories` (readdir + tiered rank filter, cap 200, opt-in `.git`/`.pi` flag… → see `browse.ts.AGENTS.md` |
| `cli.ts` | `pi-dashboard` CLI entry. Exports `parseArgs` (subcommand + flags), `buildConfig` (CLI+env+file merge →… →… → see `cli.ts.AGENTS.md` |
| `commit-draft-relay.ts` | Correlates `POST /api/git/commit-draft` → bridge `git_commit_draft_result`. → see `commit-draft-relay.ts.AGENTS.md` |
| `config-api.ts` | Config REST helpers: `readConfigRedacted` (redacts `auth.secret`/`providers[].clientSecret` + tunnel… → see `config-api.ts.AGENTS.md` |
| `config-snapshot.ts` | mtime-gated snapshot of `config.json`: `getConfigSnapshot`, `live*` accessors, `getResolvedPreviewOrigins()`… → see `config-snapshot.ts.AGENTS.md` |
| `directory-service.ts` | Server-side directory-scoped ops. Exports `createDirectoryService`, `DirectoryService` interface,… → see… → see `directory-service.ts.AGENTS.md` |
| `event-wiring.ts` | Wires pi-gateway events → browser-gateway + session manager. Exports `wireEvents`, `EventWiringDeps`. → see `event-wiring.ts.AGENTS.md` |
| `__tests__/config-put-pairing.test.ts` | `PUT /api/config` rejects a non-boolean `pairing.acceptLanRequests` with 400; boolean deep-merges. See change: add-lan-knock-pairing. |
| `__tests__/pair-request-route.test.ts` | `POST /api/pair/request` L1 (#E2–#E23, #X1, #X2): public prefix, 415 on non-JSON, socket peer not `request.ip`, every refusal reason. See change: add-lan-knock-pairing. |
| `__tests__/api-origin-gate.test.ts` | Mutating-REST Origin gate L1 (#E12-#E17, #X3). Drives the REAL `createMutationOriginGate` hook on stub routes… → see `__tests__/api-origin-gate.test.ts.AGENTS.md` |
| `__tests__/retained-transcript-route.test.ts` | L1 HTTP surface of `GET /api/sessions/:id/retained-transcript`: spy-preHandler proves the route is behind… → see `__tests__/retained-transcript-route.test.ts.AGENTS.md` |
| `__tests__/credential-migration.test.ts` | L1 startup migration of plaintext credential files over test codecs / singleton + stub keychain: E9 no marker… → see `__tests__/credential-migration.test.ts.AGENTS.md` |
| `__tests__/credential-startup-wiring.test.ts` | Real `createServer` with `ServerConfig.credentialKey` (key file): init then migration order + log lines… → see `__tests__/credential-startup-wiring.test.ts.AGENTS.md` |
| `__tests__/directory-service-retained-hydration.test.ts` | L1 `DirectoryService.loadRetainedEvents` governance (test-plan #P3, #X6, #X12, #X13): a real retained… → see `__tests__/directory-service-retained-hydration.test.ts.AGENTS.md` |
| `__tests__/browser-gateway-critical-frames.test.ts` | Bounded critical-frame delivery suite (E1–E6, X6, P1): pending-prompt replay exempt past MAX_WS_BUFFER under… → see `__tests__/browser-gateway-critical-frames.test.ts.AGENTS.md` |
| `__tests__/browser-gateway-resync-delivery.test.ts` | Requester-scoped resync suite (E7–E9, X3, E16, P2): `prompt_resync_request` forwarding/recording,… → see `__tests__/browser-gateway-resync-delivery.test.ts.AGENTS.md` |
| `__tests__/plugin-ws-route.test.ts` | Plugin-registered WS route gates on the REAL upgrade handler (test-plan #E4-#E8, #E5 golden, #X11; spec… → see `__tests__/plugin-ws-route.test.ts.AGENTS.md` |
| `__tests__/ui-link-base.test.ts` | #E2-#E5: configured match, XFH precedence/spoofing, normalized output (port 1/65535/65536, IPv6, case), fallback. See change: add-session-ui-deep-links-for-agents. |
| `__tests__/ws-origin-gate.test.ts` | WS upgrade Origin gate L1 (#E4-#E9, #E18, #X1, #X2, #F4). → see `__tests__/ws-origin-gate.test.ts.AGENTS.md` |
| `__tests__/keeper-log-maintenance.test.ts` | Sweep + stats L1 suite (E10-E15, X5-X11, P4): size/age gates, launch-log exclusion, PID-sidecar liveness (NOT… → see `__tests__/keeper-log-maintenance.test.ts.AGENTS.md` |
| `file-watch-manager.ts` | Narrow open-files watch. `setWatched(ws,sessionId,cwd,relPaths,onChange)` reconciles per (ws,session,path);… → see `file-watch-manager.ts.AGENTS.md` |
| `plugin-entry-stats.ts` | Manifest replay entry-type provider for session loads; `/api/health` `pluginEntries`. → see `plugin-entry-stats.ts.AGENTS.md` |
| `preferences-relay.ts` | `buildPreferencesUpdate(store)` → full `preferences_update` snapshot (`autoNameSessions` +… → see `preferences-relay.ts.AGENTS.md` |
| `watch-files-handler.ts` | Browser-WS `watch_files` handler. `createWatchFilesHandler({routeAdmission, manager, onChange})` →… → see `watch-files-handler.ts.AGENTS.md` |
| `fix-pty-permissions.ts` | Runtime fix for node-pty spawn-helper exec bit. Exports `fixPtyPermissions` (no-op on Windows / already… → see `fix-pty-permissions.ts.AGENTS.md` |
| `known-server-moves.ts` | In-memory verified move suggestions for renamed known servers. → see `known-server-moves.ts.AGENTS.md` |
| `peer-servers.ts` | mDNS browser events → `peerServers` map (keyed by `peerKey`), broadcast, move evaluation on up/update/sweep. → see `peer-servers.ts.AGENTS.md` |
| `pi-agent-settings.ts` | Read/WRITE of pi's GLOBAL `<agentDir>/settings.json` (`$PI_CODING_AGENT_DIR` else `~/.pi/agent`): retry policy… → see `pi-agent-settings.ts.AGENTS.md` |
| `pi-default-remirror.ts` | Re-mirror an `@role` default into pi only when its resolution moves; backs `host.remirrorPiDefaults` / `host.defaultModelRef`… → see `pi-default-remirror.ts.AGENTS.md` |
| `pi-settings-themes.ts` | `createThemeLister(scan)` → `{list, invalidate}`: sorted theme names (30 s cache, 5 s when degraded,… → see `pi-settings-themes.ts.AGENTS.md` |
| `plugin-append-event.ts` | Host side of `ctx.appendEvent`. `createPluginEventAppender({registry, eventStore, isReplaying,… → see `plugin-append-event.ts.AGENTS.md` |
| `plugin-discovery-wiring.ts` | `createPluginDiscoveryWiring({loadDeps, readDeclaredBundledIds, clearContentHashCache?, listActiveCwds,… → see `plugin-discovery-wiring.ts.AGENTS.md` |
| `plugin-event-seam.ts` | Trusted-plugin emit seams: `emitEventToSession(trusted,send,sid,type,data,{pluginId,allowed})` refuses… → see `plugin-event-seam.ts.AGENTS.md` |
| `plugin-intent-cache.ts` | Server-side cache of most recent plugin intent per `(pluginId, sessionId, slot)`. → see `plugin-intent-cache.ts.AGENTS.md` |
| `plugin-ownership.ts` | Manifest ownership table. `buildPluginOwnership(plugins)` → `plugin_ownership {eventTypes: pattern→pluginId,… → see `plugin-ownership.ts.AGENTS.md` |
| `plugin-policy-registry.ts` | Process-wide registry of plugin ownership (manifest `eventTypes` + tool-renderer claims), store policies and… → see `plugin-policy-registry.ts.AGENTS.md` |
| `plugin-request-lane.ts` | Server half of the private plugin request/reply lane. `createPluginRequestLane(send)` → `register(pluginId,type,handler)` (single owner; duplicate throws) + `handle(sessionId,msg)`: replies `plugin_reply` `{ok,result}` / `{ok:false,error}` (`no_handler`, handler message only, `reply_not_serializable`, `reply_too_large` >256 KiB). `sessionId` = socket key. Host-internal send, no priority gate, no `pi.events`. See change: expose-plugin-credential-and-oauth-seams. | See change: harden-bridge-session-claim
| `plugin-runtime-clients.ts` | Server wiring of the runtime-client registry. `createServerRuntimeClients({repoRoot?, declaredIds?})` (prod… → see `plugin-runtime-clients.ts.AGENTS.md` |
| `project-seed.ts` | Unattended project-default seeding. Exports `SeedOutcome`, `SeedProjectDefaultsOptions`,… → see `project-seed.ts.AGENTS.md` |
| `resolve-path.ts` | Exports `safeRealpathSync(p)` — `fs.realpathSync` with original-path fallback on error. |
| `ripgrep-detection.ts` | One-time `rg` detection via ToolResolver. `detectRipgrep`/`resetRipgrepCache`. See change: split-editor-workspace. |
| `runtime-publication.ts` | Startup publication of the diagnostic `runtime.resolved` block into RAW `~/.pi/dashboard/config.json` (never… → see `runtime-publication.ts.AGENTS.md` |
| `runtime-resolution.ts` | Process-lifetime holder for the ladder-resolved pi spawn runtime. → see `runtime-resolution.ts.AGENTS.md` |
| `server-heap-telemetry.ts` | Heap + GC telemetry for the SERVER process. Exports `startServerHeapTelemetry`,… → see `server-heap-telemetry.ts.AGENTS.md` |
| `server.ts` | Dashboard HTTP + WebSocket server. Exports `ServerConfig`, `DashboardServer`, `createServer(config)`. → see `server.ts.AGENTS.md` |
| `system-open-capability.ts` | System file-open capability: `systemOpenCapability`, `buildOpenCommand`/`buildRevealCommand`/`runOpener`… → see `system-open-capability.ts.AGENTS.md` |
