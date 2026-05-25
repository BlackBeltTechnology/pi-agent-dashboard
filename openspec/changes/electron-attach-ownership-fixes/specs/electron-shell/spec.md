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

### Requirement: Zombie server adoption modal on POSIX

When the Electron app launches and takes the `attach` arm of the bootstrap state machine on macOS or Linux, the main process SHALL evaluate whether the discovered server is a zombie left over from a prior Electron lifetime. A server is classified as a zombie when ALL of the following hold:

- `health.launchSourceEffective === "electron"`
- This Electron lifetime's `storedSpawnedPid === null` (we did not spawn it)
- `health.ppid === 1` (the server was reparented to init/launchd, meaning its original parent process is gone)

On Windows the Job Object integration ensures spawned children die with the parent, so zombie detection SHALL be skipped (the helper SHALL return `false` unconditionally on `process.platform === "win32"`).

When a zombie is detected the app SHALL present a modal dialog with three buttons (default: "Leave running"):

- **Take ownership** → call `setSpawnedPid(health.pid)`. Subsequent app quit SHALL stop the server per `decideShutdownOnQuit`.
- **Leave running** → set an in-memory `askedThisSession` flag. No further prompts this session. Next Electron launch SHALL re-evaluate.
- **Stop now** → send SIGTERM to `health.pid`. Poll `isDashboardRunning` for up to 5 seconds. If still alive, send SIGKILL. Then re-enter `selectLaunchSource()` to launch a fresh server.

The modal SHALL be suppressed when Electron is invoked with the command-line switch `--no-zombie-prompt` (used by QA/test runs).

#### Scenario: Zombie detected with reparenting

- **GIVEN** Electron is running on macOS or Linux
- **WHEN** the app launches AND `/api/health` returns `launchSourceEffective: "electron"`, `ppid: 1`, and `storedSpawnedPid` is null
- **THEN** the main process SHALL display the adoption modal

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

#### Scenario: Windows skips zombie detection

- **GIVEN** Electron is running on Windows
- **WHEN** the app launches AND attaches to any existing server
- **THEN** the zombie classifier SHALL return false
- **AND** no modal SHALL be displayed
