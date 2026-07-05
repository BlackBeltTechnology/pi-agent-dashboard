# Harden Electron attach-mode ownership: tray, zombies, version skew, orphan labels

## Why

When the Electron app launches and discovers a dashboard server already running on `:8000`, it takes the `attach` arm of the bootstrap state machine. `decideShutdownOnQuit` correctly refuses to stop a server Electron didn't spawn — that invariant is tested and solid. But four adjacent surfaces don't honour the same ownership rule, and one of them is a real bug:

1. **Tray menu (real bug).** In attach mode the tray probes `getServerStatus()` and finds `isRunning === true`, so `buildTrayMenuTemplate` renders **"Restart server"**. Clicking it invokes `spawnFromSource` against a port already bound by the foreign server. Best case: spawn fails fast and the user sees `loading-page-error`. Worst case: the spawn path's port-conflict handling kills the foreign server (a bridge-started server or the user's `pi-dashboard start` terminal). The ownership invariant exists for `quit` but not for `restart`.

2. **Zombie servers on POSIX.** `spawnDetached` is called with `detach: false`, which the comment in `server-lifecycle.ts` documents as a Windows Job-Object win. On macOS/Linux `detach: false` doesn't help against an Electron crash — the detached server is reparented to init/launchd and survives. The next Electron launch sees `launchSource: "electron"` but its `storedSpawnedPid` is `null`, so `decideShutdownOnQuit` returns `false` and the zombie persists indefinitely. Users have no in-app way to clean up.

3. **Bundled-shell vs running-server version skew.** A user installs Electron v0.5.3 (new `.dmg`), then opens it while an npm-installed `pi-dashboard` v0.5.1 is running in their terminal. The BrowserWindow loads `http://localhost:8000` and gets the v0.5.1 client served by the v0.5.1 server — UI matches server, no rendering glitch. But the user expects new features that ship with v0.5.3 and doesn't get them. Today nothing surfaces the mismatch.

4. **Stale `launchSource: "bridge"` after pi session quits.** `DASHBOARD_STARTER` is read from process env once and never updated. A server spawned by `packages/extension/src/server-launcher.ts` reports `launchSource: "bridge"` forever, even after the pi session that started it has exited and no bridge is connected. Consumers that read this label to make decisions (the tray fix in #1, future Doctor advisories, "find my pi session" UX) get a wrong answer.

These four are independent in code but share one root: **`launchSource` is a static label set at spawn time, and ownership decisions made outside `decideShutdownOnQuit` don't consult it.** Fixing them together lets us add the two health fields (`ppid`, `activeBridgeCount`) once and consume them in every surface that needs them.

## What Changes

### `/api/health` additions (foundation)

- Add `bootParentPid: number` — the server process's parent PID captured ONCE at boot (module-load const). The Electron PID it was spawned under.
- Add `ppid: number` — the server's **live** parent PID, read fresh per request (Linux `/proc/self/stat` field 4; macOS `ps -o ppid=`; Windows `process.ppid`). Used with `bootParentPid` to detect POSIX zombies: `ppid !== bootParentPid` AND `bootParentPid` no longer alive. NOT `process.ppid` on POSIX (Node caches it) and NOT `=== 1` (Linux subreapers/containers reparent to a non-1 PID).
- Add `bootParentAlive: boolean` — whether the recorded boot parent (`bootParentPid`) is still the live process it was at boot. Powers Windows zombie detection (Windows never reparents, so the ppid signal is unavailable — liveness of the original parent is the only signal). Two-tier server-side computation:
  - **Tier 1 (baseline, all platforms, zero-dep):** `isProcessAlive(bootParentPid)` — the existing `packages/shared/src/platform/process.ts` helper (`process.kill(pid, 0)`). PID-reuse-vulnerable: a recycled parent PID can read as "alive" and hide a zombie (safe direction — only ever under-detects, never mis-targets).
  - **Tier 2 (Windows identity-safe upgrade, via `koffi` FFI):** at boot, `OpenProcess(SYNCHRONIZE, false, bootParentPid)` retains a handle to the *specific* parent process object; per request `WaitForSingleObject(handle, 0) === WAIT_OBJECT_0` means that exact process exited → `bootParentAlive = false`. Immune to PID reuse (the kernel keeps the object alive while the handle is held). Falls back to Tier 1 if `koffi` fails to load or `OpenProcess` is denied.
- Add `activeBridgeCount: number` — count of pi WebSocket connections held by the pi-gateway on `:9999`, via the existing `pi-gateway.connectionCount()` getter (no new gateway surface). Re-evaluated per health request.
- Add `launchSourceEffective: "electron" | "standalone" | "bridge" | "bridge-orphaned"` — derived field. Equals `launchSource` except when `launchSource === "bridge"` AND `activeBridgeCount === 0` AND `uptimeMs > 30_000`, in which case it returns `"bridge-orphaned"`. The 30 s grace window absorbs the bootstrap race (server up before bridge reconnects after `server_restarting`).
- `launchSource` retains its current value (closed union over `electron | standalone | bridge`) for back-compat.

### Tray ownership-awareness (Thread 3 — the real bug)

- `buildTrayMenuTemplate` widens its `isRunning: boolean | null` parameter to `ownership: "electron" | "foreign" | "none" | "unknown"`.
  - `"electron"` → "Restart server" item shown (current behaviour preserved).
  - `"foreign"` → no Start/Restart item. Render a disabled informational row: `"Server managed externally"`.
  - `"none"` → "Start server" item shown.
  - `"unknown"` → omit launch item (current behaviour for `isRunning === null`).
- The polling probe in `createTray` swaps `getServerStatus()` for `getServerOwnership()` which calls `/api/health` and classifies:
  - `health.launchSource === "electron" AND health.pid === storedSpawnedPid` → `"electron"`
  - server reachable but ownership doesn't match → `"foreign"` (covers Bridge, Standalone, bridge-orphaned, and other-Electron-leftover)
  - server unreachable → `"none"`
  - probe error → `"unknown"`
- Existing single-boolean `getServerStatus` hook callers remain supported via an adapter in `main.ts`.

### Zombie detection + adoption prompt (Thread 1)

- On every Electron startup that takes the `attach` arm, the bootstrap state machine evaluates:

  ```
  isZombie =
    health.launchSourceEffective === "electron"
    AND storedSpawnedPid === null                    // we didn't spawn it this lifetime
    AND health.bootParentAlive === false             // original Electron parent is gone (Tier 1/2)
    AND (POSIX only, extra guard: health.ppid !== health.bootParentPid)  // reparented away
    // Windows: bootParentAlive is the sole signal (no reparenting); Job Object still
    //   kills the child on the common crash path — detection covers the bypass cases.
    // NOT `ppid === 1`: Linux subreapers / containers reparent to a non-1 PID
  ```

- When `isZombie === true`, a modal dialog asks the user:

  > **Leftover server from a previous run**
  >
  > A dashboard server (PID `<n>`) appears to have outlived a previous Electron session. Take ownership so quitting this app cleans it up?
  >
  > [ Take ownership ] [ Leave running ] [ Stop now ]

  - **Take ownership** → call `setSpawnedPid(health.pid)`. Subsequent quit triggers `decideShutdownOnQuit` true.
  - **Leave running** → no state change. Modal won't re-prompt this launch (in-memory "asked this session" flag). Will re-prompt next launch if still a zombie.
  - **Stop now** → send SIGTERM to `health.pid`, wait up to 5 s (SIGKILL if still alive), then re-enter the normal launch path to spawn a fresh server. Once the new server passes a health probe, **reload the BrowserWindow** — it was already pointing at the killed server's URL, so without a reload the user lands on a connection-refused page.

- The modal is suppressed when `app.commandLine.hasSwitch("no-zombie-prompt")` (for QA/test runs).

### Doctor version-skew row (Thread 2)

- New row in the `setup` section of Doctor: **"Attached server version"**.
  - **OK** when `app.getVersion() === health.version`.
  - **Warning** when `app.getVersion() !== health.version`, with detail showing both versions and a suggestion that depends on `launchSource`:
    - `standalone` → `Run \`npm i -g @blackbelt-technology/pi-dashboard@${app.getVersion()}\` and restart your terminal session.`
    - `bridge` or `bridge-orphaned` → `Stop the pi session that started this server, or run \`pi-dashboard stop\` from a terminal, to let this Electron app start its own bundled server.`
    - `electron` (other-Electron-leftover or zombie) → `Quit the other Electron app or use the zombie-adoption prompt to take ownership.`
  - **Error** when `health` is unreachable or `health.version` is missing.
- No title-bar pill, no startup modal — Doctor only. If user feedback shows this is missed, escalate to a one-time toast in a follow-up proposal.

### Bridge-orphan label propagation (Thread 4 — consumed by 1 and 2)

- The dynamic `launchSourceEffective` field (defined in the health additions) is what the tray probe and Doctor row read. `launchSource` stays static for back-compat with the `decideShutdownOnQuit` rule (since Electron only owns servers it spawned this lifetime, and bridge-orphan is by definition not Electron-owned, no shutdown decision changes).

## Capabilities

### Modified Capabilities

- `dashboard-starter-identity` — adds the three new health fields and the `launchSourceEffective` derivation rule.
- `electron-shell` — adds ownership-aware tray contract and zombie-adoption modal flow.
- `doctor-diagnostic` — adds the version-skew row.

## Impact

- **Scope**: ~5 files changed.
  - `packages/server/src/routes/system-routes.ts` — extend `/api/health` payload + add `launchSourceEffective` helper.
  - `packages/server/src/pi-gateway.ts` — reuse existing `connectionCount()` getter (no change needed).
  - `packages/electron/src/lib/tray.ts` — widen `buildTrayMenuTemplate` contract, swap probe, add disabled-row rendering.
  - `packages/electron/src/main.ts` — wire `getServerOwnership` adapter; zombie detection + modal at end of attach arm.
  - `packages/shared/src/doctor-core.ts` — add `checkAttachedServerVersion` to `runSharedChecks`; wired into the Electron arm only (server-arm self-fetch is a tautology).
  - `packages/electron/src/lib/server-lifecycle.ts` — small helper `decideIsZombie(...)` (pure, testable; platform-branched — Windows uses `bootParentAlive` only).
  - New file: `packages/electron/src/lib/zombie-adoption-dialog.ts` — modal renderer + IPC.
  - New file: `packages/server/src/boot-parent-liveness.ts` — computes `bootParentAlive`. Tier 1 (`isProcessAlive`) on every platform; Tier 2 loads `koffi` on `win32` to hold a `SYNCHRONIZE` handle + `WaitForSingleObject`, with graceful fallback to Tier 1 when `koffi`/`OpenProcess` is unavailable.
  - `packages/server/package.json` — add `koffi` under **`optionalDependencies`** (Tier 2 only; failed native install never breaks `npm install`; absence degrades to Tier 1). Loaded jiti-safely via `createRequire(import.meta.url)("koffi")` (the bundled server runs TS under jiti — same native-load path `node-pty` already uses successfully).
  - `packages/electron/scripts/bundle-server.mjs` (or `assert-runnable-bundle.mjs`) — GO/NO-GO assert for the koffi `win32` prebuild in `resources/server/node_modules/koffi/`, mirroring the existing `node-pty` prebuild check. No `forge.config.ts` change: koffi rides along in the outside-asar server tree; no `asarUnpack`, no `electron-rebuild` (server runs under bundled standalone Node, not Electron's process).
  - Estimated ~450 LOC + tests.

- **User-visible**:
  - Tray: power users who run `pi-dashboard` from a terminal alongside the Electron app no longer see a misleading "Restart server" item that could nuke their terminal session.
  - Zombie modal: appears after an Electron crash where the prior server survived — POSIX (reparented orphan) and Windows (Job Object bypassed). Most users see it zero times.
  - Doctor row: only appears in Doctor. Passive.

- **Performance**: `/api/health` adds cheap reads — live ppid (one POSIX syscall / cached on Windows), `bootParentAlive` (a `process.kill(pid,0)` in Tier 1, or a non-blocking `WaitForSingleObject(h,0)` in Tier 2), and bridge count (in-memory `Set.size`). No measurable cost.

- **Privacy**: PIDs are local-only and already exposed via `health.pid`. No new PII.

- **Back-compat risk**:
  - `buildTrayMenuTemplate` signature change — pure helper, tests update with it. No external consumers.
  - `/api/health` strictly additive. Existing fields untouched.
  - `decideShutdownOnQuit` rule unchanged. Zombie adoption opt-in only via user click.

- **Out of scope**:
  - Auto-killing zombies on launch without prompting (deliberate: respect user intent).
  - Title-bar pill or toast for version skew (revisit if Doctor-only proves insufficient).
  - Tier 2 on POSIX (macOS/Linux already get identity-safe detection via `ppid !== bootParentPid`; the koffi handle-wait is a Windows-only upgrade).
  - Refactoring `launchSource` to a fully dynamic field — would break `decideShutdownOnQuit`'s "starter === Electron" check during the same Electron lifetime.
  - Bridge reconnection / handoff after pi session quits.

- **Sequencing**: foundation health fields land first (independent), then tray + Doctor + zombie modal land in parallel (each consumes the fields independently). No external dependencies on other open proposals.

- **Risk**: low-medium. The tray fix touches a small pure helper; the zombie modal is opt-in user action. Highest test surface is the `launchSourceEffective` derivation (race with bridge reconnect after restart) — covered by a unit test for the 30 s grace window.
