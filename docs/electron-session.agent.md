# electron-session.md — index

Pull-only condensed map. Source: docs/electron-session.md. Implementation session log: built/tried/failed/lessons.

## Session Timeline
- Phase 1: Branding & Icons — nano-banana recenters π glyph → 1024² master. macOS tray template icons via ImageMagick (AI can't do transparency). `electron-icon-builder` → .icns/.ico. `app.name="PI Dashboard"`. Gotcha: Packager renames icon → `electron.icns`.
- Phase 2: Packaging Formats — Squirrel→NSIS, add AppImage. Failed: electron-builder makers export plain fn not MakerBase. Worked: `@felixrieseberg/electron-forge-maker-nsis`, `@pengx17/electron-forge-maker-appimage`. Vite `main:".vite/build/main.js"`. `appdmg` only builds Node 22.
- Phase 3: Cross-Platform Build Script — macOS native DMG; Linux Docker DEB+AppImage; Windows Docker (Wine fragile). Docker fixes: bookworm-slim, `--allow-unauthenticated`, prune disk, curl/ca-certificates/xz-utils. `npx @electron-forge/cli make` (not bare electron-forge=v5).
- Phase 4: macOS Catalina Support — 10.15 VMware. Failed: `LSMinimumSystemVersion` plist (Mach-O `minos 11.0` baked). Worked: Electron 33→32 (last 10.15 support).
- Phase 5: VM White Screen Fix — VMware GPU no HW accel. Failed: `ELECTRON_DISABLE_GPU=1 open` (open drops env). Worked: auto-detect VM before whenReady → `disableHardwareAcceleration()`+`disable-gpu`. macOS `sysctl hw.model`, Linux `systemd-detect-virt`, Windows WMIC.
- Phase 6: Loading Page & Error Handling — branded π loading page, 15s connect, retry, 3-option dialog (Setup/Retry/Quit). Outer catch shows dialog not silent quit.
- Phase 7: First-Run Wizard & Self-Contained — dashboard not on npm → bundle server as extraResource (`bundle-server.mjs`). Wizard installs only pi/openspec/tsx. Async `exec` (execSync froze main). Prepend bundled node dir to PATH.
- Phase 8: The __dirname Saga — server crashed `__dirname is not defined`. Attempts 1-6 (remove type:module, dirname-shim, tsx register.js, Docker test revealed real error = wrong-platform `pty.node`). Final: run `tsx` binary directly (shims CJS globals), not `node --import tsx-loader`.
- Phase 9: Native Module Platform Mismatch — `pty.node` built for darwin-arm64 shipped in .deb. Final: two-phase `bundle-server.mjs --source-only` + `docker-make.sh` npm install in Linux, copy `build/Release/pty.node`→`prebuilds/linux-x64/`, remove darwin/win32.
- Phase 10: Doctor Diagnostic — 12 checks. macOS PI Dashboard menu→Doctor; Win/Linux Help→Doctor.

## Architecture
Electron discovers/launches Dashboard Server; BrowserWindow loads localhost:8000. Bundled: `resources/node`, `resources/server`, `resources/renderer`, icons. `~/.pi-dashboard/`: pi/openspec/tsx, mode.json, server.log.

## Key Technical Details
- Server Launch Command — `~/.pi-dashboard/node_modules/.bin/tsx <resources>/server/packages/server/src/cli.ts --port 8000 --pi-port 9999`. Env: PATH prepends bundled node + managed .bin; NODE_PATH.
- Server CLI Resolution Order — 1 bundled `resourcesPath/server/...cli.ts`, 2 dev relative, 3 managed, 4 `require.resolve`.
- tsx Binary Resolution Order — 1 managed `.bin/tsx`, 2 `which tsx`.
- Wizard Install List — `@earendil-works/pi-coding-agent`, `@fission-ai/openspec`, `tsx`. Dashboard NOT installed (bundled).

## File Layout
`packages/electron/`: forge.config.ts, vite.main/preload.config.ts, entitlements.plist. `src/main.ts` (VM detect, single-instance, wizard, launch, tray). `src/lib/` (app-menu, app-updater, bundled-node, dependency-detector/installer, doctor, server-lifecycle, tray, ts-loader-resolver, wizard-ipc/state, window-state). `resources/` (icons, node, server build artifacts). `scripts/` (build-installer.sh, bundle-server.mjs, docker-make.sh, download-node.sh, test-*.sh, Dockerfile.build).

## Build Commands
`npm run electron:build [-- --linux|--windows|--all|--skip-client]`. Low-level `npm run package|make|icons|start:dev`. Tests `test-electron-install.sh`/`test-deb-install.sh`/`test-desktop-launch.sh`/`test-server-launch.sh`. Debug `cat ~/.pi-dashboard/server.log`.

## CI Workflow
`.github/workflows/electron-build.yml` on `v*`/dispatch. macos-14 arm64 .dmg, macos-13 x64 .dmg, ubuntu-latest .deb+.AppImage, windows-latest .exe NSIS native. No cross-compile in CI. macOS launch smoke `qa/tests/09-electron-mac-launch.sh` in `_electron-build.yml`: asserts `/api/health` 200 + `launchSource==electron`. `act` only runs Linux jobs.

## Startup Flow (Clean OS)
whenReady → VM detect (disable GPU) → first-run wizard (standalone install pi/openspec/tsx OR power-user verify) → API key → mode.json → ensureServer (health check → spawn tsx cli.ts, 15s deadline → error Setup/Retry/Quit) → loading page → `/api/health` → dashboard.

## Lessons Learned (1-15)
1 tsx binary not --import (shims CJS `__dirname`). 2 native modules rebuild in target platform. 3 no `"type":"module"` at bundle root (propagates ESM). 4 Electron version = macOS minimum (minos baked). 5 macOS `open` drops env. 6 Forge maker API = MakerBase, community wrappers export plain fn. 7 Docker disk `prune -af --volumes`. 8 `npx electron-forge`→v5, use full scoped name. 9 async critical (execSync freezes main). 10 bundle server don't install. 11 ESM dynamic import fails in packaged Electron → inline. 12 `process.resourcesPath` Electron-only, use `process.execPath`. 13 desktop launchers don't source profiles → minimal PATH. 14 `stdio:"ignore"` breaks `sleep N | cmd`, use `tail -f /dev/null | cmd`. 15 `window-all-closed` fires after wizard → guard startup flag.

- Phase 11: __dirname in Vite ESM Bundle (Linux) — main process itself. `bundled-node.ts` + `server-lifecycle.ts` used bare `__dirname`. ESM evaluates array literals eagerly → ReferenceError. Fix: `const __dirname = path.dirname(fileURLToPath(import.meta.url))`.
- Phase 12: Docker Install Test — 19 checks (bundled resources, no type:module leak, node-pty prebuild, wizard sim, __dirname safety, server launch+health). Ubuntu 22.04 non-root. `test-electron-install.sh`.
- Phase 13: Server Lifecycle — Inlined Config & Health Check — dynamic import of shared pkg fails packaged. Fix: inline `loadMinimalConfig()`, `isDashboardRunning()`; removed mDNS.
- Phase 14: Window Close & Startup Guard — only macOS hide-to-tray; Linux/Win quit on close. `isStartingUp` guard. Hardcoded `http://localhost:8000` fallback.
- Phase 15: Client Build Path in Bundled Server — server resolves `../../dist/client`. Fix: bundle client to `packages/dist/client/`.
- Phase 16: Node.js on PATH for Spawned Scripts — `pi` shebang `#!/usr/bin/env node` fails no-system-node. `buildSpawnEnv()` adds `dirname(process.execPath)` + `~/.local/bin` etc.
- Phase 17: Headless Session Spawn — stdin Pipeline Bug — `pi --mode rpc` exits when shell stdin `/dev/null`. Fix: `tail -f /dev/null | ${piCmd}` (inotify, no stdin dep). `spawn("sh",["-c",...],{detached,stdio:"ignore"})`.
- Phase 18: Additional Improvements — Doctor Copy to Clipboard, menu restructure, OAuth popup-close detection, wizard progress streaming, VS Code Server guide, API key save fix (`acquireLock` mkdir), icon refresh, `autoShutdown` default true→false.
- Phase 19: Docker Test Suite — 3 levels: bundled server, DEB install, desktop launch (minimal PATH). Rewritten under `bump-pi-compat-to-0-78` for bundle-only flow.
- Phase 20: Bridge Extension Bundling & Auto-Registration — sessions vanished; extension not bundled. Fix: bundle `packages/extension/`, `extension-register.ts` adds to `~/.pi/agent/settings.json`, `server.ts` calls `ensureBridgeExtensionRegistered()` at startup.
- Phase 21: Windows Support — 4 fixes: (1) Vite externalize all `builtinModules` (require broke); (2) bundled npm path Win `node/node_modules/npm/` no lib/; (3) `.cmd` needs `shell:true`; (4) paths with spaces quote command+args. VM detect `wmic`. NSIS→ZIP Docker cross-build. Tray icons bold π.

## Known Issues & Future Work
Windows NSIS cross-compile needs Wine (Docker→ZIP). macOS universal binary TODO `@electron/universal`. AppImage ~150MB. AppImage auto-update needs different mechanism. Windows signing not set up. server.log not written if tsx fails to spawn. Shell stdin pipeline bug (Linux). OAuth without Pro plan.

## Lessons Learned (Addendum 16-20)
16 bundle ALL components pi needs (bridge extension). 17 externalize ALL Node builtins in Vite (`builtinModules`). 18 Windows .cmd needs `shell:true`. 19 quote all paths when `shell:true`. 20 check both Unix `lib/node_modules/npm/` + Windows `node_modules/npm/` layouts.
