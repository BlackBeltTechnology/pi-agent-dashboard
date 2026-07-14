## MODIFIED Requirements

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
