## MODIFIED Requirements

### Requirement: Loading page with connection retry
The app SHALL show a branded loading page while waiting for the server to become available. The loading page SHALL provide user-initiated controls to launch the server, open Doctor, and view recent server log output once an initial timeout has elapsed.

#### Scenario: Loading page displays
- **WHEN** the BrowserWindow opens before the server is ready
- **THEN** it SHALL show a dark-themed page with the π symbol and "Connecting to dashboard..." animation

#### Scenario: Loading page shows error after timeout
- **WHEN** the server is not available after ~15 seconds
- **THEN** the loading page SHALL show connection error details with installation instructions
- **AND** it SHALL continue retrying in the background and auto-redirect when the server becomes available

#### Scenario: Loading page exposes Start server action after timeout
- **WHEN** the loading page has shown the error state
- **THEN** it SHALL display a primary "Start server" button
- **AND** clicking the button SHALL invoke the main-process `requestServerLaunch()` routine via the `dashboard:request-launch` IPC channel
- **AND** while the launch is in progress, the button SHALL be disabled and the status text SHALL show "Launching server…"

#### Scenario: Loading page reports launch outcome
- **WHEN** `requestServerLaunch()` returns `{ kind: "started" }` or `{ kind: "already-running" }`
- **THEN** the loading page SHALL navigate the BrowserWindow to the server URL within one polling cycle
- **WHEN** `requestServerLaunch()` returns `{ kind: "failed", reason }`
- **THEN** the loading page SHALL re-enable the "Start server" button and display the `reason` string in the status area
- **AND** background polling of `/api/health` SHALL continue so an out-of-band start (e.g. `pi` session, manual `pi-dashboard start`) still auto-redirects

#### Scenario: Loading page exposes Open Doctor action
- **WHEN** the loading page has shown the error state
- **THEN** it SHALL display an "Open Doctor" link
- **AND** clicking the link SHALL send the `dashboard:open-doctor` IPC message which opens the existing Doctor diagnostic window

#### Scenario: Loading page surfaces server log tail
- **WHEN** the loading page has shown the error state
- **AND** `~/.pi/dashboard/server.log` exists and is non-empty
- **THEN** the loading page SHALL show a collapsible "Server log" panel containing the last 20 lines of the log
- **WHEN** the log file does not exist or cannot be read
- **THEN** the panel SHALL be hidden — its absence SHALL NOT block any other loading-page behaviour

#### Scenario: Loading page is loaded from a packaged HTML resource
- **WHEN** the BrowserWindow shows the loading page
- **THEN** it SHALL be loaded via `loadFile('resources/loading.html')` (not a `data:` URL)
- **AND** a preload script SHALL expose only `requestLaunch`, `openDoctor`, `readServerLog`, and `onStatus` on `window.piDashboard` via `contextBridge`

### Requirement: System tray integration
The app SHALL show a system tray icon with a context menu when the window is closed. The tray SHALL use a platform-appropriate icon image. The tray context menu SHALL expose a server-launch action whose label and behaviour reflect current server state.

#### Scenario: Tray icon menu
- **WHEN** the window is minimized to tray
- **THEN** the tray SHALL show a context menu with a server-launch action ("Start server" or "Restart server"), "Show", and "Quit" options

#### Scenario: Tray click reopens window
- **WHEN** the user clicks the tray icon
- **THEN** the window SHALL be shown and focused

#### Scenario: Quit stops server if we started it
- **WHEN** the user clicks "Quit" in the tray menu and Electron started the server
- **THEN** it SHALL stop the server before exiting

#### Scenario: macOS tray uses template image
- **WHEN** the tray is created on macOS
- **THEN** it SHALL load `trayTemplate.png` from the resources directory (auto-adapts to dark/light menu bar)

#### Scenario: Windows/Linux tray uses app icon
- **WHEN** the tray is created on Windows or Linux
- **THEN** it SHALL load `icon.ico` or `icon.png` from the resources directory

#### Scenario: Tray shows Start server when no server is running
- **WHEN** the tray menu is rebuilt and `isDashboardRunning(port)` returns `false`
- **THEN** the menu SHALL show a "Start server" item
- **AND** clicking it SHALL call `requestServerLaunch()` and update tray status when the outcome resolves

#### Scenario: Tray shows Restart server when a server is running
- **WHEN** the tray menu is rebuilt and `isDashboardRunning(port)` returns `true`
- **THEN** the menu SHALL show a "Restart server" item
- **AND** clicking it SHALL call `requestServerLaunch({ force: true })`

#### Scenario: Tray menu reflects state changes within 5 seconds
- **WHEN** server state changes (started or stopped) while the app is running
- **THEN** the tray menu SHALL be rebuilt within 5 seconds to reflect the new state

## ADDED Requirements

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
- **AND** if the shutdown POST fails, fall through to the spawn path anyway (which will fail with a clear `EADDRINUSE` error captured in the `failed` outcome)

#### Scenario: Concurrent calls share one launch attempt
- **WHEN** two callers invoke `requestServerLaunch()` while a launch is already in flight
- **THEN** both callers SHALL receive the same `LaunchOutcome` from a single underlying spawn
- **AND** at most one server process SHALL be spawned

#### Scenario: Failure outcome is a value, not an exception
- **WHEN** the spawn step throws synchronously or the spawned process exits non-zero before becoming healthy
- **THEN** `requestServerLaunch()` SHALL catch the error and return `{ kind: "failed", reason: <string>, logTail: <string> }`
- **AND** SHALL NOT propagate the exception to the caller

### Requirement: Electron IPC channels for server control
The Electron main process SHALL register IPC handlers for renderer-initiated server control. All channels SHALL be prefixed `dashboard:` and gated to the loading-page renderer's preload origin.

#### Scenario: dashboard:request-launch handler
- **WHEN** the renderer invokes `dashboard:request-launch` with payload `{ force?: boolean }`
- **THEN** the main process SHALL call `requestServerLaunch(payload)` and return the resolved `LaunchOutcome`

#### Scenario: dashboard:open-doctor handler
- **WHEN** the renderer sends `dashboard:open-doctor`
- **THEN** the main process SHALL open the existing Doctor diagnostic window (same path as the app menu's Doctor item)

#### Scenario: dashboard:read-server-log handler
- **WHEN** the renderer invokes `dashboard:read-server-log` with payload `{ lines?: number }` (default 20)
- **THEN** the main process SHALL return up to `lines` trailing lines of `~/.pi/dashboard/server.log`
- **AND** SHALL return an empty string if the file does not exist or cannot be read
- **AND** SHALL read at most 8 KiB from the tail to bound memory

#### Scenario: dashboard:launch-status push events
- **WHEN** a launch is in progress
- **THEN** the main process SHALL emit `dashboard:launch-status` events with payload `{ phase: "starting" | "spawning" | "waiting-health" | "ready" | "failed", message?: string }` to the loading-page renderer
- **AND** the loading-page preload SHALL expose `onStatus(cb)` returning an unsubscribe function
