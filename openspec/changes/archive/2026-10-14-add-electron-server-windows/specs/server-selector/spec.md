## MODIFIED Requirements

### Requirement: Server switching
Outside the Electron app's local dashboard window (in a browser, or in an Electron window that cannot open server windows), selecting a different server in the dropdown SHALL perform a transactional switch: a staging WebSocket connection is opened to the target while the current ("live") connection remains active, and the switch is committed only after the staging connection reaches the `OPEN` state. If the staging connection fails or times out, the switch is aborted and the live connection is preserved with no state loss.

#### Scenario: Switch to reachable remote server
- **WHEN** the user selects a reachable remote server from the dropdown
- **THEN** the dashboard SHALL open a staging WebSocket to the selected server's address while keeping the current WebSocket open
- **AND** upon the staging WebSocket reaching `OPEN`, the dashboard SHALL close the previous WebSocket, swap in-memory session state, and re-subscribe to sessions from the new server
- **AND** only after a successful swap SHALL the new server address be persisted to `localStorage`

#### Scenario: Switch back to localhost when reachable
- **WHEN** the user selects the localhost entry after being connected to a remote server, and localhost is reachable
- **THEN** the dashboard SHALL perform the same transactional switch and reload session data from localhost

#### Scenario: Switch to unreachable server
- **WHEN** the user selects a server whose staging WebSocket does not reach `OPEN` within 5 seconds, or is rejected by the server
- **THEN** the dashboard SHALL close the staging WebSocket and keep the previous connection active
- **AND** in-memory session state SHALL NOT be cleared
- **AND** `localStorage` SHALL NOT be updated
- **AND** a toast SHALL be displayed with the message "Couldn't reach <host>"

#### Scenario: Click during in-flight switch
- **WHEN** a staging switch is already in progress and the user clicks another entry
- **THEN** the second click SHALL be ignored until the first staging attempt resolves (success or failure)

#### Scenario: Staging progress indicator
- **WHEN** a staging switch is in progress
- **THEN** the clicked dropdown entry SHALL display an inline progress indicator
- **AND** the overall connection banner SHALL NOT be shown because the live connection is still open

#### Scenario: Selected server becomes unreachable after switch
- **WHEN** the currently connected server becomes unreachable after a successful switch
- **THEN** the selector SHALL show a disconnected indicator
- **AND** the dashboard SHALL attempt reconnection with existing backoff logic

### Requirement: Persist last-used server
The last-used server address SHALL be persisted in `localStorage` so the dashboard reconnects to it on next launch, but persistence SHALL occur only after a successful `OPEN` of the new connection — never at click time. When the dashboard runs in the Electron app's main window on the local dashboard origin and the app offers the open-server-window capability, the dashboard SHALL NOT reconnect to a saved remote server on load; it SHALL connect to its own origin and SHALL ignore (but not delete) a saved remote address.

#### Scenario: Client persists in localStorage on success
- **WHEN** a staging WebSocket reaches `OPEN` and the switch is committed
- **THEN** the server address SHALL be saved in `localStorage` under `pi-dashboard-last-server`

#### Scenario: Client does not persist on failure
- **WHEN** a staging WebSocket fails to open or times out
- **THEN** the `localStorage` value SHALL remain unchanged from its previous state

#### Scenario: Client reconnects to last-used server
- **WHEN** the dashboard loads outside the Electron local window and `localStorage` has a saved server address
- **THEN** the dashboard SHALL attempt to connect to the saved server first
- **AND** fall back to localhost discovery if the saved server is unreachable

#### Scenario: Electron local window ignores a saved remote
- **GIVEN** the Electron main window on `http://localhost:8000` offers the open-server-window capability and `pi-dashboard-last-server` holds `192.168.16.204:8000` from an earlier in-page switch
- **WHEN** the dashboard loads
- **THEN** it SHALL connect to `localhost:8000` and the saved `pi-dashboard-last-server` value SHALL be left unchanged

## ADDED Requirements

### Requirement: Electron opens a server window instead of switching in-page
When the dashboard runs in the Electron app's main window on the local dashboard origin and the app offers the open-server-window capability, selecting an available remote server entry SHALL ask the app to open (or focus) that server's own window — or, when the app holds no usable credential for it, to start pairing with it — passing only the entry's host and port, and SHALL NOT open a staging WebSocket, swap session state, or update the persisted last-used server. The current window SHALL stay on the local dashboard. Selecting the localhost "Local" entry SHALL do nothing beyond closing the dropdown. While the request is in flight the entry SHALL show the inline progress indicator; when the app reports a failure (identity mismatch, unreachable, pairing refused or stopped) the selector SHALL show a toast with the reason in text. Entries that are not available (unreachable, network not allowed, blocked in this browser, name not found, moved, or still checking) SHALL stay non-activatable exactly as in the header requirement and SHALL NOT trigger the request. When the capability is absent, the transactional in-page switch SHALL apply.

#### Scenario: Selecting a remote opens its window
- **GIVEN** the dashboard runs in the Electron main window on `http://localhost:8000`
- **WHEN** the user selects the reachable entry `home-imac` (`192.168.16.204:8000`)
- **THEN** the app SHALL be asked to open the server window for `192.168.16.204:8000`
- **AND** no staging WebSocket SHALL be opened and `localStorage` SHALL NOT be updated
- **AND** the current window SHALL keep showing the local dashboard

#### Scenario: Failure is reported in text
- **WHEN** the app reports that `home-imac` answered with a different identity
- **THEN** a toast SHALL state the identity mismatch for `home-imac` and no window SHALL open

#### Scenario: Unavailable entry does not open a window
- **WHEN** the user presses Enter on an entry showing "Unreachable" in the Electron main window
- **THEN** the app SHALL NOT be asked to open a server window

#### Scenario: Network-not-allowed entry pairs from the Connect window
- **GIVEN** an unpaired remote entry shows "Network not allowed" in the Electron main window
- **WHEN** the user presses Enter on it
- **THEN** the app SHALL NOT be asked to open a window; the user pairs it from "Connect to Remote Dashboard"

#### Scenario: Browser keeps the in-page switch
- **GIVEN** the dashboard runs in a regular browser tab
- **WHEN** the user selects a reachable remote entry
- **THEN** the transactional in-page switch SHALL run
