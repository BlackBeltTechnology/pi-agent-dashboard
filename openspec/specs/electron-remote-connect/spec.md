# electron-remote-connect Specification

## Purpose

Lets the Electron shell attach to a remote dashboard server instead of a local one. Collects a candidate remote URL, probes it for reachability and health, persists the chosen URL and remote mode (with an MRU list of prior servers), and relaunches the app so startup re-reads the setting and attaches.

## Requirements

### Requirement: Remote-connect window

The shell SHALL expose a dedicated window for connecting to a remote dashboard, opened from the app menu, and provide the renderer a bridge to query state, probe, connect, reset to local, forget saved servers, and close.

#### Scenario: Opening the window

- **WHEN** the user opens "Connect to Remote Dashboard" from the app menu
- **THEN** a fixed-size remote-connect window loads with an isolated preload bridge and no Node integration
- **AND** if the window is already open it is focused (restored if minimized) rather than duplicated

#### Scenario: Querying current state

- **WHEN** the renderer requests the current state
- **THEN** it receives the persisted mode (defaulting to standalone when none is set), the persisted remote URL when present, and the MRU list of recent remote servers

#### Scenario: Closing the window

- **WHEN** the renderer requests to close
- **THEN** the remote-connect window is closed

### Requirement: URL normalization and probing

The shell SHALL normalize a user-entered URL and probe its health endpoint, reporting whether the target is a reachable, healthy dashboard and, when available, its version.

#### Scenario: Normalizing input

- **WHEN** a URL is submitted for probing or connecting
- **THEN** it is trimmed, defaulted to an `http://` scheme when no scheme is present, and stripped of trailing slashes
- **AND** an empty or non-string input is rejected as no URL

#### Scenario: Successful probe

- **WHEN** the normalized URL's health endpoint responds successfully
- **THEN** the probe reports success
- **AND** includes the reported version when the health body provides one, tolerating a non-JSON body

#### Scenario: Empty URL probe

- **WHEN** the probe is invoked with an empty or invalid URL
- **THEN** it reports failure with guidance to enter a URL example

#### Scenario: Probe failure paths

- **WHEN** the health endpoint returns a non-success HTTP status
- **THEN** the probe reports failure with the HTTP status
- **AND** WHEN the request exceeds the short timeout it reports a timeout failure
- **AND** WHEN the connection cannot be established it reports a connection-refused failure

### Requirement: Connect, persist, and relaunch

The shell SHALL, on connect, persist the chosen remote URL and remote mode, record the server in the MRU list, and relaunch the app so startup attaches to the remote; it SHALL also support resetting to the local dashboard.

#### Scenario: Connecting to a remote

- **WHEN** the user connects with a valid URL
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

### Requirement: Recent remote servers

The shell SHALL maintain a most-recently-used list of previously connected remote dashboards, capped, and allow removing entries.

#### Scenario: Forgetting a server

- **WHEN** the user forgets a saved remote URL
- **THEN** that URL is removed from the recent-servers list and the updated list is returned
- **AND** WHEN the URL is empty or invalid the current list is returned unchanged

#### Scenario: MRU ordering and cap

- **WHEN** a remote is connected to
- **THEN** it moves to the front of the list, any prior duplicate entry is removed, and the list is capped at its maximum size
