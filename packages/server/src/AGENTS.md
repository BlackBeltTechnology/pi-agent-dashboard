# DOX — packages/server/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `active-sessions-in-cwd.ts` | Pure helpers `isPathInside(parent, child)`, `activeSessionsUnder(path, sessions)` (excludes `status ===… → see `active-sessions-in-cwd.ts.AGENTS.md` |
| `auth-plugin.ts` | Fastify plugin registers OAuth routes + `onRequest` JWT gate. → see `auth-plugin.ts.AGENTS.md` |
| `auth.ts` | OAuth2 core: providers (GitHub, Google, Keycloak, generic OIDC via `.well-known` discovery), JWT sign/verify,… → see `auth.ts.AGENTS.md` |
| `bearer-auth.ts` | Bearer device-auth branch (D5/D7). `registerBearerAuth(fastify,{registry})` adds an `onRequest` hook… → see `bearer-auth.ts.AGENTS.md` |
| `boot-parent-liveness.ts` | Boot-parent liveness + live-ppid reader for `/api/health`. → see `boot-parent-liveness.ts.AGENTS.md` |
| `browse.ts` | Directory-browse logic: `listDirectories` (readdir + tiered rank filter, cap 200, opt-in `.git`/`.pi` flag… → see `browse.ts.AGENTS.md` |
| `browser-gateway.ts` | WebSocket gateway for browser clients. Exports `BrowserGateway` interface, `createBrowserGateway`,… → see `browser-gateway.ts.AGENTS.md` |
| `changelog-fs.ts` | `findChangelogPath(pkg, opts)` resolves CHANGELOG.md (managed > bare-import > filesystem-walk). → see `changelog-fs.ts.AGENTS.md` |
| `changelog-parser.ts` | `parseChangelog(text)` Keep-a-Changelog regex parser. `readAndParseChangelog(path)` mtime-keyed 60s cache. → see `changelog-parser.ts.AGENTS.md` |
| `changelog-remote.ts` | Fetch upstream CHANGELOG.md from GitHub raw for release notes newer than local tarball. → see `changelog-remote.ts.AGENTS.md` |
| `cli.ts` | `pi-dashboard` CLI entry. Exports `parseArgs` (subcommand + flags), `buildConfig` (CLI+env+file merge →… → see `cli.ts.AGENTS.md` |
| `commit-draft-relay.ts` | Correlates `POST /api/git/commit-draft` → bridge `git_commit_draft_result`. → see `commit-draft-relay.ts.AGENTS.md` |
| `config-api.ts` | Config REST helpers: `readConfigRedacted` (redacts `auth.secret`/`providers[].clientSecret` + tunnel provider… → see `config-api.ts.AGENTS.md` |
| `dashboard-source-decision.ts` | Pure decision: stamp `source:"dashboard"` on `session_register`? Exports `decideDashboardSource(input)` →… → see `dashboard-source-decision.ts.AGENTS.md` |
| `directory-service.ts` | Server-side directory-scoped ops. Exports `createDirectoryService`, `DirectoryService` interface,… → see `directory-service.ts.AGENTS.md` |
| `cors-origin.ts` | Pure CORS origin allow-decision extracted from the `@fastify/cors` callback in `server.ts` so it is… → see `cors-origin.ts.AGENTS.md` |
| `csp.ts` | Baseline Content-Security-Policy (defense in depth). `buildCsp()` (default-src/object-src… → see `csp.ts.AGENTS.md` |
| `launch-source-effective.ts` | `computeEffectiveLaunchSource({raw, activeBridgeCount, uptimeMs})` → `LaunchSourceEffective`… → see `launch-source-effective.ts.AGENTS.md` |
| `live-server-manager.ts` | Live-server-preview allowlist registry + SSRF gate. `createLiveServerManager(preferencesStore)`. → see `live-server-manager.ts.AGENTS.md` |
| `live-server-proxy.ts` | Reverse proxy for live-server targets on MAIN origin `/live/:id/*`. → see `live-server-proxy.ts.AGENTS.md` |
| `event-status-extraction.ts` | Extract session status/tool/model stats from forwarded events. → see `event-status-extraction.ts.AGENTS.md` |
| `event-wiring.ts` | Wires pi-gateway events → browser-gateway + session manager. Exports `wireEvents`, `EventWiringDeps`. → see `event-wiring.ts.AGENTS.md` |
| `eventloop-sampler.ts` | Dedicated ELD safety-net sampler. `startEventLoopSampler({floorMs,intervalMs,onSpike,histogram?})` →… → see `eventloop-sampler.ts.AGENTS.md` |
| `eventloop-spike-metrics.ts` | Ring buffer of worst-case event-loop stalls. `createEventLoopSpikeMetrics(capacity)` →… → see `eventloop-spike-metrics.ts.AGENTS.md` |
| `file-watch-manager.ts` | Narrow open-files watch. `setWatched(ws,sessionId,cwd,relPaths,onChange)` reconciles per (ws,session,path); `clearConnection(ws)` on disconnect, no fd leak. See change: split-editor-workspace. |
| `fix-pty-permissions.ts` | Runtime fix for node-pty spawn-helper exec bit. Exports `fixPtyPermissions` (no-op on Windows / already… → see `fix-pty-permissions.ts.AGENTS.md` |
| `folder-head-poll.ts` | Exports `computeFolderGroupKeys(sessions, pinnedDirectories)` = unique resolved folder group-key display… → see `folder-head-poll.ts.AGENTS.md` |
| `folder-head-watcher.ts` | Per-folder `fs.watch` on gitdir HEAD, modeled on `openspec-change-watcher.ts`;… → see `folder-head-watcher.ts.AGENTS.md` |
| `git-operations.ts` | Server-side git commands: branch listing, checkout, init, stash pop. → see `git-operations.ts.AGENTS.md` |
| `git-worktree-compose.ts` | Pure helper composing live `gitWorktree` payload. Exports `composeWorktreePayload(wire, cachedBase)` → `null`… → see `git-worktree-compose.ts.AGENTS.md` |
| `git-worktree-lifecycle.ts` | Pure stderr→code mappers `mapRemoveStderr` / `mapMergeStderr` / `mapPushStderr` / `mapPrStderr` +… → see `git-worktree-lifecycle.ts.AGENTS.md` |
| `git-worktree.ts` | Pure helpers for worktree handling: `slugifyBranch(branch)` (path-safe slug), `parsePorcelainWorktrees(out)`… → see `git-worktree.ts.AGENTS.md` |
| `goal-budget-guard.ts` | `decideBudgetHalt(snapshot,budget)` pure. Returns `{halt:true,command:"/goal pause"}` when active loop… → see `goal-budget-guard.ts.AGENTS.md` |
| `goal-session-primer.ts` | Kickoff `/goal` loop for goal-linked sessions. Exports `buildGoalPrimerCommands` (`/goal <objective>` or `[]`… → see `goal-session-primer.ts.AGENTS.md` |
| `goal-status-projector.ts` | `createGoalStatusProjector({store,lookupSession,warn?})`. Peer `goal_status` consumer beside the accumulator. → see `goal-status-projector.ts.AGENTS.md` |
| `goal-store.ts` | Per-cwd GoalRecord persistence. `GoalCreateBody`/`GoalUpdateBody` gain `judge?`+`autoRespawn?`. → see `goal-store.ts.AGENTS.md` |
| `goal-supervisor.ts` | Goal session supervisor (main-server; owns GoalStore). `createGoalSupervisor(deps)` rides… → see `goal-supervisor.ts.AGENTS.md` |
| `goal-verdict-accumulator.ts` | `createGoalVerdictAccumulator({store,lookupSession,now?,warn?})`. Consumes `goal_status` snapshots. → see `goal-verdict-accumulator.ts.AGENTS.md` |
| `headless-pid-registry.ts` | Registry mapping headless child processes → session IDs. Exports `createHeadlessPidRegistry`,… → see `headless-pid-registry.ts.AGENTS.md` |
| `home-lock-release.ts` | Installs SIGINT/SIGTERM/SIGHUP/SIGBREAK + `exit` handlers that release the per-HOME dashboard lock exactly… → see `home-lock-release.ts.AGENTS.md` |
| `home-lock.js` | Compiled JS of `home-lock.ts`. Per-HOME advisory lock ensuring one dashboard instance per… → see `home-lock.js.AGENTS.md` |
| `home-lock.ts` | Per-HOME advisory lock ensuring one dashboard instance per `<canonicalHomedir>/.pi/`. → see `home-lock.ts.AGENTS.md` |
| `hydration-metrics.ts` | Ring-buffer recorder for session-hydration timings. `createHydrationMetrics(capacity)` → `{ record(sample),… → see `hydration-metrics.ts.AGENTS.md` |
| `identity.ts` | Persistent Ed25519 server identity (D2, TOFU pinning). `ensureServerIdentity(path?)` generates/loads keypair… → see `identity.ts.AGENTS.md` |
| `idle-timer.ts` | Auto-shutdown timer with sleep-wake resilience. Exports `IdleTimer`, `HasActiveTerminals`,… → see `idle-timer.ts.AGENTS.md` |
| `installed-package-enricher.ts` | Enriches raw `packageManagerWrapper.listInstalled()` rows with version, description, displayName,… → see `installed-package-enricher.ts.AGENTS.md` |
| `json-store.ts` | Atomic JSON file read/write helpers. Exports `readJsonFile(filePath, fallback)` (returns fallback on… → see `json-store.ts.AGENTS.md` |
| `local-token.ts` | Local-IPC allowlist token (D10, narrowed). `ensureLocalToken(dir?)` writes high-entropy secret to… → see `local-token.ts.AGENTS.md` |
| `localhost-guard.ts` | Network access guard: `createNetworkGuard(trustedNetworks, {localToken?})`… → see `localhost-guard.ts.AGENTS.md` |
| `memory-event-store.ts` | In-memory event store with LRU eviction; replaces SQLite-backed event-store. → see `memory-event-store.ts.AGENTS.md` |
| `memory-session-manager.ts` | Pure in-memory session registry; replaces SQLite-backed session-manager. → see `memory-session-manager.ts.AGENTS.md` |
| `meta-persistence.ts` | Per-session debounced `.meta.json` writer. Exports `MetaPersistence`, `createMetaPersistence`. → see `meta-persistence.ts.AGENTS.md` |
| `migrate-persistence.ts` | Migration utility: converts `sessions.json` + `state.json` → per-session `.meta.json` + `preferences.json`. → see `migrate-persistence.ts.AGENTS.md` |
| `node-guard.ts` | Re-exports `isAffectedNode`/`isOutOfEnginesRange` from shared `node-version.ts` (public API unchanged). → see `node-guard.ts.AGENTS.md` |
| `npm-search-proxy.ts` | Cached proxy for npm registry search (`keywords:pi-package`) + README/meta fetch. → see `npm-search-proxy.ts.AGENTS.md` |
| `oauth-callback-server.ts` | Temporary HTTP callback server for OAuth auth-code flows. → see `oauth-callback-server.ts.AGENTS.md` |
| `openspec-archive.ts` | Scans `openspec/changes/archive/` for dated entries. Exports `scanOpenSpecArchive(cwd)` returning… → see `openspec-archive.ts.AGENTS.md` |
| `openspec-change-watcher.ts` | Per-cwd recursive `fs.watch` on `<cwd>/openspec/changes/`. → see `openspec-change-watcher.ts.AGENTS.md` |
| `openspec-group-store.ts` | OpenSpec group store. Persists groups + assignments + `changeOrder: Record<groupId, changeName[]>` in… → see `openspec-group-store.ts.AGENTS.md` |
| `openspec-poll-fs-helpers.ts` | Pure FS helpers extracted from `directory-service.ts` so worker imports without pulling SessionManager /… → see `openspec-poll-fs-helpers.ts.AGENTS.md` |
| `openspec-poll-worker-pool.ts` | `createOpenSpecPollWorkerPool({size?, timeoutMs=10_000, useWorker=true, workerUrlOverride?})`. → see `openspec-poll-worker-pool.ts.AGENTS.md` |
| `openspec-poll-worker.ts` | Pure `deriveAndSerialize(req): {cwd, data, serialized, stampMtimes, racyNames}` + `parentPort` bootstrap. → see `openspec-poll-worker.ts.AGENTS.md` |
| `openspec-tasks.ts` | Parser + writer for an OpenSpec change's `tasks.md`. Exports `OpenSpecTask`, `NotFoundError`,… → see `openspec-tasks.ts.AGENTS.md` |
| `package-manager-wrapper.ts` | Thin serialized adapter around pi's `DefaultPackageManager`. → see `package-manager-wrapper.ts.AGENTS.md` |
| `package-source-helpers.ts` | Pure helpers classifying pi package sources + computing dedup identities. → see `package-source-helpers.ts.AGENTS.md` |
| `paired-devices.ts` | Paired-devices registry (D5). `PairedDeviceRegistry(path?)` persists `~/.pi/dashboard/paired-devices.json`… → see `paired-devices.ts.AGENTS.md` |
| `pairing.ts` | QR/copy-string pairing manager (D6/D12). `PairingManager({registry,getFingerprint,getReachableUrls,now?})`:… → see `pairing.ts.AGENTS.md` |
| `pending-attach-registry.ts` | In-memory FIFO queue of pending `attachProposal` intents per cwd. → see `pending-attach-registry.ts.AGENTS.md` |
| `pending-automation-run-registry.ts` | FIFO-per-cwd registry of automation-run stamps {name,runId,visibility}. → see `pending-automation-run-registry.ts.AGENTS.md` |
| `pending-client-correlations.ts` | Maps server-minted `spawnToken` → client-minted `requestId`. → see `pending-client-correlations.ts.AGENTS.md` |
| `pending-fork-registry.ts` | Tracks pending fork operations keyed by `spawnToken` to place forked sessions after parent. → see `pending-fork-registry.ts.AGENTS.md` |
| `pending-initial-prompt-registry.ts` | In-memory FIFO queue of pending initial-prompt intents per cwd. → see `pending-initial-prompt-registry.ts.AGENTS.md` |
| `pending-goal-link-registry.ts` | In-memory FIFO queue of pending `goalId` link intents per cwd. → see `pending-goal-link-registry.ts.AGENTS.md` |
| `pending-load-manager.ts` | Tracks in-flight on-demand session-load requests from bridge extensions. → see `pending-load-manager.ts.AGENTS.md` |
| `pending-resume-intent-registry.ts` | In-memory tracker tagging user-initiated session-resume intents as `ResumeIntent` `"front"` | `"keep"`. → see `pending-resume-intent-registry.ts.AGENTS.md` |
| `pending-resume-registry.ts` | Tracks pending auto-resume operations: prompts queued for ended sessions being resumed. → see `pending-resume-registry.ts.AGENTS.md` |
| `pending-worktree-base-registry.ts` | In-memory FIFO queue of pending `gitWorktreeBase` intents per cwd. → see `pending-worktree-base-registry.ts.AGENTS.md` |
| `pi-core-checker.ts` | Discovers installed pi-ecosystem CORE packages (global `npm list -g` + `~/.pi-dashboard/node_modules`… → see `pi-core-checker.ts.AGENTS.md` |
| `pi-core-updater.ts` | Runs `npm install -g <pkg>@latest` (global) or `npm install <pkg>@latest` in `~/.pi-dashboard/` (managed) for… → see `pi-core-updater.ts.AGENTS.md` |
| `pi-dev-version-check.ts` | pi.dev version-check client. Queries `https://pi.dev/api/latest-version`; returns `{version, packageName?}`… → see `pi-dev-version-check.ts.AGENTS.md` |
| `pi-gateway.ts` | WebSocket server for bridge extension connections. Routes `ExtensionToServerMessage` → `SessionManager`;… → see `pi-gateway.ts.AGENTS.md` |
| `pi-resource-activation.ts` | Activation-state bridge to pi's own resolver. Loads pi via ToolRegistry; `resolveActivation(cwd, agentDir)`… → see `pi-resource-activation.ts.AGENTS.md` |
| `pi-resource-scanner.ts` | Discovers extensions, skills, prompts, agents from local `.pi/`, global `~/.pi/agent/`, and installed… → see `pi-resource-scanner.ts.AGENTS.md` |
| `pi-version-skew.ts` | Pi compatibility range reader. `readPiCompatibility` reads `piCompatibility` from… → see `pi-version-skew.ts.AGENTS.md` |
| `plugin-intent-cache.ts` | Server-side cache of most recent plugin intent per `(pluginId, sessionId, slot)`. → see `plugin-intent-cache.ts.AGENTS.md` |
| `preferences-store.ts` | Global UI preferences store — JSON-backed with debounced writes. → see `preferences-store.ts.AGENTS.md` |
| `process-classifier.ts` | Pure process classifier. Enriches scanned `process_list` entries with `kind`, `label`, `sessionRef` by… → see `process-classifier.ts.AGENTS.md` |
| `process-manager.ts` | Spawns/kills pi sessions. Exports `spawnPiSession`, `buildSpawnEnv`, `buildHeadlessArgs`,… → see `process-manager.ts.AGENTS.md` |
| `proposal-attach-naming.ts` | Pure helpers for idempotent attach/detach auto-rename rule. → see `proposal-attach-naming.ts.AGENTS.md` |
| `provider-auth-handlers.ts` | OAuth provider handlers for browser-based provider auth. Exports `AuthCodeHandler`, `DeviceCodeHandler`,… → see `provider-auth-handlers.ts.AGENTS.md` |
| `provider-auth-storage.ts` | Reads/writes `~/.pi/agent/auth.json` for pi provider credentials via `proper-lockfile` + atomic write. → see `provider-auth-storage.ts.AGENTS.md` |
| `provider-catalogue-cache.ts` | In-memory cache of most-recently-pushed provider catalogue (`providers_list` over WS). → see `provider-catalogue-cache.ts.AGENTS.md` |
| `provider-probe.ts` | Provider probe — pings custom LLM provider base URL + API key to verify reachability/auth. → see `provider-probe.ts.AGENTS.md` |
| `reattach-placement.ts` | Reattach placement policy: decides how a re-registered session id (`registerReason: "reattach"`, dashboard… → see `reattach-placement.ts.AGENTS.md` |
| `reconcile-session-order.ts` | Pure startup reconciliation of persisted `sessionOrder` map under all-status model. → see `reconcile-session-order.ts.AGENTS.md` |
| `recovery-server.ts` | Pure `node:http` recovery server. `startRecoveryServer({port, error})` spawned by `cli.ts` `runForeground`… → see `recovery-server.ts.AGENTS.md` |
| `replay-truncate.ts` | truncateToolResultForReplay(event). Strategy B reconciled onto adopt-pi-071-072-073-features. → see `replay-truncate.ts.AGENTS.md` |
| `resolve-order-key.ts` | Resolves `sessionOrder` map key for a session server-side. → see `resolve-order-key.ts.AGENTS.md` |
| `resolve-path.ts` | Exports `safeRealpathSync(p)` — `fs.realpathSync` with original-path fallback on error. |
| `resource-activation-toggle.ts` | Replays pi's `config-selector` enable/disable write via pi's `SettingsManager` (zero glob logic… → see `resource-activation-toggle.ts.AGENTS.md` |
| `restart-helper.ts` | Cross-platform restart orchestrator for POST /api/restart. → see `restart-helper.ts.AGENTS.md` |
| `ripgrep-detection.ts` | One-time `rg` detection via ToolResolver. `detectRipgrep`/`resetRipgrepCache`. See change: split-editor-workspace. |
| `server-pid.ts` | PID file management at `~/.pi/dashboard/server.pid`. Exports `writePid`, `readPid`, `removePid`,… → see `server-pid.ts.AGENTS.md` |
| `server.ts` | Dashboard HTTP + WebSocket server. Exports `ServerConfig`, `DashboardServer`, `createServer(config)`. → see `server.ts.AGENTS.md` |
| `session-api.ts` | REST wrappers for session control. Exports `registerSessionApi(fastify, deps)`. → see `session-api.ts.AGENTS.md` |
| `session-bootstrap.ts` | Exports `discoverAndBroadcastSessions(deps)` — async startup discovery from known directories, restores… → see `session-bootstrap.ts.AGENTS.md` |
| `session-diff.ts` | `extractFileChanges(events, cwd)` scans `tool_execution_start` write/edit events, groups by path, attaches… → see `session-diff.ts.AGENTS.md` |
| `session-discovery.ts` | Standalone per-cwd session discovery from `~/.pi/agent/sessions/<encoded-cwd>/`. → see `session-discovery.ts.AGENTS.md` |
| `session-file-reader.ts` | Standalone JSONL session reader. Exports `SessionEntry`, `loadSessionEntries(filePath)` (leaf→root branch… → see `session-file-reader.ts.AGENTS.md` |
| `session-load-worker-pool.ts` | Session-load worker pool. Fixed slots = `max(1, min(maxConcurrentSpawns, os.cpus().length))`; FIFO queue when… → see `session-load-worker-pool.ts.AGENTS.md` |
| `session-load-worker.ts` | Pure `loadAndReplay(req): {jobId, success, events, error, entryCount?}` + `parentPort` bootstrap. → see `session-load-worker.ts.AGENTS.md` |
| `session-order-manager.ts` | Per-cwd session ordering persisted via `PreferencesStore`. → see `session-order-manager.ts.AGENTS.md` |
| `session-scanner.ts` | Cold-start session scanner. Exports `ScanResult`, `scanAllSessions(sessionsDir)` — scans… → see `session-scanner.ts.AGENTS.md` |
| `session-to-meta.ts` | Exports `sessionToMeta(session)` — the EXPLICIT `.meta.json` field enumeration extracted from `server.ts`… → see `session-to-meta.ts.AGENTS.md` |
| `session-stats-reader.ts` | Exports `SessionStats`, `extractSessionStats(filePath)` — reads session JSONL once, accumulates tokensIn/Out,… → see `session-stats-reader.ts.AGENTS.md` |
| `spawn-failure-log.ts` | Appends/reads rolling NDJSON log of failed spawns (`~/.pi/dashboard/sessions/spawn-failures.log`). Single-shot rotation at 10 MB. See change: spawn-failure-diagnostics. |
| `spawned-turn-log.ts` | Build redacted `server.log` lines for spawned-session turn outcomes. → see `spawned-turn-log.ts.AGENTS.md` |
| `spawn-preflight.ts` | Pure sync preflight: checks cwd exists/is-dir/writable + pi+node resolvable. → see `spawn-preflight.ts.AGENTS.md` |
| `spawn-register-watchdog.ts` | Arms per-spawn timer; fires `spawn_register_timeout` if pi never registers. byPid + byCwd maps. recentlyFired (60s TTL) emits `spawn_register_recovered`. See change: spawn-failure-diagnostics. |
| `spawn-token.ts` | Spawn correlation token. Exports `mintSpawnToken()` (UUIDv4), `SPAWN_TOKEN_ENV_VAR =… → see `spawn-token.ts.AGENTS.md` |
| `terminal-gateway.ts` | WebSocket upgrade handler for `/ws/terminal/:id`. Exports `TerminalGateway` interface,… → see `terminal-gateway.ts.AGENTS.md` |
| `terminal-manager.ts` | Server-side PTY terminal manager. Exports `RingBuffer`, `detectShell`, `TerminalManager` interface,… → see `terminal-manager.ts.AGENTS.md` |
| `test-env-guard.ts` | Exports `isUnsafeTestHomeScan()` — defense-in-depth against destructive PID-registry sweeps during vitest… → see `test-env-guard.ts.AGENTS.md` |
| `tunnel-watchdog.ts` | Tunnel watchdog. Probes `${publicUrl}/api/health` on `intervalMs` (default 60000); 5xx/network/timeout count… → see `tunnel-watchdog.ts.AGENTS.md` |
| `tunnel-block-events.ts` | `BlockEventBuffer` (+ `blockEvents` singleton) — bounded, anti-poisoning ring buffer of network-guard… → see `tunnel-block-events.ts.AGENTS.md` |
| `tunnel-endpoints.ts` | "Accessible at" enumeration — `collectEndpoints` merges provider endpoints + manual `pairing.publicBaseUrls`… → see `tunnel-endpoints.ts.AGENTS.md` |
| `tunnel-enroll.ts` | Whitelisted `(provider,step)` enroll executor — `runEnrollStep`, `ENROLL_STEPS`, `isEnrollStepWhitelisted`. → see `tunnel-enroll.ts.AGENTS.md` |
| `tunnel-core.ts` | Provider-neutral child-tunnel lifecycle. Exports `ChildTunnelRuntime` (PID helpers,… → see `tunnel-core.ts.AGENTS.md` |
| `tunnel.ts` | Tunnel ("Gateway") integration — thin delegation layer over `tunnel-core.ts` + `tunnel-providers/zrok.ts`… → see `tunnel.ts.AGENTS.md` |
| `view-message-store.ts` | `ViewMessageStore` class. Per-session JSON store at `~/.pi/dashboard/view-messages/<sid>.json`. → see `view-message-store.ts.AGENTS.md` |
| `ws-ticket.ts` | Single-use WS upgrade tickets (D11/F4/F6). `WsTicketStore(now?)`: `mint(scope)` high-entropy in-memory ticket… → see `ws-ticket.ts.AGENTS.md` |
| `viewed-session-tracker.ts` | Exports `ViewedSessionTracker` interface, `createViewedSessionTracker()` — per-session set of viewing… → see `viewed-session-tracker.ts.AGENTS.md` |
| `worktree-init-errors.ts` | Pure `mapInitStderrToHint(stderr)`. Ordered regex table. Codes: EACCES, EBADENGINE/Unsupported engine,… → see `worktree-init-errors.ts.AGENTS.md` |
| `worktree-init-registry.ts` | `createWorktreeInitRegistry({ttlMs?,terminalTtlMs?,sendTo?})`. → see `worktree-init-registry.ts.AGENTS.md` |
| `worktree-init-trust.ts` | TOFU trust store. `isTrusted(repoRoot,hash)`/`recordTrust(repoRoot,hash)` keyed by `repoRoot +… → see `worktree-init-trust.ts.AGENTS.md` |
| `worktree-init.ts` | Worktree-init hook engine. `readInitHook(repoRoot)` parses `.pi/settings.json#worktreeInit` →… → see `worktree-init.ts.AGENTS.md` |
