# Spec Delta

## MODIFIED Requirements

### Requirement: Server loads session events directly from disk
The server SHALL call `SessionManager.open(sessionFile).getBranch()` to load session events on demand, without routing through a bridge. While a bridge is replaying the session (bridge replay mode), the server SHALL NOT load from disk and SHALL NOT report the session's data as unavailable; the bridge replay supplies the events.

#### Scenario: Browser subscribes to a session not in memory
- **WHEN** a browser subscribes to a session whose events are not in the in-memory event buffer, the session has a `sessionFile` path, and no bridge is replaying it
- **THEN** the server SHALL read the session file directly using `SessionManager.open(sessionFile).getBranch()`, convert entries via `replayEntriesAsEvents()`, store them in the event buffer, and send `event_replay { events, isLast: true }` to the browser

#### Scenario: Session file does not exist
- **WHEN** the server attempts to load a session file that does not exist or is corrupted
- **THEN** the server SHALL send `event_replay { events: [], isLast: true }` and `session_updated { dataUnavailable: true }` to the browser

#### Scenario: Multiple browsers subscribe to same unloaded session simultaneously
- **WHEN** two browsers subscribe to the same session before the load completes
- **THEN** the server SHALL deduplicate the load operation and deliver the loaded events to both browsers

#### Scenario: Session has no sessionFile path
- **WHEN** a browser subscribes to a session that has no `sessionFile` path and no bridge is replaying it
- **THEN** the server SHALL send `event_replay { events: [], isLast: true }` and `session_updated { dataUnavailable: true }`

#### Scenario: Session without sessionFile subscribed during a bridge replay
- **WHEN** a browser subscribes to a session with no `sessionFile` and an empty store while a bridge is replaying it
- **THEN** the server SHALL NOT send `dataUnavailable: true`
- **AND** the browser SHALL receive the session's events from the replay exit flush ending with `isLast: true`
