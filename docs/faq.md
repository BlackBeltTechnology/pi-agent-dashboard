# FAQ

FAQ. How-to answers that already live in README.md + docs/. New entries here when same question recurs.

## How to build Windows electron zip + portable .exe?

One command produces both artifacts.

Command: `./packages/electron/scripts/build-installer.sh --windows`. Add `--arch arm64` for ARM.

Outputs (both, single run):
- zip: `packages/electron/out/make/zip/<arch>/PI-Dashboard-<arch>.zip`
- portable .exe: `packages/electron/out/make/portable/<arch>/PI-Dashboard-portable.exe`

Cross-builds Windows from macOS/Linux via Docker. `Dockerfile.build` + `docker-make.sh` run `electron-builder --win portable` then `zip -r`. NSIS installer skipped on cross-build; uninstaller extraction needs Wine. NSIS produced only on native `windows-latest` CI.

### Zip only (no Docker)

Local electron-builder path. Skips Docker. Two steps from `packages/electron/`:

1. `../../node_modules/.bin/electron-forge package --platform win32 --arch x64`
2. `npx electron-builder --win zip --x64 --prepackaged out/PI-Dashboard-win32-x64`

`electron-builder` lives as devDependency in `packages/electron/package.json`.
Native Windows host required for matching `node-pty` prebuilds. Cross-package from macOS/Linux runs but bundled native modules mismatch target.
Output: `packages/electron/dist/` (electron-builder default `directories.output`) unless `--config` overrides.

Cross-refs:
- README.md:46
- README.md:613
- docs/installation-windows.md:18
- docs/installation-windows.md:396
- docs/release-process.md:155
- docs/electron-session.md:288
- docs/electron-session.md:553
- docs/file-index-electron.md

## What are the three ways to install the dashboard?

Three install paths. Pick one.

- **A — Electron desktop app**: pre-built installer from GitHub Releases. No prerequisites. Standalone mode bundles Node.js, auto-installs pi + dashboard + openspec into `~/.pi-dashboard/`.
- **B — pi package**: `pi install npm:@blackbelt-technology/pi-agent-dashboard`. Bridge auto-starts server on first `pi` launch. Requires Node.js ≥ 22.18.0, pi, C++ build tools.
- **C — From source**: `git clone` + `npm install` + `pi install /path/to/pi-agent-dashboard`. Contributors.

Cross-refs:
- README.md:34
- README.md:38
- README.md:54
- README.md:69

## How do I install the dashboard as a pi package?

Path B. Single npm install via pi.

Command: `pi install npm:@blackbelt-technology/pi-agent-dashboard`.

- Run `pi` afterward. Bridge auto-starts dashboard server on first launch.
- First-launch banner: `🌐 Dashboard started at http://localhost:8000`.
- Open `http://localhost:8000`. Active sessions appear automatically.
- Prerequisites apply (Node.js ≥ 22.18.0, pi, C++ build tools for `node-pty`).

Cross-refs:
- README.md:54
- README.md:129

## How do I install pi-dashboard without Electron?

Direct npm install. pi/openspec/tsx come in as regular npm dependencies.

Commands:
```bash
npm install -g @blackbelt-technology/pi-agent-dashboard
pi-dashboard start
```

- Server binds `:8000`. Open `http://localhost:8000`.
- No first-run install delay. pi/openspec/tsx ship as regular deps of `@blackbelt-technology/pi-dashboard-server`; npm pulls them in at install time.
- `cli.ts` logs `[bootstrap] ready (pi resolved via <source>)` on successful resolve.
- Resolution failure throws hard with `corrupted node_modules` hint. Reinstall to recover.
- Requires Node.js ≥ 22.18.0. `npm` on PATH.

Cross-refs:
- docs/service-bootstrap.md — "Standalone npm install"
- packages/server/src/cli.ts — `runForeground`
- packages/shared/src/tool-registry/ — `ToolRegistry.resolve("pi")`

## How do I install from source for development?

Path C. Clone repo, install deps, register as pi package.

Commands:
```bash
git clone https://github.com/BlackBeltTechnology/pi-agent-dashboard.git
cd pi-agent-dashboard
npm install
pi install /path/to/pi-agent-dashboard          # global
pi install -l /path/to/pi-agent-dashboard       # project-local
```

- Single-session try without registering: `pi -e /path/to/pi-agent-dashboard/packages/extension/src/bridge.ts`.
- Remove with `pi remove /path/to/pi-agent-dashboard`.
- Alternative: add path to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project) under `"packages": [...]`.

Cross-refs:
- README.md:69

## What are the prerequisites for installing the dashboard?

Required for paths B + C only. Path A (Electron) bundles everything.

| Requirement | Why |
|---|---|
| **pi** (`@earendil-works/pi-coding-agent`) | Agent monitored by dashboard |
| **Node.js ≥ 22.18.0** | Server runtime. 22.0.0–22.17.x and 24.1.0–24.2.x crash Fastify per nodejs/node#58515 |
| **C++ build tools** | `node-pty` native addon for terminal. Xcode CLI (macOS) / `build-essential` (Linux) |

Optional:
- **tmux** — when `spawnStrategy: "tmux"`.
- **zrok** — when `tunnel.enabled: true` (default).

Cross-refs:
- README.md:129

## How do I start the dashboard server manually?

Run `cli.ts` via `tsx`. Foreground process.

Commands:
```bash
npx tsx packages/server/src/cli.ts
npx tsx packages/server/src/cli.ts --port 8000 --pi-port 9999
npx tsx packages/server/src/cli.ts --dev          # proxy to Vite
```

- Default ports: HTTP/browser WS `8000`, pi extension WS `9999`.
- `--dev` proxies client to Vite dev server. Falls back to `dist/client/` production build when Vite not running.

Cross-refs:
- README.md:282
- README.md:306

## How do I run the dashboard as a daemon?

`pi-dashboard` CLI. Background process.

Commands:
```bash
pi-dashboard start              # production daemon
pi-dashboard start --dev        # dev mode (Vite proxy + fallback)
pi-dashboard stop               # stop, also kills stale port holders
pi-dashboard restart            # restart (production)
pi-dashboard restart --dev      # restart in dev mode
```

- Logs append to `~/.pi/dashboard/server.log` with timestamped headers per start.
- `restart` delegates to `POST /api/restart` when dashboard already up.
- Graceful restart via API: `curl -X POST http://localhost:8000/api/restart`. Body `{"dev":true|false}` switches mode.

Cross-refs:
- README.md:269
- README.md:290

## How do I check the dashboard daemon status?

CLI subcommand or health endpoint.

Commands:
```bash
pi-dashboard status                                       # daemon status
curl -s http://localhost:8000/api/health | jq .mode       # "dev" or "production"
curl -s http://localhost:8000/api/health | jq             # full metrics
```

`/api/health` returns:
- `mode` — `"dev"` or `"production"`.
- `server.rss`, `server.heapUsed`, `server.heapTotal`.
- `server.activeSessions`, `server.totalSessions`.
- `agents[]` — per-agent CPU%, RSS, heap, `eventLoopMaxMs`, system load (15s heartbeats).

Cross-refs:
- README.md:269
- README.md:489

## How does the auto-start flow work?

Bridge extension TCP-probes `piPort` on every pi session start. Spawns server detached when port closed and `autoStart: true`.

Sequence:
1. `pi` session starts → `ensureConfig` → `loadConfig`.
2. TCP probe `:piPort` (default `9999`).
3. Port open → connect to existing server.
4. Port closed + `autoStart: true` → `child_process.spawn` with `detached: true` + `unref()`. Server outlives pi session.
5. Bridge prints `🌐 Dashboard started at http://localhost:8000` and connects.
6. Port closed + `autoStart: false` → skip.

- Concurrent spawns from multiple pi sessions fail harmlessly with `EADDRINUSE`.
- Disable via `"autoStart": false` in `~/.pi/dashboard/config.json`.
- Bridge honours `PI_DASHBOARD_URL=ws://host:port` to point at remote server instead of localhost.

Cross-refs:
- README.md:265
- README.md:470
- docs/architecture.md:13

## How do I retry the dashboard server launch from the Electron app?

Initial `ensureServer()` attempts run during Electron startup. Failure shows loading page with "Cannot connect to dashboard server".

Loading page exposes:
- **"Start server" button** → calls `requestServerLaunch()` via `dashboard:request-launch` IPC.
- **"Open Doctor" link** → `dashboard:open-doctor` IPC.
- Collapsible **"Server log" panel** → last 20 lines of `~/.pi/dashboard/server.log` via `dashboard:read-server-log`.

System tray menu shows **"Start server"** when no server running, **"Restart server"** when running. Polls every 3s.

All entry points share idempotent `requestServerLaunch()` in `packages/electron/src/lib/server-lifecycle.ts`. Concurrent calls share one inflight spawn attempt.

`force: true` POSTs `/api/shutdown`, waits up to 5s for port to close, spawns fresh.

Failures returned as `{ kind: "failed", reason, logTail }` value, never thrown.

Cross-refs:
- README.md:268
- packages/electron/src/lib/server-lifecycle.ts

## Why does Electron show "Cannot connect to dashboard server" after fresh boot, with only a banner line in server.log?

`launchDashboardServer` fell back to `process.execPath` (Electron GUI binary) as Node interpreter. Spawned child re-launched the app, hit single-instance lock, exited silently — producing only `[<ts>] Electron launch (parent pid …)` header in `~/.pi/dashboard/server.log` with no follow-up output.

Fixed in change `fix-electron-server-launch-node-bin`: both Electron launchers (`spawnFromSource`, `launchServer`) call `pickNodeForServer()` — selects bundled Node first, system Node fallback, `process.execPath`+`ELECTRON_RUN_AS_NODE=1` as last resort.

**Workaround (pre-fix builds):** Start a `pi` CLI session first — bridge extension spawns server with real Node binary, then Electron connects.

**Verify fix:** `ps aux | grep pi-dashboard-server` shows `Resources/node/bin/node --import … cli.ts`, not the Electron binary path.

Cross-refs:
- packages/electron/src/lib/pick-node.ts
- packages/electron/src/lib/server-lifecycle.ts
- packages/shared/src/server-launcher.ts

## How do I configure the dashboard?

Edit `~/.pi/dashboard/config.json` or click gear icon in sidebar header.

Precedence: CLI flags → env vars → config file → built-in defaults.

Common keys:
- `port` (default `8000`) — HTTP + browser WebSocket port
- `piPort` (default `9999`) — Pi extension WebSocket port
- `autoStart` (default `true`) — bridge auto-spawns server
- `autoShutdown` (default `false`) — server shuts down when idle
- `shutdownIdleSeconds` (default `300`)
- `spawnStrategy` (default `"headless"`) — `"headless"` or `"tmux"`
- `reattachPlacement` (default `"always"`) — `"always"` / `"streaming-only"` / `"preserve"`
- `devBuildOnReload` (default `false`)
- `askUserPromptTimeoutSeconds` (default `300`; `≤0` = wait indefinitely)

CLI flags: `--port`, `--pi-port`, `--dev`, `--no-tunnel`.
Env vars: `PI_DASHBOARD_PORT`, `PI_DASHBOARD_PI_PORT`, `PI_DASHBOARD_URL` (bridge → remote server).

Live-reconfigurable via `PUT /api/config` — partial merge, secrets preserved as `***`. Port/piPort changes set `restartRequired: true`.

Cross-refs:
- README.md:177
- README.md:194
- docs/architecture.md:886

## Where is the dashboard config file located?

`~/.pi/dashboard/config.json`. Auto-created with defaults on first run.

Companion files in same directory:
- `tool-overrides.json` — machine-local tool path overrides
- `server.log` — daemon stdout/stderr (append mode, timestamped headers)
- `headless-pids.json` — headless session PID registry
- `zrok.pid` — active zrok subprocess PID

Cross-refs:
- README.md:178
- docs/architecture.md:959

## Why do all my PWA installs of the dashboard have the same name on the launcher?

Server serves `/manifest.json` dynamically per request.

Name format: `Pi-Dash · <source>`. Source resolution order:
1. `dashboardName` field in `~/.pi/dashboard/config.json` (override).
2. Request `Host` header, port stripped, IPv6-safe.
3. `os.hostname()`.
4. Literal `"Pi-Dash"`.

Result: each origin (`laptop.local`, `nas.local`, `abc.share.zrok.io`) gets distinct launcher label. `short_name` truncated to 12 chars.

Override via Settings → General → "PWA Display Name". Empty value clears override. Config re-read per request — no server restart needed.

Refresh behavior:
- iOS Safari freezes name at install time. Uninstall + re-add for new name.
- Chrome / Edge / Android refresh manifest within ~24h.

## How do I set up OAuth authentication for external access?

Add `auth.providers` block to `~/.pi/dashboard/config.json`. Localhost stays unguarded; external (tunnel) requests must authenticate.

```json
{
  "auth": {
    "secret": "auto-generated-if-omitted",
    "providers": {
      "github":   { "clientId": "...", "clientSecret": "..." },
      "google":   { "clientId": "...", "clientSecret": "..." },
      "keycloak": { "clientId": "...", "clientSecret": "...", "issuerUrl": "https://keycloak.example.com/realms/myrealm" }
    },
    "allowedUsers": ["octocat", "user@example.com", "*@company.com"]
  }
}
```

Keys:
- `auth.secret` — JWT signing secret (auto-generated if omitted)
- `auth.providers` — provider → `{ clientId, clientSecret, issuerUrl? }`
- `auth.allowedUsers` — usernames, emails, or `*@domain` wildcards. Empty = allow all
- `auth.bypassHosts` — trusted networks (CIDR/wildcard/exact); written by Settings → Security → Trusted Networks
- `auth.bypassUrls` — path-prefix allowlist

Callback URL: register `https://<tunnel-url>/auth/callback/<provider>` in OAuth provider settings. Tunnel URL stable across restarts via reserved share.

JWT cookie `pi_dash_token` set on success (7-day expiry). WebSocket upgrades validated identically. `/auth/*`, `/api/health`, localhost, and trusted IPs bypass the `onRequest` hook.

Cross-refs:
- README.md:213
- docs/architecture.md:869

## What OAuth providers are supported?

`github`, `google`, `keycloak`, `oidc` (generic OIDC with `issuerUrl`).

GitHub uses hardcoded endpoints. Google / Keycloak / generic `oidc` use OIDC discovery via `issuerUrl`.

Separate from dashboard auth: provider auth (sign-in to LLM providers) supports Anthropic, OpenAI Codex, GitHub Copilot, Gemini CLI, Antigravity via Settings → Providers. Credentials written to `~/.pi/agent/auth.json` (`0600`, lockfile + atomic write).

Cross-refs:
- README.md:240
- docs/architecture.md:878
- docs/architecture.md:1264

## How do I set up a zrok tunnel for a persistent public URL?

Install zrok, enrol with token, leave `tunnel.enabled: true` (default).

Steps:
1. `brew install zrok` (macOS) or download from zrok.io
2. `zrok enable <token>` — writes `~/.zrok2/environment.json` (or `~/.zrok/environment.json`)
3. Start dashboard. Server runs `zrok reserve public` if `tunnel.reservedToken` not set; saves token to config.json
4. Server spawns `zrok share reserved <token> --headless`; URL parsed from stdout (30s timeout)

Reserved share = stable URL across restarts. PID tracked in `~/.pi/dashboard/zrok.pid`.

Disable: set `tunnel.enabled: false` or pass `--no-tunnel`. Stale-process cleanup runs unconditionally on startup whenever zrok binary present.

Endpoints:
- `GET /api/tunnel-status` — `{ status: "active"|"inactive"|"unavailable", url?, serverOs }`
- `POST /api/tunnel-connect` / `POST /api/tunnel-disconnect`

Dashboard never stores zrok API keys — they live in zrok's config directory.

Cross-refs:
- README.md:259
- docs/architecture.md:978

## Why does my zrok tunnel sometimes return Bad Gateway, and is there auto-recovery?

Long-lived `zrok share` subprocess goes stale on zrok edge after hours/days. Local process alive; edge drops backend; browser sees 502/504/Bad Gateway. Subprocess heartbeat does not detect this — only end-to-end probe through public URL does.

Dashboard ships tunnel watchdog (default on). Probes `GET ${publicUrl}/api/health` via public zrok URL every 60 s; 5xx/network/timeout count as failures. After 2 consecutive failures: `deleteTunnel()` + `createTunnel()`. Reserved token preserved — URL stays same.

Config under `tunnel.watchdog` in `~/.pi/dashboard/config.json`:
- `enabled` (default true)
- `intervalMs` (default 60000)
- `failureThreshold` (default 2)
- `probeTimeoutMs` (default 10000)

Recycle-failure backoff ×2 up to ×8 cap; resets on first successful probe.

Observe: `GET /api/tunnel-status` — active variant carries `watchdog: {lastProbeAt, lastSuccessAt, lastFailureAt, lastFailureReason, consecutiveFailures, lastRecycleAt, recycleCount}`.

Tunable in Settings → Tunnel (enable toggle + Probe Interval + Failure Threshold + Probe Timeout). Saves apply live: `PUT /api/config` stops + restarts watchdog with new params. No server restart required.

Disable: set `tunnel.watchdog.enabled: false` (or untick in Settings).

Cross-refs:
- docs/architecture.md → "Tunnel watchdog"
- packages/server/src/tunnel-watchdog.ts

## How do I customize tool paths instead of using PATH?

Edit `~/.pi/dashboard/tool-overrides.json` or use Settings → General → Tools.

```json
{
  "version": 1,
  "overrides": {
    "pi":              { "path": "C:\\custom\\pi.cmd" },
    "pi-coding-agent": { "path": "D:\\dev\\pi-coding-agent\\dist\\index.js" }
  }
}
```

Resolved tools: `pi`, `pi-coding-agent`, `openspec`, `npm`, `node`, `tsx`, `git`, `zrok`, `pi-dashboard`.

Strategy chain per tool: override → managed install → bare-import / npm-global → PATH (`where`/`which`).

Settings UI:
- Shows resolved tool, source, full `tried[]` diagnostic trail
- Per-tool override path input
- Rescan individually or all
- Export full diagnostic report

Invalid overrides (path missing) recorded in trail; registry falls through to next strategy. File deliberately separate from `config.json` — machine-local, not synced via dotfiles.

Cross-refs:
- README.md:269
- docs/architecture.md:1499
- docs/architecture.md:1539

## How do I switch between headless and tmux session spawning?

Set `"spawnStrategy": "tmux"` (or `"headless"`) in `~/.pi/dashboard/config.json`.

Modes:
- `"headless"` (default) — pi runs as background process, no terminal attached, interaction through web UI
- `"tmux"` — pi runs inside tmux session named `pi-dashboard`, each spawn = new window

Attach to tmux:
```bash
tmux attach -t pi-dashboard
tmux list-windows -t pi-dashboard
# Ctrl-b n / p / w        # next / prev / picker
```

Internal `SpawnMechanism` resolves user `SpawnStrategy` against platform availability:
1. Electron mode → `headless`
2. `userStrategy === "headless"` → `headless`
3. Unix with tmux → `tmux`; without → `headless`
4. Windows: `wt` if available, else `wsl-tmux`, else `headless`

tmux requires `tmux` on PATH. Headless on Windows uses `pi.cmd --mode rpc` with `shell: true`; Unix uses `tail -f /dev/null | pi --mode rpc`.

Cross-refs:
- README.md:359
- docs/architecture.md:1151
- docs/architecture.md:1156

## What is the typical local development workflow?

Three terminals: dashboard server `--dev`, Vite dev server, pi with bridge.

Commands:
- `npx tsx packages/server/src/cli.ts --dev` — server in dev mode (proxies to Vite, falls back to `dist/client/`)
- `npm run dev` — Vite HMR for web client
- `pi -e packages/extension/src/bridge.ts` — pi with bridge extension (or plain `pi` if installed)

Open `http://localhost:8000` (server proxies SPA routes + assets to Vite) or `http://localhost:3000` (Vite directly, proxies API/WS to `:8000`).

Deploy after changes:
- Client (production): `npm run build` then `curl -X POST http://localhost:8000/api/restart`
- Server: `curl -X POST http://localhost:8000/api/restart` (TS runs directly via jiti, no build)
- Bridge extension: `npm run reload`
- Full rebuild: `npm run build` + `/api/restart` + `npm run reload`

Cross-refs:
- README.md:522
- README.md:538
- AGENTS.md:475

## How do I set up the development environment?

Clone, install, register bridge extension.

Commands:
```
git clone https://github.com/BlackBeltTechnology/pi-agent-dashboard.git
cd pi-agent-dashboard
npm install
pi install /path/to/pi-agent-dashboard            # global registration
# or: pi install -l /path/to/pi-agent-dashboard   # project-local
```

Single-session trial without registering: `pi -e /path/to/pi-agent-dashboard/packages/extension/src/bridge.ts`.

Remove with `pi remove /path/to/pi-agent-dashboard`. Or add path directly to `~/.pi/agent/settings.json` under `"packages": [...]`.

Prerequisites:
- pi (`npm i -g @earendil-works/pi-coding-agent`)
- Node.js ≥ 22.18.0 (older 22.x / 24.x < 24.3.0 hit nodejs/node#58515 Fastify crash)
- C++ build tools for `node-pty` (Xcode CLI Tools / `build-essential`)

Dev commands:
- `npm test` / `npm run test:watch` — vitest
- `npm run lint` — `tsc --noEmit`
- `npm run build` — Vite client build
- `npm run dev` — Vite dev server

Cross-refs:
- README.md:74
- README.md:111
- README.md:507

## How do I build the Electron app?

See full comparison of all three build methods: `docs/electron-build-methods.md`.


Single command for current platform.

Command: `npm run electron:build` (= `bash packages/electron/scripts/build-installer.sh`).

Flags:
- `--arch x64` — override architecture
- `--skip-client` — skip client rebuild

Step-by-step equivalent:
```
npm run build                         # web client
cd packages/electron
bash scripts/download-node.sh         # bundled Node.js
npm run make                          # electron-forge make
```

Outputs in `packages/electron/out/make/`:
- macOS: `.dmg`
- Linux: `.deb` + `.AppImage`
- Windows: `.exe` (NSIS) + `.zip` + portable `.exe`

Prerequisite: Node.js 22.12+. Forge handles platform tools.

Cross-refs:
- README.md:586
- README.md:590

## How do I build Electron for multiple platforms?

Docker cross-compile from macOS/Linux.

Commands:
- `npm run electron:build -- --all` — macOS native + Linux + Windows (Docker)
- `npm run electron:build -- --linux` — Linux `.deb` + `.AppImage`
- `npm run electron:build -- --windows` — Windows `.exe` (NSIS) + `.zip` + portable
- `npm run electron:build -- --linux --windows` — both, skip native
- `npm run electron:build -- --mac-both` — arm64 + x64 DMGs on Apple Silicon

`--mac-both` requires Rosetta 2 (`softwareupdate --install-rosetta --agree-to-license`) for node-pty x64 prebuilt unpacking. Script wipes per-arch caches via `resources/.last-arch` sentinel between runs. Intel macs cannot cross-build arm64 (Rosetta one-way).

Docker image: Node 22 Debian + NSIS for Windows cross-compile. NSIS uninstaller skipped on cross-build (needs Wine); produced only on native `windows-latest` CI.

Outputs: `packages/electron/out/make/`.

Cross-refs:
- README.md:615
- README.md:626

## How do I generate native icons for Electron?

Single npm script regenerates all platform variants from master PNG.

Command:
```
cd packages/electron
npm run icons
```

Underlying: `electron-icon-builder --input=resources/icon.png --output=resources --flatten`.

Master input: `packages/electron/resources/icon.png` (1024×1024).
Outputs: `.icns` (macOS), `.ico` (Windows), resized PNGs.

Cross-refs:
- README.md:650

## How do I cut a new release?

`npm version` + tag push fires `publish.yml`.

Commands:
```
npm version patch          # or minor / major
git push --follow-tags
```

Workflow on `v*` tag:
1. CI (lint + test + build)
2. `npm publish --workspaces --include-workspace-root --provenance`
3. Build Electron installers on native runners (matrix below)
4. Upload to draft GitHub Release; release notes from matching `## [<version>]` section of `CHANGELOG.md`

Native runners:
- `macos-14` → arm64 `.dmg`
- `macos-15-intel` → x64 `.dmg`
- `ubuntu-latest` → x64 `.deb` + `.AppImage`
- `ubuntu-24.04-arm` → arm64 `.deb`
- `windows-latest` → x64 `.exe` (NSIS) + `.zip` + portable
- `windows-latest` (arm64) → `.zip` + portable (x64 Node.js via WoW64)

Skill: `release-cut` automates `CHANGELOG.md` promotion + workspace `package.json` bumps + tag.

Cross-refs:
- README.md:670
- README.md:674
- docs/release-process.md:60

## How do I get an installer for a feature branch without cutting a release?

CI dispatch workflow. No release, no publish, no tag.

Steps:
1. GitHub Actions tab → **CI Electron (on-demand)** workflow → **Run workflow** button.
2. Select branch. Optional `legs` input narrows the matrix (default `all`; accepts `darwin`, `linux`, `win32`, or comma-list like `darwin-arm64,linux-x64`; pick `linux-x64` for cheap iteration).
3. Wait for legs to finish. Download artifacts from the run page → **Artifacts** section.

Version slug: `<base>-ci.<UTC-stamp>.<branch-slug>.<sha7>` (e.g. `0.5.3-ci.20260525-143000.feature-foo-bar.abc1234`). Prerelease segment SemVer-ranks strictly below `<base>`.

Retention 14 days. Past 14 days → re-dispatch from same commit.

No effect on installed-user update channel — `electron-updater` default `allowPrerelease: false` skips `-ci.` slugs. No npm publish, no GitHub Release.

Cross-refs:
- README.md → "On-demand Electron build (CI dispatch)"
- .github/workflows/ci-electron.yml
- .github/workflows/_electron-build.yml
- See change: add-ci-electron-on-demand-build

## What is the npm Trusted Publishers setup for releases?

OIDC token exchange replaces `NPM_TOKEN`. Per-package one-time configuration on npmjs.com.

Workflow requirements (already set in `.github/workflows/publish.yml`):
```yaml
permissions:
  contents: write   # release + tag push
  id-token: write   # OIDC token exchange
environment: npm-publish
```

npm CLI ≥ 11.5.1 required; workflow runs `npm install -g npm@latest` before publish. Provenance attached automatically.

Per-package npm setup (5 packages; `@blackbelt-technology/pi-dashboard-electron` private, skipped):
- `@blackbelt-technology/pi-agent-dashboard`
- `@blackbelt-technology/pi-dashboard-shared`
- `@blackbelt-technology/pi-dashboard-extension`
- `@blackbelt-technology/pi-dashboard-server`
- `@blackbelt-technology/pi-dashboard-web`

Steps per package: npmjs.com → package → Settings → Trusted Publisher → GitHub Actions. Fields:
- Organization: `BlackBeltTechnology`
- Repository: `pi-agent-dashboard`
- Workflow filename: `publish.yml` (filename only)
- Environment name: `npm-publish` (must match `environment:` in workflow)

Optional GitHub Environment gate: repo Settings → Environments → New `npm-publish`. Add required reviewers and/or branch/tag rules (e.g. restrict to `v*`).

No secrets to rotate.

Cross-refs:
- README.md:696
- README.md:698

## What does the bridge extension do?

Global pi extension. Runs in every pi session. Forwards events to dashboard server, relays commands back.

- Connects to dashboard server via WebSocket on port 9999.
- Detects session source (TUI, Zed, tmux, dashboard-spawned) via `.meta.json` sidecars + env vars.
- Auto-starts dashboard server on first launch when none running (disable via `autoStart: false`).
- Reconnects with exponential backoff + event buffering.
- Sends heartbeats every 15s with process metrics (CPU%, RSS, heap, event-loop max delay, load average); server replies `heartbeat_ack`.
- Server liveness watchdog: forces reconnect if no message for 60s.
- Hosts `PromptBus` — patches `ctx.ui` (`confirm`/`select`/`input`/`editor`/`multiselect`) and routes through registered adapters.
- Inlines local-image markdown (`![alt](/abs/path.png)` → `pi-asset:<sha256-16>`) before text leaves agent process.
- Honors `PI_DASHBOARD_URL=ws://host:port` to point at remote server.

Cross-refs:
- docs/architecture.md:29
- README.md:460
- packages/extension/src/bridge.ts

## What are the three main components of the dashboard?

Bridge extension + dashboard server + web client. Connected by two WebSocket gateways.

| Component | Location | Role |
|---|---|---|
| Bridge Extension | `packages/extension/` | Runs inside every pi session. WS client → port 9999. Forwards events, relays commands, hosts PromptBus, auto-starts server. |
| Dashboard Server | `packages/server/` | Node.js HTTP + dual WebSocket gateways (Pi gw 9999, Browser gw 8000). In-memory event buffer (LRU 100 sessions × 5000 events), JSON persistence, terminals, auth, tunnel. |
| Web Client | `packages/client/` | React + Tailwind responsive UI. WebSocket subscription to browser gateway. |

Shared types live in `packages/shared/src/` (`protocol.ts`, `browser-protocol.ts`, `types.ts`).

Cross-refs:
- docs/architecture.md:14
- docs/architecture.md:27
- README.md:458

## How does event flow work from pi to the browser?

Five steps. Pi event → bridge → server in-memory buffer → broadcast → React render.

1. Pi emits event (e.g. `message_update`).
2. Bridge converts to `event_forward` protocol message.
3. Server receives, stores in in-memory buffer, assigns sequence number.
4. Server broadcasts to all subscribed browsers via `event` message.
5. Browser event reducer processes, React renders update.

Side effects in step 3:
- `isActivityEvent(eventType)` allowlist match (`prompt_send`, `message_*`, `turn_end`, `tool_execution_*`, `agent_*`, `bash_output`, `flow_*`, `architect_*`) → stamps `session.lastActivityAt = Date.now()`. `session_updated` broadcast throttled ≤ 1×/30s/session.
- `isUnreadTrigger(...)` evaluated → may flip `session.unread = true` (see unread state machine entry).
- Heartbeat/metrics events (`process_metrics`, `git_info_update`, `model_select`, `ui_data_list`, `ext_ui_decorator`) excluded from activity stamping.
- Replaying sessions skipped (`replayingSessions.has(sessionId)`).
- Payloads truncated (tool results, file content, thinking blocks) to bound memory.
- Backpressure: browser sends drop when WS buffer > 4MB.

Cross-refs:
- docs/architecture.md:98
- packages/server/src/event-wiring.ts
- packages/server/src/event-status-extraction.ts

## What is the PromptBus and how does it route interactive dialogs?

Unified prompt-routing layer in bridge. Extension `ctx.ui.*` calls fan out to registered adapters; first-response wins.

Flow:
1. Extension calls `ctx.ui.confirm()` / `select()` / `input()` / `editor()` / `multiselect()`.
2. Bridge PromptBus intercepts via patched `ctx.ui`, builds `PromptRequest { promptId, pipeline }`.
3. Adapters claim:
   - `DashboardDefaultAdapter` (always registered) → `PromptClaim { component: { type: "generic-dialog", props }, placement: "inline" }`.
   - Custom adapters (e.g. `ArchitectUIAdapter` from pi-flows) via `pi.events.emit("prompt:register-adapter", adapter)`.
   - Bridge inline TUI adapter (captures original `ctx.ui` before patching) for `select`/`input`/`confirm`/`editor`. Multiselect bypasses TUI arm — bus-routed only.
4. Bus sends `prompt_request` to server, forwards to subscribed browsers.
5. Client `prompt-component-registry.ts` resolves `component.type` to React renderer + placement (`inline` / `widget-bar` / `overlay`); unknown types fall back to `generic-dialog`.
6. User responds → `prompt_response` → server → bridge → bus resolves promise; calls `onCancel()` on losing adapters.

Protocol messages: `prompt_request`, `prompt_dismiss`, `prompt_cancel`, `prompt_response`. All MUST be in `ServerToBrowserMessage` union (esbuild strips switch arms typed `as any`).

Resilience: server replays pending `prompt_request` on browser subscribe (dedup by `requestId`); bridge replays on WS reconnect.

Multiselect note: pi 0.70 RPC's `ctx.ui.custom` is no-op → bridge attaches `ctx.ui.multiselect` at `session_start`, routes through `polyfillMultiselect` → bus → `MultiselectRenderer`. Empty `[]` distinct from cancel via `JSON.stringify(values)` in `prompt_response.answer`.

Cross-refs:
- docs/architecture.md:119
- docs/architecture.md:132
- README.md:109
- packages/extension/src/prompt-bus.ts

## What happens when I type during an agent turn?

Message queues. Bridge owns `PromptQueue` per session.

- Above `CommandInput`, `QueuePanel.tsx` shows chip per queued message.
- Click "Clear all" drops entire queue (`queue_clear` action).
- Bridge runs queued messages in order after current turn ends (on `agent_end`, drains via `pi.sendUserMessage`).
- Queue lost on bridge restart — in-memory only.

Cross-refs:
- packages/extension/src/prompt-queue.ts
- packages/client/src/components/QueuePanel.tsx
- See change: surface-mid-turn-prompt-queue

## How does the unread state machine work?

`Session.unread: boolean`. Flips true when attention-worthy event fires while no browser views session. Clears when any browser opens session.

Triggers (pure helper `isUnreadTrigger(eventType, before, after, payload)` in `event-status-extraction.ts`):
1. Status transitions `streaming` → `idle` or `active` (turn finished).
2. `currentTool` becomes `"ask_user"` (input requested).
3. `agent_end` event with truthy `payload.error` (something broke).

Other events (`message_end`, tool start/end, model/git/metrics) deliberately do NOT trigger — too noisy on long turns.

Viewed registry (`viewed-session-tracker.ts`): `Map<sessionId, Set<WebSocket>>`. Browsers populate via `session_view` / `session_unview` messages from `useViewDispatcher` hook (watches `/session/:id` route + WS status). Re-sends `session_view` on every transition INTO `connected`. WS close → `tracker.unviewAll(ws)`. Read state GLOBAL across browsers (phone clears laptop unread).

Set logic in `event-wiring.ts` (after `extractSessionUpdates`):
- `isUnreadTrigger === true` AND `viewedSessionTracker.isViewedByAnyone(sessionId) === false` AND `!replayingSessions.has(sessionId)` → stamp `unread = true`, broadcast `session_updated`.
- Browser-gateway `session_view` arm clears `unread = false`, broadcasts. Already-read path no-op.

Persistence: `.meta.json#unread`. `session-scanner.ts::sessionFromMeta` restores on cold start. Cold-start `status = ended` override at `server.ts:273-279` is non-destructive on `unread`.

Render precedence (`SessionCard.tsx::getCardPulseClass`): `ask_user` (purple) > `streaming || resuming` (yellow) > `unread` (cyan `card-unread-pulse`, `rgba(34,211,238,0.18)`) > none. Reduced-motion → static cyan tint.

Cross-refs:
- docs/architecture.md:107
- packages/server/src/event-status-extraction.ts
- packages/server/src/viewed-session-tracker.ts

## What is the extension UI system (management-modal and decorators)?

Pull-based mechanism for extensions to declare dashboard UIs as data. No React, no SDK package. Phase 1 (`management-modal`) + Phase 2 (live decorations) shipped.

Probe (synchronous):
- Bridge emits `pi.events.emit("ui:list-modules", probe)` on `session_start` (`reason ∈ {new,fork,resume}`) and on every `ui:invalidate`.
- Listeners push descriptors into `probe.modules` while emit runs.
- Bridge partitions by `kind`: modal kinds → `ui_modules_list`; decorator kinds → one `ext_ui_decorator` each.
- Server caches under `Session.uiModules` + `Session.uiDecorators[${kind}:${namespace}:${id}]`.

Phase 1 — `management-modal`:
- Slash-command-triggered modal.
- `view.kind` ∈ `"table" | "grid" | "form"`.
- `UiField.kind` ∈ `"text" | "number" | "boolean" | "select" | "code" | "datetime" | "textarea"`.
- `UiAction.confirm` → Tailwind `ConfirmDialog`. Icons via `@mdi/js` keys.
- Slash-command interception in `App.tsx wrappedHandleSend`; built-in collisions (`/model`, `/compact`, `/flows`) drop module with `console.warn`.
- "Modules" entry in `SessionHeader` shown when `session.uiModules?.length > 0`.

Phase 2 — decorators (live in-page decorations):

| Kind | Mount site | Filter |
|---|---|---|
| `footer-segment` | `SessionHeader.tsx` | `kind === "footer-segment"` |
| `agent-metric` | `FlowAgentCard.tsx` | `payload.agentId === card.agentName` |
| `breadcrumb` | top of `FlowDashboard.tsx` | most recent wins |
| `gate` | inline in each `FlowLaunchDialog` | most-restrictive aggregate per `flowId` |
| `toast` | `App.tsx` top-right tray | FIFO cap = 5, auto-dismiss |

Decorator removal explicit: descriptor with `removed: true`. Server deletes cache key, broadcasts removal.

Wire protocol:
- `ui_modules_list { sessionId, modules }` (extension → server → browser).
- `ui_data_list { sessionId, event, items }` (per-event item cap = 1000, last-write-wins).
- `ui_management { sessionId, action, event, params }` (browser → server → extension).
- `ext_ui_decorator { sessionId, descriptor, removed? }` (member of both `ExtensionToServerMessage` + `ServerToBrowserMessage`).

Rate cap: bridge throttles `ui:invalidate` re-probes to 1/50ms (= 20/s); excess coalesces trailing-edge.

Replay ordering: events → pending UI requests → `ui_modules_list` → `ui_data_list` → `ext_ui_decorator` (live entries only, `removed` never replayed).

No-dashboard fallback: bridge never emits `ui:list-modules`; extensions remain pi-runnable unchanged.

Cross-refs:
- docs/architecture.md:180
- README.md:110
- packages/extension/src/ui-modules.ts

## What is the plugin architecture and slot system?

Two-tier rendering model. First-party plugins (React, in `packages/<name>-plugin/`) + third-party extensions (descriptor-only via extension UI system). Both fill same named slot taxonomy.

Tiers:
- **Tier 1** — first-party. Co-located React + server contributions. Bundled and tree-shaken into web build. Trusted (same-repo review).
- **Tier 2** — third-party. Descriptor-only protocol over `pi.events`. Sandboxed, no React.

Slot taxonomy (frozen v0.x):

First-party (React, possibly descriptor): `sidebar-folder-section`, `session-card-badge`, `session-card-action-bar`, `content-view`, `content-header-sticky`, `content-inline-footer`, `anchored-popover`, `command-route`, `settings-section`, `tool-renderer`.

Descriptor-only (extension UI system): `management-modal`, `footer-segment`, `agent-metric`, `breadcrumb`, `gate`, `toast`, `rjsf-form`.

Loader (`packages/dashboard-plugin-runtime/`):
1. **Discovery** — server globs `packages/*/package.json` on startup, parses `pi-dashboard-plugin` field, validates manifest, sorts by `priority` (lower first; first-party = 100; default 1000).
2. **Server load** — dynamic-imports `server` entry, calls `registerPlugin(ctx)` with typed `ServerPluginContext` (Fastify, session manager, event store, broadcast, scoped logger). Per-plugin failure isolated.
3. **Client bundle** — Vite plugin generates `packages/client/src/generated/plugin-registry.tsx` with named imports → tree-shaking + code-splitting per plugin.
4. **Runtime** — client boot calls `getSlotRegistry()` once. Slot consumers (`<SessionCardBadgeSlot/>`, `<ContentViewSlot/>`) iterate registry by `(priority, pluginId)`, render contributions wrapped in `SlotErrorBoundary` (per-claim).
5. **Bridge auto-register** — plugins declaring `bridge` entry auto-register into `~/.pi/agent/settings.json` under `dashboard-<plugin-id>` key.

Plugin config:
- All settings under `plugins.<id>.*` in `~/.pi/dashboard/config.json`.
- Manifest may declare `configSchema` (JSON Schema 7); Ajv validates on read (with defaults) + write (rejects invalid).
- `POST /api/config/plugins/:id` accepts partial config; broadcasts `plugin_config_update { id, config }`.
- `pluginContext.usePluginConfig<T>()` reactive — re-renders within one frame of write.
- Legacy top-level keys (e.g. `openspec.*`) auto-migrate on plugin's first server boot.

Failure isolation: load failure does NOT crash shell. Surfaced via `/api/health.plugins[]` (`{ id, enabled, loaded, error?, claims }`). Runtime crashes scoped per-claim by `SlotErrorBoundary`.

Anti-pattern: slot consumers return `null` when no claim; MUST NOT be left operand of `??` in JSX (operator evaluates JSX element, always truthy). Use `claimCount > 0 ? <Slot…/> : null`. Lint at `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts`.

Bundled-by-default plugins (initial: `git-plugin`) treated identically to others — distinction is purely build-pipeline inclusion.

Cross-refs:
- docs/architecture.md:301
- docs/architecture.md:363
- README.md:466
- packages/dashboard-plugin-runtime/src/slot-registry.ts

## How to add a new session-card subcard?

Mirror MEMORY/FLOWS pattern. Five edits.

1. `packages/shared/src/dashboard-plugin/slot-types.ts` — add slot id to `SlotId` union, `SLOT_DEFINITIONS`, `SessionScopedSlot`.
2. `packages/shared/src/dashboard-plugin/slot-props.ts` — add `SlotPropsMap` entry.
3. `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` — copy `SessionCardMemorySlot`, rename + swap slot id.
4. `packages/client/src/components/SessionCard.tsx` — add `XxxSubcard` wrapper gated by `useSlotHasClaimsForSession`; slot into stack.
5. Plugin manifest declares claim with `shouldRender` ref. Plugin client entry exports predicate. Cache populator runs at module load via `subscribeSessionDataKey` (per-session) or module flag (global). Closed-by-default prevents flicker.

See change: add-flows-subcard for worked example.

Cross-refs:
- docs/file-index-plugins.md
- docs/file-index-shared.md
- docs/file-index-client.md
- docs/plugin-claim-gates.md

## How does the dashboard detect and spawn different session types?

Two-tier type system. User config → platform availability → mechanism. Single pure selector.

Types:
- **`SpawnStrategy`** (user-visible, `shared/config.ts`): `"tmux" | "headless"`. What user wrote.
- **`SpawnMechanism`** (internal, `platform/spawn-mechanism.ts`): `"tmux" | "wt" | "wsl-tmux" | "headless"`. What system actually runs.

Selector `selectMechanism({ platform, userStrategy, electronMode, available })` rules:
1. `electronMode` → `headless`.
2. `userStrategy === "headless"` → `headless`.
3. Unix with `tmux` available → `tmux`; Unix without → `headless`.
4. Windows: `wt` if available → `wt`; else `wsl-tmux` if available → `wsl-tmux`; else `headless`.

Every mechanism branch forwards `sessionFile` + `mode` via shared `sessionFlagsToArgv` helper. No branch may drop options (root cause of fixed Windows fork/continue bugs).

Detection on bridge side: `.meta.json` sidecar + env vars classify session source as TUI / Zed / tmux / dashboard-spawned. PID delivered in `session_register` so server can kill.

Headless command line:
- Unix: `tail -f /dev/null | pi --mode rpc` (avoids `sleep` stdin pipeline bug).
- Windows: `pi.cmd --mode rpc` with `shell: true`, quoted paths for usernames with spaces.

Detached spawn (`platform/detached-spawn.ts`): `spawnDetached` uses `detached: true` on every OS. Windows emits `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, skips `AssignProcessToJobObject` → child excluded from parent's `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Pi sessions survive dashboard restart on all platforms (matches Unix PGID behavior). `headlessPidRegistry` reconciles survivors at `~/.pi/dashboard/headless-pids.json` on server boot.

Reload path selection (`shouldInterceptReload`): headless sessions → server kill-and-respawn (`handleHeadlessReload`). tmux/wt/wsl-tmux → `piGateway.sendToSession` → bridge `__dashboard_reload` command (captures `ctx.reload` from pi's `ExtensionCommandContext` since `ExtensionContext` has no `reload()`).

Cross-refs:
- docs/architecture.md:1147
- docs/architecture.md:1131
- docs/architecture.md:570
- packages/shared/src/platform/spawn-mechanism.ts
- packages/shared/src/platform/detached-spawn.ts

## How do I install pi-dashboard on Windows (Electron portable)?

Path 1 — recommended for most users. Download installer or portable zip from GitHub Releases, run.

Steps:
1. Download from [GitHub Releases](https://github.com/BlackBeltTechnology/pi-agent-dashboard/releases):
   - `PI-Dashboard-<version>-Setup.exe` — installer with Start Menu shortcuts
   - `PI-Dashboard-win32-x64.zip` — portable; unzip + run `pi-dashboard.exe`
2. Launch. Splash window appears within 1 second, progresses through startup phases (Checking server… Detecting agent… Checking bridge… Setup wizard… Launching server… Opening dashboard).
3. First-run setup wizard auto-installs agent runtime into `%USERPROFILE%\.pi-dashboard\node_modules\` using bundled Node.js + npm. No system Node required.
4. Wizard completes → dashboard opens at `http://localhost:8000`.
5. Settings → Providers, configure ≥1 LLM provider.
6. Add folder (top right sidebar), spawn session.

Installer uses bundled Node even when system Node present — sidesteps Windows bug where `spawn("npm", ...)` fails with `ENOENT` because Windows doesn't auto-append `.cmd` extensions.

Cross-refs:
- docs/installation-windows.md:18
- docs/installation-windows.md:36
- docs/installation-windows.md:67
- README.md:34

## How do I set up pi-dashboard offline on Windows (air-gapped)?

First-run offline install without registry traffic. Release Electron builds ship per-platform npm cacache inside `resources/offline-packages/` containing `pi-coding-agent`, `openspec`, `tsx` plus all transitive deps.

Workflow:
1. Download installer `.exe` or `.zip` on offline machine (or download on online machine, transfer via USB).
2. Run on air-gapped machine. Wizard uses bundled cache automatically: extracts tarball to `%USERPROFILE%\.pi-dashboard\.offline-cache\`, runs `npm install --offline`, deletes cache after (~140 MB reclaimed).
3. No registry traffic → no proxy failures → wizard completes without network.

Detection in Doctor window: "Offline packages bundle" row shows target platform + pinned versions. "Not bundled" → dev/feature build; get release artifact instead.

If bundle missing or SHA-256 mismatch → wizard aborts with clear error (never silently falls back). Tarball manual install (Path 2) remains power-user fallback.

Cross-refs:
- docs/installation-windows.md:84
- docs/installation-windows.md:94

## What are the Windows-specific prerequisites for pi-dashboard installation?

Only for Path 2 (tarball / npm). Path 1 (Electron portable) bundles everything.

| Requirement | Why | Command |
|---|---|---|
| **Node.js ≥ 22.18.0** | Server runtime; 22.0.0–22.17.x and 24.1.0–24.2.x crash Fastify per nodejs/node#58515 | Install [MSI](https://nodejs.org/dist/v22.18.0/node-v22.18.0-x64.msi) or use [fnm](https://github.com/Schniz/fnm) |
| **Git for Windows** | Version control | [git-scm.com](https://git-scm.com/download/win); select "Use Git from Windows Command Prompt" |
| **Long paths enabled** | Node's node_modules nesting exceeds Windows default 260-char limit | `reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f` then `git config --global core.longpaths true`; reboot |
| **Windows Build Tools** (optional) | Only if native modules fail to compile (node-pty) | `npm install --global windows-build-tools` or install Visual Studio Build Tools with "Desktop development with C++" workload |

Avoid nvm-windows if username contains non-ASCII characters (misreads paths + fails activation).

Cross-refs:
- docs/installation-windows.md:156
- docs/installation-windows.md:165
- docs/installation-windows.md:172
- docs/installation-windows.md:180

## Why does /ctx-stats work in some sessions but not others?

Pi 0.74 `ExtensionAPI` exposes no `dispatchCommand`. Bridge cannot reach `session.prompt` from inside pi.

Dashboard spawns three session types:

- **Headless RPC** with `useRpcKeeper: true` in `~/.pi/dashboard/config.json` (default `false`): work. Server writes JSON-line to per-session keeper UDS (`~/.pi/dashboard/sessions/<sid>.rpc.sock` Unix; `\\.\pipe\pi-rpc-<sid>` Windows); keeper forwards to pi's stdin; pi's `--mode rpc` runs `session.prompt()` → dispatch.
- **Headless RPC** with `useRpcKeeper: false`: surface `command_feedback {status:"error"}` stopgap ("requires pi 0.71+"). Default state.
- **Tmux / Windows Terminal**: cannot work via dashboard chat regardless of flag. User's terminal owns pi's stdin; no UDS route exists. Use the pi TUI directly for slash commands in those sessions.

Three-way decision lives in `packages/extension/src/slash-dispatch.ts::tryDispatchExtensionCommand` (Path B → Path C → Path D).

Activates the full Path B behavior automatically once upstream `pi.dispatchCommand` ships in pi 0.75+.

See change: `add-rpc-stdin-dispatch-with-keeper-sidecar`. See also `docs/architecture.md` § "RPC keeper sidecar" and `docs/slash-command.md` § "Path C".

## Why does Windows session spawning fail with 'spawn npm ENOENT'?

Electron wizard only — old build before commit `29af651`. Windows `npm` is actually `npm.cmd` (batch wrapper). `child_process.spawn("npm", ...)` without `.cmd` extension fails on Windows.

Symptom: First-run wizard fails during "Installing pi-coding-agent" with ENOENT. pi-coding-agent shows ✗ in Doctor output.

Fix (preferred): Download newer installer or rebuild from branch including `29af651`.

Workaround (no rebuild): Install deps manually, relaunch:

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
if not exist package.json echo {"name":"pi-dashboard-managed","version":"0.0.0","private":true} > package.json
npm install @earendil-works/pi-coding-agent
```

Reopen Dashboard. Doctor shows ✓ pi CLI.

Cross-refs:
- docs/installation-windows.md:222
- docs/installation-windows.md:232

## How do I enable long paths support on Windows?

Node's `node_modules` nesting exceeds Windows default 260-character path limit.

Commands (Admin cmd):
```cmd
reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
git config --global core.longpaths true
```

Then reboot. Without this, `npm install` fails with path-too-long errors.

Cross-refs:
- docs/installation-windows.md:172
- docs/installation-windows.md:177

## How do I install pi-dashboard on Windows from tarballs (Path 2)?

Advanced path for developers validating pre-release builds or headless server-only installs without Electron.

Prerequisites: Node.js ≥ 22.18.0, Git for Windows, long paths enabled, Windows Build Tools (optional).

Steps:

1. Create managed install directory + install agent runtime:
```cmd
mkdir "%USERPROFILE%\.pi-dashboard"
cd /d "%USERPROFILE%\.pi-dashboard"
echo {"name":"pi-dashboard-managed","version":"0.0.0","private":true} > package.json
npm install @earendil-works/pi-coding-agent tsx
```

2. Option A — from npm release:
```cmd
npm install @blackbelt-technology/pi-dashboard-server @blackbelt-technology/pi-dashboard-extension
```

2. Option B — from local tarballs (pre-release):
```bash
# On dev machine (macOS / Linux / Windows)
git clone -b <branch> https://github.com/BlackBeltTechnology/pi-agent-dashboard.git
cd pi-agent-dashboard
npm install && npm run build
mkdir tarballs
npm pack --workspace=packages/shared    --pack-destination=./tarballs
npm pack --workspace=packages/client    --pack-destination=./tarballs
npm pack --workspace=packages/server    --pack-destination=./tarballs
npm pack --workspace=packages/extension --pack-destination=./tarballs
```

Copy all 4 `.tgz` to `%USERPROFILE%\.pi-dashboard\tarballs\` on Windows, then install all together (sibling deps resolve correctly only in single run):

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
npm install ^
  tarballs\blackbelt-technology-pi-dashboard-shared-0.3.0.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-web-0.3.0.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-server-0.3.0.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-extension-0.3.0.tgz
```

3. Launch:
```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
npx pi-dashboard start
```

Open `http://localhost:8000`.

Cross-refs:
- docs/installation-windows.md:131
- docs/installation-windows.md:189
- docs/installation-windows.md:206

## What are the key Windows directory paths for pi-dashboard?

Directory reference for config, logs, sessions, tool overrides.

| Path | Purpose |
|---|---|
| `%USERPROFILE%\.pi-dashboard\` | Managed install directory (Path 2 only) |
| `%USERPROFILE%\.pi-dashboard\node_modules\@earendil-works\pi-coding-agent\` | pi agent runtime |
| `%USERPROFILE%\.pi\dashboard\server.log` | Server stdout/stderr (append mode, timestamped headers) |
| `%USERPROFILE%\.pi\dashboard\preferences.json` | Pinned folders, session ordering |
| `%USERPROFILE%\.pi\dashboard\tool-overrides.json` | Per-tool path overrides (Settings → Tools) |
| `%USERPROFILE%\.pi\dashboard\headless-pids.json` | Tracked child PIDs for orphan cleanup |
| `%USERPROFILE%\.pi\agent\sessions\` | pi agent session history (JSONL per session) |
| `%USERPROFILE%\.pi\agent\settings.json` | pi agent extension registration (auto-managed) |
| `%TEMP%\pi-dashboard-electron.log` | Electron main-process startup log (Path 1 only; diagnostics on slow start) |

Cross-refs:
- docs/installation-windows.md:332

## How do I troubleshoot 'session spawn fails: \[headless\] Windows pi spawn requires node.exe'?

Headless spawn on Windows found `pi.cmd` via PATH but not pi-coding-agent module's `dist/index.js`. Windows headless spawn cannot use `.cmd` wrappers — they require `shell: true`, which breaks detached spawn.

Fixes (in order):

1. **Rescan tools:** Settings → Tools → Rescan (top right). `pi-coding-agent` row flips to ✓ with source=`managed`.

2. **Manual override:** expand `pi-coding-agent` row, paste full path:
   ```
   %USERPROFILE%\.pi-dashboard\node_modules\@earendil-works\pi-coding-agent\dist\index.js
   ```

3. **Restart server:** pi-coding-agent installed *after* pi-dashboard started → server's cached environment stale.
   ```cmd
   pi-dashboard stop && pi-dashboard start
   ```
   Or close + relaunch Electron app.

Cross-refs:
- docs/installation-windows.md:276

## How do I upgrade pi-dashboard on Windows?

Upgrade preserves config + sessions on both Path 1 + Path 2.

**Path 1 (Electron):**
- Installer: download new `.exe`, run it. Old version uninstalls + new installs.
- Portable: download new `.zip`, unzip over (or next to) old folder, launch new `pi-dashboard.exe`.

**Path 2 (tarball):**
```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
pi-dashboard stop

:: Replace tarballs\ with new .tgz files, then:
npm install ^
  tarballs\blackbelt-technology-pi-dashboard-shared-<new>.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-web-<new>.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-server-<new>.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-extension-<new>.tgz

pi-dashboard start
```

Preserved across upgrades:
- `%USERPROFILE%\.pi\dashboard\*` (config, preferences, tool overrides)
- `%USERPROFILE%\.pi\agent\sessions\` (session history)

Cross-refs:
- docs/installation-windows.md:316
- docs/installation-windows.md:327

## How do I fix a white screen in the Electron app on virtual machines?

VMware/VirtualBox don't support hardware GPU acceleration required by Chromium. Auto-detect VM on startup, disable GPU before window creation.

Code path: `packages/electron/src/main.ts::detectVM()`. Checks:
- macOS: `sysctl -n hw.model` for "VMware" / "VirtualBox" / "Parallels"
- Linux: `systemd-detect-virt`
- Windows: WMIC BIOS manufacturer / model string

Fix: Call `app.disableHardwareAcceleration()` + `appendSwitch("disable-gpu")` before `app.whenReady()` completes.

Cross-refs:
- docs/electron-session.md:146
- packages/electron/src/main.ts:65

---

## What does the Doctor diagnostic check in Electron?

In-app tool (menu → Doctor) verifying all dependencies + server launch capability. Catches missing/wrong-version tools before user hits silent failures.

Checks (12 total):
- Electron + Chromium + app versions
- System vs bundled Node.js/npm paths + versions
- pi, openspec, tsx CLI paths + versions
- Dashboard server code location + version
- Server running status + mode (dev/production)
- Setup wizard completion + mode
- API key configured (redacted)
- Managed install directory status
- Server launch test (actual spawn attempt)
- Last 10 lines server.log (if server not running)

Accessible: macOS menu → "PI Dashboard" → "Doctor"; Windows/Linux → "Help" → "Doctor".

Error case: Shows full diagnostic trail + suggests fixes (reinstall, run setup, check PATH).

Cross-refs:
- docs/electron-session.md:312
- packages/electron/src/lib/doctor.ts

---

## Why does my server.log stay 0 bytes after a clean Electron launch?

Pre-fix bug. `spawnDetached` only routed stderr to `logFd`; stdout (where server's startup banner went) discarded. `server.log` file existed but stayed empty. Fixed in change `fix-electron-extracted-jiti-and-stdio-capture`. Pre-fix workaround: read Electron-side log at `$env:TEMP\pi-dashboard-electron.log` (Windows) or `$TMPDIR/pi-dashboard-electron.log` (macOS/Linux).

---

## Why does bundling a server in Electron differ from npm package installation?

npm package unavailable at release time. Instead: bundle server source + deps as app resource. Wizard installs only external tools (pi, openspec, tsx). Server runs from `resources/server/` inside app package.

Server resolution order:
1. Packaged: `process.resourcesPath/server/packages/server/src/cli.ts` (always found first)
2. Dev: relative path `../../server/src/cli.ts`
3. Managed: fallback `~/.pi-dashboard/node_modules/@blackbelt-technology/...`

Bundle process (`bundle-server.mjs`):
- Copies `packages/server/` + `packages/shared/` + built web client (`dist/client/`)
- Source-only mode (`--source-only`) skips `npm install` for cross-platform builds
- Docker build (`docker-make.sh`) runs `npm install` inside Linux container for correct native module prebuilds

tsx binary resolution (launcher):
1. Managed: `~/.pi-dashboard/node_modules/.bin/tsx`
2. System PATH: `which tsx`

Wizard install list (into `~/.pi-dashboard/`):
- `@earendil-works/pi-coding-agent` (pi CLI)
- `@fission-ai/openspec` (openspec CLI)
- `tsx` (TypeScript runner)

Cross-refs:
- docs/electron-session.md:205
- docs/electron-session.md:214
- packages/electron/scripts/bundle-server.mjs
- packages/electron/src/lib/server-lifecycle.ts

---

## Why do native modules fail in bundled Electron cross-platform?

Native modules (e.g., `node-pty`) built with platform-specific prebuilds. `npm install` on macOS builds `.node` file for `darwin-arm64`. Linux DEB ships those binaries. On Linux VM: `Failed to load native module: pty.node, prebuilds/linux-x64: not found`.

Solution: Two-phase cross-platform bundling:
1. `bundle-server.mjs --source-only` — copies source + client, NO npm install (avoids macOS binaries in bundle)
2. `docker-make.sh` (inside Linux Docker) — runs `npm install`, builds prebuilds for `linux-x64`, copies `build/Release/pty.node` → `prebuilds/linux-x64/pty.node`
3. Removes `prebuilds/darwin-*` + `prebuilds/win32-*` variants

Both OS native CI runners (macOS for `.dmg`, Windows for `.exe`) build natively in-runner. Docker used only for cross-build of non-native platforms (Windows from macOS/Linux, Linux from macOS/Windows).

Cross-refs:
- docs/electron-session.md:241
- packages/electron/scripts/bundle-server.mjs
- packages/electron/scripts/docker-make.sh
- packages/electron/forge.config.ts

---

## Why does `__dirname` become undefined in packaged Electron?

Electron main process bundled by Vite as ESM. In ESM, `__dirname` + `__filename` not available. Code using bare `__dirname` without definition crashes.

Problem manifests in two places:
1. **Bundled main process** — `vite.main.config.ts` output format is ESM
2. **Server CJS imports** — `node-pty` (CJS package) requires `__dirname` from parent scope

Incorrect fix (attempted): Setting `"type": "module"` field in root package.json → ALL files underneath parsed as ESM, including CJS packages in node_modules. Propagates mistake globally.

Correct fix (ESM-aware code):
```typescript
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

Apply to files using `__dirname`:
- `packages/electron/src/lib/bundled-node.ts`
- `packages/electron/src/lib/server-lifecycle.ts`
- `packages/electron/src/lib/tray.ts`
- `packages/electron/src/lib/wizard-window.ts`

Vite bundling already inlines `import.meta.url` → safe to use this pattern.

Cross-refs:
- docs/electron-session.md:150
- docs/electron-session.md:571
- packages/electron/src/lib/bundled-node.ts
- packages/electron/src/lib/server-lifecycle.ts

---

## How do I ensure bridge extension loads in packaged Electron?

Bridge extension (`packages/extension/src/bridge.ts`) NOT bundled in DEB/DMG by default. Without it, pi sessions start but never connect to dashboard WebSocket gateway.

Solution: Bundle extension + auto-register into pi's package list.

Steps:
1. `bundle-server.mjs` — adds `packages/extension/` to server bundle + includes in workspace `node_modules/`
2. `extension-register.ts` (new server module) — detects bundled extension path + adds to `~/.pi/agent/settings.json` (pi's global package discovery list) at server startup
3. Extension's `package.json` has `"pi"` field → pi discovers extension + loads `src/bridge.ts`
4. Dependencies resolve via server bundle's workspace `node_modules/` (shared types, `ws`)

Registration idempotent: cleans stale paths when server location changes (e.g., after DEB upgrade).

Why needed: Pi discovers extensions only from packages listed in `~/.pi/agent/settings.json`. Local paths resolved in-place, not npm registry. Packaged DEB/DMG must register their bundled extension at first run.

Verify: `cat ~/.pi/agent/settings.json | grep pi-dashboard` shows registered path.

Cross-refs:
- docs/electron-session.md:593
- packages/server/src/extension-register.ts
- packages/electron/scripts/bundle-server.mjs

---

## Why do headless session spawns fail on Windows with `command not found`?

`.cmd` batch files (npm, pi, tsx) on Windows require `shell: true` in Node.js `spawn()`. Without it: `spawn EINVAL`. Additionally, paths with spaces break shell parsing — must quote both command + arguments.

Correct spawn on Windows:
```typescript
const isWindows = process.platform === 'win32';
spawn(isWindows ? `"${cmd}"` : cmd, args.map(a => isWindows ? `"${a}"` : a), {
  shell: isWindows ? true : false,
  cwd, detached: true, stdio: "ignore", env,
});
```

Related: `tail -f /dev/null | pi --mode rpc` (instead of `sleep 2147483647`) prevents stdin pipeline EOF on Linux when outer shell stdin is `/dev/null`. (Affects Unix headless spawns, not Windows.)

Desktop launcher PATH issue (all platforms): `.desktop` files on Linux start apps with minimal PATH (`/usr/local/bin:/usr/bin:/bin`). User bin dirs missing. `buildSpawnEnv()` MUST prepend user-local dirs:
- `path.dirname(process.execPath)` — reliably finds current Node.js
- `~/.local/bin`, `~/.npm-global/bin`, `/usr/local/bin` — common user tool locations

Cross-refs:
- docs/electron-session.md:622
- docs/electron-session.md:625
- packages/electron/src/lib/server-lifecycle.ts
- packages/server/src/process-manager.ts

---

## What Vite configuration is required for Electron main + preload processes?

Two separate Vite configs (ESM bundling + externalizing all Node.js builtins). Missing builtins bundled as polyfills → `require()` calls fail with `Error: Calling 'require' for "node:fs" in an environment that doesn't expose the require function`.

Main config (`vite.main.config.ts`):
- `build.lib.entry` → `src/main.ts`
- `build.lib.fileName` → `main.js` (Forge expects this name)
- `external` → `["electron", "electron-updater"]` + ALL from `builtinModules`
- `build.rollupOptions.output.format` → `"cjs"` (for require compatibility)

Preload config (`vite.preload.config.ts`):
- `build.lib.entry` → `src/preload.ts`
- `build.lib.fileName` → `preload.js`
- `external` + `builtinModules` → required for security (prevent bundling Node.js APIs into renderer context)

Import pattern:
```typescript
import { builtinModules } from "node:module";
export default {
  external: ["electron", "electron-updater", ...builtinModules],
};
```

Cross-refs:
- docs/electron-session.md:533
- packages/electron/vite.main.config.ts
- packages/electron/vite.preload.config.ts

## Why doesn't the Electron app find pi or openspec?

GUI apps receive minimal system PATH (`/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`). Tools installed via nvm, volta, or homebrew invisible to Electron process.

Mitigation: Electron wizard detects tools using login shell fallback (`$SHELL -ilc "which <cmd>"`) to access user's full `.zshrc`/`.bashrc` environment. Detected paths persisted in `toolPaths` config.

Issue: Login shell on macOS emits session restore noise (`Restored session:...`, `Saving session...completed.`). Parser must extract first line starting with `/`.

Cross-refs:
- docs/service-bootstrap.md:128
- docs/service-bootstrap.md:305
- packages/electron/src/lib/dependency-detector.ts

## What happens when I update Node versions (nvm, fnm)?

Persisted tool paths become stale. Examples: `/Users/x/.nvm/versions/node/v22.22.0/bin/pi` points to removed version.

Solution: Server validates on every start — if path missing, re-detects using login shell → system PATH → managed install → bundled. Updates config.json with new path.

Entries:
- nvm version change: `v22.22.0` → `v23.0.0` (common)
- fnm version switch
- volta global pin update

Cross-refs:
- docs/service-bootstrap.md:209
- docs/service-bootstrap.md:285

## How are tool paths persisted across restarts?

`~/.pi/dashboard/config.json#toolPaths` stores resolved paths for `pi`, `openspec`, `node`, `tsx`, `bridge`, `serverCli`.

Schema:
```json
{
  "toolPaths": {
    "pi":        "/Users/x/.nvm/versions/node/v22.22.0/bin/pi",
    "openspec":  "/Users/x/.nvm/versions/node/v22.22.0/bin/openspec",
    "node":      "/Applications/PI Dashboard.app/Contents/Resources/node/bin/node",
    "tsx":       "/Users/x/.pi-dashboard/node_modules/.bin/tsx",
    "bridge":    "/Applications/PI Dashboard.app/Contents/Resources/server/packages/extension",
    "serverCli": "/Applications/PI Dashboard.app/Contents/Resources/server/packages/server/src/cli.ts"
  }
}
```

All paths absolute. `null` or missing → detect at runtime.

Writers:
- Electron wizard (initial detection on first run)
- Server startup (validation + re-detect on every start)
- Settings panel (manual override via UI)
- Bridge start (detect from shell env if empty)

Cross-refs:
- docs/service-bootstrap.md:162
- docs/service-bootstrap.md:233
- packages/shared/src/config.ts

## Why do spawned pi sessions in tmux fail to find tools?

tmux server inherits env from its launcher, not from current shell. Spawned windows inside tmux start with minimal env.

Solution: Server prepends derived PATH to tmux command via shell export:

```bash
export PATH="/Users/x/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:$PATH" && \
  cd /path/to/project && \
  pi ...
```

PATH built by extracting dirname of every resolved toolPath (auto-handles nvm, volta, homebrew — wherever tools live).

Cross-refs:
- docs/service-bootstrap.md:274
- packages/server/src/process-manager.ts:buildSpawnEnv()

## How does the AppImage on Linux affect tool paths?

AppImage mounts to temp location on launch: `/tmp/.mount_PIxxxxxx/resources/`. Mount path changes every restart.

Risk: Persisting `toolPaths.serverCli` or `toolPaths.bridge` from AppImage path causes next launch to fail (temp dir no longer exists).

Detection: Server rejects paths containing `/tmp/.mount_` before persisting.

Workaround: Use global npm install (`pi install npm:...`) or allow re-detection on every start when running AppImage.

Cross-refs:
- docs/service-bootstrap.md:293

## What is the difference between standalone mode and power-user mode?

Two Electron installation modes with different tool resolution priorities.

**Standalone** (default): Bundles pi, openspec, node.js. Prefers app's copies:
- pi, openspec: Managed (`~/.pi-dashboard/`) → Bundled → System PATH
- node: Bundled → System PATH

**Power-user**: Trusts user's system installs. Prefers user's PATH:
- pi, openspec: System PATH (nvm/volta) → Managed → Bundled
- node: System PATH → Bundled

User selects in wizard. Mode stored in `~/.pi-dashboard/mode.json`. Affects search order in `dependency-detector.ts::detectTool()`.

Use standalone when: Electron shipped with all dependencies, minimal setup.
Use power-user when: Syncing with system nvm/volta, multiple Node versions, or custom pi builds.

Cross-refs:
- docs/service-bootstrap.md:91
- packages/electron/src/lib/dependency-detector.ts

## How does the bridge extension resolve the server CLI entry point?

Two paths:

**Chain 2 (TUI)**: Bridge uses `process.execPath` (the Node running pi) + relative path from extension directory:
```javascript
const cli = require.resolve("@blackbelt-technology/pi-dashboard-server/cli.ts");
spawn(process.execPath, ["--import", jiti, cli], { detached: true });
```

**Chain 1 (Electron)**: Fallback when toolPaths empty — detect via login shell or bundled path.

Resolved path stored in `toolPaths.serverCli` on server startup for Electron to read before auto-detecting itself.

Cross-refs:
- docs/service-bootstrap.md:56
- docs/service-bootstrap.md:242
- packages/extension/src/server-launcher.ts
# FAQ — Publishing Plugins

Plugin publishing FAQs. Covers monorepo versioning, first-time npm seed, and Trusted Publisher setup.

## What is lockstep versioning?

Every workspace `package.json` shares same `version` number. `scripts/sync-versions.js` enforces invariant; exits 1 on drift.

Consequence: every release tag bumps all packages (including new plugins) in lockstep. Plugins inherit current monorepo version on first npm publish (e.g., plugin first publishes at `0.4.5`, not `0.0.1`).

Rationale: single coherent version for all dashboard components. Eliminates version-mismatch confusion. Trade-off: new plugin's first version cannot match `0.0.1` without one-shot manual seed-and-revert (see procedure below).

Cross-refs:
- docs/publishing-plugins.md:1
- scripts/sync-versions.js

## Why must I manually publish a new plugin's first version?

npm's Trusted Publisher (OIDC) unavailable until package has ≥1 published version. Workflow intentionally has no `NPM_TOKEN` secret, only OIDC path.

Chicken-and-egg: workflow cannot publish brand-new package (Trusted Publisher grey-locked until version exists). First npm publish MUST come from developer machine with `npm login`.

Procedure: one-shot `npm publish` on local machine, then optional revert of version to lockstep (if seeding at `0.0.1`). After publish lands, configure Trusted Publisher on npmjs.com; all subsequent releases via workflow's OIDC path.

Cross-refs:
- docs/publishing-plugins.md:35
- docs/publishing-plugins.md:58

## Should I seed a new plugin at 0.0.1 or current lockstep version?

Both approaches valid. Stylistic choice, lockstep invariant preserved either way.

**Seed at `0.0.1`** (one-shot manual seed):
- Temporary version bump in local package.json (step 4)
- Publish locally (step 6)
- Revert to lockstep (step 7) before commit
- Advantage: semantic versioning reset; plugin life begins at `0.0.1`.
- Git history shows lockstep (`0.4.5`); npm sees `0.0.1` only.

**Seed at current lockstep** (skip steps 4–7):
- Publish directly at current monorepo version (e.g., `0.4.5`)
- No revert needed
- Advantage: simpler, fewer steps, no temporary dirty state.

Either way, **manual local publish required for every brand-new plugin** (step 6 non-optional).

Cross-refs:
- docs/publishing-plugins.md:27
- docs/publishing-plugins.md:54

## How do I prepare a plugin's package.json for publishing?

Three changes. Remove `private`, add `publishConfig` + `license`. Declare all workspace dependencies explicitly.

```json
{
  "name": "@blackbelt-technology/pi-dashboard-<your-plugin>-plugin",
  "version": "0.4.5",
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  }
}
```

Reason: monorepo workspace hoist allows `import` without `dependencies` entry. Breaks once published — npm consumers don't hoist. Grep plugin source for all `@blackbelt-technology/*` imports; add each to `dependencies` with `^<lockstep-version>`:

```bash
grep -rEh 'from "@blackbelt-technology/[^"]+"' packages/<your-plugin>/src \
  | sed 's|.*from "\(@blackbelt-technology/[^/"]*\).*|\1|' | sort -u
```

Keep `exports`, `files`, `type`, `pi-dashboard-plugin` block unchanged.

Cross-refs:
- docs/publishing-plugins.md:69

## How do I add a new plugin to the publish workflow?

Edit `.github/workflows/publish.yml`, append plugin to `PACKAGES=(...)` bash array.

Position requirements:
- **After** `dashboard-plugin-runtime` (plugins depend on it)
- **Before** `@blackbelt-technology/pi-agent-dashboard` (root metapackage, MUST publish last)

Example insertion:

```bash
PACKAGES=(
  "@blackbelt-technology/pi-dashboard-shared"
  "@blackbelt-technology/pi-dashboard-extension"
  "@blackbelt-technology/pi-dashboard-server"
  "@blackbelt-technology/pi-dashboard-web"
  "@blackbelt-technology/dashboard-plugin-runtime"
  "@blackbelt-technology/pi-dashboard-<your-new-plugin>"   # HERE
  "@blackbelt-technology/pi-agent-dashboard"
)
```

Workflow publishes each in order. Per-package skip-if-exists loop isolates failures; new plugin won't update until Trusted Publisher configured (see next entry).

Cross-refs:
- docs/publishing-plugins.md:91

## How do I configure Trusted Publisher for a new plugin on npmjs.com?

One-time per-package setup after first `npm publish` lands.

Steps:
1. Visit npmjs.com → package → Settings (scroll to Trusted Publisher section)
2. Click "Add"
3. Select Publisher = "GitHub Actions"
4. Owner = `BlackBeltTechnology`
5. Repository = `pi-agent-dashboard`
6. Workflow filename = `publish.yml` (filename only, no path)
7. Environment = (leave blank)

Verification:
- Run `npm view @blackbelt-technology/pi-dashboard-<your-plugin> version` confirms npm sees published version
- Next release tag publishes plugin via workflow OIDC path (no `NPM_TOKEN` secret)

If skipped: workflow OIDC path fails for new plugin; per-package error loop marks as `FAIL=1`, other packages still publish. Configure Trusted Publisher to fix.

Cross-refs:
- docs/publishing-plugins.md:116
- docs/publishing-plugins.md:129

## What goes in a new plugin's dependencies vs. what does the monorepo hoist?

Monorepo `npm workspaces:` hoists transitive deps across packages. Plugin can import any `@blackbelt-technology/*` workspace package without declaring in own `dependencies`.

**This breaks on npm publish.** npm consumers don't hoist — plugin must declare every `@blackbelt-technology/*` import it uses.

Discovery: grep plugin source for `@blackbelt-technology/` imports. Example:

```bash
grep -rEh 'from "@blackbelt-technology/[^"]+"' packages/<your-plugin>/src | sort -u
```

Add each to `dependencies` of plugin's `package.json` with version `^<current-lockstep-version>`:

```json
"dependencies": {
  "@blackbelt-technology/dashboard-plugin-runtime": "^0.4.5",
  "@blackbelt-technology/pi-dashboard-shared": "^0.4.5"
}
```

All other deps (npm packages like `react`, `typescript`, etc.) follow normal Node rules — only workspace packages need explicit declaration.

Cross-refs:
- docs/publishing-plugins.md:81

## How do I dry-run publish before going live?

Verify file list, package size, and version without uploading.

Command:

```bash
npm publish --workspace=@blackbelt-technology/pi-dashboard-<your-plugin> --dry-run
```

Output shows:
- File list (matches `files: ["src/"]`)
- Package size (usually < 1 MB)
- Version being published

No files uploaded. Safe to run multiple times.

Cross-refs:
- docs/publishing-plugins.md:108

## What SemVer rules apply when choosing a release version?

Feature additions → minor, bug fixes only → patch, breaking changes → major.

Rules:
- `patch` — bug fixes only. No new features.
- `minor` — user-visible new capabilities. Backward-compatible.
- `major` — breaking changes to public API / behavior / install path.

Example:
- v0.1.0 (current) + new OAuth provider → v0.2.0
- v0.2.0 + shell-escape fix → v0.2.1
- v0.2.0 + breaking workspace format change → v1.0.0

Cross-refs:
- docs/release-process.md:62

## What format should CHANGELOG entries use?

End-user language, not commit shorthand. Bullets under `## [Unreleased]` subsections (`Added`, `Changed`, `Fixed`).

Rules:
- **Language**: end-user-facing. Avoid `refactored X`, `renamed Y`. Focus user impact.
- **Linking**: add markdown links to relevant docs when helpful.
- **Subsections**: add feature bullets under `Added`, `Changed`, `Fixed` matching commit type; omit empty subsections.
- **Completeness**: missing bullet does NOT block PR merge. Release author back-fills during curation.

Template:
```markdown
## [Unreleased]

### Added
- Feature here in user language.

### Changed
- Behavior change visible to user.

### Fixed
- Bug fix (specific, user-facing).
```

Cross-refs:
- docs/release-process.md:39
- docs/release-process.md:62

## What is sync-versions.js and when do I need it?

Helper script rewrites inter-package dependency specifiers when workspace versions bump.

Problem: `npm version <version> --workspaces` updates `package.json` files atomically, but does NOT update `"@blackbelt-technology/pi-dashboard-shared": "^old"` → `"^new"` inside dependents. Published npm metadata becomes inconsistent (root `package.json` declares old specifier while actual published server tarball contains new version).

Solution: `node scripts/sync-versions.js` (after `npm version`) rewrites every inter-package dep to match new workspace version.

Commands:
```bash
npm version patch --workspaces --include-workspace-root --no-git-tag-version
node scripts/sync-versions.js
git add package.json package-lock.json packages/*/package.json
git commit -m "chore(release): v<version>"
```

Defensive: `publish.yml` CI workflow runs `sync-versions.js` again defensively after `npm version` (before `npm publish`), so forgotten local invocation does not corrupt release.

Cross-refs:
- docs/release-process.md:92

## How do I manually fix a failed GitHub Release?

Auto-extraction failed or rendered incorrectly → edit draft release before publishing.

Steps:
1. Open draft release on GitHub Releases page.
2. Click *Edit* (pencil icon on draft).
3. Replace body with correct content copied from `CHANGELOG.md` matching section `## [<version>]`.
4. Click *Publish release* (or save as draft if re-testing).

Extraction failure fallback: if body is empty or one-liner pointing at CHANGELOG.md, script likely failed to parse `## [<version>]` section. Verify:
- `CHANGELOG.md` has matching section (exact version string, no leading `v`).
- Bullets exist under `Added` / `Changed` / `Fixed` subsections.
- No stray markdown (unclosed backticks, broken links).

Worst case (no release at all, corrupted artifacts) → delete + retry (see "How do I rollback a release?").

Cross-refs:
- docs/release-process.md:168

## How do I rollback a release?

Delete tag locally + remotely, revert version bump commit, re-push (if needed after fixes).

Commands:
```bash
git push --delete origin v<version>          # delete remote tag
git tag --delete v<version>                  # delete local tag
git revert HEAD                               # optional: revert version bump commit
# or: git reset --soft HEAD~1 && git restore --staged .
# (reverts without creating revert commit)
```

Then fix the issue (e.g. wrong CHANGELOG markdown, missing artifacts) and re-push:
```bash
git tag v<version>
git push origin v<version>
```

GitHub Release auto-deletes when tag deleted (via `softprops/action-gh-release`).

npm packages already published cannot be `npm unpublish` after 72h or when dependents exist. Workaround: `npm deprecate @package@version "Do not use"` — marks version as deprecated in registry without deletion.

Cross-refs:
- docs/release-process.md:168
- docs/release-process.md:187

## Why does `where npm` return nothing on Windows after Electron install?

Bundled Node lived at `<app>/resources/node/` only. Pre-`embed-managed-node-runtime`: `npm.cmd` / `npx.cmd` shims missing from bundle (`docker-make.sh` bug omitted them) AND bundled dir not on `PATH` for spawned children (pi-session, pi-core-updater) — `where npm` failed, `npm install` from agent failed.

After change:
- Bundle ships `node.exe` + `npm.cmd` + `npx.cmd` at `resources/node/` root (Windows) or `bin/` (Unix).
- `installManagedNode` copies bundle into `~/.pi-dashboard/node/` on first run + on every Doctor launch (idempotent via `.version` marker). Persists across Electron upgrades.
- `prependManagedNodeToPath(env, managedDir)` injects `~/.pi-dashboard/node/` at HEAD of every spawned-child `PATH`. Children resolve `npm` / `npx` without system Node.
- Restore if missing: run `pi-dashboard repair` (Doctor menu) — re-runs `installManagedNode` unconditionally.

See change: embed-managed-node-runtime.

Cross-refs:
- docs/architecture.md — Bootstrap & First Run → Managed Node runtime
- packages/shared/src/bootstrap-install.ts (`installManagedNode`)
- packages/shared/src/platform/managed-node-path.ts (`prependManagedNodeToPath`)

## How do I see why a session spawn failed?

Check banner in folder card (shows code, hint, preflight reasons, stderr tail). Open Settings → General → Recent Spawn Failures for history. Raw log at `~/.pi/dashboard/sessions/spawn-failures.log`. Fetch last N via `GET /api/spawn-failures?limit=N`.

## What happens to my old `~/.pi-dashboard/` directory after upgrading?

Left untouched. Pre-R3 builds installed pi/openspec/tsx into `~/.pi-dashboard/node_modules/` at runtime. R3 ships them as regular npm deps inside the app bundle; the legacy dir is no longer read or written.

Detection: `detectLegacyManagedDir({ homedir })` in `packages/shared/src/legacy-managed-dir.ts` returns `{present, path, pkgCount, sizeMb}`. Doctor surfaces a warning-severity advisory "Legacy install directory". Server CLI logs the path once at startup.

Safe to delete manually:
```bash
rm -rf ~/.pi-dashboard
```

Legacy scope `@mariozechner/pi-coding-agent` (pre-0.74 rename) lives there too; deleting the dir removes all of it.

Cross-refs:
- docs/electron-immutable-bundle.md
- packages/shared/src/legacy-managed-dir.ts
- packages/electron/src/lib/doctor.ts (advisory wiring)

## Why does `pi-dashboard start` fail with ERR_MODULE_NOT_FOUND in a dev checkout?

Root `package.json` `.bin` previously pointed `pi-dashboard` at `packages/server/src/cli.ts` directly. Node has no built-in TypeScript loader — launching a `.ts` file from a shebang requires jiti (or tsx) to be registered via `--import`, which a `#!/usr/bin/env node` line cannot interpolate dynamically. Symptom: `node:internal/modules/run_main:... ERR_MODULE_NOT_FOUND` on `cli.ts` import resolution.

Fix: `.bin` now points at `packages/server/bin/pi-dashboard.mjs`, a tiny `.mjs` wrapper that resolves jiti from pi's tree at runtime, then re-execs Node with `--import <jiti-url> cli.ts <args>`. Wrapper exits 1 with install-hint when jiti unresolvable.

Cross-refs:
- package.json (root) `.bin`
- packages/server/bin/pi-dashboard.mjs
- packages/shared/src/resolve-jiti.ts
- See change: replace-tsx-with-jiti

## Why does `/api/flows-anthropic-bridge/status` show "no sessions reporting"?

pi-coding-agent reads `packages[]`, not `dashboardPluginBridges`. Pre-0.5.4 dashboards wrote bridge entry only to `dashboardPluginBridges` \u2014 invisible to pi. Bridge loaded by dashboard, never invoked by pi runtime.

Fix: dashboard 0.5.4+ writes to both. Restart dashboard \u2014 one-shot `reconcilePluginBridgePackages` runs at server start.

Verify: `curl -s http://localhost:8000/api/health | jq '.plugins[] | select(.id == "flows-anthropic-bridge")'`. Expect `bridgeLoadedFrom: "both"` (or `"packages[]"` post-reconcile). Value `"dashboardPluginBridges"` only = stale install, restart again.

Escape hatch: env `PI_DASHBOARD_DISABLE_PLUGIN_BRIDGE_PACKAGES_WRITE=1` skips `packages[]` write. Legacy key only. Diagnostic flag.

See change: fix-pi-flows-end-to-end.

Cross-refs:
- docs/architecture.md \u2014 Plugin Architecture \u2192 Plugin Bridge Registration
- packages/shared/src/plugin-bridge-register.ts

## Why does abort feel slow on parallel flows?

pi-flows < 0.2.x bug: `Promise.all` over child flows did not race the AbortSignal. Children aborted at iteration boundaries; parent awaited all in-flight branches. Abort latency = slowest child remaining work, not signal-to-unwind time.

Fix in pi-flows 0.2.0+: `raceWithAbort` wrapper. Parent unwinds within 100 ms of signal. Children still drain via their own AbortSignals.

Upgrade pi-flows. No dashboard-side change required.

See change: fix-pi-flows-end-to-end.

## Where is the Roles UI?

Settings \u2192 General \u2192 Roles. Moved from model dropdown in dashboard 0.5.4.

Roles plugin (`packages/roles-plugin/`) renders it via `settings-section` slot under Settings ▸ Plugins. Edit per-session role-to-model maps. Save/load presets.

Dispatches existing `role_set` / `role_preset_*` WS messages. No protocol change.

See change: fix-pi-flows-end-to-end.

Cross-refs:
- packages/roles-plugin/src/RolesSettingsSection.tsx

## Why does Doctor sometimes show server "Not running" while dashboard works?

Old bug: `probeServer` inside `/api/doctor` shelled out `curl http://localhost:8000/api/health` via `execSync`. Server was handling the request when curl called — self-deadlock. After 3 s timeout, curl failed and probe reported "Not running". Fixed in change `harvest-bootstrap-survivor-fixes`: server-side probe reads process state directly; Electron Doctor uses native `fetch`. No subprocess spawned. Result: Doctor reports "ok" correctly while server handles load.
