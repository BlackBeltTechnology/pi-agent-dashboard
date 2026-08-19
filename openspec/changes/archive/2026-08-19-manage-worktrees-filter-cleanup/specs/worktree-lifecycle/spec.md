## ADDED Requirements

### Requirement: Worktree removal SHALL be reachable without a session

The dashboard SHALL expose a worktree-removal entry point that does not require a
live or ended session attached to the worktree. A `manage-worktrees` item SHALL
be registered in the `directory` group of `FOLDER_MENU_GROUPS`, opening the
shared `WorktreeList` in `manage` mode.

The server side requires no new capability for this: `POST
/api/git/worktree/remove` already accepts any `cwd`, and `CloseWorktreeDialog`
is already `cwd`-driven. Note the endpoint consults the session manager twice —
for the `409 active_sessions` guard, and to stamp `cwdMissing` on success.

#### Scenario: Removing a worktree with no session
- **WHEN** the user opens the manage surface and activates `✕` on a worktree that has no session in the session map
- **THEN** `CloseWorktreeDialog` SHALL open for that `cwd`
- **AND** confirming SHALL `POST /api/git/worktree/remove` and remove the worktree
- **AND** no `active_sessions` guard SHALL fire

#### Scenario: Existing escalations are inherited unchanged
- **WHEN** removal from the manage surface returns `409 active_sessions`
- **THEN** the dialog SHALL render the session list and the "End N sessions and remove worktree" path exactly as it does when opened from `WorktreeActionsMenu`
- **AND** a `dirty_worktree` or `branch_not_merged` response SHALL auto-tick the `--force` checkbox as it does today

### Requirement: Remove SHALL support deleting the worktree's branch

`removeWorktree` SHALL accept `deleteBranch?: boolean`, mirroring the option
`mergeWorktree` already carries. When set and the removal succeeds, the server
SHALL delete the entry's branch with `git branch -d` run in the main worktree.
The branch name SHALL be captured **before** the removal, since it cannot be
recovered once the worktree is gone.

`-d` (not `-D`) is the required spelling: an unmerged branch SHALL be refused,
not force-deleted, because removal from a cleanup list is a bulk gesture and a
force-delete of unmerged work is unrecoverable.

The outcome SHALL be reported as `branchDeleted: boolean` plus
`branchDeleteCode: "deleted" | "unmerged" | "no_branch" | "branch_gone" |
"delete_failed"`. No value in this set SHALL collide with a `RemoveCode` value,
so that no client predicate can match across the two namespaces by accident —
which is why the generic failure is spelled `delete_failed`, not `git_failed`.

#### Scenario: Merged branch is deleted
- **WHEN** `remove` is called with `deleteBranch: true` on a worktree whose branch is merged into its base
- **THEN** the worktree SHALL be removed and the branch SHALL be deleted
- **AND** the response SHALL report `branchDeleted: true`

#### Scenario: Unmerged branch refuses deletion without failing the removal
- **WHEN** `remove` is called with `deleteBranch: true` on a worktree whose branch is not merged
- **THEN** the worktree SHALL still be removed
- **AND** the response SHALL report `branchDeleted: false` with a stable `branchDeleteCode`
- **AND** the branch SHALL still exist

#### Scenario: Branch-deletion outcome does not collide with RemoveCode
- **WHEN** a removal succeeds but the branch deletion is refused
- **THEN** the top-level removal result SHALL remain a success and SHALL NOT carry the `RemoveCode` value `branch_not_merged`
- **AND** the branch outcome SHALL be reported in the separate `branchDeleteCode` field
- **AND** a client keyed on `RemoveCode` SHALL NOT auto-tick `--force` or retry the removal

#### Scenario: Entries with no branch skip deletion
- **WHEN** `remove` is called with `deleteBranch: true` on an entry whose `branch` is `null` (either `detached: true` or `bare: true`)
- **THEN** the worktree SHALL be removed and `branchDeleted: false` SHALL be reported without invoking `git branch`

### Requirement: Bulk removal SHALL report per-item outcomes

`POST /api/git/worktree/remove-batch` SHALL accept an array of removal requests
and return one result per input item, in input order. The batch SHALL NOT abort
on the first failure, so a client can escalate the failed rows individually
(re-post with `force`, or shut sessions down first) without re-running the
successful ones.

Each item result SHALL carry `code: RemoveCode | "active_sessions" |
"cwd_invalid" | "is_main_worktree"`, and SHALL carry `sessionIds: string[]` on
the `active_sessions` case. The union is wider than `RemoveCode` deliberately:
`active_sessions` is a route-level 409 condition and is not a member of
`RemoveCode`, so without the widening the per-row escalation this requirement
exists to enable would be unimplementable.

#### Scenario: Partial failure does not abort the batch
- **WHEN** a batch of 3 removals is posted and the 2nd worktree is dirty
- **THEN** the response SHALL contain 3 results in input order
- **AND** items 1 and 3 SHALL report `ok`
- **AND** item 2 SHALL report `dirty_worktree`
- **AND** worktrees 1 and 3 SHALL be removed on disk

#### Scenario: Per-item containment
- **WHEN** any item in the batch carries a `cwd` that fails `validateCwd`, or resolves outside the main worktree
- **THEN** that item SHALL be rejected with the validation code
- **AND** the remaining items SHALL still be processed

#### Scenario: Main worktree is rejected as an item
- **WHEN** a batch item names the main worktree's path
- **THEN** that item SHALL report a failure code and the main worktree SHALL NOT be removed

#### Scenario: Batch replicates the cwdMissing broadcast
- **WHEN** a batch removal succeeds for an item that has sessions registered under its path
- **THEN** every such session SHALL be updated with `cwdMissing: true`
- **AND** a `sessionUpdated` broadcast SHALL be emitted for each, exactly as the single-item endpoint does

#### Scenario: Oversized batches are rejected
- **WHEN** a batch is posted whose item count exceeds the documented cap
- **THEN** the request SHALL be rejected with a stable code
- **AND** no git command SHALL run

#### Scenario: A blocked item reports its own sessions
- **WHEN** one batch item's path contains active sessions and `force` is not set for it
- **THEN** that item SHALL report `active_sessions` with its own `sessionIds`
- **AND** the remaining items SHALL still be processed

### Requirement: Stale worktree registrations SHALL be prunable

`POST /api/git/worktree/prune` SHALL run `git worktree prune` in the resolved
main worktree, clearing registrations whose directory no longer exists.

#### Scenario: Prune clears a vanished registration
- **WHEN** a registered worktree's directory has been deleted outside git and `prune` is called
- **THEN** the registration SHALL be removed
- **AND** the response SHALL report the count of pruned entries

#### Scenario: Prune is a no-op when every directory exists
- **WHEN** every registered worktree's directory exists on disk and `prune` is called
- **THEN** the call SHALL succeed reporting 0 pruned entries
- **AND** no registration SHALL be removed

### Requirement: Rows whose directory is gone SHALL route to prune, not remove

`validateCwd` rejects a nonexistent path with `400 cwd_invalid` before any git
command runs, so `remove` can never clear a registration whose directory has
vanished. Because those registrations are exactly the abandoned entries the
manage surface exists to clear, `GET /api/git/worktrees` SHALL report per-entry
directory existence and the list SHALL route such rows to `prune`.

#### Scenario: Worktree list reports directory existence
- **WHEN** `GET /api/git/worktrees` is called and one registration's directory has been deleted outside git
- **THEN** that entry SHALL be reported with `exists: false`
- **AND** every entry whose directory is present SHALL be reported with `exists: true`

#### Scenario: A missing row offers prune instead of remove
- **WHEN** the manage surface renders an entry with `exists: false`
- **THEN** the row SHALL NOT offer the `✕` remove control
- **AND** the row SHALL be excluded from batch selection
- **AND** the row SHALL offer the prune affordance instead
- **AND** the affordance SHALL convey that prune is repo-global, clearing every stale registration rather than only that row

#### Scenario: Absent existence information means present
- **WHEN** the client receives entries from a server that does not report `exists`
- **THEN** every row SHALL be treated as present
- **AND** remove controls SHALL remain enabled

## MODIFIED Requirements

### Requirement: Remove worktree endpoint
The server SHALL expose `POST /api/git/worktree/remove` (localhost-only) accepting `{ cwd: string, force?: boolean, deleteBranch?: boolean }`. The endpoint SHALL refuse when one or more active pi sessions have their `cwd` inside the target path, returning `{ ok: false, code: "active_sessions", sessionIds: string[] }`. It SHALL reject the main worktree explicitly with `is_main_worktree` rather than relying on git's error, which maps to `git_failed` / HTTP 500. When safe, it SHALL run `git worktree remove [--force] <cwd>` from the parent repository and stamp `cwdMissing: true` on every session whose cwd is inside the removed path.

On a successful `git worktree remove`, the endpoint SHALL leave no residual physical directory at the worktree path. Because a knowledge-base extension may hold the checkout's SQLite index open in WAL mode, the server SHALL cause open kb DB handles for the removed cwd to be released (checkpointed + closed) before or atomically with the git removal, so no live write recreates `.pi/dashboard/kb/{index.db,-wal,-shm}` after git deletes the directory. If a residual directory nonetheless survives on disk after git reports success, the server SHALL remove it — guarded so the removed path's realpath is inside the parent repository's `.worktrees/` subtree and is never the main checkout. The sweep SHALL run only on git-confirmed removal, never on a git failure.

#### Scenario: Active sessions block removal
- **WHEN** `POST /api/git/worktree/remove` is called with `cwd` containing 2 active sessions
- **THEN** the response SHALL be `{ success: false, error: "active_sessions", sessionIds: ["<id1>","<id2>"] }` with HTTP 409

#### Scenario: Clean worktree removed successfully
- **WHEN** the target worktree has no active sessions, no uncommitted changes, and no unmerged commits
- **THEN** `git worktree remove <cwd>` SHALL succeed and the response SHALL be `{ success: true, data: { removed: true, branchDeleted: false } }`
- **AND** every ended session whose `cwd` was inside the removed path SHALL receive a `session_updated` with `cwdMissing: true`

#### Scenario: Main worktree is rejected cleanly
- **WHEN** `POST /api/git/worktree/remove` is called with the main worktree's path
- **THEN** the response SHALL be a failure carrying `is_main_worktree`
- **AND** no `git worktree remove` SHALL run

#### Scenario: No residual directory after removal
- **WHEN** a worktree is removed successfully and a kb index existed at `<cwd>/.pi/dashboard/kb/index.db`
- **THEN** open kb DB handles for that cwd SHALL be released so the directory is not recreated
- **AND** no directory (no `.pi/` residue, no `-wal`/`-shm` sidecars) SHALL remain at the worktree path

#### Scenario: Sweep is confined to the worktrees subtree
- **WHEN** the resolved worktree path is not inside the parent repository's `.worktrees/` subtree, or equals the main checkout
- **THEN** the residual-dir sweep SHALL NOT run
- **AND** no directory outside `.worktrees/` SHALL be deleted

#### Scenario: No sweep on git failure
- **WHEN** `git worktree remove` fails (dirty / unmerged / spawn error) without `--force`
- **THEN** the worktree directory SHALL be left intact and the residual-dir sweep SHALL NOT run

#### Scenario: Server logs every remove call
- **WHEN** `POST /api/git/worktree/remove` passes cwd validation
- **THEN** the server SHALL emit a single log line of the form `[git-routes] worktree/remove cwd=<path> force=<bool> → <ok|fail:<code>>` to `~/.pi/dashboard/server.log` covering both success and failure outcomes
- **AND** this breadcrumb SHALL exist independent of fastify's default request logging so failed clicks can be diagnosed from the log alone

#### Scenario: Dirty worktree refused without --force
- **WHEN** the worktree has uncommitted changes and `force` is omitted or `false`
- **THEN** the response SHALL be `{ success: false, error: "dirty_worktree", stderr: "<git output>" }` with HTTP 409

#### Scenario: Branch not merged refused without --force
- **WHEN** removing would orphan unmerged commits and `force` is omitted
- **THEN** the response SHALL be `{ success: false, error: "branch_not_merged", stderr: "<git output>" }` with HTTP 409

#### Scenario: --force overrides dirty + unmerged guards
- **WHEN** `force: true` is supplied
- **THEN** `git worktree remove --force <cwd>` SHALL run regardless of dirty / unmerged state
