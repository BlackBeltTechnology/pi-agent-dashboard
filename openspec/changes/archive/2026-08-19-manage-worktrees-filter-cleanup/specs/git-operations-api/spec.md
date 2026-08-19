## ADDED Requirements

### Requirement: Two additional worktree-lifecycle endpoints registered

The git routes SHALL register, alongside the existing worktree-lifecycle routes
(`remove`, `merge`, `push`, `pr`, `diff-stat`):

- `POST /api/git/worktree/remove-batch`
- `POST /api/git/worktree/prune`

Both SHALL carry the same `networkGuard` preHandler and the same `validateCwd`
containment the existing `POST /api/git/worktree/remove` carries — applied **per
item** for `remove-batch`, since its body is a caller-supplied array of paths.

#### Scenario: Both endpoints are registered
- **WHEN** the server boots with git routes registered
- **THEN** `POST /api/git/worktree/remove-batch` and `POST /api/git/worktree/prune` SHALL respond (not 404)

#### Scenario: Endpoints are network-guarded
- **WHEN** either endpoint is called from a request the `networkGuard` denies
- **THEN** the call SHALL be rejected by the guard before any git command runs

#### Scenario: Batch body must be an array
- **WHEN** `remove-batch` is called with a body whose item list is absent or not an array
- **THEN** the response SHALL be `400` with a stable validation code
- **AND** no git command SHALL run

#### Scenario: Batch size is capped
- **WHEN** `remove-batch` is called with more items than the documented cap
- **THEN** the response SHALL be `400` with a stable code naming the cap
- **AND** no git command SHALL run

The cap is required because `removeWorktree` uses `execSync`: an uncapped array
blocks the event loop for N sequential git invocations (2N with `deleteBranch`)
on a server that also hosts two WebSocket servers.

## MODIFIED Requirements

### Requirement: List worktrees endpoint
The server SHALL expose `GET /api/git/worktrees?cwd=<path>` (localhost-only) returning every worktree of the repository containing `cwd`. The endpoint SHALL parse `git worktree list --porcelain` output.

Response shape: `{ worktrees: Array<{ path: string, branch: string | null, sha: string, bare: boolean, detached: boolean, isMain: boolean, exists: boolean }> }`. `path` SHALL be the absolute path returned by git. `branch` SHALL be the branch name with `refs/heads/` stripped, or `null` for detached / bare. `isMain` SHALL be `true` for exactly one entry — the main worktree (the first record in porcelain output). `exists` SHALL report whether the registration's directory is present on disk; it is not derivable client-side, and without it a client cannot distinguish a live worktree from a stale registration that `remove` can never clear.

#### Scenario: Repository with main + two worktrees
- **WHEN** `GET /api/git/worktrees?cwd=/repo/.worktrees/feat-x` is called on a repo with two worktrees
- **THEN** the response SHALL list 3 entries (main + 2 worktrees)
- **AND** exactly one entry SHALL have `isMain: true`
- **AND** the result SHALL be the same regardless of which worktree's path was passed as `cwd`

#### Scenario: Repository with no extra worktrees
- **WHEN** the repo has only the main checkout
- **THEN** the response SHALL be `{ worktrees: [ { isMain: true, ... } ] }` (one entry)

#### Scenario: Detached worktree
- **WHEN** a worktree was created with a detached HEAD
- **THEN** its entry SHALL have `branch: null` and `detached: true`

#### Scenario: Not a git repository
- **WHEN** the cwd is not inside a git repository
- **THEN** the response SHALL be `{ success: false, error: "not_a_repo" }`

#### Scenario: Localhost-only
- **WHEN** the request originates from a non-loopback address and is not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope

#### Scenario: Stale registration is reported as missing
- **WHEN** a registered worktree's directory has been deleted outside git
- **THEN** that entry SHALL be reported with `exists: false`
- **AND** every entry whose directory is present SHALL be reported with `exists: true`

#### Scenario: Field is additive
- **WHEN** an existing client that does not read `exists` consumes the response
- **THEN** its behaviour SHALL be unchanged
- **AND** no protocol version bump SHALL be required
