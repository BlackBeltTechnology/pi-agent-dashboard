# service-bootstrap.md — index

Pull-only condensed map. Source: docs/service-bootstrap.md. Service bootstrap + tool resolution.

## Overview
One server process reached via 3 starters (Electron, Bridge, Standalone) across 2 invocation surfaces (GUI click, shell command). Each starter resolves tool paths (pi, openspec, node, tsx, bridge). R3 update (`eliminate-electron-runtime-install`): Electron launcher only, no runtime install; pi/openspec/tsx ship as npm deps in `.app`, load read-only `<resourcesPath>/server/node_modules/`. `selectLaunchSource()` → `attach|devMonorepo|bundled`. See electron-bootstrap-flow.md (6-state machine), electron-immutable-bundle.md.

## Concepts
- Starter — runtime identity, 3 values. Stamped `DASHBOARD_STARTER` env (`server-launcher.ts#launchDashboardServer`). Exposed `launchSource` on `/api/health`. Read by `decideShutdownOnQuit` + `useLaunchSource()`. Single source of truth for pid ownership + arm-aware UI.
- Invocation surface — user entry point, 2 values, not observable at runtime, doc device. Groups starters by PATH pedigree.
- Mapping: GUI→Electron (minimal PATH, owns pid, not detached); shell→Bridge (full PATH, no pid, detached) or Standalone (full PATH, owns pid SIGINT, not detached). Chain1=GUI→Electron; Chain2=shell→Bridge/Standalone. Client gates `launchSource==="electron"` as immutable-bundle proxy.

## Startup Chains
- Chain 1 Electron→Server — `.app` → main.ts checking-server-health (`isDashboardRunning`) → wizard-welcome (first-run, `~/.pi/dashboard/first-run-done` marker) → `selectLaunchSource()` → `spawnFromSource()` stamps `DASHBOARD_STARTER=Electron`, `setSpawnedPid()` → server boots (no runtime install) → BrowserWindow localhost:8000.
- Chain 2 Pi TUI→Bridge→Server — `pi` (full shell PATH) → loads `~/.pi/agent/settings.json` packages[] → bridge.ts reads `~/.pi/dashboard/config.json` → `autoStartServer()` (mDNS 2s → health check → `launchServer()` if autoStart) → `spawn(process.execPath, ["--import", jiti, cli.ts])` → ConnectionManager ws://localhost:9999.

## The Tool Resolution Problem
- What needs resolving — pi (spawn sessions), openspec (in sessions), node (runtime), tsx (server launch standalone), bridge (extension dir), serverCli (cli.ts).
- Why it's hard — Chain 2 (TUI) works: shell full PATH nvm/volta/brew/fnm. Chain 1 (Electron) breaks: GUI minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`), nvm/volta/brew invisible.
- Current mitigations (fragile) — each component resolves independently, no shared state: `dependency-detector.ts` (login shell fallback `$SHELL -lc "which"`), `server-lifecycle.ts` (prepend pi bin+bundled node), `process-manager.ts` (`buildSpawnEnv()`), `extension-register.ts` (relative __dirname), `server-launcher.ts` (`process.execPath`+relative). Login shell output has macOS session-restore noise to parse out.
- Failure modes — Electron GUI nvm (which pi fails), server can't spawn (PATH missing nvm bin), nvm version change (stale paths), AppImage (temp mount path changes), tmux (own env).

## Tool Source Hierarchy
- Power-user mode — prefers system: pi/openspec System PATH→Managed(`~/.pi-dashboard/`)→Bundled; node System→Bundled; tsx System→Managed→Bundled; bridge System(npm global)→Bundled→Dev; serverCli System→Bundled→Managed.
- Standalone npm install — `npm install -g @blackbelt-technology/pi-agent-dashboard`. pi/openspec/tsx = regular `dependencies` of pi-dashboard-server. No first-run install. `jiti` direct dep; bin wrapper `packages/server/bin/pi-dashboard.mjs` resolves jiti via argv[1] walk-up, re-execs `node --import <jiti-url> cli.ts`. `cli.ts` logs `[bootstrap] ready` on resolve.
- Electron arm (immutable bundle) — all runtime deps `<resourcesPath>/server/node_modules/` read-only. node `<resourcesPath>/node/bin/node`. Update via electron-updater whole-app. Legacy `~/.pi-dashboard/` untouched; `detectLegacyManagedDir` Doctor advisory.

## Target Architecture: Persisted Tool Paths
- Config schema — add `toolPaths` to `~/.pi/dashboard/config.json` (pi/openspec/node/tsx/bridge/serverCli absolute paths; null/missing → detect at runtime).
- Writers — Electron Wizard (initial detection+selection, first run), Server Startup (validate+re-detect every start), Settings Panel (manual override), Bridge Start (detect from shell env if empty).
- Consumers — Electron `ensureServer()` (serverCli/tsx/node → PATH from dirnames); Server process-manager (pi → `resolvePiCommand()`, PATH from dirname, tmux inject); Bridge server-launcher (serverCli/node); Bridge registration (bridge → settings.json packages[]); Wizard/Doctor/Settings (display/validate/edit).
- Server startup validation — for each tool: if path set + exists keep; else re-detect (login shell → system PATH → managed → bundled), update config + log move, or warn+null.
- PATH derivation — `buildPathFromToolPaths(toolPaths)`: Set of dirnames of existing paths + process.env.PATH. Auto-handles nvm/volta/brew.
- tmux PATH injection — tmux new shell no inherit; prepend `export PATH="${resolvedPath}:$PATH" && cd ... && pi`.

## Platform-Specific Considerations
- macOS (.app) — `resourcesPath`=`/Applications/PI Dashboard.app/Contents/Resources`, stable. Login shell fallback for nvm/volta (no .zshrc). Parse session-restore noise (first line starting `/`).
- Linux (deb/rpm) — `resourcesPath`=`/usr/lib/pi-dashboard/resources`, stable. Login shell fallback, less noise.
- Linux (AppImage) — `resourcesPath`=`/tmp/.mount_PIxxxxxx/resources`, UNSTABLE mount changes each launch. Don't persist bridge/serverCli; reject `/tmp/.mount_`; re-detect every start.
- Windows (NSIS) — `resourcesPath`=`C:\Program Files\PI Dashboard\resources`, stable. No login shell (PATH global). Spawn `windowsHide:true`.

## Key Files
`shared/src/config.ts` (DashboardConfig), electron `dependency-detector.ts`/`server-lifecycle.ts`(ensureServer,launchViaCli)/`health-check.ts`(isDashboardRunning)/`bridge-register.ts`/`wizard-ipc.ts`/`wizard-window.ts`/`renderer/wizard.html`/`main.ts`, extension `bridge.ts`/`server-auto-start.ts`(mDNS→health→launch)/`server-launcher.ts`(process.execPath+jiti), server `server.ts`(ensureBridgeExtensionRegistered)/`extension-register.ts`/`process-manager.ts`(spawnPiSession,buildSpawnEnv,resolvePiCommand)/`session-bootstrap.ts`.

## Migration Path
`toolPaths` additive, all optional. Phase1 add schema (fallback detection). Phase2 wizard writes, server validates. Phase3 settings edit, dashboard-settings.json = "wizard completed" flag. Phase4 remove scattered detection, read from config with detect-on-miss.

## Appendix: Detection Methods
- Login shell fallback (macOS/Linux) — `-lc` (login non-interactive; `-i` forbidden — interactive claims tty, parent pi gets SIGTSTP). Used when `which` fails on process PATH. `$SHELL -lc "which <cmd>"`, extract first line starting `/` (zsh session-restore noise).
- buildSpawnEnv (server process-manager) — with toolPaths: `buildPathFromToolPaths` prepend; without: managed bin+node bin+`~/.local/bin`+`/usr/local/bin`.
