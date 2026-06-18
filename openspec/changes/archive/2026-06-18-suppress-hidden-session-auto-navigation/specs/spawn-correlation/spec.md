## MODIFIED Requirements

### Requirement: Client auto-selects newly registered session by requestId match
The client `useMessageHandler.ts` SHALL, on receipt of `session_added`, look up `msg.spawnRequestId` in its `pendingSpawns` map. If found, the client SHALL: (a) remove the entry from `pendingSpawns`, (b) navigate to `/session/<msg.session.id>`, (c) cancel the spawn-timeout timer for that requestId. If `spawnRequestId` is absent or unknown, the client SHALL NOT auto-navigate (existing behavior preserved for natural session arrivals).

When `msg.session.hidden === true`, the client SHALL NOT auto-navigate AND SHALL NOT consume any correlation state for that message — it SHALL NOT remove a `pendingSpawns` entry, SHALL NOT clear `spawningCwds`, and SHALL NOT cancel any spawn-timeout timer. A hidden session SHALL still be added to the session map and rendered in the Hidden tier; only the correlation+navigation cascade is suppressed. This prevents a headless worker (subagent, `memory` tool, nested `pi -p`) that shares its parent session's `cwd` from stealing focus or consuming the correlation token minted for the real visible spawn.

#### Scenario: Auto-select after spawn
- **WHEN** the user spawned a session with `requestId: "rq_42"`
- **AND** `session_added { session, spawnRequestId: "rq_42" }` arrives
- **THEN** the client SHALL navigate to that session's URL
- **AND** the matching placeholder card SHALL be removed

#### Scenario: Auto-select after fork
- **WHEN** the user forked a session with `requestId: "rq_77"`
- **AND** `session_added { session, spawnRequestId: "rq_77" }` arrives for the forked session
- **THEN** the client SHALL navigate to the new (forked) session's URL
- **AND** the parent session's resuming flag SHALL be cleared

#### Scenario: No auto-select for natural sessions
- **WHEN** `session_added { session }` arrives without `spawnRequestId` (e.g. a TUI-spawned session)
- **THEN** the client SHALL NOT change the active route

#### Scenario: Unknown spawnRequestId tolerated
- **WHEN** `session_added { session, spawnRequestId: "rq_unknown" }` arrives but `pendingSpawns` has no matching entry (e.g. timeout already cleared)
- **THEN** the client SHALL NOT throw and SHALL NOT navigate

#### Scenario: Hidden session never auto-navigates
- **WHEN** `session_added { session, hidden: true }` arrives (e.g. an auto-hidden headless worker)
- **THEN** the client SHALL NOT navigate, regardless of whether `spawnRequestId` or the session `cwd` would otherwise match a `pendingSpawns` entry
- **AND** the session SHALL still be added to the session map and rendered in the Hidden tier

#### Scenario: Hidden session does not consume a real spawn's correlation
- **WHEN** a visible session was spawned with `requestId: "rq_99"` (placeholder live in `pendingSpawns`)
- **AND** a headless worker in the SAME `cwd` registers and arrives first as `session_added { session, hidden: true }` with no matching `spawnRequestId`
- **THEN** the `rq_99` `pendingSpawns` entry SHALL remain intact, its timer SHALL NOT be cancelled, and `spawningCwds` SHALL NOT be cleared
- **AND** when the real visible `session_added { session, spawnRequestId: "rq_99" }` later arrives it SHALL still auto-select and clear its placeholder
