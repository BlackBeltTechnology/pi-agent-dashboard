## MODIFIED Requirements

### Requirement: Electron main process lifecycle

The Electron main process SHALL discover or launch a dashboard server, then open a BrowserWindow pointing at the server URL. The server SHALL always run as a separate detached process, never in-process. On `ensureServer()` failure the main process SHALL classify the error and route to either the configuration-error dialog or the interactive loading page — it SHALL NOT retry `ensureServer()` a second time, because a second 15 s budget produces no useful signal that the loading page (which polls indefinitely) does not already provide.

#### Scenario: Launch with no server running

- **WHEN** the Electron app starts and no dashboard server is discovered (mDNS via `@blackbelt-technology/pi-dashboard-shared/mdns-discovery` + health check fallback via `@blackbelt-technology/pi-dashboard-shared/server-identity`)
- **THEN** it SHALL launch the server as a detached process through `launchDashboardServer` (see `server-launch`), with the TypeScript loader selected per `server-launch` (Node-native by default, jiti when `PI_DASHBOARD_TS_LOADER=jiti`) resolved from the launch source, and open a BrowserWindow pointing at `http://localhost:<port>` once the server is ready

#### Scenario: Launch with server already running

- **WHEN** the Electron app starts and a localhost dashboard server is discovered
- **THEN** it SHALL skip server launch and open a BrowserWindow pointing at the discovered server URL

#### Scenario: Window close behavior

- **WHEN** the user closes the Electron window
- **THEN** the app SHALL minimize to the system tray (server keeps running)

#### Scenario: Configuration-error failure shows error dialog

- **GIVEN** `ensureServer()` throws an error that does NOT begin with "Server did not respond within" or "Server child process exited prematurely" (e.g. "No TypeScript loader found", "Dashboard server CLI not found", "Port N is in use by another service")
- **WHEN** the main process catches the error
- **THEN** it SHALL close the splash and show an error dialog with the failure reason and offer "Run Setup", "Retry", or "Quit" options
- **AND** it SHALL NOT issue a second `ensureServer()` attempt before showing the dialog

#### Scenario: Deadline / child-exit failure falls through to loading page

- **GIVEN** `ensureServer()` throws an error whose message begins with "Server did not respond within" OR "Server child process exited prematurely"
- **WHEN** the main process catches the error
- **THEN** it SHALL close the splash, open the BrowserWindow at `http://localhost:<port>`, and call `showLoadingPage(win, serverUrl)`
- **AND** it SHALL NOT show the error dialog
- **AND** it SHALL NOT issue a second `ensureServer()` attempt
- **AND** the loading page SHALL keep polling `/api/health` every 1.5 s, surfacing Start server / Open Doctor / server-log controls after ~15 s as already specified
