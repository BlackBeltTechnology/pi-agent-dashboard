# Tasks

## 1. Health-endpoint foundation

- [ ] 1.1 Add `getActiveBridgeCount(): number` to `packages/server/src/pi-gateway.ts`. Exposes `connectedClients.size` (or equivalent for the existing bridge-tracking Set). Pure getter, no side effects.
- [ ] 1.2 In `packages/server/src/routes/system-routes.ts` `/api/health` handler, extend the response body to include:
  - `ppid: process.ppid` (cached once at module load — `process.ppid` is stable for a process lifetime).
  - `activeBridgeCount: piGateway.getActiveBridgeCount()` — evaluated per-request.
  - `launchSourceEffective: computeEffectiveLaunchSource({ raw: parseLaunchSource(process.env), activeBridgeCount, uptimeMs })`.
- [ ] 1.3 Add pure helper `computeEffectiveLaunchSource(params)` to `packages/server/src/launch-source-effective.ts`:
  - Returns `"bridge-orphaned"` when `raw === "bridge"` AND `activeBridgeCount === 0` AND `uptimeMs > 30_000`.
  - Otherwise returns `raw` cast to the wider union.
- [ ] 1.4 Unit tests in `packages/server/src/__tests__/launch-source-effective.test.ts`:
  - `bridge` + 0 bridges + uptime 31_000 → `bridge-orphaned`.
  - `bridge` + 0 bridges + uptime 29_000 → `bridge` (grace window).
  - `bridge` + 1 bridge + uptime 31_000 → `bridge`.
  - `electron` + 0 bridges + any uptime → `electron`.
  - `standalone` + 0 bridges + any uptime → `standalone`.
- [ ] 1.5 Update `packages/server/src/__tests__/health-shape.test.ts` to assert presence of `ppid`, `activeBridgeCount`, `launchSourceEffective` on every existing case. Add new case: server with `DASHBOARD_STARTER=Bridge` and zero connected bridges + faked uptime > 30 s → `launchSourceEffective === "bridge-orphaned"`.

## 2. Pure ownership classifier (Electron-side)

- [ ] 2.1 Add `decideOwnership({ healthLaunchSource, healthPid, storedSpawnedPid })` to `packages/electron/src/lib/server-lifecycle.ts`. Pure helper returning `"electron" | "foreign" | "none"`. Mirrors the rule:
  - `health.launchSource === "electron" AND health.pid === storedSpawnedPid` → `"electron"`
  - server reachable (i.e. caller supplied a non-null healthLaunchSource) → `"foreign"`
  - server unreachable (caller passes `null`) → `"none"`
- [ ] 2.2 Add `decideIsZombie({ healthLaunchSourceEffective, healthPid, healthPpid, storedSpawnedPid, platform })` to the same file. Returns boolean.
  - `false` when `platform === "win32"` (Job Object covers this).
  - `false` when `storedSpawnedPid !== null` (we own it).
  - `false` when `healthLaunchSourceEffective !== "electron"`.
  - `true` when `healthPpid === 1` (reparented to init/launchd on POSIX).
  - `false` otherwise.
- [ ] 2.3 Unit tests in `packages/electron/src/lib/__tests__/server-lifecycle.test.ts`:
  - `decideOwnership` — three classes plus a `null` health case.
  - `decideIsZombie` — POSIX ppid=1 with no stored pid → true; POSIX ppid=1 with stored pid set → false (we own it); Windows always false; standalone launchSource → false; bridge launchSource → false.

## 3. Tray ownership-awareness (Thread 3)

- [ ] 3.1 Widen `buildTrayMenuTemplate` in `packages/electron/src/lib/tray.ts`:
  - Replace `isRunning: boolean | null` with `ownership: "electron" | "foreign" | "none" | "unknown"`.
  - `"electron"` → first item "Restart server" (unchanged).
  - `"none"` → first item "Start server" (unchanged).
  - `"foreign"` → first item is a disabled `MenuItemConstructorOptions` with label `"Server managed externally"` and `enabled: false`, followed by separator and Show/Quit.
  - `"unknown"` → no launch item (current `null` behaviour preserved).
- [ ] 3.2 Update the `createTray` hook contract:
  - Replace `getServerStatus: () => Promise<boolean>` with `getServerOwnership: () => Promise<"electron" | "foreign" | "none" | "unknown">`.
  - The polling loop calls the new probe every 3 s; menu rebuilds only when the value changes (preserving existing `lastIsRunning` optimization, generalized to `lastOwnership`).
- [ ] 3.3 In `packages/electron/src/main.ts`, implement `getServerOwnership` adapter:
  - GET `/api/health` with 1 s timeout.
  - Returns `"unknown"` on fetch error or non-200.
  - Otherwise calls `decideOwnership({ healthLaunchSource: body.launchSourceEffective, healthPid: body.pid, storedSpawnedPid: getStoredSpawnedPid() })`. (Use `launchSourceEffective` not `launchSource` so bridge-orphaned classifies as foreign correctly.)
- [ ] 3.4 Add `getStoredSpawnedPid(): number | null` to `packages/electron/src/lib/server-lifecycle.ts` (read-only accessor for the existing module-private `storedSpawnedPid`).
- [ ] 3.5 Unit tests in `packages/electron/src/lib/__tests__/tray-menu.test.ts`:
  - Each ownership value renders the documented first item.
  - `"foreign"` item has `enabled: false` and the documented label.
  - `"unknown"` omits the launch item entirely.

## 4. Zombie detection + adoption modal (Thread 1)

- [ ] 4.1 Add new file `packages/electron/src/lib/zombie-adoption-dialog.ts`:
  - Exports `promptZombieAdoption({ pid }): Promise<"adopt" | "leave" | "stop">`.
  - Uses Electron `dialog.showMessageBox` with three buttons; maps button index to the union.
  - Default button: `"leave"` (safest — preserves current behaviour for users who dismiss).
- [ ] 4.2 In `packages/electron/src/main.ts`, at the end of the `attach` arm (after BrowserWindow is created) and before user can interact:
  - Skip if `app.commandLine.hasSwitch("no-zombie-prompt")`.
  - Compute `isZombie` via `decideIsZombie(...)`. Skip if false.
  - In-memory `askedThisSession` flag (module-scoped) — skip if already true.
  - On `"adopt"` → call `setSpawnedPid(health.pid)`. Log `[zombie] adopted PID <n>`.
  - On `"leave"` → set `askedThisSession = true`. Log `[zombie] left running, will prompt next launch`.
  - On `"stop"` → `process.kill(health.pid, "SIGTERM")`. Poll with `isDashboardRunning` for up to 5 s. If still alive, send SIGKILL. Then re-enter `selectLaunchSource()` (i.e. spawn a fresh server via the normal launch path).
- [ ] 4.3 Unit tests in `packages/electron/src/lib/__tests__/zombie-adoption.test.ts`:
  - Modal returns each of the three options based on stubbed button index.
  - The "stop" flow sends SIGTERM, then SIGKILL after timeout, with the dashboard-running poll mocked.
- [ ] 4.4 Integration smoke test (manual, documented in `qa/tests/`): launch Electron, SIGKILL the Electron process, relaunch, verify modal appears. Adopt → quit Electron → verify server stops. Leave → verify modal reappears on next launch.

## 5. Doctor version-skew row (Thread 2)

- [ ] 5.1 In `packages/shared/src/doctor-core.ts`, add `checkAttachedServerVersion(deps)` to the `runSharedChecks` set:
  - Inputs (via deps): `appVersion: string` (Electron app version), `healthFetcher: () => Promise<HealthResponse | null>`.
  - Returns a `DoctorCheck` with section `"setup"`.
  - Status `error` when `healthFetcher` returns null or throws.
  - Status `ok` when `appVersion === health.version`.
  - Status `warning` when versions differ — message includes both versions; suggestion derived from `health.launchSource`:
    - `"standalone"` → `Run \`npm i -g @blackbelt-technology/pi-dashboard@${appVersion}\` and restart your terminal session.`
    - `"bridge"` or `"bridge-orphaned"` → `Stop the pi session that started this server (or run \`pi-dashboard stop\`) and relaunch the app.`
    - `"electron"` → `Quit the other Electron instance or use the zombie-adoption prompt to take ownership.`
- [ ] 5.2 Wire the new check into `packages/electron/src/lib/doctor.ts` (Electron arm) with `app.getVersion()` and a fetch helper. Wire into `packages/server/src/routes/doctor-routes.ts` (server arm) with `pkgJson.version` from the server side and a self-fetch helper.
- [ ] 5.3 Unit tests in `packages/shared/src/__tests__/doctor-core.test.ts`:
  - Matching versions → `ok`.
  - Mismatch + `standalone` → suggestion mentions npm.
  - Mismatch + `bridge` → suggestion mentions pi session.
  - Mismatch + `electron` → suggestion mentions other-Electron.
  - `healthFetcher` returns null → `error` with non-empty message.

## 6. Documentation

- [ ] 6.1 Update `docs/electron-bootstrap-flow.md`: extend the `launchSource resolution` section with a `launchSourceEffective` table row noting the bridge-orphan promotion. Add a new section "Zombie adoption" describing the modal flow and the `--no-zombie-prompt` switch.
- [ ] 6.2 Update `docs/file-index-electron.md` with rows for the two new files (`zombie-adoption-dialog.ts`, `launch-source-effective.ts`).
- [ ] 6.3 Update `docs/faq.md` with a new entry: "Electron shows 'Server managed externally' in the tray — what does that mean?"

## 7. Verification

- [ ] 7.1 `npm test` green.
- [ ] 7.2 Manual run on macOS: start `pi-dashboard start` in a terminal; launch Electron; verify tray shows the disabled "Server managed externally" row, no "Restart server" option. Quit Electron; verify terminal server still alive.
- [ ] 7.3 Manual run on macOS: launch Electron; `kill -9` the Electron PID; relaunch Electron; verify zombie modal appears with the prior server's PID; each of the three options behaves per the spec.
- [ ] 7.4 Manual run: rebuild Electron with a stale bundled server version (e.g. flip `version` in `packages/server/package.json` to `0.0.1` before bundling); attach to a current-version running server; open Doctor; verify the version-skew row appears with the expected suggestion text for each `launchSource`.
- [ ] 7.5 `openspec change validate electron-attach-ownership-fixes` passes.
