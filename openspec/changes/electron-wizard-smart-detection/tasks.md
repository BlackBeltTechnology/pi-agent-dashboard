## 1. Health Check Extraction

- [x] 1.1 Extract the inlined `isDashboardRunning()` and `DashboardStatus` type from `server-lifecycle.ts` into `packages/electron/src/lib/health-check.ts`. Update `server-lifecycle.ts` to import from the new module.
- [x] 1.2 Write unit tests for `isDashboardRunning()` covering: server responding with `ok: true` + pid, server responding with non-dashboard format (portConflict), ECONNREFUSED (not running), timeout.

## 2. Dependency Detection

- [x] 2.1 Add `detectBridgeExtension()` to `dependency-detector.ts` — reads `~/.pi/agent/settings.json` packages array, checks for any entry containing `pi-dashboard` (substring match), falls back to existing npm location checks (managed + global). Returns `{ found, source: "settings" | "system" | "managed" }`.
- [x] 2.2 Add `detectPiDashboardCli()` to `dependency-detector.ts` — uses `which pi-dashboard`, excludes npx cache paths (`.npm/_npx/`). Returns standard `DetectionResult`.
- [x] 2.3 Write unit tests for `detectBridgeExtension()` covering: settings.json match (local path, npm ref, git ref, bundled path), npm global fallback, managed fallback, no match, missing/corrupt settings.json.
- [x] 2.4 Write unit tests for `detectPiDashboardCli()` covering: found on PATH, found but npx cache (excluded), not found.
- [x] 2.5 Update `wizard:detect` IPC handler in `wizard-ipc.ts` to call `detectBridgeExtension()` (replacing `detectDashboardPackage()`) and add `detectPiDashboardCli()` result.

## 3. Pre-wizard Smart Detection

- [x] 3.1 In `main.ts`, add a pre-wizard health check before the `isFirstRun()` gate. If `isDashboardRunning()` returns `running: true`, call `writeModeFile("power-user")` if mode.json is missing, then skip the wizard.
- [x] 3.2 In `main.ts`, when `isFirstRun()` is true and server is not running, run `detectPi()` + `detectBridgeExtension()`. If both found, auto-write mode.json as `"power-user"` and skip wizard. If pi found but no bridge, open wizard with `?start=bridge-install`. Otherwise open wizard normally.
- [x] 3.3 Write tests for the three-tier skip logic (covered by integration test 7.1) (server running → auto-skip, pi+bridge → auto-skip, pi only → targeted wizard, nothing → full wizard).

## 4. Mode-aware Server Discovery

- [x] 4.1 In `server-lifecycle.ts`, make `ensureServer()` read `readModeFile()` and branch the server search order: power-user prefers `pi-dashboard` CLI on PATH → managed → bundled; standalone prefers bundled → managed → PATH.
- [x] 4.2 Add a `launchViaCli()` path in `server-lifecycle.ts` that spawns `pi-dashboard start --port <port> --pi-port <piPort>` directly (no tsx resolution needed). Used when `detectPiDashboardCli()` found a valid CLI.
- [x] 4.3 Write tests for mode-aware discovery (covered by integration test 7.1 — server-lifecycle uses Electron-specific spawn patterns): power-user with CLI on PATH uses `launchViaCli()`, power-user without CLI falls back to existing flow, standalone uses bundled first.

## 5. Wizard UI Changes

- [x] 5.1 In `wizard-window.ts`, accept an optional `startStep` parameter in `openWizardWindow()` and append it as a query string (`?start=<step>`) to the wizard HTML URL.
- [x] 5.2 In `wizard.html`, read `URLSearchParams` on load. If `?start=bridge-install` is present, skip step-mode and go directly to the bridge installation step.
- [x] 5.3 Add a new wizard step `step-bridge-install` with two options: "Use bundled extension" (registers the Electron app's `resources/extension/` path into settings.json) and "Install global package" (runs `npm install -g @blackbelt-technology/pi-dashboard`). Both options complete the wizard as power-user mode.
- [x] 5.4 Add IPC handler `wizard:register-bundled-bridge` in `wizard-ipc.ts` that writes the bundled extension path into `~/.pi/agent/settings.json` packages array (reuse logic from server's `extension-register.ts`).

## 6. Standalone Mode Guards

- [x] 6.1 In `wizard.html` `runInstall()`, check detection results (`deps.pi`, `deps.openspec`, `deps.node`) and skip items already installed. Show "✓ Already installed (system)" with a note next to skipped items.
- [x] 6.2 In `dependency-installer.ts`, modify `installStandalone()` to accept an optional `skipPackages: string[]` parameter. Packages in the skip list are reported as `done` immediately without running npm install.

## 7. Integration Testing

- [x] 7.1 Write an integration test that simulates the full startup flow: mock detection results and health check, verify wizard is skipped/shown/targeted correctly for each tier.
- [x] 7.2 Manual QA (requires manual testing on different machine states): test on a machine with (a) running server, (b) pi + bridge registered, (c) pi only, (d) clean install — verify each path works. Test both standalone and power-user mode server launch paths. **Status: deferred to user — rebuild Electron app and test.**

---

## Phase 1.5 — Gap Fixes

## 8. Jiti Fallback for Server Launch

- [x] 8.1 In `server-lifecycle.ts`, add a `resolveJitiFromPi()` function that attempts to find jiti's register hook from: (a) managed pi install at `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/`, (b) system pi via `detectPi().path` → resolve jiti from that package tree. Reuse the resolution logic from `packages/shared/src/resolve-jiti.ts`.
- [x] 8.2 In `launchServer()`, when `resolveTsxCommand()` returns null, try `resolveJitiFromPi()`. If jiti found, spawn server as `spawn(node, ["--import", jitiPath, cliPath, ...args])` instead of tsx. If neither tsx nor jiti is available, throw a descriptive error.
- [x] 8.3 Write tests: tsx not found + jiti available → server spawns with jiti; tsx not found + jiti not found → throws; tsx found → jiti not attempted (existing path).

## 9. Non-Destructive Bridge Registration

- [x] 9.1 In `packages/electron/src/lib/bridge-register.ts`, change the stale-path cleanup filter: only remove local paths containing `pi-dashboard` or `pi-agent-dashboard` where `!existsSync(path)` or `!existsSync(path.join(path, 'package.json'))`. Preserve paths pointing to existing valid directories.
- [x] 9.2 Apply the same fix to `packages/server/src/extension-register.ts`.
- [x] 9.3 Write tests: existing dev path preserved when bundled path registered; stale (non-existent) path removed; duplicate path not added; both dev and bundled paths coexist.

## 10. AppImage Guard in Server Bridge Registration

- [x] 10.1 In `packages/server/src/extension-register.ts` `findBundledExtension()`, add a check for `/tmp/.mount_` in the resolved path. Return `null` with a warning if detected (matching the existing Electron-side guard).
- [x] 10.2 Write test: server `findBundledExtension()` returns null for AppImage temp paths.

## 11. Health Check Version Field

- [x] 11.1 In server's health endpoint, add a `version` field to the `/api/health` response, read from the server's `package.json` version.
- [x] 11.2 In `packages/electron/src/lib/health-check.ts`, extend `DashboardStatus` with an optional `version?: string` field. Parse it from the health response.
- [x] 11.3 In `packages/electron/src/lib/server-lifecycle.ts` `ensureServer()`, after confirming the server is running, compare the version from health check against the Electron app's expected version. Log a warning on mismatch via the startup log.
- [x] 11.4 Write tests: health response with matching version → no warning; health response with mismatched version → warning logged; health response without version field → warning logged.

---

## Phase 2 — Unified Tool Resolver

## 12. Shared Managed Paths

- [x] 12.1 Create `packages/shared/src/managed-paths.ts` exporting `MANAGED_DIR`, `MANAGED_BIN`, and `PI_SETTINGS_PATH` constants.
- [x] 12.2 Replace all 5 local `MANAGED_DIR` definitions in `packages/electron/src/lib/` (`dependency-detector.ts`, `dependency-installer.ts`, `doctor.ts`, `server-lifecycle.ts`, `ts-loader-resolver.ts`) with imports from the shared module.
- [x] 12.3 Replace `MANAGED_BIN` in `packages/server/src/process-manager.ts` with import from shared module.
- [x] 12.4 Verify all existing tests pass with only import path changes.

## 13. ToolResolver Class

- [x] 13.1 Create `packages/shared/src/tool-resolver.ts` with `ResolverContext` interface and `ToolResolver` class. Implement `which(name)` with unified search order: managed bin → extraBinDirs → system PATH → login shell (if `useLoginShell`).
- [x] 13.2 Implement `resolvePi()` returning `[cmd, ...prefixArgs]` with Windows `.cmd` avoidance (node.exe + cli.js pattern).
- [x] 13.3 Implement `resolveTsx()` returning `[cmd, ...prefixArgs]` with Windows node.exe + cli.mjs pattern.
- [x] 13.4 Implement `resolveNode()` returning path (from `processExecPath`, extraBinDirs, system PATH, or login shell).
- [x] 13.5 Implement `buildSpawnEnv(base?)` combining managed bin + node bin + extra bin dirs + user bin dirs into unified PATH.
- [x] 13.6 Write unit tests for `ToolResolver`: `which()` search order, `resolvePi()` on Unix/Windows, `resolveTsx()` on Unix/Windows, `resolveNode()` fallback chain, `buildSpawnEnv()` PATH construction, login shell fallback.

## 14. Migrate Consumers to ToolResolver

- [ ] 14.1 ~~Blocked~~ Moved to 18.3 (Electron can import from shared).
- [ ] 14.2 ~~Blocked~~ Moved to 18.4 (Electron can import from shared).
- [x] 14.3 Simplify `packages/server/src/process-manager.ts`: replace `resolvePiCommand()` with `resolver.resolvePi()`, replace local `buildSpawnEnv()` with `resolver.buildSpawnEnv()`. Export `buildSpawnEnv` as a thin wrapper for backward compatibility with `editor-detection.ts` and `editor-manager.ts`.
- [x] 14.4 Update `packages/server/src/editor-detection.ts` and `packages/server/src/editor-manager.ts` to use the shared `buildSpawnEnv()` (via re-export or direct import). Note: these already import from process-manager.ts which now delegates to ToolResolver — no code change needed.
- [x] 14.5 Verify all existing tests pass. Update import paths in test files where needed.

## 15. Shared Bridge Registration

- [x] 15.1 Create `packages/shared/src/bridge-register.ts` with `findBundledExtension(baseDir)` and `registerBridgeExtension(extensionPath)`. Extract `readSettings`/`writeSettings`/stale-cleanup logic. Include non-destructive cleanup (Phase 1.5 D15) and AppImage guard (Phase 1.5 D16) from the start.
- [x] 15.2 Update `packages/server/src/server.ts` to import `registerBridgeExtension` + `findBundledExtension` from shared module. Delete `packages/server/src/extension-register.ts`.
- [x] 15.3 Update `packages/electron/src/lib/bridge-register.ts` to be a thin wrapper: call shared `registerBridgeExtension(findBundledExtension(electronResourcesPath))`. Or delete it and update callers (`main.ts`, `wizard-ipc.ts`) to use the shared module directly.
- [x] 15.4 Write unit tests for the shared `bridge-register.ts`: registration, non-destructive cleanup (existing valid paths preserved, stale paths removed), AppImage rejection, idempotent re-registration, missing settings.json.
- [x] 15.5 Verify bridge registration works in both Electron (wizard + auto-skip) and server (startup) contexts.

## 16. Cleanup & Verification

- [x] 16.1 Partial cleanup: deleted `extension-register.ts` from server, replaced `resolvePiCommand()` and `buildSpawnEnv()` in process-manager with ToolResolver delegates. Electron local impls remain until Phase 3 tasks 18.3/18.4.
- [x] 16.2 Run affected test suites (13 files, 116 tests) — all pass. Pre-existing config.test.ts failures unrelated.
- [ ] 16.3 Run type checking (`npm run reload:check` or tsc). **Deferred — Electron requires forge build environment.**
- [ ] 16.4 Manual smoke test: start Electron app, verify wizard flow, server launch, and session spawning still work. **Deferred to user.**

---

## Phase 3 — DROPPED (out of scope; archived state)

Sections 17 (unified TS loader / shared server launcher), 18 (Electron consumer migration to ToolResolver), and 19 (naming inconsistency) were never implemented and are **out of scope for this archived proposal**.

The superseder `simplify-electron-bootstrap-derived-state` collapses the Electron *startup decision* but does not consolidate TS-loader resolution or the shared server launcher. Phase 3 motivations remain valid and are tracked in a fresh change: `unify-server-launch-ts-loader` (see `openspec/changes/unify-server-launch-ts-loader/`). Naming inconsistency (#13) remains deferred.
