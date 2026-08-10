# electron-app — index

Plan: package pi-dashboard as standalone Electron app (macOS/Linux/Windows), zero prerequisites via bundled Node.

## Overview
- Monorepo restructured: `packages/client|server|extension|shared|dist`.
- `mdns-server-discovery` change fully implemented+archived (`isDashboardRunning()`, mDNS, ServerSelector, bridge mDNS). `spawnStrategy` default already `"headless"`. CORS added.
- Remaining: one change `electron-desktop-bundle`, 9 task groups.

## Motivation
- Removes manual install of Node/pi/openspec. Single-click install, preserves CLI/browser workflow.

## Architecture
- Current + With-Electron ASCII diagrams. Ports: bridge 9999, server 8000.
- Key principle: Electron = smart window + server bootstrapper, NOT in-process server. Server always separate detached process. Avoids port collision, server-death-on-quit, restart coupling.

## Dependency Analysis
- External tools table: Node.js (bundle v22 LTS ~95MB), pi/openspec/dashboard-pkg/tsx (npm install at first run into `~/.pi-dashboard/`), node-pty (server process), tmux (dropped), zrok/git (detect on PATH).
- node-pty: C++ addon, runs in server process (system Node), no Electron rebuild for MVP.
- TS loader: jiti (bridge, pi's fork) vs tsx (server, fully compatible). Server has ZERO `virtualModules` imports → tsx safe. Standalone=tsx, power-user=jiti+tsx fallback.

## Two Installation Modes
- Standalone ("set up everything"): installs pi/dashboard/openspec/tsx into `~/.pi-dashboard/node_modules/`, `.bin` prepended to PATH, `mode.json`.
- Power User ("use existing pi"): detects system pi/openspec, verifies dashboard pkg registered, offers `npm install -g`, uses system Node + jiti.
- Why two: auto-detect fragile — system pi without dashboard pkg breaks bridge silently.

## Server Discovery
- Problem: `isPortOpen()` TCP probe can't distinguish dashboard from other services on 8000.
- Two-layer: mDNS `_pi-dashboard._tcp` via `bonjour-service` (~67KB), health-check fallback `GET /api/health` → `{ok, pid}`.
- Electron startup flow: mDNS browse (2s) → health check → launch server detached → retry.
- Server Selector dropdown: hostname/port/Local-Remote badge/status; persist `lastServer` in localStorage+config.json.

## Electron Shell Details
- Window: `nodeIntegration:false`, `contextIsolation:true`, persisted size/pos, `ELECTRON_DEV=1` skips discovery.
- System tray: close minimizes, Show/Quit menu, quit optionally stops server.
- Single instance: `app.requestSingleInstanceLock()`.
- Server lifecycle: outlives Electron; only stops on Quit if Electron started it.

## Configuration Changes
- `spawnStrategy` default changed tmux→headless. `electronMode` new bool. `lastServer` new. Invalid spawnStrategy falls back headless.

## Build Pipeline
- Tooling: `@electron-forge/cli` + `plugin-vite`, `@electron/rebuild`, platform makers.
- Targets: macOS .dmg universal (Apple Developer ID), Linux .AppImage+.deb, Windows .exe NSIS (unsigned MVP).
- Bundle ~250MB (Electron 150 + Node 80 + app 15 + node-pty 2). Comparable VS Code/Cursor/Slack.
- CI matrix: macos-14, ubuntu-latest, windows-latest.
- npm scripts: `electron:dev`, `electron:start`, `electron:make`.

## Auto-Update
- Deps (pi/openspec): check launch + 24h, `npm outdated`, non-blocking notification.
- App: `electron-updater` + GitHub Releases, "Download & Restart" banner.

## Development Workflow
- Unchanged. `electron:dev` opens window at localhost:8000, server separate, Vite HMR works.

## Implementation Plan
- Change 1 `mdns-server-discovery` DONE (archived).
- Change 2 `electron-desktop-bundle`: 8 groups/40 tasks table (config, Windows fixes, workspace setup, installer, wizard, shell, auto-update, build, updater).

## Key Design Decisions Summary
- D1–D12 table: smart-window, bundle Node v22, two modes, health-check identity, mDNS bonjour, localhost-first, server-selector, forge+Vite, universal binary, tray-on-close, updater-in-MVP, headless default, skip Windows signing.

## Risks and Mitigations
- Table: mDNS firewall, Node drift, bundle size, signing cost, dual runtimes, port conflict, bridge not loaded, tsx/jiti, Windows terminal/scanner/editor.
