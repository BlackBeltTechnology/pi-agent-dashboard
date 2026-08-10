# architecture.md — index

Pull-only condensed map. Source: docs/architecture.md.

## Overview
Web dashboard monitors + interacts with pi sessions. Three components + shared types.

## Components
- Bridge Extension (`src/extension/`) — global pi extension, every session. Detects source (TUI/Zed/tmux/dashboard) via `.meta.json` + env. Forwards events.
- Dashboard Server (`src/server/`) — Node HTTP+WS. Pi Gateway port 9999, browser gateway. In-memory + JSON persistence.
- Web Client (`src/client/`) — React responsive. Sessions grouped by directory, pinned dirs top.
- Shared Types (`src/shared/`) — `protocol.ts` (ext↔server), `browser-protocol.ts`, `types.ts`.

## Data Flow
- Event Flow (pi→browser) — pi event → bridge `event_forward` → server buffer → broadcast → React.
- Interactive UI Flow (PromptBus) — `ctx.ui.confirm/select/input/editor/multiselect` → bridge PromptBus `PromptRequest{promptId,pipeline}` → browser → response.
- Command Flow (browser→pi) — user prompt/command → `send_prompt` WS → bridge → pi.
- Flow Dashboard Data Flow (pi-flows→browser) — subagents use `SessionManager.inMemory()`, no bridge. `EventEmitObserver` emits `flow:*` (10 `FlowObserver` callbacks).
- Extension UI System (Phases 1+2 shipped) — extensions declare UIs as data, no React/SDK. Phase1 `management-modal`, Phase2 decorators. Pull-based synchronous probe.
- Plugin Architecture (`add-dashboard-shell-slots-runtime`) — two-tier render model, one slot contract. First-party features as plugins.
  - Health endpoint observability — `/api/health` adds `eventLoopDelay{meanMs,p99Ms,maxMs}` via `perf_hooks`. See change: instrument-session-h*.
  - JSX slot wrappers + `??` fallback — anti-pattern. Slot components return null; must not sit in `??` chain (unreachable siblings).
  - Plugin Bridge Registration — dual-write `~/.pi/agent/settings.json`: `dashboardPluginBridges["dashboard-<id>"]` (legacy) + packages[].
  - Plugin Staleness Detection — build-time `PLUGIN_REGISTRY_HASH` sha256 into `generated/plugin-registry.tsx`. No new route/WS.
  - Plugin Activation UI — Settings▸Plugins toggle. `POST /api/plugins/:id/toggle` (`plugin-activation-routes.ts`).
  - Plugin bridge↔server channel (generic) — `dashboard:enqueue-followup`, `enqueueSystemFollowup`. goal-plugin first consumer.
  - Goal Session Supervisor (`add-goal-session-supervisor`) — `packages/server/src/goal-supervisor.ts`. Host owns spawn mechanism; supervisor rides death detection.
- Automation Plugin (`add-automation-plugin`) — `packages/automation-plugin/`. Schedule-triggered runs. `<scope>/.pi/automation/<name>/automation.yaml`.
- Bootstrap & First Run (R3, immutable bundle) — pi/openspec/tsx = regular npm deps of `pi-dashboard-server`. No runtime install. Electron reads `<resourcesPath>/server/node_modules/`.
  - Legacy `~/.pi-dashboard/` advisory — pre-R3 runtime install dir left untouched. `detectLegacyManagedDir`. See change: eliminate-electron-runtime-install.
- Force Kill Escalation — Stop button 2-click. Click1 abort→`ctx.abort()`; Click2 force stop.
- Platform-routed kill paths — all kills via `packages/shared/src/platform/process.ts`. No direct `process.kill` elsewhere.
- Repeated Tool Call Collapsing — consecutive same-name+args tool calls collapse to one expandable group.
- Local-image inlining + LaTeX math — bridge inlines `![alt](/abs.png)` local images; LaTeX rendered in chat.
- Edit Tool Diff Rendering — `ToolCallStep` gates renderer with `{expanded && <Renderer/>}`. Desktop `RichDiff`, mobile simpler.
- `/reload` Flow (two code paths) — reload via `npm run reload`/button/`/reload` chat. Path depends on connection.
- Server Restart (single-orchestrator path) — `fix-restart-bridge-auto-start-race` collapses 3 paths (CLI, `POST /api/restart`, bridge auto-start) into one orchestrator.
- Async action feedback — `useAsyncAction(fn,opts)` `{pending,error,run,bind}`. Bridges click→WS-broadcast gap.
- State & feedback primitives (client-utils) — 4 primitives `packages/client-utils/src/`. EmptyState/Skeleton/spinner decision rule.
- Auto-Resume on Prompt — `send_prompt` to `status==="ended"` session with valid `sessionFile` → auto-resume.
- Sidebar session ordering: top-of-tier on status change — one persisted `sessionOrder` per group path. Client partitions ACTIVE→ENDED→HIDDEN.
- Shell overlay routing — shell content overlays via wouter routes. Supersedes priority-chain from `fix-desktop-back-navigation`.
- Model & Thinking Level Flow — bridge sends model+thinking in `session_register`; `/model` → `model_select` event.
- Context Usage Tracking — on `turn_end` bridge calls `ctx.getContextUsage()`, enriches event with `contextUsage`.
- VCS Polling (Git) — bridge polls every 30s (`vcs-info.ts`): branch/remote/PR. `git_info_update` only on change.
- Working-tree status + commit from card — same 30s tick, `gatherGitStatus` `git status --porcelain=v2 --branch`, deduped `lastGitStatusJson`.
- Git Polling (legacy entry) — see VCS Polling.
- Git worktree convention (`.worktrees/`) — new path `<repoRoot>/.worktrees/<slugifyBranch(branch)>` when body omits path.
- Git worktree lifecycle — 5 endpoints `/api/git/worktree/*`: remove/merge/push/pr/diff-stat. Localhost-gated. `/remove` checks `activeSessionsUnder`.
- Child Process Scanning — bridge scans every 10s (`process-scanner.ts`), two-phase PGID capture. Reports procs ≥30s.
- OpenSpec Polling (Server-Side) — master gate `DashboardConfig.openspec.enabled` (default true).
  - OpenSpec polling cost model — naive fan-out explodes (67 spawns). Scheduler `directory-service.ts` applies 4 throttle layers.
- OpenSpec board — route `/folder/:encodedCwd/openspec` (`OpenSpecBoardView`). Groups=columns, draggable cards (@dnd-kit).
- OpenSpec session card UI — attached-change row: State pill (`StatePill.tsx` `deriveChangeState`), etc.
- File Read API — `GET /api/file?cwd=&path=`. Localhost-only.
- Filesystem Browser (PathPicker) — 3 localhost endpoints. `GET /api/browse?path=&q=&detect=`.
- Pi Resources Browser — `pi-resource-scanner.ts` scans local `<cwd>/.pi/extensions|skills|prompts` + global.
- Settings → Packages tab — single `<UnifiedPackagesSection>`. Core→Recommended→Other.
- Git Branch Selector — folder-group `BranchPicker` typeahead. No repo → "Init git" `POST /api/git/init`.
- Session File Diff View — GitHub-style. `GET /api/session-diff?sessionId=` scans Write/Edit tool calls.
- Internal Monaco editor pane (v1 read-only) — route `/session/:id/editor?file=&line=` `EditorPane`. Tabs/tree in localStorage.
- Split editor workspace — `SplitWorkspaceProvider`. `openInSplit` file-open helper.
- Directory Settings + scoped markdown editing — first WRITE surface. FolderActionBar cog → `/folder/:cwd/settings/:page?`.
- Markdown Preview View — `MarkdownPreviewView` replaces chat area, back button + tabs.
- Archive Browser — `ArchiveBrowserView` date-grouped. `GET /api/openspec-archive?cwd=`.
- Content View Management — right panel one view: ChatView/ArchiveBrowser/SpecsBrowser/PiResources/MarkdownPreview. Route-match mutual exclusion.
- Network Access Control — two-layer. Layer1 Network Guard (`createNetworkGuard`) Fastify preHandler on sensitive routes.
- OAuth Authentication Flow — optional OAuth2. Loads `auth` config from `~/.pi/dashboard/config.json`.
- Server-Keypair Device Pairing — 2nd auth path. QR/copy-string, long-lived bearer. Change: `add-server-keypair-pairing`.
  - Topology 3 — neutral static PWA shell at `pi-dashboard.dev/app/`. GitHub Pages subpath.
  - Server identity — Model 1, TOFU pinning. Ed25519 keypair `~/.pi/dashboard/identity.key` (0600). Fingerprint `sha256:<base64url>`.
  - QR / copy-string pairing — Pairing QR `{v,id,code,urls[]}` one-time ~60s code, TLS-only URLs. Link QR for no-TLS.
  - Compare-code approval — D12.
  - Bearer device auth — D5/D7. Registry `~/.pi/dashboard/paired-devices.json` (0600), SHA-256 hash only. Revoke=row delete.
  - WS single-use ticket — D11/F4/F6. `POST /api/ws-ticket {scope}` mints ~15s ticket.
  - Genuine-local trust — D10. `isGenuinelyLocal(ip,headers)` loopback AND no proxy header.
  - CORS default — `https://pi-dashboard.dev` + `*.share.zrok.io`. `cors.allowedOrigins`.
  - Versioned protocol — D9. `PAIRING_PROTOCOL_VERSION`, `SUPPORTED_PAIRING_VERSIONS`.
  - Operator pairing view (client) — `PairingView.tsx`. Settings→Security. `GET /api/pair/payload`. `qrcode` dep.
- Settings Panel — gear icon → `/settings`. `GET /api/config` (secrets `***`).
- Reconnection Flow — browser reconnect `subscribe{lastSeq}`. Server replays missed events, batches of 50 backpressure.
- Bridge Reconnection (State Reset) — `session_register` with `eventCount` re-registers.
- Session File Deduplication — pi `--session <file>` reuses JSONL, new session ID; server detects.
- Ghost Session Cleanup — duplicate bridge loads → ghost sessions cleaned on session-id change if `source:unknown`.
- On-Demand Session Loading — evicted events: server sends empty `event_replay isLast:false` loading indicator.
- Flows Refresh Deduplication — `flows_list` notifies same-cwd sessions; loop prevention.
- Event Broadcast During Replay — during replay, `event_forward` stored not broadcast individually.
- Per-message entry id stamping — Fork button needs entry id. Replay path reads JSONL (`state-replay.ts`).

## Persistence
In-memory + JSON files under `~/.pi/dashboard/`.

## Configuration
Precedence: CLI flags → env vars → config file (`~/.pi/dashboard/config.json`).
- Tunnel Lifecycle — UI label "Gateway"; internal id `tunnel` (`config.tunnel`, `/api/tunnel-status`, `createTunnel()`).
  - Provider abstraction — `TunnelProvider` (`tunnel-provider.ts`). 4 providers. `tunnel.provider`+`tunnel.mode`.
  - Child lifecycle (zrok, ngrok) — server owns child, PID + watchdog, URL from stdout.
  - Daemon lifecycle (tailscale, zerotier) — idempotent control vs `tailscaled`/`zerotier-one`. No PID/watchdog.
  - Server-side enroll — `POST /api/tunnel/enroll` whitelisted recipe keyed `(provider,step)`. token/networkId strict regex.
  - Endpoints — `GET /api/tunnel/endpoints` tagged `{kind,url,tls}` kind∈public/mesh/magicdns/lan/local. Manual HTTPS → `pairing.publicBaseUrls`.
  - Trusted-network block events — `GET /api/tunnel/block-events` ring buffer of guard denials (socket-peer IP only).
  - Docker — host-first; daemons in-container = follow-up. zrok in image.
  - Client modules — `lib/gateway-{api,config-ops,endpoints,providers,setup}.ts`, `components/Gateway/*`.
  - zrok child steps — `detectZrokBinary()` PATH check via which/where, then share.
- Tunnel watchdog — long-lived `zrok share` goes stale; probe `GET ${publicUrl}/api/health` real edge round-trip.
- CORS — Fastify callback allows same-origin (no Origin), etc.
- HTTP Compression — `@fastify/compress` gzip+deflate threshold 1KB. No Brotli. Client `.gz` siblings via `precompress.mjs`.
- PWA Support — installable. Manifest `public/manifest.json`.
- Tool-Output File Linkification — `linkify-tool-output.ts::tokenize`. Click via `useFileOpenRouting`.
- External Link Routing (#13) — three shells (browser/PWA-standalone/Electron). `MarkdownContent.tsx` overrides `a`, `isExternalHref`.

## Shared Config
Server CLI + bridge read `~/.pi/dashboard/config.json` via `src/shared/config.ts`.
- Dev Mode with Production Fallback — `--dev` proxies Vite HMR; falls back to `dist/client/`. Always works, no 502.
- Graceful Restart — `POST /api/restart` + `pi-dashboard restart`. Flush state, restart, verify health.
- Cross-Platform Server Launch — `node --import <loader> <cli.ts>` from 4 call sites. `file://` URL wrapping.
  - stdout + stderr capture parity — both call sites capture both streams into log.
  - CJS preload for Fastify (nodejs/node#58515) — inject `--require preload-fastify.cjs` before `--import jiti`.
  - Node-version preflight — `node-version-check.ts::isKnownBadNode(version)`. CLI warns, proceeds.
  - AppImage CLI self-recursion guard — power-user launch prefers installed `pi-dashboard` on PATH; guards recursion.
- Cross-OS Platform Primitives — `packages/shared/src/platform/` win32 branches. Optional `platform` param injection.
- Windows runtime dependencies (git + bash) — Windows needs `git.exe` + POSIX shell. Installers embed dugite-native (git 2.53.0 + bash). `windowsGitSource` auto/host/bundled.
- Session spawn dispatch — two-tier: `SpawnStrategy` ("tmux"|"headless") user-visible.
- RPC keeper sidecar — `add-rpc-stdin-dispatch-with-keeper-sidecar`, default via `enable-rpc-keeper-by-default`. Per-session keeper owns pi stdin, UDS/named-pipe.
- Server Log Hygiene — `~/.pi/dashboard/server.log` append mode; crash output survives retries.
- Auto-Start Flow — `autoStart:true` (default): bridge auto-starts server on session_start.

## mDNS Server Discovery
`bonjour-service`, zero-config discovery.
- Discovery Chain — mDNS browse (2s) → health check `GET /api/health` `{ok,pid}`.
- Server Advertisement — publishes `_pi-dashboard._tcp` TXT `{version,pid,piPort}`; unpublish on shutdown.
- Bridge Discovery — bridge uses mDNS chain. `isDashboardRunning(port)` replaces `isPortOpen`.
- Known Servers — `knownServers: KnownServer[]` in config. `{host,port,label?,addedAt}`.
- Server Selector UI — header dropdown: known servers + localhost.
- Transactional Server Switching — `performServerSwitch` two-phase: stage 2nd WS (5s), verify, then swap.
- Connection Status Banner — `ConnectionStatusBanner.tsx` above `<MobileShell>`.
- Server Management (Settings) — Known Servers + Network Discovery (`POST /api/discover-servers`).

## Provider Authentication
Browser-based login to pi LLM providers; phones/tablets/tunnel.
- Flow — OAuth providers (Anthropic/Codex/GitHub Copilot/Gemini CLI/Antigravity) + API-key. Auth-code popup relays via postMessage.
- Model metadata enrichment — custom `/v1/models` advertise only `{id,owned_by}`; dashboard enriches.
- Testing a custom provider (Test button) — `POST /api/pr*` posts unsaved `{baseUrl,apiKey,api}`. Resolves `$ENV`/`***` server-side.
- Key Files — provider-auth-storage etc.

## Terminal Emulator
Browser terminal, direct shell.
- Architecture — browser↔server.
- WebSocket Protocol — `/ws/terminal/:id` binary frames raw I/O.
- Terminal Lifecycle — `create_terminal` → server spawns PTY (`node-pty`) → `terminal_added`.
- Package management (install/remove/update/move) — `package-manager-wrapper.ts` single-flight `busy` lock. Move semantics (`unify-package-management-ui`).
- Bundled first-party extensions (Electron installer) — `resources/bundled-extensions/<id>/`. Build gated `BUNDLE_RECOMMENDED_EXTENSIONS=1`.
- Output Buffering — 256KB ring buffer replayed on connect.
- Keep-Alive — xterm.js instances stay mounted (CSS hidden), WS open.
- Folder-Scoped View — tabbed `TerminalsView` per folder.

## Embedded Editor (code-server)
VS Code in browser.
- Architecture — browser↔dashboard↔code-server.
- Lifecycle — Editor button → `/folder/:encodedCwd/editor`, `POST /api/editor/start {cwd}`.
- Reverse Proxy — `/editor/:id/*` same-origin.
- Orphan Cleanup — in-memory; `editorManager.stopAll()` SIGTERM. `editor-pids.json` for crash recovery.
- Editor keeper sidecar — supersedes orphan-kill. code-server survives restart; `keeper.cjs` per-editor.
- Configuration — `editor` config block.
- Known Servers Configuration — `knownServers` config.

## Bundled Skill: pi-dashboard
`.pi/skills/pi-dashboard/` both local skill + npm-shipped.
- Session Control REST API — `src/server/session-api.ts` REST wrappers; same internal methods as WS handlers.
- Skill Contents — `SKILL.md` auto-discovers port; `references/api-reference.md`.

## Tool Resolution (`ToolRegistry`)
Every binary/module/dir via single `ToolRegistry` (`packages/shared/src/tool*`).
- Registered tools — pi/openspec/node/tsx/bridge/serverCli etc.
- Build-time consumers — shell-callable wrapper; CI/Dockerfiles cannot import TS.
- Resolution record — `registry.resolve(name)` → `Resolution{ok,...}`.
- Overrides — `~/.pi/dashboard/tool-overrides.json`.
- Caching — one Resolution per tool cached; loaded ES modules cached.
- REST API (`/api/tools`) — same network guard as `/api/config`.
- Settings UI — Settings→General→Tools: badge/source/path/override/rescan.
- Migration path — `ToolResolver.which()` low-level. See change: consolidate-tool-resolution.

## Path Handling (`platform/paths.ts`)
OS-aware paths: pin storage, session grouping, browse.
- Primitives — normalizePath etc.
- Platform injection pattern — optional trailing `platform` param defaults `process.platform`.
- Windows multi-drive invariants.
- Protocol extension — `BrowseResult.platform` field.
- Common gotcha: `Array.prototype.map(normalizePath)` — map passes index as 2nd arg. See change: platform-path-normalization.

## Cross-OS Build Orchestration
- Principle — cross-OS logic in `.mjs` invoked by node. bash gated by `if:`.
- Why — Git-for-Windows MSYS2 translates Win32 paths to POSIX for bash vars.
- Four-cell failure-mode matrix.
- Shell allowlist.
- Lock — `no-bash-on-windows.test.ts` parses workflows. See change: eliminate-bash-on-windows-runners.

## Electron Server Lifecycle
- Power-user-mode managed install (Defect 1 fix).
- LaunchSource V2 Resolution (Phase C default) — `selectLaunchSource()` (`launch-source.ts`) replaces `mode.json`. Walks 5 paths; attach=health 200 in 3s.
- Legacy first-launch flow (LAUNCH_SOURCE_V2=false) — escape-hatch, 3 branches.
- Server-startup deadline + cause-aware error (Defect 4) — `SERVER_READY_DEADLINE_MS=60_000`. `buildServerStartupError()`.
- Runtime jiti version contract (Defect 2) — `shouldUrlWrapEntry()` (`node-spawn.ts`) decides entry URL-wrap.

## Chat Input State (drafts & history recall)
- Per-session draft persistence — `CommandInput.tsx` controlled; `draft` prop from `App.tsx`. Hydrated from localStorage `chat-draft:`.
- History recall (ArrowUp/ArrowDown) — derived `extractUserPromptHistory(state.messages)` role==="user".

## Git is required
Electron treats git as hard runtime dep.
- Boot-time gate — `app.whenReady` first-run check.
- Platform install dispatch — `installTool(name,action,options)` (`system-toolchain-installer.ts`).
- Single-flight + cancellation — module `inFlight: Map<"git"|"node">`; 2nd kills 1st.
- Error formatting + fault tolerance (D8a) — tagged `InstallResult`, no raw stack.
- Persistent log — `~/.pi-dashboard/git-gate.log` (1MB rotation).
- Escape hatches — `--skip-git-gate` / `PI_DASHBOARD_SKIP_GIT_GATE=1`.

## Doctor Diagnostics
Single rich-output surface; 3 consumers wrap one core (`packages/electron/src/lib/doctor.ts`).
- Fault-tolerance contract — never crash. `safeCheck(name,section,fn)` per-check isolation.

## Model Proxy
`GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/messages`.
- API-key auth data flow — `Authorization: Bearer pi-proxy-<48-char>`. `auth-gate.ts` sha256 lookup `modelProxy.apiKeys[]`.
- Credential-kind routing filter — `getAvailable()`/`find()` by cred-kind × model id. `canRouteModel(model,cred)`.
- Refresh trigger map.
- auth.json write contract — two writers of `~/.pi/agent/auth.json`; `provider-auth-storage.ts#writeCredential` mkdir lock.

## Test execution & isolation
Vitest 4. Root `vitest.config.ts` `test.projects`. Per-project `pool:"forks"` `maxWorkers:"50%"`. Per-file HOME isolation via `setup-home-perfile.ts` mkdtemp.

## Electron Auto-Update
`packages/electron/src/lib/app-updater.ts` wraps `electron-updater`. `initAutoUpdater()` 60s initial + 24h interval. Skipped in dev.
