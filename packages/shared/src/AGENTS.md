# DOX — packages/shared/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `__tests__/client-build-deps-runtime.test.ts` | Repo-lint (#E6): client `package.json` declares `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`,… → see `__tests__/client-build-deps-runtime.test.ts.AGENTS.md` |
| `__tests__/nightly-workflow-contract.test.ts` | Repo-lint safety contract for the nightly (change: add-nightly-verdaccio-build). → see `__tests__/nightly-workflow-contract.test.ts.AGENTS.md` |
| `__tests__/node-cap-single-source.test.ts` | Repo-lint (#E5): engines-cap arithmetic lives only in `node-version.ts`. → see `__tests__/node-cap-single-source.test.ts.AGENTS.md` |
| `__tests__/smoke-node-matrix.test.ts` | Repo-lint (#E8): `_smoke.yml` `standalone-install-smoke-linux` matrix majors equal the SUPPORTED set… → see `__tests__/smoke-node-matrix.test.ts.AGENTS.md` |
| `archive-types.ts` | `ArchiveEntry` interface — OpenSpec archive dir row (name, date, done artifacts). Shared server↔client. |
| `boot-state.ts` | Exit-intent vocabulary for the server boot record. Exports `ExitIntent`… → see `boot-state.ts.AGENTS.md` |
| `bridge-register.ts` | Shared bridge registration: `findBundledExtension(baseDir)` + `registerBridgeExtension(path)`; non-destructive cleanup, AppImage guard. Used by server startup and Electron wizard. |
| `browser-protocol.ts` | Server↔Browser WebSocket message contracts. Exports `ServerToBrowserMessage` + `BrowserToServerMessage` unions… → see `browser-protocol.ts.AGENTS.md` |
| `changelog-types.ts` | `ChangelogBullet` / `Release` / `Response` types for parsed CHANGELOG.md responses. See change: pi-update-whats-new-panel. |
| `config.ts` | Dashboard config loader. `loadConfig()` reads `~/.pi/dashboard/config.json` via `CONFIG_FILE`;… → see `config.ts.AGENTS.md` |
| `credential-detect.ts` | Detects configured LLM-provider credential. `hasAnyProviderCredential(homeDir?)` OR-merges… → see `credential-detect.ts.AGENTS.md` |
| `dashboard-paths.ts` | Single-source path helpers for dashboard runtime dirs. `getDashboardConfigDir` → `~/.pi/dashboard/`. → see `dashboard-paths.ts.AGENTS.md` |
| `dashboard-starter.ts` | Identifies dashboard launcher. `DashboardStarter` = `Bridge` | `Standalone` | `Electron`. → see `dashboard-starter.ts.AGENTS.md` |
| `diff-types.ts` | Session file-diff API types. `EditOperation`, `FileChangeEvent`, `FileDiffEntry`, `SessionDiffResponse`… → see `diff-types.ts.AGENTS.md` |
| `display-prefs.ts` | `DisplayPrefs` interface gates chat-view chrome (thinking, tool calls per kind, turn separators, debug tools,… → see `display-prefs.ts.AGENTS.md` |
| `doctor-core.ts` | Pure detection core. Types `DoctorCheck` / `DoctorReport` / `DoctorSection` (6:… → see `doctor-core.ts.AGENTS.md` |
| `live-server.ts` | Pure browser-safe live-server SSRF boundary. `validateLiveTarget({host,port,label})` — loopback-only… → see `live-server.ts.AGENTS.md` |
| `file-kind.ts` | Pure browser-safe viewer classifier. `fileKind(absPath, sniff?)` → `{ kind, mimeType, viewer, editable }`. → see `file-kind.ts.AGENTS.md` |
| `git-worktree-helpers.ts` | Pure worktree helpers shared by server + client. `slugifyBranch(branch)` → fs-safe slug; `localNameOf(ref)`… → see `git-worktree-helpers.ts.AGENTS.md` |
| `index.ts` | Barrel re-exports for cumbersome symbols. Re-exports `doctor-core.js`, `node-version.js`, `ViewTarget` type,… → see `index.ts.AGENTS.md` |
| `launch-source-types.ts` | `LaunchSource` discriminated union for Electron server layout. `SourceKind` = `attach` | `bundled` | `devMonorepo`; variants carry url/starter or cliPath/cwd. Replaces pre-R3 layouts. |
| `legacy-managed-dir.ts` | `detectLegacyManagedDir({ homedir? })`. Returns `{present:false}` or `{present:true, path, pkgCount,… → see `legacy-managed-dir.ts.AGENTS.md` |
| `managed-paths.ts` | Single source of truth for managed install dir `~/.pi-dashboard/`. → see `managed-paths.ts.AGENTS.md` |
| `model-id.ts` | First-slash model-id parser. `parseModelId(label)` → `{provider, modelId}`: provider = before first `/`,… → see `model-id.ts.AGENTS.md` |
| `mdns-discovery.ts` | mDNS `_pi-dashboard._tcp` advertise + discover. `advertiseDashboard(port, piPort)`, `stopAdvertising()`,… → see `mdns-discovery.ts.AGENTS.md` |
| `models-json-reader.ts` | ONE shared pure reader for user-authored `~/.pi/agent/models.json`, consumed by BOTH registry paths… → see `models-json-reader.ts.AGENTS.md` |
| `node-version.ts` | Single source of truth for Node-version predicates. `isAffectedNode(version)` flags nodejs/node#58515… → see `node-version.ts.AGENTS.md` |
| `notify.ts` | `normalizeNotifyLevel(level)` — maps an unrecognized notify level to `"info"`. → see `notify.ts.AGENTS.md` |
| `openspec-activity-detector.ts` | Detects OpenSpec activity from tool-execution events. `detectOpenSpecActivity(toolName, args)` returns `{… → see `openspec-activity-detector.ts.AGENTS.md` |
| `openspec-design-evidence.ts` | Local-evidence override for OpenSpec `design` artifact. `evaluateLocalDesignSatisfaction(changeDir, probe)`… → see `openspec-design-evidence.ts.AGENTS.md` |
| `openspec-poller.ts` | Aggregates `openspec list`+`status` into `OpenSpecData`. `pollOpenSpec(cwd)` sync (bridge),… → see `openspec-poller.ts.AGENTS.md` |
| `openspec-specs-evidence.ts` | Local-evidence override for OpenSpec `specs` artifact. `evaluateLocalSpecsSatisfaction(changeDir, probe)` =… → see `openspec-specs-evidence.ts.AGENTS.md` |
| `pi-package-resolver.ts` | Walks `~/.pi/agent/settings.json#packages[]` + per-workspace `<cwd>/.pi/settings.json`. → see `pi-package-resolver.ts.AGENTS.md` |
| `plugin-bridge-register.ts` | Dual-write contract. `registerPluginBridge` writes BOTH `dashboardPluginBridges["dashboard-<id>"]` AND… → see `plugin-bridge-register.ts.AGENTS.md` |
| `protocol.ts` | Extension↔Server WebSocket protocol. `ExtensionToServerMessage` + `ServerToExtensionMessage` unions. → see `protocol.ts.AGENTS.md` |
| `recovery-timing.ts` | The two cold-start recovery windows in one module so their relation is testable. → see `recovery-timing.ts.AGENTS.md` |
| `recommended-extensions.ts` | Curated manifest of recommended pi extensions. `RecommendedExtension` (id, source, displayName, status,… → see `recommended-extensions.ts.AGENTS.md` |
| `rest-api.ts` | REST endpoint request/response types. Sessions, events, spawn, file read/write (`FileWriteRequest` mtime… → see `rest-api.ts.AGENTS.md` |
| `role-name-validation.ts` | Shared role-name trust boundary. `isValidRoleName(name, existing) → {ok, reason?}`: non-empty after trim;… → see `role-name-validation.ts.AGENTS.md` |
| `semaphore.ts` | Tiny FIFO throttling semaphore. `createSemaphore(max)` → `Semaphore` with `run(fn)` (queue when at cap,… → see `semaphore.ts.AGENTS.md` |
| `server-identity.ts` | Identity-verified dashboard detection over GET /api/health. → see `server-identity.ts.AGENTS.md` |
| `server-launcher.ts` | `launchDashboardServer` — single shared spawn primitive (jiti loader, argv, env, log header, readiness) used by Bridge / Standalone / Electron starters |
| `session-group-path.ts` | Hoisted `inferPlatform`/`pathKey`/`resolveSessionGroupPath` from client session-grouping.ts. → see `session-group-path.ts.AGENTS.md` |
| `session-meta.ts` | Per-session sidecar `.meta.json` schema + IO. Exports `SessionMeta`, `metaPath`, `readSessionMeta`,… → see `session-meta.ts.AGENTS.md` |
| `skill-block-parser.ts` | Single source of truth for pi's `<skill name location>…</skill>` envelope. → see `skill-block-parser.ts.AGENTS.md` |
| `source-matching.ts` | `sourcesMatch` cross-kind matcher. Adds `npm ↔ raw` branch: npm-declared package installed from local path… → see `source-matching.ts.AGENTS.md` |
| `state-replay.ts` | Synthesizes dashboard `event_forward` messages from persisted pi session entries for post-reconnect chat… → see `state-replay.ts.AGENTS.md` |
| `stats-extractor.ts` | Extracts `StatsData` (tokensIn/out, cost, turnUsage, optional contextUsage) from a `turn_end` event's… → see `stats-extractor.ts.AGENTS.md` |
| `tunnel-provider.ts` | Tunnel ("Gateway") provider abstraction types. Exports `TunnelProvider` interface (`id`, `kind`… → see `tunnel-provider.ts.AGENTS.md` |
| `terminal-types.ts` | Terminal emulator shared types. Exports `TerminalSession` (id, cwd, shell, status, title, `ephemeral` flag for inline cards) and `TerminalControlMessage` (resize | title) control frame union. |
| `types.ts` | Core dashboard shared type surface. Exports `DashboardSession`, `DashboardEvent`, `FlowInfo`, `CommandInfo`,… → see `types.ts.AGENTS.md` |
| `zrok-env.ts` | Pure `readZrokEnvironment({homedir,fs})` returning `{found, kind: v2\|v1\|null, path, env, reason}`. → see `zrok-env.ts.AGENTS.md` |
