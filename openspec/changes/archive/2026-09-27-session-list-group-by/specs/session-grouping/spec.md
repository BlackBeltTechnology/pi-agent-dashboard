## MODIFIED Requirements

### Requirement: Group sessions by directory
The session list SHALL group sessions by their `cwd` value. Sessions with the same `cwd` SHALL appear together under a group header. ALL groups — including single-session groups — SHALL display a folder header. Sessions within each group SHALL be rendered in the order provided by the server's session order for that group's resolved key.

Pinned directory groups SHALL appear first, in the user-defined pinned order. Unpinned directory groups SHALL appear after pinned groups, sorted by most recent session activity (descending). Pinned directories with zero sessions SHALL still appear as groups.

The per-session group-key resolver (`resolveSessionGroupPath`) SHALL apply the following precedence (first match wins):

1. **Explicit pin wins** — if `pathKey(session.cwd)` matches a pinned entry, the session SHALL group under its own cwd.
2. **Git worktree collapse** — else if `session.gitWorktree?.mainPath` is set, the session SHALL group under the main worktree path.
3. **Default** — else the session SHALL group under its cwd.

Within a group, session order SHALL be governed by the server-provided session order (status-partitioned per the `session-ordering` capability). When the group's effective group-by mode (per the `session-list-group-by` capability) is `status` or `location`, the group's non-ended sessions SHALL additionally be partitioned into lanes, each lane preserving the relative server order. There SHALL be NO workspace-cluster adjacency constraint: worktree sibling sessions are ordered purely by the flat order list, not forced adjacent. (This removes the prior `clusterByWorkspaceName` ordering; grouping-under-parent collapse — step 2 above — is unchanged.)

#### Scenario: Multiple sessions in same directory
- **WHEN** two or more sessions share the same `cwd`
- **THEN** they SHALL be displayed under a group header showing the directory name

#### Scenario: Single session in a directory
- **WHEN** only one session exists for a given `cwd`
- **THEN** the session SHALL be displayed under a group header showing the directory name (same as multi-session groups), with git info on the group header

#### Scenario: Pinned directories appear first
- **WHEN** both pinned and unpinned directory groups exist
- **THEN** pinned groups SHALL appear above unpinned groups, in the user-defined pinned order

#### Scenario: Unpinned directories sorted by recency
- **WHEN** unpinned directory groups exist
- **THEN** they SHALL be ordered by most recent session activity (descending), after all pinned groups

#### Scenario: Pinned directory with no sessions
- **WHEN** a directory is pinned but has no sessions matching that cwd
- **THEN** a group SHALL still be rendered for that directory, showing zero sessions

#### Scenario: Sessions ordered within group
- **WHEN** the server provides an order for a group's resolved key
- **THEN** sessions within that group SHALL be rendered in the server-provided order (status-partitioned), with unordered sessions appended by startedAt descending

#### Scenario: Sessions ordered within lanes
- **WHEN** a group's effective group-by mode is `status` or `location`
- **THEN** each lane SHALL list its sessions in the relative order of the server-provided order, with unordered sessions appended by startedAt descending

#### Scenario: Worktree session groups under parent repo
- **WHEN** a session has `cwd = "/repo/.worktrees/feat-x"` and `gitWorktree.mainPath = "/repo"`
- **AND** `/repo` is in the pinned list AND `/repo/.worktrees/feat-x` is not pinned
- **THEN** the session SHALL render inside the `/repo` group

#### Scenario: Explicit pin of worktree path wins
- **WHEN** the user has pinned `/repo/.worktrees/feat-x` AND that pin's pathKey matches the session's cwd
- **THEN** the session SHALL render under its own `/repo/.worktrees/feat-x` group, NOT inside `/repo`

#### Scenario: Worktree sessions ordered by flat order, not clustered
- **WHEN** a folder group contains a main-checkout session and sessions from worktrees `feat-x` and `feat-y`, and a `feat-y` session is moved to front
- **THEN** that `feat-y` session SHALL render at the top of its tier, ahead of the main-checkout and `feat-x` sessions
- **AND** no cluster-adjacency rule SHALL reorder it back next to its `feat-y` siblings
