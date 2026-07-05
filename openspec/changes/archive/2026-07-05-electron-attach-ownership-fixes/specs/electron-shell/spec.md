# electron-shell — delta

## ADDED Requirements

### Requirement: Tray menu reflects server ownership

The Electron tray menu's primary action SHALL be derived from a three-way ownership classification — `"electron" | "foreign" | "none" | "unknown"` — rather than a binary `isRunning` flag. The classifier SHALL consult both `/api/health.launchSourceEffective` and the Electron-process-local `storedSpawnedPid`.

- `"electron"` (server reachable AND `launchSourceEffective === "electron"` AND `pid === storedSpawnedPid`) → menu first item SHALL be **Restart server**, enabled, click invokes `onLaunch(true)`.
- `"none"` (server unreachable) → menu first item SHALL be **Start server**, enabled, click invokes `onLaunch(false)`.
- `"foreign"` (server reachable AND ownership does not match) → menu first item SHALL be a disabled informational row labelled **Server managed externally** with no click handler.
- `"unknown"` (probe error) → no launch item rendered (current `null` behaviour preserved).

The tray polling probe SHALL re-evaluate ownership every 3 seconds and rebuild the menu only when the value changes from the prior poll.

#### Scenario: Foreign server suppresses Restart action

- **GIVEN** the user is running `pi-dashboard start` from a terminal
- **WHEN** the Electron app launches AND opens the tray menu
- **THEN** the menu SHALL NOT contain a "Restart server" item
- **AND** SHALL contain a disabled "Server managed externally" row

#### Scenario: Electron-owned server shows Restart

- **GIVEN** Electron spawned the dashboard server on launch
- **WHEN** the user opens the tray menu
- **THEN** the menu SHALL contain an enabled "Restart server" item

#### Scenario: No server shows Start

- **GIVEN** no dashboard server is running on the configured port
- **WHEN** the user opens the tray menu
- **THEN** the menu SHALL contain an enabled "Start server" item

#### Scenario: Probe error omits launch item

- **WHEN** the ownership probe fails (network error or non-200 response)
- **THEN** the menu SHALL NOT contain any Start/Restart/managed-externally item
- **AND** the Show/Quit items SHALL still be present

### Requirement: Zombie server adoption modal (cross-platform)

When the Electron app launches and takes the `attach` arm of the bootstrap state machine, the main process SHALL evaluate whether the discovered server is a zombie left over from a prior Electron lifetime. Detection is platform-branched but shares the server-computed `health.bootParentAlive` signal. Common gates (all platforms):

- `health.launchSourceEffective === "electron"`
- This Electron lifetime's `storedSpawnedPid === null` (we did not spawn it)

Platform-specific final gate:

- **macOS / Linux:** `health.ppid !== health.bootParentPid` AND `health.bootParentAlive === false` — the server was reparented away from its boot parent AND that parent is gone. It SHALL NOT test `ppid === 1` (unreliable under Linux subreapers and containers).
- **Windows** (`process.platform === "win32"`): `health.bootParentAlive === false` — Windows never reparents an orphan, so liveness of the boot parent is the sole signal. The Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) remains the first-line guarantee that kills the server on the common crash path; detection is the safety net for bypass cases (`CREATE_BREAKAWAY_FROM_JOB`, nested-job assignment failure, self-respawn). `bootParentAlive` is identity-safe when Tier 2 (`koffi` handle-wait) is available and PID-reuse-vulnerable but functional under Tier 1 fallback.

When a zombie is detected the app SHALL present a modal dialog with three buttons (default: "Leave running"):

- **Take ownership** → call `setSpawnedPid(health.pid)`. Subsequent app quit SHALL stop the server per `decideShutdownOnQuit`.
- **Leave running** → set an in-memory `askedThisSession` flag. No further prompts this session. Next Electron launch SHALL re-evaluate.
- **Stop now** → send SIGTERM to `health.pid`. Poll `isDashboardRunning` for up to 5 seconds. If still alive, send SIGKILL. Then re-enter `selectLaunchSource()` to launch a fresh server.

The modal SHALL be suppressed when Electron is invoked with the command-line switch `--no-zombie-prompt` (used by QA/test runs).

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
- **THEN** the app SHALL re-enter `selectLaunchSource()` to spawn a new server using the standard launch path

#### Scenario: Modal suppressed under test switch

- **WHEN** Electron is launched with `--no-zombie-prompt`
- **THEN** zombie detection SHALL still run for logging purposes
- **AND** the modal SHALL NOT be displayed regardless of the result
