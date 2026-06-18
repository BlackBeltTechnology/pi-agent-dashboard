## ADDED Requirements

### Requirement: Placeholder card shown during session spawn
When the user (or programmatic flow) issues a spawn, the system SHALL immediately render a placeholder skeleton card at the top of the target group's session list. The placeholder SHALL display a pulse/loading animation. Placeholders SHALL be keyed by the spawn `requestId` (UUIDv4 minted by the client at dispatch time), NOT by the cwd. Multiple placeholders MAY render simultaneously in the same group when multiple spawns are in-flight for the same cwd.

The client SHALL maintain `pendingSpawns: Map<requestId, { cwd, placeholderCwd, startedAt, attachProposal? }>`. Each placeholder card's React key SHALL be the `requestId`.

The placeholder SHALL render in the group whose cwd equals the entry's `placeholderCwd` — the cwd of the folder group that will HOST the spawned session once it registers. `placeholderCwd` SHALL be resolved by the same session-grouping precedence the real session card uses (`pin > jjState.workspaceRoot > gitWorktree.mainPath > cwd`). For a normal spawn `placeholderCwd` SHALL equal the spawn `cwd`. For a worktree spawn `placeholderCwd` SHALL equal the PARENT repo path (where the worktree session groups), NOT the worktree path passed as the spawn `cwd`.

#### Scenario: User clicks New in a group
- **WHEN** the user clicks the "New" button in a workspace group header
- **THEN** the client SHALL generate a fresh `requestId` and insert into `pendingSpawns` with `placeholderCwd` equal to the group cwd
- **AND** a placeholder card with pulse animation SHALL appear at the top of that group's session list immediately, before any server response

#### Scenario: Worktree spawn renders placeholder under parent group
- **WHEN** a worktree spawn is issued for parent repo `/repo` producing worktree path `/repo/.worktrees/feat-x`
- **THEN** the `pendingSpawns` entry SHALL carry `cwd = /repo/.worktrees/feat-x` AND `placeholderCwd = /repo`
- **AND** the placeholder card SHALL render in the `/repo` folder group (where the worktree session will land), NOT in any group keyed by the worktree path
- **AND** the worktree path SHALL NOT cause a standalone placeholder in a non-existent worktree-path group

#### Scenario: Placeholder appears above existing sessions
- **WHEN** one or more placeholder cards are rendered for a group
- **THEN** all placeholders SHALL appear before all real session cards in that group

#### Scenario: Multiple placeholders coexist in same cwd
- **WHEN** two `spawn_session` dispatches occur with the same `placeholderCwd` within milliseconds (e.g. programmatic flow or fast double-click escaping the disabled-button guard)
- **THEN** TWO placeholder cards SHALL render in that group's list, each keyed by its distinct `requestId`
- **AND** each SHALL be dismissed independently when its matching `session_added` arrives

### Requirement: New button disabled during spawn
The "New" button in a workspace group header SHALL be disabled while at least one entry in `pendingSpawns` has `placeholderCwd` equal to that group's cwd. Other groups' "New" buttons SHALL remain enabled.

#### Scenario: New button disabled for spawning group
- **WHEN** at least one `pendingSpawns` entry has `placeholderCwd` matching the group's cwd
- **THEN** that group's "New" button SHALL be disabled (not clickable)
- **AND** "New" buttons for other groups SHALL remain enabled

#### Scenario: Parent New button disabled during worktree spawn
- **WHEN** a worktree spawn is in-flight with `placeholderCwd = /repo`
- **THEN** the `/repo` group's "New" button SHALL be disabled for the full window (from dialog submit through register)
- **AND** the button SHALL be re-enabled once the worktree session registers or the spawn fails/times out

#### Scenario: New button re-enabled when last placeholder clears
- **WHEN** every `pendingSpawns` entry for that `placeholderCwd` has been removed
- **THEN** the group's "New" button SHALL be re-enabled

### Requirement: Placeholder replaced on session added matching requestId
When a `session_added` message arrives carrying `spawnRequestId` matching an entry in `pendingSpawns`, the system SHALL: (a) remove that entry from `pendingSpawns` (clearing the placeholder keyed by the entry's `placeholderCwd`), (b) cancel any associated timeout timer, (c) navigate to the new session's URL. The real session card SHALL render in its place via the normal session rendering pipeline.

When `msg.session.hidden === true`, the system SHALL NOT clear any placeholder, SHALL NOT cancel any timeout timer, and SHALL NOT navigate, even if `spawnRequestId` matches a `pendingSpawns` entry. A hidden session is never the visible spawn a placeholder represents.

#### Scenario: session_added with matching spawnRequestId replaces placeholder
- **WHEN** a `session_added { session, spawnRequestId: "rq_42" }` message arrives
- **AND** `pendingSpawns` contains an entry with key `rq_42`
- **THEN** the placeholder for `rq_42` SHALL be removed using the entry's `placeholderCwd`
- **AND** the client SHALL navigate to `/session/<session.id>`
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

### Requirement: Placeholder removed on spawn failure matching requestId
When a `spawn_result` message arrives with `success: false`, the system SHALL look up the `requestId` (when echoed) in `pendingSpawns` and remove that specific placeholder using its `placeholderCwd`. When `requestId` is absent (legacy server), the system SHALL fall back to removing the FIRST placeholder whose `placeholderCwd` matches the failure cwd. An error toast SHALL be displayed.

#### Scenario: spawn_result failure with requestId removes specific placeholder
- **WHEN** `spawn_result { cwd, success: false, requestId: "rq_42", message }` arrives
- **THEN** the placeholder keyed by `rq_42` SHALL be removed using its `placeholderCwd`
- **AND** an error toast SHALL be displayed
- **AND** other placeholders in the same group SHALL remain unaffected

### Requirement: Safety timeout for stuck placeholders
Each entry in `pendingSpawns` SHALL have an associated timer (default 30 seconds, aligned with `spawn-register-watchdog` config). If neither `session_added` matching `requestId` nor a failed `spawn_result` clears the entry within the timeout, the system SHALL automatically remove the entry. The timer SHALL be per-`requestId` (not per-cwd).

#### Scenario: Timeout clears specific placeholder
- **WHEN** 30 seconds elapse after `pendingSpawns` entry `rq_x` was created
- **AND** the entry has not been cleared
- **THEN** that placeholder SHALL be automatically removed
- **AND** the "New" button SHALL be re-enabled if no other entries remain for that cwd

### Requirement: Fallback placeholder clear when spawnRequestId is absent
The client SHALL clear a worktree spawn placeholder via a cwd-based fallback when `spawnRequestId` correlation misses.

When a `session_added` message arrives WITHOUT a `spawnRequestId` (or whose
`spawnRequestId` matches no `pendingSpawns` entry), AND no placeholder is keyed
by the session's own `cwd`, the client SHALL scan `pendingSpawns` for a
`kind: "spawn"` entry whose tracked spawn `cwd` equals the new session's `cwd`
(path-normalized, trailing-slash and case insensitive per platform). On the
first match the client SHALL: (a) remove that entry from `pendingSpawns` and
clear the placeholder keyed by the entry's `placeholderCwd`, (b) cancel its
timeout timer, (c) navigate to the new session's URL. This is the worktree-aware
fallback (Tier 2.5): worktree placeholders are keyed by the PARENT cwd, so the
session's own cwd never matches the placeholder key, and without this fallback a
worktree placeholder is orphaned whenever the `spawnRequestId` correlation
misses.

The fallback SHALL only fire after exact `spawnRequestId` correlation and any
cwd-equals-session-cwd match have both missed, SHALL match at most one entry
(first-match-wins), and SHALL NOT fire for `kind: "resume"` or fork entries.

When `msg.session.hidden === true`, the fallback SHALL NOT run at all — a hidden
session SHALL NOT clear any placeholder, cancel any timer, or navigate. This
prevents a headless worker that shares its parent session's `cwd` from consuming
the cwd-keyed correlation entry that belongs to the real visible spawn.

#### Scenario: Worktree session_added without spawnRequestId clears parent placeholder
- **WHEN** `session_added { session }` arrives with `session.cwd = /repo/.worktrees/feat-x` and NO `spawnRequestId` matches `pendingSpawns`
- **AND** `pendingSpawns` contains a `kind: "spawn"` entry with `cwd = /repo/.worktrees/feat-x` and `placeholderCwd = /repo`
- **THEN** that entry SHALL be removed and the placeholder keyed by `/repo` SHALL be cleared
- **AND** its timeout timer SHALL be cancelled
- **AND** the client SHALL navigate to `/session/<session.id>`

#### Scenario: Plain spawn still cleared by cwd match, not double-handled
- **WHEN** `session_added { session }` arrives with `session.cwd = /repo` and a placeholder keyed by `/repo` exists (plain spawn, `placeholderCwd === cwd`)
- **THEN** the existing cwd-equals-session-cwd path SHALL clear it
- **AND** the Tier 2.5 fallback SHALL NOT run (it only runs when that match misses)

#### Scenario: Fallback ignores resume and fork entries
- **WHEN** `session_added` arrives with no matching `spawnRequestId` and the only `pendingSpawns` entry sharing the session's cwd has `kind: "resume"`
- **THEN** the fallback SHALL NOT clear it and SHALL NOT navigate

#### Scenario: Hidden worker sharing parent cwd does not trigger the fallback
- **WHEN** `session_added { session, hidden: true }` arrives with no matching `spawnRequestId` and a `kind: "spawn"` `pendingSpawns` entry exists whose `cwd` equals the hidden session's `cwd` (the parent's cwd)
- **THEN** the fallback SHALL NOT remove that entry, SHALL NOT clear its placeholder, SHALL NOT cancel its timer, and SHALL NOT navigate
- **AND** the entry SHALL remain available to correlate the real visible session

#### Scenario: Path normalization across separators and trailing slash
- **WHEN** a pending-spawn entry has `cwd = /repo/.worktrees/feat-x/` (trailing slash) and `session.cwd = /repo/.worktrees/feat-x`
- **THEN** the normalized comparison SHALL treat them as equal and the fallback SHALL clear the entry's `placeholderCwd`
