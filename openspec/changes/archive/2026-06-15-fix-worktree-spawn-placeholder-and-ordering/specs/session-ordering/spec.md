## ADDED Requirements

### Requirement: Deferred order-key re-resolution when group identity arrives after register
The server SHALL re-key a session's order entry to its resolved group key when group identity arrives after register.

A worktree (or jj) session's group identity — `gitWorktree.mainPath` /
`jjState.workspaceRoot` — is NOT present on the initial `session_register`; the
bridge sends it shortly after via `git_info_update`. Because
`resolveOrderKey` depends on that identity, a fresh worktree session is first
inserted under its own raw `cwd` key, NOT the parent key the client groups under.

When a later update first establishes (or changes) a session's group identity
such that `resolveOrderKey(session)` resolves to a DIFFERENT key than the one
the session's id currently lives under, the server SHALL re-key the order entry:
remove the id from the stale key (pruning the entry if its list becomes empty),
prepend the id to the FRONT of the resolved key's order list, and broadcast a
single `sessions_reordered { cwd: <resolvedKey>, sessionIds }` (with ids filtered
to sessions whose resolved key equals the resolved key). When the resolved key
equals the current key, the server SHALL make NO mutation and NO broadcast.

Front placement is used because the session is brand-new at this point, matching
the "Auto-place new sessions at the beginning" intent. This makes a freshly
spawned worktree session occupy the top slot of its parent group (the slot its
spawn placeholder held), instead of falling into the unordered bucket and
rendering at the bottom.

#### Scenario: Worktree session re-keyed to parent front when gitWorktree arrives
- **WHEN** a session registers with `cwd = /repo/.worktrees/feat-x` and `gitWorktree` undefined, and is inserted into `sessionOrder["/repo/.worktrees/feat-x"]`
- **AND** a subsequent `git_info_update` sets `gitWorktree.mainPath = /repo` (and `/repo/.worktrees/feat-x` is not pinned)
- **THEN** the id SHALL be removed from `sessionOrder["/repo/.worktrees/feat-x"]` (entry pruned if now empty)
- **AND** the id SHALL be prepended to the FRONT of `sessionOrder["/repo"]`
- **AND** the server SHALL broadcast exactly one `sessions_reordered { cwd: "/repo", ... }` for the transition

#### Scenario: No re-key when gitWorktree present on register
- **WHEN** a (legacy) bridge sends `gitWorktree.mainPath = /repo` on the initial `session_register` so the id is inserted under `/repo` immediately
- **AND** a later `git_info_update` re-asserts the same `gitWorktree`
- **THEN** `resolveOrderKey` equals the current key
- **AND** the server SHALL NOT mutate `sessionOrder` and SHALL NOT broadcast `sessions_reordered` for the transition

#### Scenario: Re-key is idempotent across repeated updates
- **WHEN** the id already lives under the resolved parent key and another `git_info_update` arrives
- **THEN** the server SHALL detect key equality and perform no mutation and no broadcast

#### Scenario: Stale worktree-cwd key pruned
- **WHEN** the only id under `sessionOrder["/repo/.worktrees/feat-x"]` is re-keyed to `/repo`
- **THEN** the empty `sessionOrder["/repo/.worktrees/feat-x"]` entry SHALL be pruned
- **AND** no session SHALL group under that stale key
