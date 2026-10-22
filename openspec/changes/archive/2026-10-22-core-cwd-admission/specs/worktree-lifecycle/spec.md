## MODIFIED Requirements

### Requirement: Bulk removal SHALL report per-item outcomes

`POST /api/git/worktree/remove-batch` SHALL accept an array of removal requests
and return one result per input item, in input order. The batch SHALL NOT abort
on the first failure, so a client can escalate the failed rows individually
(re-post with `force`, or shut sessions down first) without re-running the
successful ones.

Each item result SHALL carry `code: RemoveCode | "active_sessions" |
"cwd_invalid" | "cwd_unknown" | "cwd-admission-unavailable" | "is_main_worktree" |
"main_checkout_unresolved"`,
and SHALL carry `sessionIds: string[]` on the `active_sessions` case. The union is wider than `RemoveCode` deliberately:
`active_sessions` is a route-level 409 condition and is not a member of
`RemoveCode`, so without the widening the per-row escalation this requirement
exists to enable would be unimplementable. Items SHALL be admitted sequentially,
one admission per distinct `cwd` per request, under a whole-batch admission
budget of 10 seconds. An item whose admission is indeterminate, or is not yet
decided when the budget is exhausted, SHALL report `cwd-admission-unavailable`;
the batch response SHALL stay HTTP 200 without a `Retry-After` header.

#### Scenario: Partial failure does not abort the batch
- **WHEN** a batch of 3 removals is posted and the 2nd worktree is dirty
- **THEN** the response SHALL contain 3 results in input order
- **AND** items 1 and 3 SHALL report `ok`
- **AND** item 2 SHALL report `dirty_worktree`
- **AND** worktrees 1 and 3 SHALL be removed on disk

#### Scenario: Per-item containment
- **WHEN** any item in the batch carries a `cwd` that fails `validateCwd` (including cwd admission), or resolves outside the main worktree
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

#### Scenario: Indeterminate admission is reported per item
- **WHEN** one item of a 3-item batch has an indeterminate cwd admission
- **THEN** that item SHALL report `cwd-admission-unavailable`
- **AND** the other two items SHALL still be processed
- **AND** the response SHALL be HTTP 200 without `Retry-After`

#### Scenario: Exhausted admission budget
- **WHEN** a batch's admissions have used the 10-second budget before every item is decided
- **THEN** every undecided item SHALL report `cwd-admission-unavailable`
- **AND** no git command SHALL run for those items

### Requirement: Worktree removal SHALL be reachable without a session

The dashboard SHALL expose a worktree-removal entry point that does not require a
live or ended session attached to the worktree. A `manage-worktrees` item SHALL
be registered in the `directory` group of `FOLDER_MENU_GROUPS`, opening the
shared `WorktreeList` in `manage` mode.

The server side requires no new capability for this: `POST
/api/git/worktree/remove` accepts any admitted `cwd` (see `core-cwd-admission`),
which includes every linked worktree of a repository whose main checkout is a
session cwd or a pinned directory, and `CloseWorktreeDialog` is already
`cwd`-driven. Note the endpoint consults the session manager twice —
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

#### Scenario: Worktree of a repository known only through a sibling worktree
- **WHEN** the only known folder of a repository is a session inside linked worktree A, and the user removes linked worktree B from the manage surface
- **THEN** the remove SHALL be refused with `cwd_unknown` and a hint to pin the repository
- **AND** the dialog SHALL NOT report the worktree as removed or already gone

#### Scenario: Sessionless worktree vanished before confirm
- **WHEN** a sessionless linked worktree of a pinned repository is deleted outside the dashboard after the manage list loaded, and the user confirms its removal
- **THEN** the remove SHALL be refused with `cwd_unknown`
- **AND** the dialog SHALL show the error instead of closing as removed

### Requirement: Rows whose directory is gone SHALL route to prune, not remove

`validateCwd` rejects a nonexistent path before any git command runs (`400
cwd_invalid` for a known path, `400 cwd_unknown` for an unknown one), so `remove` can never clear a registration whose directory has
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
