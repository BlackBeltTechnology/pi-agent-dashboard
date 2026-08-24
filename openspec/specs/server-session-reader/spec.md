# server-session-reader Specification

## Purpose

Server-side session discovery and event loading. The server imports `SessionManager` from `@mariozechner/pi-coding-agent` to discover historical sessions and load session events directly from disk, without requiring a bridge connection.

## Requirements

### Requirement: Server reads session history directly from disk
The server SHALL import `SessionManager` from `@mariozechner/pi-coding-agent` and call `SessionManager.list(cwd)` to discover historical sessions for a directory, without requiring a bridge connection.

#### Scenario: Server discovers sessions for a pinned directory on startup
- **WHEN** the server starts and has pinned directories configured
- **THEN** it SHALL call `SessionManager.list(cwd)` for each pinned directory and insert discovered sessions into the in-memory session registry with status `"ended"`, `hidden: true`, source `"tui"`

#### Scenario: Server discovers sessions when a new directory is registered
- **WHEN** a new pinned directory is added or a session registers with a previously unknown cwd
- **THEN** the server SHALL call `SessionManager.list(cwd)` for that directory and insert any new sessions

#### Scenario: Deduplication of discovered sessions
- **WHEN** `SessionManager.list(cwd)` returns a session ID already present in the session registry
- **THEN** the server SHALL skip that session without modification

#### Scenario: SessionManager import fails
- **WHEN** `@mariozechner/pi-coding-agent` cannot be imported (not installed or incompatible version)
- **THEN** the server SHALL log a warning and continue without session history discovery, marking directories as data unavailable

### Requirement: Server loads session events directly from disk
The server SHALL call `SessionManager.open(sessionFile).getBranch()` to load session events on demand, without routing through a bridge.

#### Scenario: Browser subscribes to a session not in memory
- **WHEN** a browser subscribes to a session whose events are not in the in-memory event buffer and the session has a `sessionFile` path
- **THEN** the server SHALL read the session file directly using `SessionManager.open(sessionFile).getBranch()`, convert entries via `replayEntriesAsEvents()`, store them in the event buffer, and send `event_replay { events, isLast: true }` to the browser

#### Scenario: Session file does not exist
- **WHEN** the server attempts to load a session file that does not exist or is corrupted
- **THEN** the server SHALL send `event_replay { events: [], isLast: true }` and `session_updated { dataUnavailable: true }` to the browser

#### Scenario: Multiple browsers subscribe to same unloaded session simultaneously
- **WHEN** two browsers subscribe to the same session before the load completes
- **THEN** the server SHALL deduplicate the load operation and deliver the loaded events to both browsers

#### Scenario: Session has no sessionFile path
- **WHEN** a browser subscribes to a session that has no `sessionFile` path
- **THEN** the server SHALL send `event_replay { events: [], isLast: true }` and `session_updated { dataUnavailable: true }`

### Requirement: Known directories computation
The server SHALL compute the set of known directories as the union of pinned directories and cwds of all registered sessions.

#### Scenario: Pinned directory with no sessions
- **WHEN** a directory is pinned but has no registered sessions
- **THEN** the server SHALL still discover historical sessions and poll OpenSpec for that directory

#### Scenario: Directory with sessions but not pinned
- **WHEN** sessions are registered for a directory that is not pinned
- **THEN** the server SHALL include that directory in known directories for history discovery and polling
