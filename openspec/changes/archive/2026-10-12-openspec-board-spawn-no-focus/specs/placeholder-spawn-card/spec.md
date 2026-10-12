## MODIFIED Requirements

### Requirement: Placeholder replaced on session added matching requestId
When a `session_added` message arrives carrying `spawnRequestId` matching an entry in `pendingSpawns`, the system SHALL: (a) remove that entry from `pendingSpawns` (clearing the placeholder keyed by the entry's `placeholderCwd`), (b) cancel any associated timeout timer, (c) navigate to the new session's URL — unless the entry carries the "no focus" intent defined by `spawn-correlation`, in which case (a) and (b) SHALL still happen and (c) SHALL NOT. The real session card SHALL render in its place via the normal session rendering pipeline.

When `msg.session.hidden === true`, the system SHALL NOT clear any placeholder, SHALL NOT cancel any timeout timer, and SHALL NOT navigate, even if `spawnRequestId` matches a `pendingSpawns` entry. A hidden session is never the visible spawn a placeholder represents.

#### Scenario: session_added with matching spawnRequestId replaces placeholder
- **WHEN** a `session_added { session, spawnRequestId: "rq_42" }` message arrives
- **AND** `pendingSpawns` contains an entry with key `rq_42`
- **THEN** the placeholder for `rq_42` SHALL be removed using the entry's `placeholderCwd`
- **AND** the client SHALL navigate to `/session/<session.id>`
- **AND** the real session card SHALL render in the host group's list

#### Scenario: No-focus spawn replaces placeholder without navigating
- **WHEN** a `session_added { session, spawnRequestId: "rq_50" }` message arrives
- **AND** `pendingSpawns` contains an entry `rq_50` recorded with the "no focus" intent
- **THEN** the placeholder for `rq_50` SHALL be removed using the entry's `placeholderCwd`
- **AND** the client SHALL NOT change the active route
- **AND** the real session card SHALL render in the host group's list

#### Scenario: Worktree session_added clears parent-group placeholder
- **WHEN** a worktree spawn's `session_added { session, spawnRequestId }` arrives where `session.cwd` is the worktree path
- **THEN** the placeholder SHALL be removed using the entry's `placeholderCwd` (parent repo path), NOT `session.cwd`
- **AND** the placeholder SHALL clear immediately (not rely on the safety timeout)

#### Scenario: session_added without spawnRequestId is treated as natural arrival
- **WHEN** `session_added { session }` arrives without a `spawnRequestId` (e.g. TUI-spawned session)
- **THEN** no placeholder SHALL be removed (none was matched)
- **AND** no auto-navigation SHALL occur
- **AND** the new session SHALL still render in its group via the normal pipeline

#### Scenario: Hidden session never clears a placeholder or navigates
- **WHEN** `session_added { session, hidden: true }` arrives, even with a `spawnRequestId` matching a live `pendingSpawns` entry
- **THEN** the placeholder SHALL NOT be removed, the timeout timer SHALL NOT be cancelled, and the client SHALL NOT navigate
- **AND** the placeholder SHALL persist until the real visible session arrives or the safety timeout fires

