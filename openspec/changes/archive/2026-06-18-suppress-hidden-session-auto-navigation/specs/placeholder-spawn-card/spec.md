## MODIFIED Requirements

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
