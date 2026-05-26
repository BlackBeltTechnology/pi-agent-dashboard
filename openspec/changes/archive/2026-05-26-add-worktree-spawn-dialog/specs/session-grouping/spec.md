## MODIFIED Requirements

### Requirement: Group sessions by directory
The session list SHALL group sessions by their `cwd` value. Sessions with the same `cwd` SHALL appear together under a group header. ALL groups — including single-session groups — SHALL display a folder header. Sessions within each group SHALL be rendered in the order provided by the server's session order for that cwd.

Pinned directory groups SHALL appear first, in the user-defined pinned order. Unpinned directory groups SHALL appear after pinned groups, sorted by most recent session activity (descending). Pinned directories with zero sessions SHALL still appear as groups.

The per-session group-key resolver (`resolveSessionGroupPath`) SHALL apply the following precedence (first match wins):

1. **Explicit pin wins** — if `pathKey(session.cwd)` matches a pinned entry, the session SHALL group under its own cwd.
2. **jj workspace collapse** — else if `session.jjState?.workspaceRoot` is set, the session SHALL group under that workspace root.
3. **Git worktree collapse** — else if `session.gitWorktree?.mainPath` is set, the session SHALL group under the main worktree path.
4. **Default** — else the session SHALL group under its cwd.

Sessions within a group SHALL be additionally cluster-sorted so all rows sharing the same cluster key sit adjacent. The cluster key SHALL be the first non-empty of `session.jjState?.workspaceName`, `session.gitWorktree?.name`, or the empty string (meaning "main checkout cluster"). The empty-key cluster SHALL sort first; remaining keys SHALL sort alphabetically. The existing `sortSessionsByOrder` ranking SHALL apply inside each cluster.

The clustering SHALL NOT introduce visible sub-headers or dividers between clusters — clusters remain a silent ordering of the flat session list within the folder group. (Visible sub-headers are out of scope for this change.)

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
- **WHEN** the server provides an order for a cwd
- **THEN** sessions within that group SHALL be rendered in the server-provided order, with unordered sessions appended by startedAt descending

#### Scenario: Worktree session groups under parent repo
- **WHEN** a session has `cwd = "/repo/.worktrees/feat-x"` and `gitWorktree.mainPath = "/repo"`
- **AND** `/repo` is in the pinned list AND `/repo/.worktrees/feat-x` is not pinned
- **AND** the session has no `jjState`
- **THEN** the session SHALL render inside the `/repo` group

#### Scenario: Explicit pin of worktree path wins
- **WHEN** the user has pinned `/repo/.worktrees/feat-x` AND that pin's pathKey matches the session's cwd
- **THEN** the session SHALL render under its own `/repo/.worktrees/feat-x` group, NOT inside `/repo`

#### Scenario: Both jj workspace and git worktree present
- **WHEN** a session carries both `jjState.workspaceRoot` and `gitWorktree.mainPath`
- **THEN** the session SHALL group under `jjState.workspaceRoot` (jj wins because it is step 2 in precedence)

#### Scenario: Worktree sessions cluster adjacent
- **WHEN** a folder group contains sessions from a main checkout AND from two worktrees `feat-x` and `feat-y`
- **THEN** sessions SHALL be rendered with the main-checkout cluster first, then all `feat-x` sessions adjacent, then all `feat-y` sessions adjacent
- **AND** no visible divider or sub-header SHALL appear between clusters

#### Scenario: Worktree cluster preserves session order within
- **WHEN** the server provides a session order for the folder
- **THEN** the cluster sort SHALL be stable — the server-provided order SHALL be preserved within each cluster
