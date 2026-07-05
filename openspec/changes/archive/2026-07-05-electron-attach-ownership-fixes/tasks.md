# Tasks

## 1. Health-endpoint foundation

- [x] 1.1 Reuse the existing `connectionCount(): number` getter on `packages/server/src/pi-gateway.ts` (`return connections.size`) for the bridge count. Do NOT add a duplicate `getActiveBridgeCount()` — `connectionCount()` already exposes exactly `connections.size` (the `Map<sessionId, WebSocket>` of pi bridge connections).
- [x] 1.2 In `packages/server/src/routes/system-routes.ts` `/api/health` handler, extend the response body to include:
  - `bootParentPid: number` — captured ONCE at server boot (module-load const) into the server's process identity. This is the parent PID the server was spawned under. Static by design.
  - `ppid: number` — the server's **live** parent PID, read fresh per request (NOT `process.ppid`, which Node caches on first access and will not reflect reparenting). POSIX read: Linux `/proc/self/stat` field 4; macOS `ps -o ppid= -p <pid>` (or `sysctl kern.proc.pid`). **Windows branch:** return `process.ppid` — Windows zombie detection uses `bootParentAlive`, not ppid (Windows never reparents), so the cached getter is fine there; the field must still populate so the shape is uniform and CI passes. Cache the reader's platform branch, not its value.
  - `bootParentAlive: computeBootParentAlive()` — evaluated per-request (see task 1.6). Boolean.
  - `activeBridgeCount: piGateway.connectionCount()` — evaluated per-request.
  - `launchSourceEffective: computeEffectiveLaunchSource({ raw: parseLaunchSource(process.env), activeBridgeCount, uptimeMs })`.
- [x] 1.3 Add pure helper `computeEffectiveLaunchSource(params)` to `packages/server/src/launch-source-effective.ts`:
  - Returns `"bridge-orphaned"` when `raw === "bridge"` AND `activeBridgeCount === 0` AND `uptimeMs > 30_000`.
  - Otherwise returns `raw` cast to the wider union.
- [x] 1.4 Unit tests in `packages/server/src/__tests__/launch-source-effective.test.ts`:
  - `bridge` + 0 bridges + uptime 31_000 → `bridge-orphaned`.
  - `bridge` + 0 bridges + uptime 29_000 → `bridge` (grace window).
  - `bridge` + 1 bridge + uptime 31_000 → `bridge`.
  - `electron` + 0 bridges + any uptime → `electron`.
  - `standalone` + 0 bridges + any uptime → `standalone`.
- [x] 1.5 Update `packages/server/src/__tests__/health-shape.test.ts` to assert presence of `bootParentPid`, `ppid`, `bootParentAlive`, `activeBridgeCount`, `launchSourceEffective` on every existing case. The ppid reader is platform-branched (POSIX syscall vs Windows `process.ppid`), so these assertions must hold on all three OSes in CI — add a `win32`-mocked case asserting `ppid`/`bootParentPid` are numbers and `bootParentAlive` is a boolean (not `undefined`/throw).
- [x] 1.6 Add new file `packages/server/src/boot-parent-liveness.ts` exposing `computeBootParentAlive(): boolean` — the two-tier parent-liveness check:
  - Capture `bootParentPid` once at module load.
  - **Tier 1 (all platforms, default):** `isProcessAlive(bootParentPid)` from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`. PID-reuse-vulnerable; documented.
  - **Tier 2 (`win32` only, identity-safe):** at module load, lazily load koffi **jiti-safely** — `const mod = createRequire(import.meta.url)("koffi"); const koffi = mod.default ?? mod;` inside try/catch. Rationale: the bundled server runs TS under jiti; `createRequire` bypasses any jiti ESM-interop wrapping and resolves from `resources/server/node_modules/` (mirrors how `server.ts` already resolves the client via `createRequire(...).resolve(...)`), and `?? mod` absorbs default-interop. Then declare `OpenProcess(uint32 access, bool inherit, uint32 pid) -> void*` and `WaitForSingleObject(void* h, uint32 ms) -> uint32` from `kernel32.dll`; `OpenProcess(SYNCHRONIZE=0x00100000, false, bootParentPid)` and retain the handle. `computeBootParentAlive()` returns `WaitForSingleObject(handle, 0) !== WAIT_OBJECT_0 (0x0)`. **Synchronous koffi calls only** (timeout 0, non-blocking) — no async koffi, so no background-thread/jiti interplay. On ANY failure (koffi load, null handle, denied access) set a module flag that permanently routes `computeBootParentAlive()` to the Tier 1 path. Never throw from the getter.
  - `koffi` added to `packages/server/package.json` under **`optionalDependencies`**, so a failed native install never breaks `npm install`; `bundle-server.mjs`'s `npm install --omit=dev` still materializes optionals into `resources/server/node_modules/koffi/`. No `forge.config.ts` change — koffi rides along in the already-extraResource'd (outside-asar) server tree, exactly like `node-pty`. No `asarUnpack`, no `electron-rebuild` (the server runs under bundled standalone Node, not Electron's process).
- [x] 1.7 Unit tests in `packages/server/src/__tests__/boot-parent-liveness.test.ts`:
  - Tier 1: injected `isProcessAlive` stub true/false → getter returns matching boolean.
  - Tier 2 fallback: simulate `koffi` require throwing → getter uses Tier 1 (assert no throw, boolean result).
  - (Tier 2 happy-path is exercised only in the Windows manual QA — `koffi`/`kernel32` can't be faithfully mocked cross-platform in unit tests.) Add new case: server with `DASHBOARD_STARTER=Bridge` and zero connected bridges + faked uptime > 30 s → `launchSourceEffective === "bridge-orphaned"`.

## 1b. Windows Tier-2 packaging (koffi native binary)

- [x] 1b.1 Add `koffi` to `packages/server/package.json` `optionalDependencies`. Confirm the version ships prebuilt `koffi.node` for the target Windows arch(es) (`win32_x64`, and `win32_arm64` if built). No node-gyp / compile at install — koffi delivers prebuilt binaries in its npm tarball.
- [x] 1b.2 Add a GO/NO-GO assertion (in `packages/electron/scripts/bundle-server.mjs` or `assert-runnable-bundle.mjs`) mirroring the existing `node-pty` prebuild check: on `win32` builds, fail the build if `resources/server/node_modules/koffi/build/koffi/win32_x64/koffi.node` is absent. Prevents a future koffi bump silently regressing every Windows user to Tier 1. macOS/Linux builds skip the assert (koffi unused there — POSIX uses the ppid signal).
- [x] 1b.3 Verify the bundled `resources/node` Node major is within koffi's supported N-API range; if a mismatch, either pin the bundled Node or the koffi version. One-line check; document the supported floor.
- [x] 1b.4 Confirm jiti-safe koffi loading on real Windows. AUTOMATED via CI smoke: `scripts/windows-liveness-smoke.ts` (wired into `_smoke.yml` standalone-install-smoke-windows leg) imports `boot-parent-liveness.ts` so koffi actually loads, and asserts `bootParentLivenessTier() === "tier2"` (koffi `OpenProcess`+`WaitForSingleObject` loaded, NOT the Tier-1 fallback) + `computeBootParentAlive()` boolean/idempotent. Cross-platform (Tier-1 on Linux/macOS). Fails the build on a silent Windows-wide degrade. Full bundled-server end-to-end still benefits from a manual bundle check, but the load-bearing Tier-2-vs-fallback assertion is now automated.

## 2. Pure ownership classifier (Electron-side)

- [x] 2.1 Add `decideOwnership({ healthLaunchSource, healthPid, storedSpawnedPid })` to `packages/electron/src/lib/server-lifecycle.ts`. Pure helper returning `"electron" | "foreign" | "none"`. Mirrors the rule:
  - `health.launchSource === "electron" AND health.pid === storedSpawnedPid` → `"electron"`
  - server reachable (i.e. caller supplied a non-null healthLaunchSource) → `"foreign"`
  - server unreachable (caller passes `null`) → `"none"`
- [x] 2.2 Add `decideIsZombie({ healthLaunchSourceEffective, healthPid, healthPpid, healthBootParentPid, healthBootParentAlive, storedSpawnedPid, platform })` to the same file. Returns boolean. Pure — all liveness is precomputed server-side into `healthBootParentAlive` (no injected `isPidAlive`; the server, not Electron, holds the Tier 2 handle).
  - `false` when `storedSpawnedPid !== null` (we own it).
  - `false` when `healthLaunchSourceEffective !== "electron"`.
  - **POSIX** (`platform !== "win32"`): `true` when `healthPpid !== healthBootParentPid` AND `healthBootParentAlive === false` (reparented away AND original parent gone — reliable on macOS AND Linux, incl. systemd `--user` subreapers and containers where the reparent target is not PID 1).
  - **Windows** (`platform === "win32"`): `true` when `healthBootParentAlive === false` (Windows never reparents, so liveness of the boot parent is the whole signal; the Job Object already covers the common crash path, this catches the bypass cases).
  - `false` otherwise.
- [x] 2.3 Unit tests in `packages/electron/src/lib/__tests__/server-lifecycle.test.ts`:
  - `decideOwnership` — three classes plus a `null` health case.
  - `decideIsZombie` POSIX — `ppid !== bootParentPid` + `bootParentAlive false` + no stored pid → true; `bootParentAlive true` → false; `ppid === bootParentPid` (not reparented) → false; reparented + dead parent but stored pid set → false (we own it); standalone/bridge launchSource → false.
  - `decideIsZombie` Windows — `bootParentAlive false` + electron + no stored pid → true (regardless of ppid); `bootParentAlive true` → false; stored pid set → false; non-electron launchSource → false.

## 3. Tray ownership-awareness (Thread 3)

- [x] 3.1 Widen `buildTrayMenuTemplate` in `packages/electron/src/lib/tray.ts`:
  - Replace `isRunning: boolean | null` with `ownership: "electron" | "foreign" | "none" | "unknown"`.
  - `"electron"` → first item "Restart server" (unchanged).
  - `"none"` → first item "Start server" (unchanged).
  - `"foreign"` → first item is a disabled `MenuItemConstructorOptions` with label `"Server managed externally"` and `enabled: false`, followed by separator and Show/Quit.
  - `"unknown"` → no launch item (current `null` behaviour preserved).
- [x] 3.2 Update the `createTray` hook contract:
  - Replace `getServerStatus: () => Promise<boolean>` with `getServerOwnership: () => Promise<"electron" | "foreign" | "none" | "unknown">`.
  - The polling loop calls the new probe every 3 s; menu rebuilds only when the value changes (preserving existing `lastIsRunning` optimization, generalized to `lastOwnership`).
- [x] 3.3 In `packages/electron/src/main.ts`, implement `getServerOwnership` adapter:
  - GET `/api/health` with 1 s timeout.
  - Returns `"unknown"` on fetch error or non-200.
  - Otherwise calls `decideOwnership({ healthLaunchSource: body.launchSourceEffective, healthPid: body.pid, storedSpawnedPid: getStoredSpawnedPid() })`. (Use `launchSourceEffective` not `launchSource` so bridge-orphaned classifies as foreign correctly.)
- [x] 3.4 Add `getStoredSpawnedPid(): number | null` to `packages/electron/src/lib/server-lifecycle.ts` (read-only accessor for the existing module-private `storedSpawnedPid`).
- [x] 3.5 Unit tests in `packages/electron/src/lib/__tests__/tray-menu.test.ts`:
  - Each ownership value renders the documented first item.
  - `"foreign"` item has `enabled: false` and the documented label.
  - `"unknown"` omits the launch item entirely.

## 4. Zombie detection + adoption modal (Thread 1)

- [x] 4.1 Add new file `packages/electron/src/lib/zombie-adoption-dialog.ts`:
  - Exports `promptZombieAdoption({ pid }): Promise<"adopt" | "leave" | "stop">`.
  - Uses Electron `dialog.showMessageBox` with three buttons; maps button index to the union.
  - Default button: `"leave"` (safest — preserves current behaviour for users who dismiss).
- [x] 4.2 In `packages/electron/src/main.ts`, at the end of the `attach` arm (after BrowserWindow is created) and before user can interact:
  - Skip if `app.commandLine.hasSwitch("no-zombie-prompt")`.
  - Compute `isZombie` via `decideIsZombie({ ...health, healthBootParentAlive: health.bootParentAlive, storedSpawnedPid: getStoredSpawnedPid(), platform: process.platform })`. Skip if false. (Runs on Windows too now — no `win32` early-out.)
  - In-memory `askedThisSession` flag (module-scoped) — skip if already true.
  - On `"adopt"` → call `setSpawnedPid(health.pid)`. Log `[zombie] adopted PID <n>`.
  - On `"leave"` → set `askedThisSession = true`. Log `[zombie] left running, will prompt next launch`.
  - On `"stop"` → `process.kill(health.pid, "SIGTERM")`. Poll with `isDashboardRunning` for up to 5 s. If still alive, send SIGKILL. Then re-enter `selectLaunchSource()` (i.e. spawn a fresh server via the normal launch path). **After the fresh server is ready, reload the BrowserWindow** (`mainWindow.webContents.reload()` / re-`loadURL`) — the window loaded the now-killed server's URL before the modal fired, so without a reload the user is left on a connection-refused page. Reload only after a positive health probe against the new server.
- [x] 4.3 Unit tests in `packages/electron/src/lib/__tests__/zombie-adoption.test.ts`:
  - Modal returns each of the three options based on stubbed button index.
  - The "stop" flow sends SIGTERM, then SIGKILL after timeout, with the dashboard-running poll mocked.
- [x] 4.4 Integration smoke test. AUTOMATED via Playwright-Electron: `tests/e2e-electron/zombie-adoption.electron.spec.ts` (fake zombie `/api/health`, native `dialog.showMessageBox` stubbed in main) asserts modal shown with PID, `--no-zombie-prompt` suppresses, and Take-ownership → app-quit POSTs `/api/shutdown`. Runs in `.github/workflows/ci-e2e-electron.yml` (xvfb). Native modal cannot be clicked by automation; the stub asserts the flow reaches it + each choice's outcome.

## 5. Doctor version-skew row (Thread 2)

- [x] 5.1 In `packages/shared/src/doctor-core.ts`, add `checkAttachedServerVersion(deps)` to the `runSharedChecks` set:
  - Inputs (via deps): `appVersion: string` (Electron app version), `healthFetcher: () => Promise<HealthResponse | null>`.
  - Returns a `DoctorCheck` with section `"setup"`.
  - Status `error` when `healthFetcher` returns null or throws.
  - Status `ok` when `appVersion === health.version`.
  - Status `warning` when versions differ — message includes both versions; suggestion derived from `health.launchSource`:
    - `"standalone"` → `Run \`npm i -g @blackbelt-technology/pi-dashboard@${appVersion}\` and restart your terminal session.`
    - `"bridge"` or `"bridge-orphaned"` → `Stop the pi session that started this server (or run \`pi-dashboard stop\`) and relaunch the app.`
    - `"electron"` → `Quit the other Electron instance or use the zombie-adoption prompt to take ownership.`
- [x] 5.2 Wire the new check into `packages/electron/src/lib/doctor.ts` (Electron arm) ONLY, with `app.getVersion()` (bundled shell version) and a fetch helper against the attached server's `/api/health`. Do NOT wire into the server arm (`doctor-routes.ts`): a server comparing its own pkg version to its own self-fetched `/api/health` is a loopback tautology — always `ok`, never detects skew, and reports false coverage. Skew is only meaningful across the Electron-shell ↔ attached-server boundary.
- [x] 5.3 Unit tests in `packages/shared/src/__tests__/doctor-core.test.ts`:
  - Matching versions → `ok`.
  - Mismatch + `standalone` → suggestion mentions npm.
  - Mismatch + `bridge` → suggestion mentions pi session.
  - Mismatch + `electron` → suggestion mentions other-Electron.
  - `healthFetcher` returns null → `error` with non-empty message.

## 6. Documentation

- [x] 6.1 Update `docs/electron-bootstrap-flow.md`: extend the `launchSource resolution` section with a `launchSourceEffective` table row noting the bridge-orphan promotion. Add a new section "Zombie adoption" describing the cross-platform modal flow, the POSIX (ppid+liveness) vs Windows (`bootParentAlive`, Job Object + Tier1/Tier2) detection branches, and the `--no-zombie-prompt` switch. (Delegate any `docs/` write to a subagent per repo Rule 6, caveman style.)
- [x] 6.2 Add per-file rows for the new files (`zombie-adoption-dialog.ts`, `launch-source-effective.ts`, `boot-parent-liveness.ts`) to their nearest directory `AGENTS.md` (per repo Documentation Update Protocol — `docs/file-index*.md` is retired). Note `boot-parent-liveness.ts`'s optional `koffi` Tier-2 dependency in its row.
- [x] 6.3 Update `docs/faq.md` with a new entry: "Electron shows 'Server managed externally' in the tray — what does that mean?"

## 7. Verification

- [x] 7.1 `npm test` green.
- [x] 7.2 Tray ownership row — AUTOMATED: `tests/e2e-electron/tray-ownership.electron.spec.ts` attaches the app to a foreign fake server, monkeypatches `Menu.buildFromTemplate` in main, and asserts the tray builds the disabled "Server managed externally" row and NEVER a "Restart server" item (native menu can't be clicked; template capture proves the live classification). Runs on both OS legs of `ci-e2e-electron.yml`. Manual macOS terminal-server walkthrough remains an optional cross-check.
- [x] 7.3 Zombie modal — AUTOMATED (supersedes manual): `tests/e2e-electron/zombie-adoption.electron.spec.ts` covers modal-shown-with-PID + adopt/leave/stop outcomes via the CI-run Playwright-Electron suite. Manual macOS `kill -9` walkthrough remains an optional cross-check.
- [x] 7.4 Windows checks (both AUTOMATED — see sub-bullets; koffi Tier-2 load also covered by `scripts/windows-liveness-smoke.ts`):
  - (a) **Job Object (first line):** AUTOMATED via `scripts/windows-job-object-smoke.ts` (CI job `job-object-windows` on windows-latest): launches the packaged app in spawn-mode, reads the spawned server pid from `/api/health`, fires `taskkill /F /PID <electron-pid>` (parent only, no `/T`), and asserts the server pid dies + `:8000` frees within 15s — confirming `KILL_ON_JOB_CLOSE` cascades on forced termination. Distinct INFRA vs FAIL signals separate a runner boot failure from an invariant break.
  - (b) **Detection (safety net):** AUTOMATED. The koffi Tier-2 load is smoke-tested on real Windows by `scripts/windows-liveness-smoke.ts` (`_smoke.yml`). The win32 `decideIsZombie` branch (bootParentAlive-only) runs in the REAL packaged app on the `windows-latest` leg of `ci-e2e-electron.yml` (`tests/e2e-electron/zombie-adoption.electron.spec.ts` — the app's `process.platform === "win32"` takes the win32 branch against the zombie-shaped fake `/api/health`, firing the modal). PID-reuse identity-safety is a koffi-runtime property covered by the Tier-2 load assertion; a true PID-recycle race stays manual.
- [x] 7.5 Version-skew Doctor row — AUTOMATED: `tests/e2e-electron/doctor-version-skew.electron.spec.ts` attaches the app to a fake `/api/health` with a mismatched version + `launchSource: standalone`, opens the Doctor window via the loading-page `#doctor-btn`, and asserts the WARN row + npm-upgrade suggestion. Runs in `ci-e2e-electron.yml`.
- [x] 7.6 `openspec change validate electron-attach-ownership-fixes` passes.
