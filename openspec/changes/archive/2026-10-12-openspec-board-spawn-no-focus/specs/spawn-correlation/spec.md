## MODIFIED Requirements

### Requirement: Client auto-selects newly registered session by requestId match
The client `useMessageHandler.ts` SHALL, on receipt of `session_added`, look up `msg.spawnRequestId` in its `pendingSpawns` map. If found, the client SHALL: (a) remove the entry from `pendingSpawns`, (b) navigate to `/session/<msg.session.id>`, (c) cancel the spawn-timeout timer for that requestId. If `spawnRequestId` is absent or unknown, the client SHALL NOT auto-navigate (existing behavior preserved for natural session arrivals).

A pending spawn MAY be recorded with a "no focus" intent (e.g. a spawn initiated from the OpenSpec board). When a non-hidden, non-reconciled `session_added` correlates to a `pendingSpawns` entry that carries the "no focus" intent, the client SHALL perform the same correlation cleanup it performs for a default spawn (remove the entry and clear the spawning placeholder for the entry's group cwd, i.e. `placeholderCwd` when set, else `cwd`) but SHALL NOT navigate. This applies to the exact `spawnRequestId` match and to every cwd-based fallback match used when `spawnRequestId` is absent. A cwd-based fallback match SHALL withhold navigation only when at least one pending `spawn`-kind entry matches that session cwd and every such matching entry carries the "no focus" intent; when the matching entries are mixed, or none match, the client SHALL behave as for a default spawn, so the intent SHALL NOT suppress navigation for any other pending spawn. The intent travels with the spawn: it SHALL be honored regardless of which route is active when `session_added` arrives. A reconciled `session_added` keeps its existing behavior (never navigates; consumes correlation state only on an exact `spawnRequestId` match). A pending spawn recorded without the intent keeps the default auto-select behavior. This exception governs every requirement or scenario in this capability that describes the client navigating to a correlated session.

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

#### Scenario: No-focus spawn clears correlation without navigating
- **WHEN** the user spawned a session with `requestId: "rq_50"` recorded with the "no focus" intent
- **AND** `session_added { session, spawnRequestId: "rq_50" }` arrives
- **THEN** the client SHALL NOT change the active route
- **AND** the `rq_50` entry SHALL be removed from `pendingSpawns` and its placeholder card SHALL be removed

#### Scenario: No-focus worktree spawn matched by cwd fallback does not navigate
- **WHEN** a worktree session was spawned with the "no focus" intent, its placeholder keyed by the parent repo cwd
- **AND** `session_added { session }` arrives for the worktree cwd without a `spawnRequestId`
- **AND** the client correlates it to that pending entry by cwd
- **THEN** the client SHALL clear the parent-cwd placeholder and remove the entry
- **AND** the client SHALL NOT change the active route

#### Scenario: No-focus intent is honored after the user leaves the originating view
- **WHEN** a spawn was recorded with the "no focus" intent
- **AND** the user navigated elsewhere before its `session_added` arrived
- **THEN** the client SHALL NOT navigate to the new session when it arrives

#### Scenario: No-focus intent does not leak to other spawns
- **WHEN** a "no focus" spawn `rq_60` and a default spawn `rq_61` are both pending
- **AND** `session_added { session, spawnRequestId: "rq_61" }` arrives
- **THEN** the client SHALL navigate to that session's URL
- **AND** the `rq_60` entry SHALL remain in `pendingSpawns`

#### Scenario: Mixed fallback match still focuses
- **WHEN** a "no focus" spawn and a default spawn are both pending for the same cwd
- **AND** `session_added { session }` arrives for that cwd without a `spawnRequestId`
- **THEN** the client SHALL navigate to that session's URL

#### Scenario: Hidden session never auto-navigates
- **WHEN** `session_added { session, hidden: true }` arrives (e.g. an auto-hidden headless worker)
- **THEN** the client SHALL NOT navigate, regardless of whether `spawnRequestId` or the session `cwd` would otherwise match a `pendingSpawns` entry
- **AND** the session SHALL still be added to the session map and rendered in the Hidden tier

#### Scenario: Hidden session does not consume a real spawn's correlation
- **WHEN** a visible session was spawned with `requestId: "rq_99"` (placeholder live in `pendingSpawns`)
- **AND** a headless worker in the SAME `cwd` registers and arrives first as `session_added { session, hidden: true }` with no matching `spawnRequestId`
- **THEN** the `rq_99` `pendingSpawns` entry SHALL remain intact, its timer SHALL NOT be cancelled, and `spawningCwds` SHALL NOT be cleared
- **AND** when the real visible `session_added { session, spawnRequestId: "rq_99" }` later arrives it SHALL still auto-select and clear its placeholder
