
# PI Dashboard

## Project Overview

Web-based dashboard for monitoring and interacting with pi agent sessions remotely. Three-component architecture: bridge extension + Node.js server + React web client.

## Architecture

See [docs/architecture.md](docs/architecture.md) for full details.

- **Bridge Extension** (`src/extension/`) — Runs in every pi session, forwards events via WebSocket
- **Dashboard Server** (`src/server/`) — Aggregates events, in-memory + JSON persistence, dual WebSocket servers
- **Web Client** (`src/client/`) — React + Tailwind responsive UI
- **Shared Types** (`src/shared/`) — Protocol definitions shared across components

## Commands

```bash
npm install          # Install dependencies
npm test             # Run all tests (vitest) — ISOLATED HOME, safe for live sessions
npm run test:watch   # Watch mode — also isolated
npm run build        # Build web client (Vite)
npm run dev          # Start Vite dev server
npm run reload       # Reload all connected pi sessions
npm run reload:check # Type-check + reload all pi sessions
pi-dashboard         # Start dashboard server
pi-dashboard --dev   # Start with Vite proxy
```

## Test Isolation (READ BEFORE RUNNING VITEST)

**Always run tests via `npm test` or `npm run test:watch`.** Never run `npx vitest` / `vitest` directly without also setting `HOME` to an ephemeral directory first.

### Why this matters

Integration tests call `createServer()`, which on startup runs destructive sweeps against `$HOME/.pi/dashboard/`:
- `headlessPidRegistry.cleanupOrphans()` — reads `headless-pids.json` and may SIGTERM PIDs it considers orphans (including the **live pi process running the bridge**).
- `headlessPidRegistry.killAll()` — SIGTERMs every tracked PID on server shutdown.
- `editorPidRegistry.cleanupOrphans()` — SIGTERMs orphan code-server processes.

If tests run against your real `$HOME`, these sweeps can **kill the pi session that launched the tests**. They also write `.meta.json` sidecars into `~/.pi/agent/sessions/`, racing live bridges and corrupting real session state.

### How isolation works

Three independent layers (defense-in-depth):

1. **Process-level HOME override** (`package.json` `test` / `test:watch` scripts): `HOME=$(mktemp -d -t pi-test-XXXXXX) vitest ...` — vitest starts with a fresh HOME under `os.tmpdir()`.
2. **globalSetup tripwire** (`packages/shared/src/test-support/setup-home.ts`, wired via `globalSetup` in every `vitest.config.ts`): runs ONCE at vitest boot, throws if `process.env.HOME === os.userInfo().homedir` — aborts the run before any test file loads. Pre-creates `.pi/agent/sessions/` and `.pi/dashboard/` subdirs.
3. **Production-code guards** (`packages/server/src/test-env-guard.ts`): `headlessPidRegistry.cleanupOrphans`/`killAll` and `editorPidRegistry.cleanupOrphans` no-op with `console.warn` when `process.env.VITEST === "true"` AND HOME matches the real user home.

### Running tests safely

```bash
npm test                         # Preferred — all isolation layers active
npm run test:watch               # Also safe
```

If you must invoke vitest directly (e.g. for a single file):

```bash
HOME=$(mktemp -d -t pi-test-XXXXXX) npx vitest run path/to/test.ts
```

Without the `HOME=$(mktemp -d)` prefix, the globalSetup tripwire will abort the run with an instructive error — but **don't rely on that alone**: if you stash or delete the tripwire code, the prefix is your only remaining safety net.

### Writing integration tests

Tests that boot a real `DashboardServer` SHOULD use the `createTestServer()` helper:

```ts
import { createTestServer } from "@blackbelt-technology/pi-dashboard-server/test-support/test-server.js";

const { server, httpPort, piPort, stop } = await createTestServer();
// httpPort and piPort are OS-assigned (port: 0) — no hard-coded port ranges,
// no risk of colliding with the live dashboard on :8000 / :9999.
// ...
await stop();
```

Avoid hard-coding ports like `19070`, `19080`, `19090`, etc. in new tests — the helper handles port allocation and safe defaults (`autoShutdown: false`, `tunnel: false`).

### Verifying isolation after test changes

```bash
find ~/.pi/agent/sessions -name "*.meta.json" -exec md5 -q {} \; | sort > /tmp/before.txt
npm test
find ~/.pi/agent/sessions -name "*.meta.json" -exec md5 -q {} \; | sort > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt | grep -v "pi-agent-dashboard"  # should be empty
```

Files under the **current** session's directory (`~/.pi/agent/sessions/--Users-...-pi-agent-dashboard--/`) will legitimately change during the test run because the live bridge keeps writing heartbeats. Only files in **other** session directories indicate a leak.

## Cross-Platform QA Testing

VM-based QA testing for verifying clean-state installation and runtime across platforms.

```bash
cd qa
make build-linux-x86    # Build Ubuntu x86 base image (Packer + VMware)
make test-linux-x86     # Clone → boot → run tests → destroy
make manual-linux-x86   # Clone with GUI for manual testing
make clean              # Destroy all cloned VMs
```

| File | Purpose |
|------|---------|
| `qa/Makefile` | Build/test/manual/clean targets for all platforms |
| `qa/packer/*.pkr.hcl` | Packer templates per platform (Ubuntu, Windows, macOS) |
| `qa/packer/scripts/` | Provisioning scripts (common, linux, macos, windows) |
| `qa/packer/vars/` | OS-version-specific variables (ISO URL, checksum, VM specs) |
| `qa/packer/http/` | Auto-install configs (cloud-init, autounattend.xml) |
| `qa/scripts/` | VM lifecycle (clone, wait-ssh, destroy, run-test) |
| `qa/tests/` | Test suite (install, server, websocket, terminal, git) |
| `qa/README.md` | Full setup and usage documentation |

## Key Files

| File | Purpose |
|------|---------|
| `src/shared/protocol.ts` | Extension↔Server WebSocket messages |
| `src/shared/browser-protocol.ts` | Server↔Browser WebSocket messages (all message types including PromptBus `prompt_request`/`prompt_dismiss`/`prompt_cancel` must be in the `ServerToBrowserMessage` union — `as any` switch cases are stripped by esbuild in production) |
| `src/shared/types.ts` | Data models (Session, Workspace, Event) |
| `src/shared/config.ts` | Shared config loader (`~/.pi/dashboard/config.json`) |
| `src/extension/bridge.ts` | Main extension entry point (composes sync/tracker/flow modules, tracks `isAgentStreaming` in persistent BridgeState) |
| `src/extension/bridge-context.ts` | Shared mutable state type + helpers for bridge modules |
| `src/extension/session-sync.ts` | Session register, replay, and switch/fork handling |
| `src/extension/model-tracker.ts` | Model/thinking-level/git/name change detection |
| `src/extension/flow-event-wiring.ts` | Flow event listener registration (flow:* → event_forward) |
| `src/extension/connection.ts` | WebSocket with exponential backoff |
| `src/extension/server-probe.ts` | TCP probe to detect running server |
| `src/shared/server-identity.ts` | Identity-verified health check (`isDashboardRunning`) replacing bare TCP probes |
| `src/shared/mdns-discovery.ts` | mDNS advertise/discover/browse for `_pi-dashboard._tcp` services |
| `src/extension/server-launcher.ts` | Auto-start server as detached process |
| `src/extension/command-handler.ts` | Command routing: `!`/`!!` bash, `/compact`, slash commands |
| `src/extension/prompt-expander.ts` | Slash command → prompt template expansion (supports colon-to-hyphen aliasing: `/opsx:cmd` → `opsx-cmd.md`) |
| `src/extension/dev-build.ts` | Dev build-on-reload helper (client build + server shutdown) |
| `src/extension/server-auto-start.ts` | mDNS-first discovery → health check fallback → auto-start with concurrent launch detection |
| `src/shared/session-meta.ts` | Session metadata sidecar (.meta.json) read/write helpers |
| `src/extension/process-metrics.ts` | Lightweight CPU/memory/event-loop metrics collector for heartbeats |
| `src/extension/process-scanner.ts` | Child process detection via ps + PGID tracking (leaf-only, grandchild recursion) and PGID-based kill |
| `src/client/components/ProcessList.tsx` | Session card process list with elapsed time and red ✕ kill button |
| `src/extension/git-info.ts` | Git branch/remote/PR detection (polled every 30s) |
| `src/extension/git-link-builder.ts` | Git remote URL parsing and platform-specific links |
| `src/server/git-operations.ts` | Server-side git commands: branch listing, checkout, init, stash pop |
| `src/client/components/BranchPicker.tsx` | Typeahead branch picker with keyboard navigation |
| `src/client/components/BranchSwitchDialog.tsx` | Checkout orchestration: dirty-state stash, pop prompt |
| `src/client/lib/git-api.ts` | Client-side fetch helpers for git API endpoints |
| `src/extension/prompt-bus.ts` | PromptBus — unified prompt routing to registered adapters (TUI, dashboard, custom). First-response-wins, cross-adapter dismissal. |
| `src/extension/dashboard-default-adapter.ts` | Built-in PromptBus adapter that renders prompts as generic interactive dialogs in dashboard chat |
| `src/client/lib/prompt-component-registry.ts` | Client-side component registry mapping prompt type strings to render metadata (placement, component) |
| `src/extension/ask-user-tool.ts` | `ask_user` tool registration (bundled in bridge, registered at session_start to avoid static tool-name conflicts with other extensions). Supports five methods: `confirm`, `select`, `multiselect`, `input`, and `batch` (multiple related questions in one call, answers returned as ordered array; cancel mid-batch returns partial results + `cancelled: true`). `prepareArguments` rescues common LLM drift: stringified `params`/`questions`/`options`, `question`/`header` → `title`, `input_type` wrapper flattening, `{label,value}[]` → `label[]` with warning surfaced via `details.warnings`. |
| `src/shared/openspec-activity-detector.ts` | Detects OpenSpec activity from tool events; auto-attach requires only changeName (phase optional) |
| `src/shared/openspec-poller.ts` | OpenSpec CLI polling (shared, used by server DirectoryService) |
| `src/shared/state-replay.ts` | Synthesizes events from pi entries (shared, used by server + bridge) |
| `src/shared/stats-extractor.ts` | Extracts token/cost stats from turn_end events |
| `src/server/session-stats-reader.ts` | Reads cumulative stats + context usage from session JSONL files at startup |
| `src/server/server.ts` | HTTP + WebSocket server (composes route modules + wiring) |
| `src/server/routes/session-routes.ts` | REST routes: sessions, events, session-diff |
| `src/server/routes/git-routes.ts` | REST routes: git branches, checkout, init, stash-pop |
| `src/server/routes/file-routes.ts` | REST routes: file read, browse, readme, pinned-dirs |
| `src/server/routes/openspec-routes.ts` | REST routes: openspec-archive, pi-resources, pi-resource-file |
| `src/server/routes/system-routes.ts` | REST routes: config, health, shutdown, tunnel, editors |
| `src/server/event-wiring.ts` | Pi gateway → browser gateway event forwarding (replay suppression with `skipReplayInsert` dedup, flows refresh dedup, context usage extraction) |
| `src/server/idle-timer.ts` | Auto-shutdown idle timer with sleep-wake resilience |
| `src/server/session-bootstrap.ts` | Startup session discovery and OpenSpec polling init |
| `src/server/pi-gateway.ts` | Extension WebSocket gateway (port 9999) |
| `src/server/browser-gateway.ts` | Browser WebSocket gateway (dispatches to handler modules; logs handler exceptions as `[browser-gw] handler error type=<msg.type>: <err>` instead of silently swallowing them — only malformed JSON frames are dropped silently) |
| `src/server/browser-handlers/handler-context.ts` | Shared context type for browser message handlers |
| `src/server/browser-handlers/subscription-handler.ts` | Subscribe/unsubscribe with async batched replay, backpressure, lazy loading |
| `src/server/browser-handlers/session-action-handler.ts` | Send prompt, abort, resume, spawn, shutdown, force kill, flow control |
| `src/client/components/ImageLightbox.tsx` | Full-size image lightbox with zoom/pan (useZoomPan), Esc/backdrop close |
| `src/client/components/CollapsedToolGroup.tsx` | Collapsed group of repeated tool calls with expand toggle |
| `src/client/lib/group-tool-calls.ts` | Groups consecutive identical tool calls for chat display |
| `src/server/browser-handlers/session-meta-handler.ts` | Rename, hide, unhide, attach/detach proposal, fetch, list |
| `src/server/browser-handlers/terminal-handler.ts` | Create, kill, rename terminals |
| `src/server/browser-handlers/directory-handler.ts` | Pin/unpin dirs, reorder, openspec refresh, pi-gateway forwards |
| `src/server/memory-event-store.ts` | In-memory event buffer with LRU eviction, per-session cap, payload truncation |
| `src/server/memory-session-manager.ts` | Pure in-memory session registry |
| `src/client/components/FolderOpenSpecSection.tsx` | Folder-level OpenSpec UI: collapsible change list, refresh, bulk archive, archive button |
| `src/client/components/ArchiveBrowserView.tsx` | Searchable archive browser: date-grouped list, two-level nav to artifact reader |
| `src/client/hooks/useArchiveListing.ts` | Fetch hook + pure helpers (groupByDate, filterEntries) for archive endpoint |
| `src/server/openspec-archive.ts` | Scans `openspec/changes/archive/` and returns structured ArchiveEntry list |
| `packages/server/src/openspec-tasks.ts` | Parses an OpenSpec change's `tasks.md` (top-level `- [ ]` / `- [x]` lines under `## ` headings) and rewrites a single checkbox line atomically (tmp + rename, byte-for-byte preservation of other lines). Exports `parseTasksMarkdown`, `readTasks`, `toggleTask`, plus typed `NotFoundError` / `LineMismatchError` / `NotACheckboxError` consumed by `routes/openspec-routes.ts` to map to HTTP 404/409/400. |
| `packages/client/src/lib/openspec-tasks-api.ts` | Client fetch helpers for `GET /api/openspec/tasks` and `POST /api/openspec/tasks/toggle`. Throws typed `LineMismatchError` on HTTP 409 so `TasksPopover` can refetch + show a banner without string-matching error text. |
| `packages/client/src/components/StatePill.tsx` | Compact color-coded pill (zinc/blue/amber/green) showing `deriveChangeState(change)` next to the attached-change badge on the session card. Exports `stateToLabel` and the `STATE_PILL_CLASS` map for reuse. |
| `packages/client/src/components/TasksPopover.tsx` | Portal-rendered popover (anchored to the session card's `Tasks N/M` button) listing every parseable `tasks.md` checkbox grouped by `## ` heading. Optimistic toggle; HTTP 409 triggers a refetch + “File changed” banner; broadcast-driven openspec poll keeps the card counts fresh after each tick.
| `src/client/components/SessionOpenSpecActions.tsx` | Session-level OpenSpec: searchable attach dialog, action buttons, detach |
| `src/client/components/DialogPortal.tsx` | Portal wrapper rendering dialogs at document.body with scroll lock |
| `src/client/components/PinDirectoryDialog.tsx` | Dialog to pin a directory (wraps PathPicker). Mounted once at the app root in `App.tsx` via `DialogPortal`; opened by both the sidebar "Add folder" button and the LandingPage Step ② CTA through a shared `onOpenPinDialog` callback. |
| `packages/client/src/components/LandingPage.tsx` | Empty-state onboarding view. Renders three cards (Setup credentials → Add folder → Start session) that collapse to ✔ rows once each step is satisfied. Accepts `{ providersReady, pinnedCount, sessionsCount, firstPinnedCwd, onOpenPinDialog, onSpawnSession, navigate }`. Falls back to the legacy `π + "Select a session to get started"` placeholder when no onboarding props are supplied (preserves existing test surface). |
| `packages/client/src/hooks/useProvidersReady.ts` | Hook observing `GET /api/providers`: returns `{ loading, ready, count }` where `ready=true` iff at least one provider has a non-empty `apiKey`. Refetches on window `focus` and on `provider-auth-event` custom events. Used by `LandingPage` via `App.tsx` to drive Step ① state. |
| `src/client/components/PathPicker.tsx` | Reusable keyboard-first path picker with typeahead directory list |
| `src/client/lib/browse-api.ts` | Client-side browse API helper for PathPicker |
| `src/server/browse.ts` | Directory listing logic for browse API endpoint |
| `src/server/pi-resource-scanner.ts` | Discovers pi extensions, skills, prompts from local, global, and package sources |
| `src/server/package-manager-wrapper.ts` | Thin adapter around pi's `DefaultPackageManager` with operation serialization, progress forwarding, and session reload. `loadPiPackageManager()` resolution order: (1) direct import of `@mariozechner/pi-coding-agent`, (2) managed install at `~/.pi-dashboard/node_modules/` (used by Electron portable/standalone on Windows where pi isn't globally installed), (3) `npm root -g`. Without step (2) portable Windows users see a red "pi-coding-agent is not installed" banner in the Packages tab. |
| `src/server/npm-search-proxy.ts` | Cached proxy for npm registry search (`keywords:pi-package`) and README fetch |
| `src/server/routes/package-routes.ts` | REST routes: search, readme, installed, install, remove, update, check-updates |
| `packages/server/src/pi-core-checker.ts` | Discovers pi ecosystem CORE CLI packages (pi itself, pi-dashboard, pi-model-proxy, etc.) from global npm + `~/.pi-dashboard/node_modules/` and compares against the npm registry. Complements PackageManagerWrapper which only manages extensions in `settings.json packages[]`. 5-min cache. |
| `packages/server/src/pi-core-updater.ts` | Runs `npm update -g <pkg>` (global install) or `npm update <pkg>` in `~/.pi-dashboard/` (managed install), streams progress via listener, acquires `PackageManagerWrapper.runExclusive()` busy-lock, auto-reloads sessions on any successful update. |
| `packages/server/src/routes/pi-core-routes.ts` | REST routes: `GET /api/pi-core/versions[?refresh=true]`, `POST /api/pi-core/update` with `{ packages?: string[] }` (empty = update all with `updateAvailable`). 409 when busy, 400 on unknown package names. |
| `packages/client/src/hooks/usePiCoreVersions.ts` | Fetch + 30-min poll hook for pi core version status. Refetches (with `?refresh=true`) when `pi_core_update_complete` arrives via the `pi-core-event` window event. |
| `packages/client/src/components/PiCoreVersionsSection.tsx` | Settings → Packages tab section showing core packages with current → latest versions, per-package Update button, Update All, Check Now, live progress/error surfaced from WS `pi_core_update_progress`/`complete`. |
| `packages/client/src/components/PiUpdateBadge.tsx` | Header badge (count of available pi core updates). Hidden when zero. Clicking navigates to `/settings?tab=packages`. Mounted next to `ServerSelector` in `App.tsx` `headerExtra`. |
| `src/client/components/SortablePinnedGroup.tsx` | Drag-to-reorder wrapper for pinned directory groups |
| `src/server/preferences-store.ts` | Global UI preferences (pinned dirs, session order) in `preferences.json` |
| `src/server/meta-persistence.ts` | Per-session debounced `.meta.json` writer |
| `src/server/session-scanner.ts` | Startup session discovery by scanning `~/.pi/agent/sessions/` |
| `src/server/migrate-persistence.ts` | One-time migration from `sessions.json` + `state.json` to `.meta.json` |
| `src/server/session-order-manager.ts` | Per-cwd session ordering with persistence |
| `src/server/directory-service.ts` | Server-side session discovery, event loading, and OpenSpec polling |
| `src/server/pending-fork-registry.ts` | Tracks pending fork operations for session placement |
| `src/server/pending-resume-registry.ts` | Queues prompts for auto-resume of ended sessions |
| `src/server/json-store.ts` | Atomic JSON file read/write helpers |
| `src/server/process-manager.ts` | Session spawning via tmux or headless mode |
| `src/server/editor-registry.ts` | Detects available native editors (running processes + CLI) |
| `src/server/editor-manager.ts` | Lifecycle manager for code-server child processes (spawn, stop, idle, heartbeat) |
| `packages/server/src/editor-pid-registry.ts` | Persists spawned code-server PIDs to `~/.pi/dashboard/editor-pids.json` and sweeps orphaned code-server processes on server boot (runs in `server.start()` before `fastify.listen`). Verifies ownership via cmdline check against `~/.pi/dashboard/editors/` prefix to avoid killing unrelated user-run code-server instances. SIGTERM → 1s grace → SIGKILL escalation. |
| `src/server/editor-proxy.ts` | Reverse proxy for `/editor/:id/*` to code-server instances |
| `src/server/editor-detection.ts` | Auto-detect code-server/openvscode-server binary on PATH |
| `src/server/routes/editor-routes.ts` | REST routes: editor start, stop, heartbeat, status, detect |
| `src/server/event-status-extraction.ts` | Extracts session status/tool updates from events (incl. flow metadata) |
| `src/server/headless-pid-registry.ts` | Maps headless child PIDs to session IDs |
| `src/server/auth.ts` | OAuth2 authentication: provider registry, JWT helpers, user allowlist |
| `src/server/provider-auth-handlers.ts` | Pi provider OAuth handlers (Anthropic, Codex, GitHub Copilot, Gemini CLI, Antigravity) |
| `src/server/provider-auth-storage.ts` | Read/write ~/.pi/agent/auth.json with lockfile for pi provider credentials |
| `src/server/routes/provider-auth-routes.ts` | REST routes: provider OAuth authorize/exchange/callback, device-code, API key CRUD |
| `src/client/components/ProviderAuthSection.tsx` | Settings section: OAuth login buttons, device-code modal, API key inputs |
| `src/server/auth-plugin.ts` | Fastify plugin: auth routes, onRequest hook, WS upgrade validation |
| `src/server/config-api.ts` | Config REST API: read (redacted), write (partial merge), secret preservation |
| `src/client/components/SettingsPanel.tsx` | Settings UI: all dashboard config fields, grouped form, save to server |
| `src/client/hooks/useAuthStatus.ts` | Client auth status hook and login redirect helper |
| `src/server/localhost-guard.ts` | Network access guard: `createNetworkGuard` (loopback/trusted/authenticated), `isBypassedHost` (CIDR/wildcard/exact), netmask-to-CIDR helpers |
| `src/server/server-pid.ts` | PID file management for daemon mode |
| `src/client/components/ServerSelector.tsx` | Server selector dropdown showing persisted known servers with availability probing |
| `src/client/components/KnownServersSection.tsx` | Settings section: list/add/remove persisted known remote servers |
| `src/client/components/NetworkDiscoverySection.tsx` | Settings section: mDNS network scan with "Add" action and label prompt |
| `src/client/lib/known-servers-api.ts` | Client-side fetch helpers for known servers CRUD and discovery endpoints |
| `src/server/routes/known-servers-routes.ts` | REST routes: known servers CRUD, on-demand mDNS discovery scan |
| `src/server/terminal-manager.ts` | PTY lifecycle, ring buffer, spawn/attach/kill terminals |
| `src/server/terminal-gateway.ts` | Binary WebSocket upgrade handler for `/ws/terminal/:id` |
| `scripts/fix-pty-permissions.cjs` | Postinstall: locates `node-pty` via `require.resolve("node-pty/package.json")` (hoist-aware) and chmods every `prebuilds/*/spawn-helper` and `prebuilds/*/pty.node` to `0o755`. Wired up at the workspace-root `postinstall` so it applies regardless of which workspace triggered `npm install`. |
| `src/server/fix-pty-permissions.ts` | Runtime spawn-helper permission fix — called once by `createTerminalManager()`, uses `createRequire().resolve("node-pty")` to handle any install layout including Electron bundles |
| `src/server/tunnel.ts` | Zrok tunnel with reserved shares for persistent URLs. Serialized creation via in-flight promise (`pendingCreate`) prevents parallel reservations from UI double-clicks. `releaseShare(token)` + `scavengeOrphanZrokProcesses(port)` clean up leaked reservations and processes on startup (unconditional when zrok binary is present, even in `--no-tunnel`), on `/api/restart`, `/api/shutdown`, and `/api/tunnel-disconnect`. Retry cap of 1 prevents cascade leaks; timeout path SIGTERM→SIGKILL escalation + release just-in-time tokens. |
| `packages/client/vite.config.ts` | Client build. `rollupOptions.output.manualChunks` splits bundle into vendor chunks (`react-vendor`, `markdown`, `syntax`, `diff`, `xterm`, `dnd`, `util`) so the initial chunk is ~570 KB (~150 KB gzipped) instead of a 3 MB monolith — avoids tunnel abort thresholds on large assets. |
| `packages/client/scripts/precompress.mjs` | Post-build step (runs from `build` / `prepare`): zero-dependency Node script that writes `.gz` siblings for every compressible file in `dist/`. `@fastify/static` serves them with `preCompressed: true` so responses ship a stable `Content-Length` header — avoids streaming-compression quirks in intermediate HTTP/2 proxies. |
| `packages/server/src/server.ts` | Fastify server. Registers `@fastify/compress` globally with gzip+deflate (brotli intentionally disabled — zrok free proxy stream-resets `content-encoding: br`). Serves static client with `preCompressed: true`. CORS callback allows localhost, the active zrok tunnel URL (via `getTunnelUrl()`), any `*.share.zrok.io` host, and configured origins; on mismatch returns `cb(null, false)` rather than throwing — throwing causes `@fastify/cors` to surface HTTP 500 on every asset response (the hidden root cause of browser-only 500s over zrok tunnels, since Vite's `<script type="module" crossorigin>` entries always request in CORS mode). |
| `src/client/components/TunnelButton.tsx` | Unified tunnel/QR button — tunnel icon when not set up, QR icon when inactive, green QR icon when connected; opens QR dialog with disconnect/setup |
| `src/client/components/QrCodeDialog.tsx` | QR code dialog showing tunnel URL as scannable QR code with copy, disconnect, and setup buttons |
| `public/manifest.json` | PWA web app manifest for installability |
| `public/sw.js` | Minimal service worker for PWA installability |
| `src/client/components/ZrokInstallGuide.tsx` | OS-aware zrok installation guide view (macOS/Linux/Windows) |
| `src/server/cli.ts` | CLI entry point with subcommands (start/stop/restart/status); `findPortHolders` is cross-platform (netstat/taskkill on Windows, lsof on Unix) and `server.log` is opened append-mode with timestamped headers |
| `src/server/restart-helper.ts` | Cross-platform `/api/restart` orchestrator: spawns a detached `node -e` child using only Node built-ins (net, http) — no sh/lsof/curl dependency; exports pure `buildOrchestratorScript(params)` for testing |
| `src/shared/resolve-jiti.ts` | Resolves pi's jiti register hook as a `file://` URL (required for `node --import` on Windows); exports pure `buildJitiRegisterUrl(pkgJsonPath)` helper and `resolveJitiFromAnchor(anchorPath)` for managed-install/system-pi callers |
| `src/shared/platform/` | Unified cross-OS primitives (see `index.ts` barrel). Sub-modules: `exec.ts` (**the only module that imports `node:child_process`** — wraps `execSync`/`exec`/`execFile`/`spawn`/`spawnSync` with `windowsHide: true` by default; enforced by `no-direct-child-process.test.ts`), `runner.ts` (the Recipe engine — `run(recipe, input)` resolves binaries via `ToolResolver`, applies timeout / tolerate / error normalization, returns `Result<T>`), `git.ts` / `openspec.ts` / `npm.ts` (Recipe-based tool modules — typed functions like `git.diff(...)`, `openspec.list(...)`, `npm.rootGlobal()` that never touch `child_process` or `process.platform`), `binary-lookup.ts` (`where`/`which`, `.cmd` ext, `ToolResolver` class), `process.ts` (`findPortHolders`, `killProcess`, `isProcessAlive`, `killPidWithGroup`, `parseNetstatListeners`), `process-scan.ts` (`isProcessRunning` via pgrep/tasklist, `parseEtime`), `shell.ts` (`detectShell` for SHELL/COMSPEC, `getTerminalEnvHints`), `commands.ts` (`openBrowser`, `isVirtualMachine`). All exported helpers that depend on OS take an optional `platform: NodeJS.Platform` parameter so tests can exercise both branches without mutating `process.platform`. See changes: consolidate-platform-handlers, platform-command-executor. |
| `src/shared/rest-api.ts` | REST API type definitions |
| `scripts/reload-all.sh` | Build bridge + reload all pi sessions |
| `CHANGELOG.md` | Human-authored release notes per version (Keep a Changelog 1.1.0); source of GitHub Release bodies. Contributors append bullets to `## [Unreleased]`; release author promotes at tag time. |
| `packages/shared/src/test-support/setup-home.ts` | Vitest `globalSetup` module. Runs ONCE at vitest boot. Tripwire: throws if `process.env.HOME === os.userInfo().homedir` (i.e. tests would run against real user home), aborting the entire run before any test file loads. Warns if HOME is outside `os.tmpdir()`. Pre-creates `<HOME>/.pi/agent/sessions/` and `<HOME>/.pi/dashboard/`. Wired via `test.globalSetup` in every package's `vitest.config.ts`. |
| `packages/server/src/test-env-guard.ts` | `isUnsafeTestHomeScan()` — returns true when `VITEST=true` AND HOME matches `os.userInfo().homedir`. Gates destructive sweeps in `headlessPidRegistry.cleanupOrphans/killAll` and `editorPidRegistry.cleanupOrphans` so tests never SIGTERM live pi processes even if higher isolation layers are bypassed. |
| `packages/server/src/test-support/test-server.ts` | `createTestServer(overrides)` helper — boots a real `DashboardServer` on OS-assigned ports (`port: 0`, `piPort: 0`) with safe defaults (no auto-shutdown, no tunnel). Returns `{ server, httpPort, piPort, stop }`. Prefer over hard-coded `19xxx` port constants in new integration tests. |
| `docs/release-process.md` | Canonical how-to for cutting a release: commit conventions, Unreleased promotion, version bump, tag + push, CI behavior, manual fallback. |
| `src/client/components/PiResourcesView.tsx` | Content area view for browsing pi extensions, skills, and prompts (with Installed/Packages tabs) |
| `src/client/components/PackageBrowser.tsx` | Reusable inline package browser: npm search, type filters, install/uninstall, manual URL input |
| `src/client/components/PackageCard.tsx` | Package card with type badges, downloads, install/uninstall actions |
| `src/client/components/PackageReadmeDialog.tsx` | Dialog overlay showing package README with install/uninstall action |
| `src/client/components/PackageInstallConfirmDialog.tsx` | Confirmation dialog before package install (name, source, scope) |
| `src/client/hooks/usePackageSearch.ts` | Debounced fetch hook for `/api/packages/search` |
| `src/client/hooks/useInstalledPackages.ts` | Fetch hook for `/api/packages/installed` |
| `src/client/hooks/useRecommendedExtensions.ts` | Fetch hook for `/api/packages/recommended`; auto-refreshes on `package_operation_complete` |
| `src/client/components/RecommendedExtensions.tsx` | Curated-recommended-extensions card grid, rendered above search in Packages tab |
| `src/client/components/MissingRequiredBanner.tsx` | Top-of-page banner when any `required` recommended extension is missing from `~/.pi/agent/settings.json` `packages[]` |
| `src/shared/recommended-extensions.ts` | Static `RECOMMENDED_EXTENSIONS` manifest (pi-anthropic-messages, @tintinweb/pi-subagents, pi-flows, pi-web-access, pi-agent-browser); enriched server-side with live description/version and installed/active cross-reference |
| `src/server/routes/recommended-routes.ts` | `GET /api/packages/recommended` — enrichment + 60s cache, invalidated on successful install/remove/update |
| `src/client/hooks/usePackageOperations.ts` | Install/remove/update actions with WebSocket progress listening |
| `src/client/hooks/usePiResources.ts` | Fetch + 30s polling hook for pi resources API |
| `src/client/components/MarkdownPreviewView.tsx` | Generic reusable markdown preview with back button, tabs, loading/error states |
| `src/client/hooks/useOpenSpecReader.ts` | Maps OpenSpec artifacts to file paths, fetches content, concatenates specs |
| `src/client/components/interactive-renderers/` | Registry + renderers for interactive UI dialogs (confirm, select, multiselect, input, editor, notify) |
| `src/shared/terminal-types.ts` | TerminalSession type and control messages |
| `src/client/components/TerminalView.tsx` | xterm.js terminal emulator wrapper with keep-alive |
| `src/client/components/TerminalsView.tsx` | Tabbed terminal container per folder (tab bar, keep-alive, rename) |
| `src/client/components/EditorView.tsx` | code-server iframe embedding with lazy start and heartbeat |
| `src/client/components/EditorInstallGuide.tsx` | Platform-specific code-server installation guide |
| `src/client/components/FolderActionBar.tsx` | Unified action bar per folder: +Session, Terminals(N), Editor, Zed, Pi Resources |
| `packages/client/src/hooks/useImagePaste.ts` | Shared clipboard-image-paste hook (pendingImages, imageError, handlePaste, removeImage, clearImages). Used by `CommandInput` and `ExploreDialog` so behavior is identical across both prompt surfaces. Exports `MAX_IMAGE_SIZE` and `SUPPORTED_IMAGE_TYPES`. |
| `packages/client/src/components/ImagePreviewStrip.tsx` | Shared image preview strip: error banner + horizontal thumbnail row with remove buttons; thumbnails open `ImageLightbox`. Used by `CommandInput` and `ExploreDialog`. |
| `src/client/lib/folder-encoding.ts` | Base64url encode/decode for folder paths in URL routes |
| `src/shared/editor-types.ts` | Editor instance types shared across components |
| `src/client/components/TerminalCard.tsx` | Sidebar card for terminal sessions (cyan accent) |
| `src/client/App.tsx` | React app with WebSocket integration |
| `src/client/components/MobileShell.tsx` | Two-panel mobile shell with slide transitions and swipe-back |
| `src/client/components/MobileActionMenu.tsx` | Kebab menu for session actions on mobile (includes OpenSpec commands) |
| `src/client/components/MobileOverlay.tsx` | Hamburger button and sidebar overlay for mobile |
| `src/client/components/SessionHeader.tsx` | Session header with OpenSpec attach/detach, flow launcher, MobileAttachButton |
| `packages/client/src/components/PiLogo.tsx` | Inline-SVG Pi brand-mark component. `fill="currentColor"`, transparent background, themeable via parent `color`. Used in both sidebar headers (`SessionList.tsx`, `SessionSidebar.tsx`). |
| `packages/client/src/components/SessionSidebar.tsx` | Alternate sidebar; header brand button renders `<PiLogo size={24} />` (inherits `text-blue-500 hover:text-blue-400`) instead of a literal `π` glyph. |
| `packages/client/src/components/SessionList.tsx` | Desktop sidebar; header brand button uses `<PiLogo />`. Pin-folder button renders `📌 Add folder` label (tooltip: "Pin a folder to the sidebar") instead of icon-only `📌+`. |
| `packages/client/src/index.css` | Global styles. `.card-working-pulse` layers a 45° repeating-linear-gradient (amber, `background-size: 28.2843px` = one full diagonal period) over a flat amber tint; `background-position` scrolls **horizontally** by `56.5685px` (2 periods) over 2s linear — scroll must be across stripes, diagonal scroll is pattern-invariant. An opacity pulse `0.6 → 1 → 0.6` runs in parallel over 3s ease-in-out (coprime with 2s stripes so they never lock). `prefers-reduced-motion: reduce` disables both animations but keeps the static stripe pattern as a state cue. `.card-input-pulse` (ask_user) intentionally stays pulse-only — stripes = working, pulse-only = waiting on you. |
| `packages/client/vite.config.ts` | Client build config. `publicDir: "../../../public"` — resolved relative to `root: "src"`, three `../` hops reach the project-root `public/` directory (icon-192.png, icon-512.png, manifest.json, sw.js). Earlier `"../../public"` silently resolved to a non-existent `packages/public/` and caused all PWA assets to 404 in production. |
| `src/client/hooks/useSwipeBack.ts` | iOS-style left-edge swipe-back gesture (40px edge zone, document-level listeners) |
| `src/client/components/ChatView.tsx` | Chat message view with scroll-lock: pauses auto-scroll when user scrolls up, floating scroll-to-bottom button, per-session scroll position persistence |
| `src/client/lib/mobile-depth.ts` | Pure function computing MobileShell depth from route state |
| `src/client/hooks/useZoomPan.ts` | Reusable zoom/pan hook (wheel, drag, pinch, buttons) |
| `src/client/hooks/useMessageHandler.ts` | WebSocket message dispatch hook (extracted from App.tsx) |
| `src/client/hooks/useSessionActions.ts` | Session action callbacks hook (send, abort, resume, spawn, etc.) |
| `src/client/hooks/useOpenSpecActions.ts` | OpenSpec action callbacks hook (refresh, archive, attach, detach); calls `clearAllContentViews` before opening preview |
| `src/client/hooks/useContentViews.ts` | Content view state + fetch (pi resources, readme, file preview); `clearAll()` resets all hook-owned states; `onBeforeOpen` callback for cross-component clearing |
| `src/client/lib/event-reducer.ts` | Event-sourced state reducer (delegates flow events to flow-reducer); extracts LLM errors from `agent_end` into `lastError` |
| `src/client/hooks/usePendingPromptTimeout.ts` | 30-second safety timeout for stuck `pendingPrompt` spinners |
| `src/client/lib/flow-reducer.ts` | Flow state machine: all flow_* event handling |
| `src/client/lib/session-grouping.ts` | Pure functions: group, sort, filter sessions by directory |
| `src/client/lib/truncate-path.ts` | Middle-truncation utility for filesystem paths |
| `src/server/resolve-path.ts` | Safe realpath resolution (symlink handling) |
| `src/client/components/ElapsedBadge.tsx` | Reusable elapsed time badge: static duration or live ticking counter |
| `src/client/components/FlowDashboard.tsx` | Sticky flow card grid above ChatView with abort/auto controls, mobile collapse |
| `src/client/components/FlowAgentCard.tsx` | Individual agent card: status, tools, tokens, duration, loop badge |
| `src/client/components/FlowAgentDetail.tsx` | Full content-area agent detail: tool history, assistant text, thinking |
| `src/client/components/FlowSummary.tsx` | Post-completion summary: per-agent status, file counts, dismiss |
| `src/client/components/FlowActivityBadge.tsx` | Session card badge showing flow name and agent progress |
| `src/client/components/FlowLaunchDialog.tsx` | Task input dialog for launching a flow |
| `src/client/components/SessionFlowActions.tsx` | Session card flow launcher: searchable picker + new flow button |
| `src/client/components/SearchableSelectDialog.tsx` | Shared searchable select dialog (keyboard nav, filtering, badges) |
| `src/shared/diff-types.ts` | Types for session file diff API (FileChangeEvent, FileDiffEntry, SessionDiffResponse) |
| `src/server/session-diff.ts` | Server-side event scanning + git diff extraction for session file changes |
| `src/client/components/FileDiffView.tsx` | Split-pane container: file tree + diff panel, content-area view |
| `src/client/components/DiffFileTree.tsx` | Two-level file tree with change events, timestamps, context messages |
| `src/client/components/DiffPanel.tsx` | Rich diff rendering via @git-diff-view/react with syntax highlighting |
| `src/client/hooks/useSessionDiff.ts` | Fetch hook for `/api/session-diff` endpoint |
| `src/client/lib/diff-tree.ts` | Directory tree builder from flat file paths |
| `src/server/session-api.ts` | REST wrappers for WebSocket-only session operations (prompt, abort, spawn, resume, etc.) |
| `.pi/skills/pi-dashboard/SKILL.md` | Bundled skill: monitor and control the dashboard from any pi session |
| `.pi/skills/release-cut/SKILL.md` | Skill: cut a new release — pre-flight (clean tree, tests, build), CHANGELOG `[Unreleased]` → versioned promotion, workspace version bump, `chore(release): v<version>` commit, tag + push develop. Stops at the CI-generated draft GitHub Release per `docs/release-process.md`. |
| `.pi/skills/release-revoke/SKILL.md` | Skill: revoke/rollback a release — delete GitHub Release (draft or published) via `gh release delete`, remove git tag locally + on origin, `npm deprecate` the version (never `npm unpublish` — blocked after 72h / with dependents), optionally revert the `chore(release): v<version>` commit. Handles partial CI failures gracefully. |
| `.pi/skills/pi-dashboard/references/api-reference.md` | Complete REST API reference for the skill |
| `.pi/skills/pi-dashboard/references/recipes.md` | Multi-step orchestration recipes |
| `.pi/skills/pi-dashboard/scripts/dashboard-api.sh` | Helper script with port auto-detection and auth |

| `.pi/skills/spec-coherence-check/SKILL.md` | Skill: sweep proposals for staleness, conflicts, obsolescence against codebase |
| `.pi/skills/spec-coherence-check/references/proposal-queue-schema.md` | JSON schema for `.pi/proposal-queue.json` |
| `.pi/skills/code-review/SKILL.md` | Skill: comprehensive code review with severity labels, four-phase process, language-specific guides |
| `.pi/skills/code-review/references/` | On-demand language guides (React, TypeScript, Vue, Rust, Go, Java, Python, C/C++, CSS, Qt) + architecture/performance/security reviews |
| `.pi/skills/nano-banana-imagegen/SKILL.md` | Skill: AI image generation/editing via Google Gemini (nano-banana CLI) |
| `.pi/skills/nano-banana-imagegen/references/` | Prompting guide, example prompts (headers, icons, illustrations, photography) |
| `.pi/skills/browser-visual-debug/SKILL.md` | Skill: visual debugging with a real browser (screenshots, interaction, responsive testing) via pi-agent-browser |
| `.pi/skills/browser-visual-debug/references/` | Dashboard recipes, responsive testing presets, agent-browser commands cheatsheet |
| `.pi/skills/browser-visual-debug/scripts/detect-dashboard.sh` | Auto-detect dashboard URL, mode, and Vite dev server status |
| `packages/electron/src/main.ts` | Electron main process: single-instance, wizard, server launch, loading page, tray |
| `packages/electron/src/lib/server-lifecycle.ts` | Health check → tsx binary spawn (inlined config/health, no shared pkg imports) |
| `packages/server/src/extension-register.ts` | Auto-registers bundled bridge extension in pi's global settings on startup |
| `packages/electron/src/lib/doctor.ts` | Doctor diagnostic: checks all binaries, versions, server status, offers setup |
| `packages/electron/src/lib/app-menu.ts` | App menu with About dialog and Doctor on all platforms |
| `packages/electron/src/lib/tray.ts` | System tray with platform-specific icons (template on macOS, ico/png on Win/Linux) |
| `packages/electron/src/lib/dependency-installer.ts` | Async npm install of pi, openspec, tsx into ~/.pi-dashboard/ using bundled Node |
| `packages/electron/src/lib/dependency-detector.ts` | Detects pi, openspec, Node.js on system PATH and managed install |
| `packages/electron/src/lib/bundled-node.ts` | Resolves bundled Node.js/npm paths in Electron resources |
| `packages/electron/src/lib/wizard-window.ts` | First-run setup wizard window with preload bridge |
| `packages/electron/forge.config.ts` | Electron Forge config: DMG, DEB, AppImage, NSIS makers, icon, extraResources |
| `packages/electron/scripts/build-installer.sh` | Build script: native + Docker cross-platform (--linux, --windows, --all) |
| `packages/electron/scripts/docker-make.sh` | Docker entrypoint: platform-aware native module handling, ZIP for Windows |
| `packages/electron/scripts/Dockerfile.build` | Docker image for cross-platform builds (node:22-bookworm-slim + build tools) |
| `packages/electron/scripts/bundle-server.sh` | Bundles dashboard server source + deps into resources/server/ (--source-only for cross-builds) |
| `packages/electron/scripts/docker-make.sh` | Docker entrypoint: bundles server, installs native deps, runs Forge make |
| `packages/electron/scripts/Dockerfile.build` | Docker image for cross-platform builds (node:22-bookworm-slim + build tools) |
| `packages/electron/scripts/test-server-launch.sh` | Docker-based test for server launch on clean Linux |
| `packages/electron/scripts/test-electron-install.sh` | Full e2e Docker test: install, wizard, server launch, health check |
| `packages/electron/scripts/test-electron-install-inner.sh` | Inner test script run inside Docker container |
| `packages/electron/resources/icon.png` | Master 1024×1024 app icon (π on dark navy) |
| `.github/workflows/publish.yml` | CI: builds DMG (macOS), DEB+AppImage (Linux), NSIS+ZIP+portable (Windows) on native runners; publishes npm + GitHub Release |
| `.github/workflows/deploy-site.yml` | CI: builds marketing site in `/site` with Astro, enforces 50 KB gzipped JS budget, deploys to GitHub Pages via `actions/deploy-pages@v4` on push to `develop` when `site/**` changes |
| `site/` | Public marketing site (Astro + Tailwind + MDX + Preact). Self-contained, published at `BlackBeltTechnology.github.io/pi-agent-dashboard` (later `pi-dashboard.dev`). Uses Pi-blue palette, Supabase-style playful bento grid, 4-state storytelling hero animation. |
| `site/src/components/HeroAnimation.tsx` | Preact island — the only hydrated hero component. Cycles through dashboard state screenshots every 6s with motion-one crossfade; pauses on hover/touch; respects `prefers-reduced-motion`. |
| `site/src/content/features.ts` | Data-driven feature list rendered by `BentoGrid.astro` into the 12-card bento layout. |
| `site/scripts/screenshots/capture.ts` | Playwright screenshot pipeline. Two modes: `SCREENSHOT_TARGET_URL=<url> npm run screenshots` captures against an existing dashboard (recommended); plain `npm run screenshots` spawns a temp `pi-dashboard` with fixture sessions, captures desktop (1440) + mobile (390), and cleans up. Outputs to `site/public/screenshots/{desktop,mobile}/`. |
| `site/scripts/check-js-size.mjs` | Enforces the 50 KB gzipped JavaScript budget on `site/dist/**/*.js` (wired to `npm run size` and to the deploy workflow). |

## Build & Restart Workflow

The dashboard has three components that need rebuilding depending on what changed:

### After bridge extension changes (`src/extension/`)
Reload all connected pi sessions to pick up the new bridge code:
```bash
npm run reload          # Reload all pi sessions
npm run reload:check    # Type-check first, then reload
```

### After server changes (`src/server/`, `src/shared/`)
Restart the dashboard server. The server runs TypeScript directly via jiti (pi's TypeScript loader), so no separate build step is needed — just restart:
```bash
# Graceful restart via API (preserves current dev/prod mode)
curl -X POST http://localhost:8000/api/restart

# Or via CLI
pi-dashboard restart              # production mode
pi-dashboard restart --dev        # dev mode

# Manual stop + start
pi-dashboard stop && pi-dashboard start
pi-dashboard stop && pi-dashboard start --dev
```

### After client changes (`src/client/`)
- **Dev mode**: Vite hot-reloads automatically, no action needed. Start with `npm run dev`.
- **Production mode**: Rebuild the client and restart the server:
  ```bash
  npm run build
  curl -X POST http://localhost:8000/api/restart
  ```

### After OpenSpec apply finishes (full rebuild)
When an openspec-apply-change skill completes implementation, do a full rebuild and restart:
```bash
npm run build
curl -X POST http://localhost:8000/api/restart
npm run reload
```

### Check current mode
```bash
curl -s http://localhost:8000/api/health | jq .mode
# Returns "dev" or "production"
```

### Dev mode with production fallback
In `--dev` mode, the server proxies to Vite for HMR. If Vite is not running, it **automatically falls back** to serving the production build from `dist/client/`. This means `pi-dashboard start --dev` always works — no 502 errors.

### Fault-tolerant restart
- `POST /api/restart` waits for the old server to exit, starts a new one, and verifies health
- `POST /api/restart` with body `{"dev": true}` or `{"dev": false}` switches modes
- `pi-dashboard stop` kills stale processes holding the ports (via `lsof`), not just the PID file

## OpenSpec Conventions

When creating OpenSpec change artifacts, always place them at `openspec/changes/<name>/` — never nest under subdirectories like `active/` or `archive/`. Prefer using `openspec change new <name>` CLI to scaffold the directory structure correctly.

## Diagram Style

When creating diagrams, use Mermaid syntax (```mermaid blocks) instead of ASCII box drawings. This applies to explore mode, design documents, and all other artifacts.

## Code Instructions

1. First think through the problem, read the codebase for relevant files.
2. Before you make any major changes, check in with me and I will verify the plan.
3. Please every step of the way just give me a high level explanation of what changes you made.
4. Make every task and code change you do as simple as possible. We want to avoid making any massive or complex changes. Every change should impact as little code as possible. Everything is about simplicity.
5. Maintain a documentation file that describes how the architecture of the app works inside and out.
6. Never speculate about code you have not opened. If the user references a specific file, you MUST read the file before answering. Make sure to investigate and read relevant files BEFORE answering questions about the codebase. Never make any claims about code before investigating unless you are certain of the correct answer - give grounded and hallucination-free answers.
7. For implementation use TDD (Test-Driven Development): write or update tests first to define the expected behaviour, verify they fail, then write the minimal implementation to make them pass.
8. Use DRY (Don't Repeat Yourself): extract reusable logic into separate classes, utilities, or components. If the same pattern appears in multiple places, refactor it into a shared helper.

## Document changes

When an implementation is ready, update AGENTS.md, README.md, and docs/architecture.md. AGENTS.md contains instructions for AI agents, key files, and commands needed to build and operate. README.md contains end-user and developer documentation with CI badges, prerequisites, configuration, and project structure. docs/architecture.md contains detailed data flows, persistence model, reconnection logic, and configuration reference.
