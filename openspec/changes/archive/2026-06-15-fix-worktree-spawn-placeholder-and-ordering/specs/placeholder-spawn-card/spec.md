## ADDED Requirements

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

#### Scenario: Path normalization across separators and trailing slash
- **WHEN** a pending-spawn entry has `cwd = /repo/.worktrees/feat-x/` (trailing slash) and `session.cwd = /repo/.worktrees/feat-x`
- **THEN** the normalized comparison SHALL treat them as equal and the fallback SHALL clear the entry's `placeholderCwd`
