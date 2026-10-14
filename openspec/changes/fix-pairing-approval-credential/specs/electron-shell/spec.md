# electron-shell — delta

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
- **THEN** the loading page SHALL ask the main process to navigate to the server, and the BrowserWindow SHALL land on the server origin within one polling cycle, after any local-proof bootstrap redirect the main process performs
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
- **AND** a preload script SHALL expose on `window.piDashboard` via `contextBridge` exactly the members `requestLaunch`, `openDoctor`, `readServerLog`, `onStatus`, `probeServer`, `checkAppUpdate` and `navigateToServer`, and no other members
- **AND** `navigateToServer` SHALL only REQUEST a navigation and SHALL NOT return a URL, a code, or any other credential material to the renderer

### Requirement: Remote-mode attach probes reachability in the main process
When attaching in remote mode, the app SHALL determine target reachability using a **main-process** probe (a Node HTTP request that sends no browser `Origin` header and is not subject to CORS), and the window SHALL then reach the dashboard via a top-level navigation. That navigation SHALL be issued by the **main process** on the renderer's request (see "Local proof is re-established on every handoff to a local dashboard URL"), not by the renderer assigning `location.href`, so that a local target can be credentialed without the renderer ever seeing the credential; for a remote target the effect is identical to the previous `location.href = serverUrl`. The loading page SHALL NOT gate that navigation behind a renderer-side `fetch` from its `file://` (`Origin: null`) document, because a remote dashboard's CORS policy deliberately refuses the `null` origin — making such a probe never succeed and the attach hang until the error timeout despite a healthy, directly-reachable server.

#### Scenario: Remote attach reaches a healthy remote without a renderer fetch gate
- **WHEN** the app starts in remote mode with `remoteUrl = http://192.168.16.242:8000` and that server is healthy
- **THEN** the main process SHALL probe `${remoteUrl}/api/health` (Node fetch, no `Origin` header) and report reachable
- **AND** the main process SHALL navigate the window to `remoteUrl` unchanged, minting no local credential for it
- **AND** the attach SHALL NOT depend on a renderer `fetch(${remoteUrl}/api/health)` succeeding

#### Scenario: Loopback attach unchanged
- **WHEN** the app attaches to `http://localhost:<port>`
- **THEN** the loading page behavior SHALL be unchanged (its existing health polling and Start server / Open Doctor / server-log controls after ~15 s still apply)

#### Scenario: Unreachable remote still surfaces the error page
- **WHEN** the app starts in remote mode but the remote is genuinely unreachable
- **THEN** the main-process probe SHALL report not-reachable
- **AND** the loading page SHALL surface the existing connection-error UI after the timeout (no indefinite silent hang)

### Requirement: Electron IPC channels for server control
The Electron main process SHALL register IPC handlers for renderer-initiated server control. All channels SHALL be prefixed `dashboard:`. Every channel that carries renderer input or performs a privileged action SHALL be gated to a trusted sender — the packaged loading page, or the local dashboard origin on the configured port — and SHALL refuse every other sender frame, including remote content shown in the main window. A channel that takes no renderer input and returns no data (`dashboard:check-app-update`) MAY be left ungated.

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

#### Scenario: Navigation request handler
- **WHEN** a trusted sender — the packaged loading page, or the local dashboard origin on the configured port — invokes the `dashboard:navigate-to-server` channel with a target URL
- **THEN** the main process SHALL perform the navigation ITSELF — loading a local-proof bootstrap URL when the target is this host's configured server and a credential could be minted, otherwise loading the target unchanged — and SHALL return only an acknowledgement of whether a navigation happened
- **AND** the renderer SHALL NOT receive the local credential, the single-use code, or any URL containing them, for any target
- **WHEN** the target's scheme is anything other than `http` or `https`
- **THEN** the main process SHALL perform no navigation and SHALL return a refusal
- **WHEN** the target's origin is none of: this host's configured server, the server URL the main window was created for, or a configured known server
- **THEN** the main process SHALL perform no navigation and SHALL return a refusal
- **WHEN** the target names this host but a port other than the server's configured port
- **THEN** the main process SHALL navigate to it unchanged and SHALL mint nothing, so the renderer cannot aim a credential at another local listener

#### Scenario: Dashboard page cannot replace itself with an external site
- **GIVEN** the main window shows the local dashboard on the configured port, a trusted sender
- **WHEN** that page invokes `dashboard:navigate-to-server` with `https://evil.example/`, which is neither the configured server, the window's server URL, nor a known server
- **THEN** the main process SHALL refuse the request, SHALL NOT load the target in the main window, SHALL NOT open it in the system browser, and SHALL mint no credential
- **AND** the main window SHALL remain on the dashboard

#### Scenario: Navigation request from an untrusted sender is refused
- **GIVEN** the main window shows a remote dashboard in remote mode, so its preload is attached to remote content
- **WHEN** a sender frame that is neither the packaged loading page nor the local dashboard origin on the configured port invokes `dashboard:navigate-to-server` with any target, including this host's configured server
- **THEN** the main process SHALL refuse the call through the same sender-trust gate as the other privileged `dashboard:*` channels
- **AND** SHALL perform no navigation and mint no local credential

## ADDED Requirements

### Requirement: Local proof is re-established on every handoff to a local dashboard URL

The desktop app SHALL hold an operator credential for the dashboard it runs on
this host whenever it is showing that dashboard — not only when the window was
created while the server was already running. Every navigation the app itself
initiates towards a dashboard, including the handoff out of the loading page after
the server becomes reachable, a restart, a recovery from a startup failure, and
the selection of a server from the known-servers list, SHALL first attempt to
establish local proof for the target.

The decision whether a target is this host, the minting of the credential, AND the
navigation itself SHALL all happen in the main process, and only on a request from
a trusted sender (the packaged loading page or the local dashboard origin on the
configured port); a request from any other sender, including remote content shown
in the same window, SHALL cause no navigation and no mint. The renderer SHALL be able
to request a navigation, and SHALL NOT receive the credential, the single-use code,
or any URL carrying them. The renderer SHALL NOT be able to cause a local
credential to be minted for, or presented to, anything but this host's configured
server. Only a target whose origin is this host's configured server, the server
URL the main window was created for, or a configured known server SHALL be
navigated to at all — any other target SHALL be refused, so this path can never
let an external URL replace the dashboard; among allowed targets, one naming
any other host, or any other port on this host, SHALL be navigated to unchanged
with no credential, and a target whose scheme is not `http` or `https` SHALL
not be navigated to at all. When the attempt
fails for any reason — the server is not reachable, the local credential cannot be
read, the server refuses — the app SHALL navigate to the plain target URL rather
than block or fail the navigation.

#### Scenario: Server started after the window opened

- **GIVEN** the app launched while the dashboard server was not yet running and is showing the loading page
- **WHEN** the server becomes reachable and the app navigates to it
- **THEN** the window SHALL hold local proof for that dashboard
- **AND** approving a pending pairing from the dialog SHALL succeed without any terminal step

#### Scenario: Known remote server is never offered the credential

- **WHEN** the operator picks a known server on another host from the loading page
- **THEN** the app SHALL navigate to that server unchanged
- **AND** SHALL mint no local credential for it

#### Scenario: Renderer cannot redirect the credential

- **WHEN** the loading page asks to navigate to an allowed target (the window's remote server URL or a known server) whose host is not this host
- **THEN** the main process SHALL navigate to that target unchanged and mint nothing, regardless of how the target reached the loading page
- **AND** no response to the renderer SHALL contain a credential or a single-use code

#### Scenario: Remote content cannot trigger a mint

- **GIVEN** the window shows a remote dashboard in remote mode
- **WHEN** that remote page asks to navigate to this host's configured server
- **THEN** the request SHALL be refused, no navigation SHALL occur, and no local credential SHALL be minted

#### Scenario: Renderer cannot name a non-web scheme

- **WHEN** the loading page asks to navigate to a `file:`, `javascript:` or other non-`http(s)` target
- **THEN** no navigation SHALL occur and the request SHALL be refused

#### Scenario: Failure degrades to a plain navigation

- **GIVEN** the local credential cannot be read on this host
- **WHEN** the app navigates to the local dashboard
- **THEN** it SHALL load the plain dashboard URL and SHALL NOT block, retry indefinitely, or show an error

#### Scenario: Restart keeps the proof

- **WHEN** the dashboard server is restarted from the app and the window reloads it
- **THEN** the window SHALL again hold local proof for that dashboard
