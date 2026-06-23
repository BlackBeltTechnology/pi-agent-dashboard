# Electron Desktop App — Comprehensive Plan

## Overview

Package the pi-dashboard as a standalone Electron desktop app for macOS, Linux, and Windows. The app works on a fresh machine with zero prerequisites — bundled Node.js bootstraps all dependencies.

**Current state:** The project has been restructured into an npm workspaces monorepo (`packages/client`, `packages/server`, `packages/extension`, `packages/shared`, `packages/dist`). The `mdns-server-discovery` change has been **fully implemented and archived** — `isDashboardRunning()`, mDNS discovery, `ServerSelector`, bridge mDNS connection handling are all in place. `spawnStrategy` default is already `"headless"`. CORS support is added for cross-origin client serving.

**Remaining:** One OpenSpec change `electron-desktop-bundle` with 9 task groups, 46 tasks.

## Motivation

The pi-dashboard currently requires manual installation of Node.js, pi, and openspec. This creates a high barrier for non-developers or fresh machines. An Electron bundle provides a single-click install while preserving the existing CLI/browser workflow.

## Architecture

### Current Architecture (Monorepo)

```
┌────────────────────┐   WebSocket   ┌────────────────────┐   WebSocket   ┌──────────────────┐
│ packages/extension │ ◄────────────►│ packages/server    │ ◄────────────►│ packages/client  │
│ Bridge Extension   │  (port 9999)  │ Dashboard Server   │  (port 8000)  │ React Web UI     │
│ (per pi session)   │               │ (Node.js detached) │               │ (Browser)        │
└────────────────────┘               └────────────────────┘               └──────────────────┘
                                            │
                                     packages/shared
                                     (types, config, mDNS,
                                      server-identity)
```

### With Electron

```
┌─────────────┐     WebSocket      ┌──────────────┐     WebSocket     ┌─────────────┐
│   Bridge    │ ◄─────────────────► │  Dashboard   │ ◄───────────────► │  Electron   │
│  Extension  │    (port 9999)      │   Server     │    (port 8000)    │  Window     │
│  (per pi)   │                     │  (detached)  │                   │ (or Browser)│
└─────────────┘                     └──────────────┘                   └─────────────┘
                                          ▲
                                          │ Launches if not running
                                    ┌─────┴──────┐
                                    │  Electron   │
                                    │  Main Proc  │
                                    └────────────┘
```

**Key principle:** Electron is a **smart window + server bootstrapper**, not an in-process server. The dashboard server always runs as a separate detached process. This avoids:
- Port collision with CLI-started servers
- Server dying when Electron quits (bridges would disconnect)
- Needing to restart Electron to restart the server
- Dev workflow disruption (existing browser + Vite HMR unchanged)

## Dependency Analysis

### External Tool Dependencies

| Tool | How Used | Required? | Embedding Strategy |
|------|----------|-----------|-------------------|
| **Node.js** | Runtime for pi, openspec, server | Mandatory | Bundle v22 LTS as `extraResources` (~95MB stripped) |
| **pi** (`@mariozechner/pi-coding-agent`) | Spawned as child process (`pi --mode rpc`) | Mandatory | `npm install` at first run into `~/.pi-dashboard/` |
| **openspec** (`@fission-ai/openspec`) | Called via `execFile("openspec", ...)` | Mandatory | `npm install` at first run into `~/.pi-dashboard/` |
| **Dashboard package** (`@blackbelt-technology/pi-dashboard`) | Bridge extension + server code | Mandatory | `npm install` at first run (registers bridge with pi) |
| **tsx** | TypeScript loader for server | Mandatory (standalone mode) | `npm install` at first run into `~/.pi-dashboard/` |
| **node-pty** | Terminal emulator (PTY allocation) | Yes (terminal feature) | Runs in server process (system Node), no Electron rebuild needed for MVP |
| **tmux** | Session spawning (optional strategy) | No | Dropped — headless is the new default |
| **zrok** | Tunneling for remote access | No (optional) | Detect on PATH |
| **git** | Branch switching, diffs | Soft dependency | Detect on PATH |

### Native Addon: node-pty

node-pty is a C++ addon. In the Electron architecture, it runs in the **server process** (system Node), not in Electron's process. Since the server is a separate detached process using the system (or managed) Node.js, node-pty works as-is without Electron-specific rebuilding.

If a future enhancement runs the server in-process, node-pty would need `@electron/rebuild` per platform+arch.

### TypeScript Loader Analysis

The server runs TypeScript directly via a loader. Two options were analyzed:

| Loader | Source | Used By | Compatible? |
|--------|--------|---------|-------------|
| **jiti** (`@mariozechner/jiti`) | Pi's fork with `virtualModules` | Bridge extension (inside pi process) | N/A — bridge always uses pi's jiti |
| **tsx** | Standard TS loader | Server when launched outside pi | ✅ Fully compatible |

**Finding:** The server has **zero imports** from pi's `virtualModules`. All pi imports in the server are either:
- `import type` (erased at runtime)
- Dynamic `import()` in `package-manager-wrapper.ts` (resolves compiled `.js`)

**Conclusion:** tsx is safe for the server. Standalone mode uses tsx; power user mode uses jiti (from pi) with tsx fallback.

## Two Installation Modes

The first-run wizard presents two modes:

### Standalone Mode ("Set up everything for me")

For users on fresh machines or who want a self-contained setup.

```
~/.pi-dashboard/
  mode.json                          ← { mode: "standalone", completedAt: "..." }
  package.json                       ← Auto-created
  node_modules/
    .bin/
      pi                             ← Symlink to pi CLI
      openspec                       ← Symlink to openspec CLI
      tsx                            ← TypeScript loader
    @mariozechner/pi-coding-agent/   ← pi
    @blackbelt-technology/pi-dashboard/  ← Dashboard (bridge extension)
    @fission-ai/openspec/            ← openspec
    tsx/                             ← TS loader
```

- Installs pi, dashboard package, openspec, and tsx into `~/.pi-dashboard/node_modules/`
- `~/.pi-dashboard/node_modules/.bin` prepended to PATH for spawned processes
- Dashboard package's `pi.extensions` field registers the bridge with pi
- Server spawned using bundled or managed Node + tsx

### Power User Mode ("Use my existing pi installation")

For users who already have pi installed globally.

- Detects system pi and openspec on PATH
- Verifies the dashboard package is registered with pi (global npm or `settings.json` packages)
- If dashboard package missing → offers `npm install -g @blackbelt-technology/pi-dashboard`
- Server spawned using system Node + jiti (from pi)

### Why Two Modes?

A single auto-detect path would be fragile — system pi without the dashboard package means the bridge extension won't load, breaking everything silently. Explicit choice surfaces the right setup at the right time.

## Server Discovery

### Problem

The current `isPortOpen()` TCP probe can't distinguish the dashboard from any other service on port 8000 (Rails, webpack-dev-server, etc.). This is a pre-existing bug that Electron makes critical.

### Solution: Two-Layer Discovery

**Layer 1 — mDNS (from `mdns-server-discovery` change):**
- Server advertises `_pi-dashboard._tcp` via `bonjour-service` (pure JS, no native deps, ~67KB)
- Clients browse by service type — identity guaranteed
- Works across LAN (bridge on machine A finds server on machine B)
- Tested: discovery takes <1 second on localhost

**Layer 2 — Health check fallback:**
- `GET http://localhost:<port>/api/health` → verify `{ ok: true, pid: N }`
- Used when mDNS is blocked (Windows firewall, CI, containers)
- Distinguishes dashboard from other services on the same port

### Electron Startup Flow

```
App Launch
    │
    ▼
mDNS browse _pi-dashboard._tcp (2s timeout)
    │
    ├─ Found on localhost → Open BrowserWindow → done
    │
    ├─ Not found → GET localhost:<port>/api/health
    │       │
    │       ├─ Dashboard confirmed → Open BrowserWindow → done
    │       │
    │       ├─ Other service on port → Error: "Port X in use by another service"
    │       │
    │       └─ Connection refused → Launch server (detached) → retry → Open BrowserWindow
    │
    └─ Remote servers found → Show in server selector (user must explicitly switch)
```

### Server Selector

A dropdown in the dashboard header showing all discovered servers:
- Hostname, port, Local/Remote badge, connection status
- Switching closes current WebSocket, opens new one to selected server
- Last-used server persisted in `localStorage` and `config.json`
- Server relays peer discovery to browsers (browsers can't do UDP multicast)

## Electron Shell Details

### Window Behavior
- `nodeIntegration: false`, `contextIsolation: true`
- Window size and position persisted across restarts
- `ELECTRON_DEV=1` mode: skip server discovery, point at `http://localhost:8000`

### System Tray
- Closing the window minimizes to system tray (server keeps running)
- Tray icon with "Show" and "Quit" menu
- Click tray icon → reopen window
- "Quit" → optionally stop server if Electron started it

### Single Instance
- `app.requestSingleInstanceLock()` prevents multiple Electron windows
- Second launch focuses existing window

### Server Lifecycle
- Electron detects existing server (mDNS → health check) and connects
- If no server → launches as detached process (same as `pi-dashboard start`)
- Server outlives Electron — bridges stay connected after window close
- Only stops server on "Quit" if Electron was the one that started it

## Configuration Changes

| Field | Type | Default | Change |
|-------|------|---------|--------|
| `spawnStrategy` | `"tmux" \| "headless"` | `"headless"` | **Changed** from `"tmux"` — affects all users |
| `electronMode` | boolean | `false` | **New** — forces headless, set by Electron |
| `lastServer` | string \| undefined | `undefined` | **New** (mDNS change) — persists selected server |

Invalid `spawnStrategy` values now fall back to `"headless"` instead of `"tmux"`.

## Build Pipeline

### Tooling
- `@electron-forge/cli` with `@electron-forge/plugin-vite`
- `@electron/rebuild` for native addon handling
- Platform-specific makers for installer output

### Build Targets

| Platform | Format | Signing |
|----------|--------|---------|
| macOS | `.dmg` (universal arm64+x64) | Apple Developer ID (MVP) |
| Linux | `.AppImage` + `.deb` (x64) | None needed |
| Windows | `.exe` NSIS (x64) | Deferred (shows "unknown publisher") |

### Bundle Size Budget

| Component | Size |
|-----------|------|
| Electron | ~150MB |
| Bundled Node.js v22 (stripped) | ~80MB |
| Dashboard app | ~15MB |
| node-pty prebuilds | ~2MB |
| **Total** | **~250MB** |

Comparable to VS Code (~350MB), Cursor (~450MB), Slack (~300MB).

### CI Matrix (GitHub Actions)

| Runner | Target |
|--------|--------|
| `macos-14` | macOS universal DMG |
| `ubuntu-latest` | Linux AppImage + deb |
| `windows-latest` | Windows NSIS exe |

### npm Scripts

| Script | Purpose |
|--------|---------|
| `npm run electron:dev` | Start Electron in dev mode (external server) |
| `npm run electron:start` | Start Electron with server auto-launch |
| `npm run electron:make` | Produce platform installers in `out/` |

## Auto-Update

### Dependency Updates (pi, openspec)
- Check on launch + every 24 hours
- `npm outdated` for managed or system installs
- Non-blocking notification with "Update" button
- Update runs `npm install <package>@latest` using same npm that installed it
- Network failures silently ignored

### App Updates (Electron itself)
- `electron-updater` with GitHub Releases
- Check on launch + every 24 hours
- "Download & Restart" banner when update available

## Development Workflow

**The existing dev workflow is completely unchanged.** Electron is a packaging concern, not a development-time concern.

```
Development (unchanged):
  Terminal 1: pi-dashboard start --dev     → server on :8000
  Terminal 2: npm run dev                  → Vite HMR on :5173
  Browser:    http://localhost:8000
  Client changes → Vite HMR → instant
  Server changes → pi-dashboard restart → refresh

Testing Electron shell:
  npm run electron:dev    → Opens Electron window pointing at localhost:8000
                            Server still runs as separate process
                            Vite HMR still works
```

## Implementation Plan

### ~~Change 1: `mdns-server-discovery`~~ ✅ COMPLETED

Fully implemented and archived. Provides:
- `isDashboardRunning()` in `packages/shared/src/server-identity.ts`
- mDNS discovery in `packages/shared/src/mdns-discovery.ts`
- `ServerSelector` component in `packages/client/src/components/ServerSelector.tsx`
- Bridge mDNS connection handling in `packages/extension/src/server-auto-start.ts`

### Change 2: `electron-desktop-bundle` — Remaining Work

**OpenSpec:** `openspec/changes/electron-desktop-bundle/`
**8 task groups, 40 tasks**

| Group | Tasks | Description |
|-------|-------|-------------|
| 1. Config Changes | 4 | `electronMode`, managed PATH |
| 2. Windows Platform Fixes | 6 | Terminal shell, process scanner, editor registry |
| 3. Electron Workspace Setup | 6 | `packages/electron/`, forge config, npm scripts |
| 4. Dependency Installer | 5 | Detection, standalone/power-user install, bundled Node, TS loader |
| 5. First-Run Wizard | 8 | Mode selection, install progress, API key, mode persistence |
| 6. Electron Shell | 6 | Main process, window, system tray, dev mode |
| 7. Dependency Auto-Update | 5 | Outdated check, notification, update execution |
| 8. Build Pipeline | 5 | Node.js download, extraResources, CI matrix, signing |
| 9. App Auto-Updater | 5 | electron-updater, GitHub Releases, update UI |

## Key Design Decisions Summary

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Electron = smart window, not in-process server | Server outlives window, no port collision, dev workflow unchanged |
| D2 | Bundle Node.js v22 LTS | Zero prerequisites on fresh machine |
| D2a | Two installation modes | Explicit choice prevents silent bridge-not-found failures |
| D2b | tsx for standalone, jiti for power user | Server has zero jiti-specific imports; tsx is fully compatible |
| D3 | Health check identity (`/api/health`) | Bare TCP probe can't distinguish dashboard from other services |
| D4 | mDNS via `bonjour-service` | Zero-config, LAN discovery, pure JS, ~67KB |
| D5 | Localhost-first, passive LAN | Auto-remote would be surprising and insecure |
| D6 | Server selector in header | Non-modal, discoverable, follows DB tool patterns |
| D7 | electron-forge + Vite plugin | Official Electron build tool, reuses existing Vite config |
| D8 | macOS universal binary | Simpler for users, one download |
| D9 | System tray on close | Server keeps running, quick reopen |
| D10 | App auto-updater in MVP | `electron-updater` + GitHub Releases from the start |
| D11 | headless default globally | tmux no longer needed as default; simpler for all users |
| D12 | Skip Windows code signing for MVP | EV cert cost/complexity; "unknown publisher" warning acceptable |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| mDNS blocked by firewall | Discovery fails | Config-based health-check fallback always works |
| Bundled Node.js version drift | pi/openspec incompatibility | v22 LTS supported until April 2027; app updates bump version |
| Bundle size ~250MB | Large download | Comparable to VS Code/Cursor/Slack; acceptable for desktop |
| macOS code signing cost | $99/year | Required for Gatekeeper; essential investment |
| Two Node.js runtimes | Confusion | System Node preferred when available; bundled is fallback only |
| Port conflict with other service | Can't start server | Health check detects conflict, shows clear error message |
| Bridge extension not loaded | Sessions don't appear | Two-mode wizard explicitly installs/verifies dashboard package |
| tsx vs jiti incompatibility | Server fails to start | Analyzed: server has zero jiti-specific imports; tsx verified safe |
| Windows terminal defaults to `/bin/bash` | Terminal broken | Detect platform, use `COMSPEC` / `powershell.exe` fallback |
| Windows process scanner disabled | No stalled process detection | Implement via `wmic`/`tasklist`, kill via `taskkill /T /F` |
| Windows editor registry empty | No "Open in Editor" | Add `win32` patterns for VS Code, IntelliJ |
