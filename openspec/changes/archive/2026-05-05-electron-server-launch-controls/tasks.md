## 1. Main-process launch routine

- [x] 1.1 Add `LaunchOutcome` and `LaunchStatus` type exports to `packages/electron/src/lib/server-lifecycle.ts`
- [x] 1.2 Implement `requestServerLaunch(opts?: { force?: boolean }): Promise<LaunchOutcome>` reusing the existing `ensureServer()` spawn body
- [x] 1.3 Implement in-module shared-Promise guard so concurrent callers share one spawn attempt
- [x] 1.4 Implement force-restart branch: POST `/api/restart` first, fall through to fresh spawn on failure
- [x] 1.5 Wrap spawn errors so the routine returns `{ kind: "failed", reason, logTail }` instead of throwing
- [x] 1.6 Add `isManagedServerRunning(port): Promise<boolean>` helper (thin wrapper over existing `isDashboardRunning`)
- [x] 1.7 Add `readServerLogTail(lines: number): Promise<string>` reading at most 8 KiB from `~/.pi/dashboard/server.log`
- [x] 1.8 Unit tests in `packages/electron/src/lib/__tests__/server-lifecycle-launch.test.ts` covering: already-running, started, failed, force-restart, concurrent-share, throw-to-value

## 2. IPC channels & emitter

- [x] 2.1 Register `ipcMain.handle('dashboard:request-launch', ...)` in `packages/electron/src/main.ts`
- [x] 2.2 Register `ipcMain.on('dashboard:open-doctor', ...)` calling existing Doctor entry point
- [x] 2.3 Register `ipcMain.handle('dashboard:read-server-log', ...)` calling `readServerLogTail`
- [x] 2.4 Add a tiny event emitter inside `requestServerLaunch()` that pushes `dashboard:launch-status` to the loading-page `webContents`
- [x] 2.5 Unregister IPC handlers on `before-quit` to avoid leaks across reload cycles

## 3. Loading page resource & preload

- [x] 3.1 Create `packages/electron/resources/loading.html` (port content from current inline HTML in `main.ts:158-198`, add Start button + log panel + Doctor link)
- [x] 3.2 Create `packages/electron/src/preload-loading.ts` exposing `requestLaunch`, `openDoctor`, `readServerLog`, `onStatus` via `contextBridge`
- [x] 3.3 Update `main.ts::createLoadingWindow` to use `loadFile()` and attach the new preload
- [x] 3.4 Add `loading.html` and the compiled preload bundle to Forge `extraResource` in `packages/electron/forge.config.ts`
- [x] 3.5 Wire renderer click handlers: button → `requestLaunch()`; link → `openDoctor()`; on mount → `readServerLog()` + `onStatus()`
- [x] 3.6 Update status text and disable/re-enable button based on `LaunchStatus` push events

## 4. Tray dynamic menu

- [x] 4.1 Refactor `packages/electron/src/lib/tray.ts::createTray` to accept a `getServerStatus()` callback
- [x] 4.2 Build the menu template with conditional first item: "Start server" or "Restart server"
- [x] 4.3 Wire menu-item clicks to `requestServerLaunch({ force: <isRunning> })`
- [x] 4.4 Add a 3-second `setInterval` that re-probes `isManagedServerRunning(port)` and rebuilds the menu when state flips
- [x] 4.5 Clear the interval in `destroyTray()`
- [x] 4.6 Unit test: pure menu-template builder takes `{ isRunning: boolean }` and returns expected `MenuItemConstructorOptions[]`

## 5. Packaging & QA

- [x] 5.1 Verify packaged Linux AppImage / DEB ships `loading.html` and preload (`scripts/test-server-launch.sh` extension)
- [x] 5.2 Verify packaged Windows NSIS ships the same (extend `scripts/test-electron-install.sh`)
- [x] 5.3 Verify packaged macOS DMG (manual smoke; arm64 + x64 via `make manual-macos-*`)
- [x] 5.4 Add repo-lint test asserting no `data:text/html` URL is loaded into a `BrowserWindow` in `main.ts` (regression guard)

## 6. Documentation

- [x] 6.1 Update `README.md` "Auto-start" section with one paragraph on the new manual launch controls
- [x] 6.2 Add an FAQ entry to `docs/faq.md`: "How do I retry the dashboard server launch from the Electron app?"
- [x] 6.3 Add per-file rows for the new files (`loading.html`, `preload-loading.ts`) to `docs/file-index-electron.md` (caveman style, alphabetical)
- [x] 6.4 Append change-history annotation to existing rows for `main.ts`, `tray.ts`, `server-lifecycle.ts` in `docs/file-index-electron.md`
