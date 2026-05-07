## ADDED Requirements

### Requirement: Placeholder card shown during session spawn
When the user (or programmatic flow) issues a spawn, the system SHALL immediately render a placeholder skeleton card at the top of the target group's session list. The placeholder SHALL display a pulse/loading animation. Placeholders SHALL be keyed by the spawn `requestId` (UUIDv4 minted by the client at dispatch time), NOT by the cwd. Multiple placeholders MAY render simultaneously in the same group when multiple spawns are in-flight for the same cwd.

The client SHALL maintain `pendingSpawns: Map<requestId, { cwd, startedAt, attachProposal? }>` (replacing today's `spawningCwds: Set<cwd>`). Each placeholder card's React key SHALL be the `requestId`.

#### Scenario: User clicks New in a group
- **WHEN** the user clicks the "New" button in a workspace group header
- **THEN** the client SHALL generate a fresh `requestId` and insert into `pendingSpawns`
- **AND** a placeholder card with pulse animation SHALL appear at the top of that group's session list immediately, before any server response

#### Scenario: Placeholder appears above existing sessions
- **WHEN** one or more placeholder cards are rendered for a group
- **THEN** all placeholders SHALL appear before all real session cards in that group

#### Scenario: Multiple placeholders coexist in same cwd
- **WHEN** two `spawn_session` dispatches occur in the same cwd within milliseconds (e.g. programmatic flow or fast double-click escaping the disabled-button guard)
- **THEN** TWO placeholder cards SHALL render in that group's list, each keyed by its distinct `requestId`
- **AND** each SHALL be dismissed independently when its matching `session_added` arrives

### Requirement: New button disabled during spawn
The "New" button in a workspace group header SHALL be disabled while at least one entry in `pendingSpawns` has `cwd` equal to that group's cwd. Other groups' "New" buttons SHALL remain enabled.

#### Scenario: New button disabled for spawning group
- **WHEN** at least one `pendingSpawns` entry has `cwd` matching the group's cwd
- **THEN** that group's "New" button SHALL be disabled (not clickable)
- **AND** "New" buttons for other groups SHALL remain enabled

#### Scenario: New button re-enabled when last placeholder clears
- **WHEN** every `pendingSpawns` entry for that cwd has been removed
- **THEN** the group's "New" button SHALL be re-enabled

### Requirement: Placeholder replaced on session added
When a `session_added` message arrives, the system SHALL clear the matching placeholder using a two-tier correlation strategy. **Tier 1 (preferred):** if the message carries `spawnRequestId` matching an entry in `pendingSpawns`, that entry SHALL be removed, its timeout cancelled, and the client SHALL navigate to the new session's URL. **Tier 2 (legacy fallback):** if no `spawnRequestId` matches but the session's `cwd` or `groupCwd` matches a spawning group's cwd, the placeholder for that group SHALL be removed. The real session card SHALL render in the placeholder's visual position. The server SHALL ensure the new session is placed at the front of the session order for the group's cwd (using `groupCwd` when set) so the client renders it at the top.

#### Scenario: session_added with matching spawnRequestId replaces placeholder
- **WHEN** a `session_added { session, spawnRequestId: "rq_42" }` message arrives
- **AND** `pendingSpawns` contains an entry with key `rq_42`
- **THEN** the placeholder for `rq_42` SHALL be removed
- **AND** the client SHALL navigate to `/session/<session.id>`
- **AND** the real session card SHALL render in the group's list

#### Scenario: Session added replaces placeholder via cwd fallback
- **WHEN** a `session_added` message arrives without a matching `spawnRequestId` but `session.cwd` matches a spawning group's cwd
- **THEN** the placeholder card for that group SHALL be removed
- **AND** the real session card SHALL render at the top of the group's session list

#### Scenario: Worktree session replaces placeholder via groupCwd
- **WHEN** a `session_added` arrives for a worktree-spawned session where `session.cwd` is a worktree path and `session.groupCwd` matches the spawning group's cwd
- **THEN** the placeholder card for the spawning group SHALL be removed
- **AND** the real session card SHALL render at the top of the spawning group's session list (where the placeholder was)

#### Scenario: Sequential multi-spawn places most recent at top
- **WHEN** the user spawns three sessions for the same group in sequence: first A, then B, then C (each completing before the next starts)
- **THEN** each session card SHALL replace its corresponding placeholder in-place
- **AND** after all three register, the final rendered order SHALL be C at top, then B, then A (most recently spawned at top)

#### Scenario: session_added without spawnRequestId is treated as natural arrival
- **WHEN** `session_added { session }` arrives without a `spawnRequestId` (e.g. TUI-spawned session)
- **THEN** no placeholder SHALL be removed (none was matched)
- **AND** no auto-navigation SHALL occur
- **AND** the new session SHALL still render in its group via the normal pipeline

#### Scenario: session_added with unknown spawnRequestId
- **WHEN** `session_added { session, spawnRequestId: "rq_unknown" }` arrives but `pendingSpawns` has no matching entry (e.g. timeout already cleared)
- **THEN** the client SHALL render the session normally without crashing or navigating

### Requirement: Placeholder removed on spawn failure matching requestId
When a `spawn_result` message arrives with `success: false`, the system SHALL look up the `requestId` (when echoed) in `pendingSpawns` and remove that specific placeholder. When `requestId` is absent (legacy server), the system SHALL fall back to the previous cwd-based behavior: remove the FIRST placeholder for that cwd. An error toast SHALL be displayed. A `spawn_error` message arriving for the same cwd SHALL provide rich detail (code, stderr, reasons).

#### Scenario: spawn_result failure with requestId removes specific placeholder
- **WHEN** `spawn_result { cwd, success: false, requestId: "rq_42", message }` arrives
- **THEN** the placeholder keyed by `rq_42` SHALL be removed
- **AND** an error toast SHALL be displayed
- **AND** other placeholders in the same cwd SHALL remain unaffected

#### Scenario: spawn_result failure without requestId falls back to cwd
- **WHEN** `spawn_result { cwd, success: false, message }` arrives without `requestId` (legacy server)
- **AND** at least one placeholder exists for that cwd
- **THEN** ONE placeholder for that cwd SHALL be removed (oldest by `startedAt`)
- **AND** an error toast SHALL be displayed

### Requirement: Safety timeout for stuck placeholders
Each entry in `pendingSpawns` SHALL have an associated timer (default 30 seconds, aligned with `spawn-register-watchdog` config). If neither `session_added` matching `requestId` nor a failed `spawn_result` clears the entry within the timeout, the system SHALL automatically remove the entry. The timer SHALL be per-`requestId` (not per-cwd).

#### Scenario: Timeout clears specific placeholder
- **WHEN** 30 seconds elapse after `pendingSpawns` entry `rq_x` was created
- **AND** the entry has not been cleared
- **THEN** that placeholder SHALL be automatically removed
- **AND** the "New" button SHALL be re-enabled if no other entries remain for that cwd
