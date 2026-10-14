## MODIFIED Requirements

### Requirement: Remote-connect window

The shell SHALL expose a dedicated window for connecting to another dashboard, opened from the app menu, and provide the renderer a bridge to query state, list discovered and paired servers, probe, connect, open a server window, reset to local, forget saved servers, and close. The window SHALL show four sections: **Paired** servers (from the server keyring), **Discovered** servers (from main-process discovery, excluding paired ones), **Enter a URL** (manual entry), and **Recent remote dashboards** (the MRU list of servers used as the whole-app remote dashboard, each with Connect and Forget). Each server row SHALL show its label, host and a paired state in text ("Paired", "Not paired", "Needs pairing", "Identity not advertised").

#### Scenario: Opening the window

- **WHEN** the user opens "Connect to Remote Dashboard" from the app menu
- **THEN** a fixed-size remote-connect window loads with an isolated preload bridge and no Node integration
- **AND** if the window is already open it is focused (restored if minimized) rather than duplicated

#### Scenario: Querying current state

- **WHEN** the renderer requests the current state
- **THEN** it receives the persisted mode (defaulting to standalone when none is set), the persisted remote URL when present, and the MRU list of recent remote servers

#### Scenario: Paired and discovered servers are listed

- **GIVEN** a paired server `home-imac` and a discovered, unpaired server `lab-box`
- **WHEN** the window opens
- **THEN** `home-imac` SHALL be listed under Paired with state "Paired"
- **AND** `lab-box` SHALL be listed under Discovered with state "Not paired"
- **AND** the lists SHALL update while the window is open as servers appear or disappear

#### Scenario: Closing the window

- **WHEN** the renderer requests to close
- **THEN** the remote-connect window is closed

### Requirement: Connect, persist, and relaunch

The shell SHALL, on the manual-URL "Use as remote dashboard" action, persist the chosen remote URL and remote mode, record the server in the MRU list, and relaunch the app so startup attaches to the remote; it SHALL also support resetting to the local dashboard. This whole-app remote mode SHALL remain available alongside per-server windows.

#### Scenario: Connecting to a remote

- **WHEN** the user chooses "Use as remote dashboard" with a valid URL
- **THEN** the URL is added to the front of the recent-servers MRU list (deduplicated, capped)
- **AND** the settings persist remote mode with that remote URL, preserving the MRU list
- **AND** the app relaunches
- **AND** a saved (already-probed) server is not re-probed before persisting

#### Scenario: Connecting with an invalid URL

- **WHEN** connect is invoked with an empty or invalid URL
- **THEN** it fails with an error and no settings are written and no relaunch occurs

#### Scenario: Reverting to local

- **WHEN** the user chooses to use the local dashboard
- **THEN** the settings persist standalone mode and the app relaunches

## ADDED Requirements

### Requirement: Open a server in its own window from the remote-connect window

The remote-connect window SHALL offer "Open" on each Paired server, "Connect" on each Discovered server, and "Open in window" for a manually entered URL. "Open" SHALL open (or focus) that server's window. "Connect" and "Open in window" SHALL run the main-process knock pairing flow when no usable credential exists and SHALL open the server window on approval. None of these actions SHALL change the persisted mode, relaunch the app, or add to the recent-remote-servers list (which records only servers used as the whole-app remote dashboard); the local dashboard SHALL keep running. A manually entered URL SHALL be normalized exactly as for probing and connecting before any of these actions. A Paired row SHALL also offer "Forget", and a "Needs pairing" row SHALL offer "Pair again".

#### Scenario: Connect to a discovered server without relaunch

- **GIVEN** the app runs its local dashboard
- **WHEN** the user chooses Connect on discovered `lab-box` and pairing is approved
- **THEN** a `lab-box` server window SHALL open
- **AND** the persisted mode SHALL be unchanged, the app SHALL NOT relaunch, and the local dashboard window SHALL keep working

#### Scenario: Manual URL opens in a window with trust on first use

- **WHEN** the user enters `http://10.0.0.5:8000` and chooses "Open in window"
- **THEN** the connecting window SHALL show the short fingerprint the address proved and SHALL wait for the user to choose "Send request"
- **AND** the knock pairing flow SHALL run against that address only after the user sends the request
- **AND** the recent-remote-servers list SHALL be unchanged

#### Scenario: Pair again on a revoked entry

- **GIVEN** `home-imac` is listed with state "Needs pairing"
- **WHEN** the user chooses "Pair again"
- **THEN** the knock pairing flow SHALL run against `home-imac` with its pinned fingerprint as the expected identity
