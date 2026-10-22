## MODIFIED Requirements

### Requirement: Idempotent server launch routine
The Electron main process SHALL expose an exported `requestServerLaunch()` routine in `packages/electron/src/lib/server-lifecycle.ts` that is the single entry point used by the loading page button, tray menu items, and any future in-app launch controls. The routine SHALL be idempotent under concurrent invocation.

#### Scenario: Returns already-running when server responds
- **WHEN** `requestServerLaunch()` is called with `force: false` (or omitted)
- **AND** `isDashboardRunning(port)` returns `true`
- **THEN** it SHALL return `{ kind: "already-running", url }` without spawning a new process

#### Scenario: Spawns server when none running
- **WHEN** `requestServerLaunch()` is called and no server is running
- **THEN** it SHALL invoke the existing server-spawn path (same code as startup `ensureServer()`)
- **AND** on success return `{ kind: "started", url }`
- **AND** on failure return `{ kind: "failed", reason, logTail }` — never throw

#### Scenario: Force restart when server already running
- **WHEN** `requestServerLaunch({ force: true })` is called and a server is running
- **THEN** it SHALL POST `/api/shutdown` to stop the running server
- **AND** wait (up to 5 seconds) for `isDashboardRunning(port)` to return `false`
- **AND** then invoke the standard spawn path and return `{ kind: "started", url }`
- **AND** if the shutdown POST fails, still wait as above

#### Scenario: Force restart never reports a surviving server as started
- **WHEN** `requestServerLaunch({ force: true })` is called and a server still answers on the port after the wait
- **THEN** it SHALL NOT spawn and SHALL NOT return `started`
- **AND** SHALL return `{ kind: "failed", reason, logTail }` naming the surviving server

#### Scenario: Force restart waits for the old process, not just the port
- **WHEN** `requestServerLaunch({ force: true })` is called and a server is running
- **THEN** it SHALL read that server's PID from `/api/health` before POSTing `/api/shutdown`
- **AND** SHALL spawn only after a liveness probe reports that PID no longer exists ("permission denied" counts as alive)
- **AND** when the PID survives the graceful wait, and the probe has reported it alive continuously since it was read, it SHALL escalate SIGTERM → SIGKILL on that PID
- **AND** when the PID still exists after escalation it SHALL return `failed` without spawning

#### Scenario: Concurrent calls share one launch attempt
- **WHEN** two callers invoke `requestServerLaunch()` while a launch is already in flight
- **THEN** both callers SHALL receive the same `LaunchOutcome` from a single underlying spawn
- **AND** at most one server process SHALL be spawned

#### Scenario: Failure outcome is a value, not an exception
- **WHEN** the spawn step throws synchronously or the spawned process exits non-zero before becoming healthy
- **THEN** `requestServerLaunch()` SHALL catch the error and return `{ kind: "failed", reason: <string>, logTail: <string> }`
- **AND** SHALL NOT propagate the exception to the caller

### Requirement: Zombie server adoption modal (cross-platform)

When the Electron app launches and takes the `attach` arm of the bootstrap state machine, the main process SHALL evaluate whether the discovered server is a zombie left over from a prior Electron lifetime. Detection is platform-branched but shares the server-computed `health.bootParentAlive` signal. Common gates (all platforms):

- `health.launchSourceEffective === "electron"`
- This Electron lifetime's `storedSpawnedPid === null` (we did not spawn it)

Platform-specific final gate:

- **macOS / Linux:** `health.ppid !== health.bootParentPid` AND `health.bootParentAlive === false` — the server was reparented away from its boot parent AND that parent is gone. It SHALL NOT test `ppid === 1` (unreliable under Linux subreapers and containers).
- **Windows** (`process.platform === "win32"`): `health.bootParentAlive === false` — Windows never reparents an orphan, so liveness of the boot parent is the sole signal. The Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) remains the first-line guarantee that kills the server on the common crash path; detection is the safety net for bypass cases (`CREATE_BREAKAWAY_FROM_JOB`, nested-job assignment failure, self-respawn). `bootParentAlive` is identity-safe when Tier 2 (`koffi` handle-wait) is available and PID-reuse-vulnerable but functional under Tier 1 fallback.

When a zombie is detected and its version matches the expected runtime version (or either version is unknown — see "Attach-time server version skew check"), the app SHALL present a modal dialog with three buttons (default: "Leave running"):

- **Take ownership** → call `setSpawnedPid(health.pid)`. Subsequent app quit SHALL stop the server per `decideShutdownOnQuit`.
- **Leave running** → set an in-memory `askedThisSession` flag. No further prompts this session. Next Electron launch SHALL re-evaluate.
- **Stop now** → send SIGTERM to `health.pid`. Poll for up to 5 seconds. If still alive, send SIGKILL. Respawn via `selectLaunchSource()` only after a liveness probe confirms the PID no longer exists; otherwise tell the user the server could not be stopped and do not spawn.

When a zombie is detected AND it is version-skewed, the app SHALL instead present ONE merged modal naming both versions, with three buttons (default: "Restart with v<expected>"):

- **Restart with v<expected>** → restart through the same path as "Skewed Electron-launched server is offered a restart" (graceful shutdown first, verified escalation, version verification).
- **Take ownership** → as above; the skewed server keeps running and this Electron lifetime owns it.
- **Leave running** → as above; also suppresses the skew prompt for this Electron lifetime.

The app SHALL NOT show the zombie modal and a separate skew modal for the same server.

The modal SHALL be suppressed when Electron is invoked with the command-line switch `--no-zombie-prompt` (used by QA/test runs). The switch suppresses the merged modal as well.

#### Scenario: Zombie detected with reparenting (POSIX)

- **GIVEN** Electron is running on macOS or Linux
- **WHEN** the app launches AND `/api/health` returns `launchSourceEffective: "electron"`, a live `ppid` that differs from `bootParentPid`, `bootParentAlive: false`, and `storedSpawnedPid` is null
- **THEN** the main process SHALL display the adoption modal

#### Scenario: Zombie detected via parent liveness (Windows)

- **GIVEN** Electron is running on Windows AND a prior server survived a Job Object bypass
- **WHEN** the app launches AND `/api/health` returns `launchSourceEffective: "electron"`, `bootParentAlive: false`, and `storedSpawnedPid` is null
- **THEN** the main process SHALL display the adoption modal (regardless of the `ppid` value, since Windows does not reparent)

#### Scenario: Take-ownership transfers shutdown responsibility

- **GIVEN** the adoption modal is displayed
- **WHEN** the user clicks "Take ownership"
- **AND** later quits the app
- **THEN** the app SHALL send a graceful shutdown signal to the previously-zombie server's PID

#### Scenario: Leave-running suppresses re-prompt this session

- **GIVEN** the adoption modal is displayed AND the user clicks "Leave running"
- **WHEN** any other tray or BrowserWindow event would normally trigger re-evaluation
- **THEN** the modal SHALL NOT be re-shown for the remainder of this Electron process lifetime

#### Scenario: Stop-now removes zombie and respawns

- **GIVEN** the adoption modal is displayed AND the user clicks "Stop now"
- **WHEN** the SIGTERM-then-SIGKILL sequence completes
- **THEN** the app SHALL re-enter `selectLaunchSource()` to spawn a new server using the standard launch path, only once the zombie PID is confirmed gone

#### Scenario: Modal suppressed under test switch

- **WHEN** Electron is launched with `--no-zombie-prompt`
- **THEN** zombie detection SHALL still run for logging purposes
- **AND** the modal SHALL NOT be displayed regardless of the result

#### Scenario: Zombie that is also skewed shows one merged modal

- **GIVEN** a zombie is detected AND `/api/health.version` is `0.9.0` AND the expected runtime version is `0.10.0`
- **WHEN** the attach arm evaluates the server
- **THEN** exactly one modal SHALL be displayed, offering "Restart with v0.10.0" (default), "Take ownership" and "Leave running"
- **AND** the modal text SHALL name both `0.9.0` and `0.10.0`

#### Scenario: Merged-modal restart spawns the expected runtime

- **GIVEN** the merged modal is displayed
- **WHEN** the user clicks "Restart with v0.10.0"
- **THEN** the app SHALL request a graceful shutdown of the zombie and spawn a new server through the standard in-app launch routine
- **AND** the window SHALL load the new server once it is healthy

#### Scenario: Zombie with matching version keeps the three-button modal

- **GIVEN** a zombie is detected AND `/api/health.version` equals the expected runtime version
- **WHEN** the attach arm evaluates the server
- **THEN** the original modal (Take ownership / Leave running / Stop now) SHALL be displayed

## ADDED Requirements

### Requirement: Attach-time server version skew check

On the local `attach` arm of a packaged app, the main process SHALL compare `/api/health.version` with the expected runtime version (`electron-launch-source`). The server is version-skewed when both are known and differ after normalisation (trimmed, leading `v` removed). The check SHALL NOT prompt when unpackaged or when either version is unknown (a resolution error, or a server version that is empty or the literal `unknown`), SHALL log its decision, and SHALL NOT delay opening the window.

#### Scenario: Cosmetic version differences are not skew

- **WHEN** the server reports `v0.10.0` and the expected version is `0.10.0`
- **THEN** no skew modal SHALL be displayed

#### Scenario: Matching versions attach silently

- **GIVEN** a packaged app whose expected runtime version is `0.10.0`
- **WHEN** it attaches to a server reporting `version: "0.10.0"`
- **THEN** no skew modal SHALL be displayed

#### Scenario: Development and local-link runtimes are not checked

- **WHEN** the app is unpackaged, OR the expected source is `devMonorepo` or `localLink`
- **THEN** the skew check SHALL NOT display any modal

#### Scenario: Expected-version failure is silent

- **WHEN** resolving the expected runtime throws (e.g. no bundled server, pinned source unavailable)
- **THEN** the expected version SHALL be treated as unknown
- **AND** no skew modal SHALL be displayed and the window SHALL still open

### Requirement: Skewed Electron-launched server is offered a restart

When a non-zombie attached server launched by Electron is version-skewed, the app SHALL show a modal naming both versions with **Restart with v<expected>** and **Leave running**. Restart SHALL be the default only when `/api/health.bootParentAlive` is `false`; otherwise Leave running SHALL be the default. Leave running SHALL suppress the prompt for this Electron lifetime.

#### Scenario: Older Electron-launched server is offered a restart

- **GIVEN** the expected runtime version is `0.10.0`
- **WHEN** the app attaches to a non-zombie server reporting `version: "0.9.0"`, `launchSourceEffective: "electron"` and `bootParentAlive: false`
- **THEN** a modal SHALL offer "Restart with v0.10.0" (default) and "Leave running"

#### Scenario: Live or unknown owner makes Leave running the default

- **WHEN** the skewed Electron-launched server reports `bootParentAlive: true`, or omits `bootParentAlive`
- **THEN** the modal SHALL be displayed with "Leave running" as the default

#### Scenario: Leave running suppresses for this lifetime only

- **GIVEN** the user chose "Leave running"
- **WHEN** any later event in the same Electron lifetime re-evaluates the attached server
- **THEN** the skew modal SHALL NOT be shown again
- **AND** the next Electron launch SHALL evaluate the server again

### Requirement: Version-skew restart is graceful, verified and fail-closed

Before restarting, the app SHALL re-validate the server's PID, boot parent, launch source and version, aborting with a notice if any changed. It SHALL restart via the in-app launch routine with force. After a spawn it SHALL confirm the new server is the one it spawned and report the actual version if it differs from the promised one. Failures SHALL be shown, never a silent attach.

#### Scenario: Graceful restart replaces the skewed server

- **GIVEN** the restart modal is displayed for a `0.9.0` server with PID 4242
- **WHEN** the user clicks "Restart with v0.10.0" and the server honours `/api/shutdown`
- **THEN** PID 4242 SHALL exit without being signalled
- **AND** a new server SHALL be spawned whose `/api/health.version` is `0.10.0`

#### Scenario: Unresponsive old server is escalated

- **GIVEN** the graceful shutdown did not stop PID 4242, whether or not its port has closed
- **WHEN** the liveness probe has reported PID 4242 alive continuously since the pre-restart re-validation
- **THEN** the app SHALL send SIGTERM, then SIGKILL, to PID 4242
- **AND** SHALL spawn only after PID 4242 is confirmed gone

#### Scenario: Server already at the expected version is not restarted

- **WHEN** the user clicks Restart AND `/api/health.version` now equals the expected version
- **THEN** the app SHALL NOT restart the server
- **AND** SHALL tell the user it is already up to date

#### Scenario: Changed identity aborts the restart

- **WHEN** `/api/health` reports a different PID or boot parent than when the modal was raised, before or during the restart
- **THEN** the app SHALL NOT signal any process
- **AND** SHALL tell the user the restart did not complete

#### Scenario: Unkillable server fails closed

- **WHEN** PID 4242 is still alive after SIGKILL and the bounded wait
- **THEN** the app SHALL NOT spawn a server
- **AND** SHALL show a notice that the old server could not be stopped

#### Scenario: A foreign server on the port is not adopted

- **WHEN** after the spawn step `/api/health` reports a PID other than the spawned one, or a launch source other than `electron`
- **THEN** the app SHALL NOT report the restart as successful
- **AND** SHALL show the recovery page

#### Scenario: Runtime fallback is reported honestly

- **GIVEN** the user restarted to v0.10.1 (an overlay)
- **WHEN** the overlay fails at spawn and the cold launch falls back to the `0.10.0` bundle
- **THEN** the app SHALL show a notice that v0.10.0 is running instead of v0.10.1

### Requirement: Skewed externally launched server gets a dismissible notice

When a skewed attached server's launch source is not `electron` (including missing), the app SHALL show an informational modal naming both versions with the Doctor's fix text and buttons **OK** (default) and **Don't show again for this version pair**, and SHALL NOT stop the server. A dismissal SHALL be persisted per (server version, expected version, launch source) in a dedicated file under `~/.pi-dashboard/` and suppress only this modal for that key.

#### Scenario: Standalone server gets an informational notice

- **GIVEN** the expected runtime version is `0.10.0`
- **WHEN** the app attaches to a server reporting `version: "0.9.0"` and `launchSourceEffective: "standalone"`
- **THEN** an informational modal SHALL name both versions and show the Doctor's standalone fix text
- **AND** the app SHALL NOT stop or restart that server

#### Scenario: OK suppresses for this lifetime only

- **GIVEN** the user clicked "OK" on the informational modal
- **WHEN** the same Electron lifetime re-evaluates the server
- **THEN** the modal SHALL NOT be shown again
- **AND** the next launch SHALL show it again

#### Scenario: Fix text names the version it installs

- **WHEN** the expected runtime version differs from the app's own version
- **THEN** the informational modal SHALL state which version its fix text installs

#### Scenario: Unknown launch source is never restarted

- **WHEN** a skewed attached server reports no `launchSourceEffective`
- **THEN** the informational modal SHALL be shown
- **AND** no restart SHALL be offered

#### Scenario: Dismissed version pair stays quiet

- **GIVEN** the user chose "Don't show again for this version pair" for a `standalone` server `0.9.0` / expected `0.10.0`
- **WHEN** a later launch attaches to a `standalone` server reporting `0.9.0` with expected `0.10.0`
- **THEN** no skew modal SHALL be displayed
- **AND** when the expected version later becomes `0.10.1`, or the same pair is reported by a `bridge` server, the modal SHALL be displayed again

#### Scenario: Dismissal does not affect first-run detection

- **GIVEN** no dashboard settings file exists
- **WHEN** the user dismisses a version pair
- **THEN** the dashboard settings file SHALL still not exist and first-run detection SHALL be unchanged

### Requirement: Skew modals honour the test switch

Under `--no-zombie-prompt` the version-skew check SHALL still run and log its result, but no skew or merged modal SHALL be displayed.

#### Scenario: Test switch suppresses the modal

- **WHEN** Electron is launched with `--no-zombie-prompt` and attaches to a skewed server
- **THEN** the skew result SHALL be logged
- **AND** no skew modal SHALL be displayed
