# session-history-sync Specification

## Purpose

**DEPRECATED** — Session history sync has moved from the bridge extension to the dashboard server. See `server-session-reader` for the replacement capability.

Previously, the bridge extension called `SessionManager.list(cwd)` on connect and sent results via `session_history_sync` protocol message. This was replaced by server-side direct disk discovery via `DirectoryService.discoverSessions(cwd)` to eliminate bridge dependency and enable zero-session directory visibility.

## Requirements

### Requirement: Bridge-side session history sync is retired

This capability SHALL NOT be implemented. The `session_history_sync` protocol
message and the bridge's `SessionManager.list(cwd)` call were removed; consumers
SHALL use `server-session-reader`, which discovers sessions directly from disk
via `DirectoryService.discoverSessions(cwd)`.

This spec is retained as a tombstone because live specs and archived changes
still reference the `session-history-sync` capability name. It records no current
behaviour.

#### Scenario: No bridge-side history sync exists

- **WHEN** the bridge extension connects to the dashboard server
- **THEN** it SHALL NOT send a `session_history_sync` message
- **AND** historical sessions SHALL be discovered by `server-session-reader`
