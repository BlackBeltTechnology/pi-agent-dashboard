## MODIFIED Requirements

### Requirement: Server-startup deadline is 15 seconds with cause-aware error wording

The `waitForReady` callsites in `server-lifecycle.ts` SHALL use a deadline of `15_000` milliseconds (15 seconds), not `60_000`. The error message constructed when `waitForReady` returns unsuccessful SHALL distinguish two cases — child process exiting prematurely vs. deadline elapsed without the probe returning true — and use different wording for each. The deadline budget SHALL NOT exceed 15 s because beyond that point the failure is almost always terminal (port conflict, missing loader, bad Node) and the loading page (`resources/loading.html`) is a strictly better surface — it polls every 1.5 s and exposes Start server / Open Doctor / log-tail controls — than a frozen splash.

#### Scenario: Deadline is 15 seconds at every callsite

- **WHEN** `server-lifecycle.ts` is parsed
- **THEN** every `waitForReady` call SHALL pass `deadlineMs: SERVER_READY_DEADLINE_MS`
- **AND** `SERVER_READY_DEADLINE_MS` SHALL be `15_000`

#### Scenario: Child-exit error wording

- **WHEN** the spawned server child process exits before the probe returns true
- **THEN** the thrown error SHALL begin with "Server child process exited prematurely (...)"
- **AND** SHALL include a hint identifying the typical cause ("usually means a missing dependency or wrong TypeScript loader")
- **AND** SHALL include the spawn command, CWD, and the last 20 lines of `server.log`

#### Scenario: Deadline-exceeded error wording

- **WHEN** the deadline elapses without either the probe returning true or the child exiting
- **THEN** the thrown error SHALL begin with "Server did not respond within 15 seconds (...)"
- **AND** SHALL include the hint "The server is likely still starting; the loading page will keep polling — try the Doctor button if it doesn't connect"
- **AND** SHALL include the spawn command, CWD, and the last 20 lines of `server.log`

### Requirement: Electron main process lifecycle

The Electron main process SHALL discover or launch a dashboard server, then open a BrowserWindow pointing at the server URL. The server SHALL always run as a separate detached process, never in-process. On `ensureServer()` failure the main process SHALL classify the error and route to either the configuration-error dialog or the interactive loading page — it SHALL NOT retry `ensureServer()` a second time, because a second 15 s budget produces no useful signal that the loading page (which polls indefinitely) does not already provide.

#### Scenario: Launch with no server running

- **WHEN** the Electron app starts and no dashboard server is discovered (mDNS via `@blackbelt-technology/pi-dashboard-shared/mdns-discovery` + health check fallback via `@blackbelt-technology/pi-dashboard-shared/server-identity`)
- **THEN** it SHALL launch the server as a detached process using the `tsx` binary and open a BrowserWindow pointing at `http://localhost:<port>` once the server is ready

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
