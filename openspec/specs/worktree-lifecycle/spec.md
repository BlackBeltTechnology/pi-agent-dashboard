# Worktree Lifecycle

## Purpose

Lifecycle actions for git worktree sessions surfaced in the dashboard. Covers remove / merge / push / open-PR endpoints, a diff-stat preview endpoint, the `WorktreeActionsMenu` component rendered inside the WORKSPACE subcard, and the `CloseWorktreeDialog` active-session guard. Endpoints are localhost-gated and validate cwd via realpath. PR action is gated on `gh` resolvability.
## Requirements
### Requirement: Remove worktree endpoint
The server SHALL expose `POST /api/git/worktree/remove` (localhost-only) accepting `{ cwd: string, force?: boolean }`. The endpoint SHALL refuse when one or more active pi sessions have their `cwd` inside the target path, returning `{ ok: false, code: "active_sessions", sessionIds: string[] }`. When safe, it SHALL run `git worktree remove [--force] <cwd>` from the parent repository and stamp `cwdMissing: true` on every session whose cwd is inside the removed path.

On a successful `git worktree remove`, the endpoint SHALL leave no residual physical directory at the worktree path. Because a knowledge-base extension may hold the checkout's SQLite index open in WAL mode, the server SHALL cause open kb DB handles for the removed cwd to be released (checkpointed + closed) before or atomically with the git removal, so no live write recreates `.pi/dashboard/kb/{index.db,-wal,-shm}` after git deletes the directory. If a residual directory nonetheless survives on disk after git reports success, the server SHALL remove it — guarded so the removed path's realpath is inside the parent repository's `.worktrees/` subtree and is never the main checkout. The sweep SHALL run only on git-confirmed removal, never on a git failure.

#### Scenario: Active sessions block removal
- **WHEN** `POST /api/git/worktree/remove` is called with `cwd` containing 2 active sessions
- **THEN** the response SHALL be `{ success: false, error: "active_sessions", sessionIds: ["<id1>","<id2>"] }` with HTTP 409

#### Scenario: Clean worktree removed successfully
- **WHEN** the target worktree has no active sessions, no uncommitted changes, and no unmerged commits
- **THEN** `git worktree remove <cwd>` SHALL succeed and the response SHALL be `{ success: true, data: { removed: true } }`
- **AND** every ended session whose `cwd` was inside the removed path SHALL receive a `session_updated` with `cwdMissing: true`

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

### Requirement: Merge worktree endpoint
The server SHALL expose `POST /api/git/worktree/merge` accepting `{ cwd: string, deleteBranch?: boolean }`. It SHALL refuse when the main checkout has uncommitted changes. Otherwise it SHALL run `git checkout <base>` then `git merge --no-ff <branch>` in the main checkout, optionally deleting the branch after a successful merge.

#### Scenario: Clean merge into base
- **WHEN** the main checkout is clean and the merge produces no conflicts
- **THEN** the response SHALL be `{ success: true, data: { mergeSha: "<sha>", branchDeleted: false } }`

#### Scenario: Merge with branch deletion
- **WHEN** `deleteBranch: true` is supplied and the merge succeeds
- **THEN** `git branch -d <branch>` SHALL run after the merge
- **AND** the response SHALL be `{ success: true, data: { mergeSha: "<sha>", branchDeleted: true } }`

#### Scenario: Dirty main checkout refused
- **WHEN** `git -C <mainPath> status --porcelain` is non-empty
- **THEN** the response SHALL be `{ success: false, error: "dirty_main", stderr: "<git output>" }` with HTTP 409

#### Scenario: Merge conflict aborted
- **WHEN** the merge produces conflicts
- **THEN** the server SHALL run `git merge --abort` and return `{ success: false, error: "merge_conflict", stderr: "<git output>" }`

#### Scenario: Base ref missing
- **WHEN** the worktree's `gitWorktreeBase` and the fallback chain (`develop`/`main`/`master`) all fail to resolve
- **THEN** the response SHALL be `{ success: false, error: "base_not_found" }`

### Requirement: Push branch endpoint
The server SHALL expose `POST /api/git/worktree/push` accepting `{ cwd: string, setUpstream?: boolean }`. It SHALL run `git push [-u] origin <branch>` from the worktree.

#### Scenario: First push sets upstream
- **WHEN** the branch has no upstream and `setUpstream` defaults / is true
- **THEN** `git push -u origin <branch>` SHALL run and the response SHALL be `{ success: true }`

#### Scenario: No remote configured
- **WHEN** the repository has no `origin` remote
- **THEN** the response SHALL be `{ success: false, error: "no_remote" }`

#### Scenario: Auth failure surfaces stderr
- **WHEN** push fails with authentication-related stderr
- **THEN** the response SHALL be `{ success: false, error: "auth_failed", stderr: "<git output>" }`

#### Scenario: Non-fast-forward rejected
- **WHEN** the remote has commits the local branch doesn't
- **THEN** the response SHALL be `{ success: false, error: "non_fast_forward", stderr: "<git output>" }`

### Requirement: Open pull request endpoint
The server SHALL expose `POST /api/git/worktree/pr` accepting `{ cwd: string, title?: string, body?: string }`. It SHALL run `gh pr create --base <base> --head <branch>` with optional `--title` / `--body`. When the branch has no upstream, it SHALL push first.

#### Scenario: gh resolved + pushed branch
- **WHEN** `gh` is resolvable, the branch has an upstream, and PR creation succeeds
- **THEN** the response SHALL be `{ success: true, data: { url: "https://..." } }`

#### Scenario: gh resolved + missing upstream auto-pushes
- **WHEN** the branch has no upstream
- **THEN** the server SHALL invoke push first; success SHALL proceed to `gh pr create`
- **AND** push failure SHALL return `{ success: false, error: "auth_failed" | "no_remote", stderr }`

#### Scenario: gh missing
- **WHEN** `gh` is not resolvable via the tool registry
- **THEN** the response SHALL be `{ success: false, error: "gh_not_found" }`

#### Scenario: gh not authenticated
- **WHEN** `gh pr create` fails with auth-related stderr
- **THEN** the response SHALL be `{ success: false, error: "gh_not_authed", stderr: "<gh output>" }`

#### Scenario: PR already exists
- **WHEN** an open PR already exists for the branch
- **THEN** the response SHALL be `{ success: false, error: "pr_exists", stderr: "<gh output>" }`

#### Scenario: Pushed but PR failed
- **WHEN** the auto-push succeeds but `gh pr create` fails
- **THEN** the response SHALL be `{ success: false, error: "pushed_but_pr_failed", stderr: "<gh output>" }`
- **AND** the push SHALL NOT be rolled back

### Requirement: Diff-stat endpoint
The server SHALL expose `GET /api/git/worktree/diff-stat?cwd=<path>` returning a summary of changes between the worktree's branch and its base ref. Used by the merge confirm dialog to preview what will be merged.

#### Scenario: Worktree with 12 changed files
- **WHEN** the worktree has 12 changed files vs base
- **THEN** the response SHALL be `{ success: true, data: { summary: "<git diff --stat output truncated to 5 lines>", filesChanged: 12, insertions: <n>, deletions: <n> } }`

#### Scenario: Worktree identical to base
- **WHEN** the worktree's branch has no commits ahead of base
- **THEN** the response SHALL be `{ success: true, data: { summary: "", filesChanged: 0, insertions: 0, deletions: 0 } }`

### Requirement: WorktreeActionsMenu component
The client SHALL render `<WorktreeActionsMenu>` inside the WORKSPACE subcard whenever `session.gitWorktree` is set. The menu SHALL expose up to four actions: Push, Open PR (or View PR when `session.gitPrNumber != null`), Merge, Close worktree. The Open PR action is gh-gated — see the gh-availability scenarios below.

#### Scenario: All visible actions present for worktree session without PR when gh is available
- **WHEN** the card renders for a worktree session with no `gitPrNumber`
- **AND** `gh` is resolvable via the tool registry
- **THEN** the menu SHALL show Push, Open PR, Merge, Close worktree buttons

#### Scenario: Open PR hidden when gh is not available
- **WHEN** the card renders for a worktree session with no `gitPrNumber`
- **AND** `gh` is NOT resolvable via the tool registry
- **THEN** the menu SHALL show Push, Merge, Close worktree buttons
- **AND** the Open PR button SHALL NOT render

#### Scenario: View PR remains visible without gh when PR already exists
- **WHEN** `session.gitPrNumber` is set
- **AND** `gh` is NOT resolvable
- **THEN** the menu SHALL still render a "View PR #N" link pointing to `session.gitPrUrl` (opening the existing PR does not require gh)

#### Scenario: Open PR toggles to View PR when PR exists
- **WHEN** `session.gitPrNumber` is set
- **THEN** the Open PR button SHALL be replaced with a "View PR #N" link pointing to `session.gitPrUrl`

#### Scenario: Menu hidden for non-worktree sessions
- **WHEN** `session.gitWorktree` is undefined
- **THEN** `<WorktreeActionsMenu>` SHALL NOT render

#### Scenario: Mobile renders single action sheet trigger
- **WHEN** `useMobile()` returns true
- **THEN** the menu SHALL collapse into a single `⋯` button opening an action sheet listing the same visible actions

### Requirement: CloseWorktreeDialog presents active-session guard
The client SHALL render a confirm dialog before invoking `worktree/remove` whenever the server returns `code: "active_sessions"`. The dialog SHALL list every session ID returned by the server and offer a single confirm button "End N sessions and remove worktree".

#### Scenario: Two active sessions confirmation
- **WHEN** the user clicks "Close worktree" and the server returns `sessionIds: [id1, id2]`
- **THEN** the dialog SHALL show both session names + cwds and a confirm button labeled "End 2 sessions and remove worktree"
- **AND** clicking confirm SHALL send `shutdown` to each listed session, then `await` the forced `worktree/remove` call so the success branch reliably fires `onRemoved` + `onClose` before the dialog unmounts (the previous fire-and-forget shape could drop the success callback when the dashboard's own session was the one being shut down)

#### Scenario: Delete merged branch checkbox
- **WHEN** the worktree's branch is fully merged into its base ref
- **THEN** the dialog SHALL show a checked-by-default "Delete merged branch" checkbox
- **AND** the resulting remove call SHALL be followed by `git branch -d <branch>` when checked

#### Scenario: Force toggle exposed when removal would refuse
- **WHEN** the worktree is dirty or unmerged
- **THEN** the dialog SHALL show a "--force (discard changes)" toggle
- **AND** the toggle SHALL be unchecked on initial render

#### Scenario: Dirty / unmerged response auto-ticks --force and surfaces hint
- **WHEN** `worktree/remove` returns `code: "dirty_worktree"` or `code: "branch_not_merged"` without force
- **THEN** the dialog SHALL automatically set the `--force` toggle to checked
- **AND** the error block SHALL render an inline hint referencing `--force` so the next Remove click sends `force: true` with no extra user step
- **AND** the dialog SHALL remain open until the user cancels or retries

#### Scenario: Successful remove notifies parent menu
- **WHEN** `worktree/remove` returns `{ ok: true }`
- **THEN** the dialog SHALL invoke its `onRemoved` callback before `onClose`
- **AND** `WorktreeActionsMenu` SHALL wire `onRemoved` to surface a success toast ("Worktree removed.") so the user has visible confirmation that the on-disk directory was deleted

