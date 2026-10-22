# DOX — packages/electron/src/lib

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `app-menu.ts` | App menu with About dialog + Doctor on all platforms. Doctor menu entry opens `openDoctorWindow()` (replaces… → see `app-menu.ts.AGENTS.md` |
| `app-updater.ts` | electron-updater wrapper. `initAutoUpdater()` 60s + 24h check, dev-skip. `autoDownload=false`. → see `app-updater.ts.AGENTS.md` |
| `attach-evaluation.ts` | `createAttachEvaluator(deps).evaluate()` — attach-arm evaluation, all I/O injected: one health fetch →… → see `attach-evaluation.ts.AGENTS.md` |
| `bridge-register.ts` | Registers bundled bridge extension into `~/.pi/agent/settings.json`. → see `bridge-register.ts.AGENTS.md` |
| `build-version.ts` | Windows-safe build version helper. Exports `deriveWindowsBuildVersion(pkgVersion, runNumber)` → 4-integer… → see `build-version.ts.AGENTS.md` |
| `bundled-node.ts` | Resolves bundled Node.js/npm paths in Electron resources |
| `connecting-window.ts` | `openConnectingWindow(initial, onClosed)` → `ConnectingHandle{push,focus,close,isOpen}`;… → see `connecting-window.ts.AGENTS.md` |
| `dependency-detector.ts` | Detects pi, openspec, Node.js on system PATH + managed install. → see `dependency-detector.ts.AGENTS.md` |
| `doctor-bridge-contract.ts` | `DoctorBridge` TypeScript interface. Imported by preload + renderer. Channel-name-drift breaks type-check. |
| `doctor-window.ts` | `openDoctorWindow()` factory. BrowserWindow 1000×720. Single-instance focus-reuse. → see `doctor-window.ts.AGENTS.md` |
| `doctor.ts` | Electron-only doctor checks (Electron version, bundled Node, bundled npm, server-code path, server-launch… → see `doctor.ts.AGENTS.md` |
| `health-check.ts` | Thin re-export of `@blackbelt-technology/pi-dashboard-shared/server-identity.js` (`isDashboardRunning`,… → see `health-check.ts.AGENTS.md` |
| `ipc-trust.ts` | Sender-frame trust for privileged `dashboard:*` IPC. `isTrustedSenderUrl(url, {loadingPagePath, localPort})`… → see `ipc-trust.ts.AGENTS.md` |
| `launch-source.ts` | `selectLaunchSource()` resolver. Chain `attach` (health probe; skipped with `skipAttach` for runtime… → see `launch-source.ts.AGENTS.md` |
| `link-handling.ts` | Pure helpers used by Electron shell. **`isSameOriginUrl(href, serverOrigin)`** — classifies URLs as… → see `link-handling.ts.AGENTS.md` |
| `local-proof-bootstrap.ts` | Main-process local proof: `localTokenHeaders()` (reads `~/.pi/dashboard/local/token`), `mintLocalProofUrl`,… → see `local-proof-bootstrap.ts.AGENTS.md` |
| `lock-metadata.ts` | Read per-HOME dashboard lock sidecar. Exports `DashboardLockMetadata` interface, `getLockMetaPath()`,… → see `lock-metadata.ts.AGENTS.md` |
| `managed-paths.ts` | Managed install paths, mirrored locally (no shared-pkg import for ESM resolution in packaged app). → see `managed-paths.ts.AGENTS.md` |
| `pairing-client.ts` | `startPairing(target, deps)` → `PairingSession{send,stop,done}`. → see `pairing-client.ts.AGENTS.md` |
| `pick-node.ts` | `pickNodeForServer(PickNodeInput): PickNodeResult` — discriminated union… → see `pick-node.ts.AGENTS.md` |
| `quit-guard.ts` | `installQuitGuard(app, {isQuitting, requestQuit})`: `before-quit` → full quit (stop server, tray, exit) for… → see `quit-guard.ts.AGENTS.md` |
| `remote-probe.ts` | Main-process remote-dashboard reachability probe, extracted from `remote-connect-window.ts` so `main.ts` can… → see `remote-probe.ts.AGENTS.md` |
| `renderer-paths.ts` | `getWizardPreloadPath()`, `getRendererHtmlPath(name)`: resolve bundled wizard preload + `renderer/*.html`… → see `renderer-paths.ts.AGENTS.md` |
| `resolve-cdp-activation.ts` | Pure `resolveCdpActivation(argv, env): {enabled, port?}`. → see `resolve-cdp-activation.ts.AGENTS.md` |
| `runtime-overlay-main.ts` | Real-I/O wiring. `gateRuntimeRoot` (manifest compat + preflight; local: checkout `engines.node` vs shell Node… → see `runtime-overlay-main.ts.AGENTS.md` |
| `runtime-overlay.ts` | Runtime-overlay state machine, pure over `~/.pi/dashboard/runtime/` (writes `state.json` only). → see `runtime-overlay.ts.AGENTS.md` |
| `runtime-switch-ownership.ts` | Leaf module: PID-scoped exit ownership during a switch. `expectExit`, `claimCandidate`,… → see `runtime-switch-ownership.ts.AGENTS.md` |
| `server-discovery.ts` | Pure helpers: `shortFingerprint` (`sha256:` + 16 chars), `isFingerprint`, `serverOrigin` (brackets IPv6),… → see `server-discovery.ts.AGENTS.md` |
| `server-error-classification.ts` | Pure `isDeadlineOrChildExitError(message)` returns true for messages starting with "Server did not respond… → see `server-error-classification.ts.AGENTS.md` |
| `server-keyring.ts` | `ServerKeyring` / `loadKeyring`: paired servers by fingerprint in `~/.pi-dashboard/server-keyring.json` (v1). → see `server-keyring.ts.AGENTS.md` |
| `server-lifecycle.ts` | Thin `selectLaunchSource + spawnFromSource` shim under R3. → see `server-lifecycle.ts.AGENTS.md` |
| `server-windows-main.ts` | `startServerWindows(opts)`: Electron binding for server windows. → see `server-windows-main.ts.AGENTS.md` |
| `server-windows.ts` | `createServerWindows(deps)`: one window per paired server on its own origin. → see `server-windows.ts.AGENTS.md` |
| `servers-ipc.ts` | `servers:*` IPC (own family). `registerServersIpc(deps)`; `isServerWindowsSender` accepts only TOP frame of… → see `servers-ipc.ts.AGENTS.md` |
| `servers-menu.ts` | Servers submenu for app + tray menus: `buildServersSubmenu`, `serversMenuItem`, `setServersMenuHooks`,… → see `servers-menu.ts.AGENTS.md` |
| `tray.ts` | System tray with platform-specific icons (template on macOS, ico/png on Win/Linux) → see `tray.ts.AGENTS.md` |
| `update-checker.ts` | Checks outdated pi/openspec versions. Exports `OutdatedPackage`, `checkOutdated(starter)` (Standalone→global,… → see `update-checker.ts.AGENTS.md` |
| `update-notifier.ts` | Native OS update notifications via Electron `Notification`. → see `update-notifier.ts.AGENTS.md` |
| `window-state.ts` | Persists BrowserWindow size/position to `~/.pi/dashboard/window-state.json`. → see `window-state.ts.AGENTS.md` |
| `remote-connect-window.ts` | `openRemoteConnectWindow()` factory (520×780) + IPC for `remote-connect.html`. → see `remote-connect-window.ts.AGENTS.md` |
| `wizard-state.ts` | Dashboard settings persistence: `~/.pi-dashboard/dashboard-settings.json` (renamed from `mode.json`;… → see `wizard-state.ts.AGENTS.md` |
| `zombie-adoption-dialog.ts` | Zombie-server adoption modal + stop sequence. `promptZombieAdoption({pid}):… → see `zombie-adoption-dialog.ts.AGENTS.md` |
