## MODIFIED Requirements

### Requirement: Server reads session history directly from disk
The server SHALL import `SessionManager` from `@earendil-works/pi-coding-agent` and call `SessionManager.list(cwd)` to discover historical sessions for a directory, without requiring a bridge connection.

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
- **WHEN** `@earendil-works/pi-coding-agent` cannot be imported (not installed or incompatible version)
- **AND** regardless of whether `@mariozechner/pi-coding-agent` is installed
- **THEN** the server SHALL log a warning and continue without session history discovery, marking directories as data unavailable
