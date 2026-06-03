## ADDED Requirements

### Requirement: Worktree init-status endpoint

The server SHALL expose `GET /api/git/worktree/init-status` (localhost-only) reporting whether a checkout needs initialization per its declared hook. Query/body carries `cwd`. The server SHALL validate `cwd`, resolve the repo root, and `readInitHook(repoRoot)`.

- When no hook is declared, respond `{ success: true, data: { hasHook: false } }`.
- When a hook is declared, evaluate the gate (using the cache) and respond `{ success: true, data: { hasHook: true, needsInit: boolean, trusted: boolean } }`.

The endpoint replaces the removed `GET /api/git/worktree/bootstrap-status`.

#### Scenario: No hook declared

- **WHEN** `init-status` is requested for a checkout whose repo declares no `worktreeInit`
- **THEN** the response SHALL be `{ success: true, data: { hasHook: false } }`

#### Scenario: Hook present, gate says needs init

- **WHEN** the gate exits `0` for the checkout
- **THEN** the response SHALL include `{ hasHook: true, needsInit: true }`
- **AND** SHALL include the current `trusted` flag for `repoRoot + hash(hook)`

#### Scenario: Hook present, gate says no init

- **WHEN** the gate exits non-zero for the checkout
- **THEN** the response SHALL include `{ hasHook: true, needsInit: false }`

#### Scenario: Localhost-only

- **WHEN** the request originates from a non-loopback address not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope

### Requirement: Worktree init endpoint

The server SHALL expose `POST /api/git/worktree/init` (localhost-only) running the declared hook for a checkout. Request body carries `cwd`, optional `requestId` for progress streaming, and optional `confirmHash` to record trust.

The endpoint SHALL:
1. Validate `cwd`; `readInitHook(repoRoot)`. When no hook → `{ success: true, data: { ran: false, skippedReason: "no_hook" } }`.
2. Compute `hash(hook)`. When `confirmHash` matches, `recordTrust(repoRoot, hash)` before proceeding.
3. When `repoRoot + hash` is not trusted, respond `{ success: false, code: "init_untrusted", data: { hook } }` WITHOUT executing.
4. When trusted, run the hook (script or detached agent), invalidate the gate cache for the checkout, stream `worktree_init_progress` to the requesting browser (when `requestId` + registry present), and respond with the run result.

Stable codes: `init_untrusted`, `init_failed`, `no_hook`.

#### Scenario: Untrusted run returns confirm payload

- **WHEN** `POST /api/git/worktree/init` is called for an untrusted hook with no matching `confirmHash`
- **THEN** the hook SHALL NOT execute
- **AND** the response SHALL be `{ success: false, code: "init_untrusted", data: { hook } }`

#### Scenario: Confirm then run

- **WHEN** the request includes `confirmHash` equal to the current hook hash
- **THEN** the server SHALL record trust
- **AND** SHALL execute the hook
- **AND** SHALL respond with the run result

#### Scenario: Script hook success

- **WHEN** a trusted `script` hook exits `0`
- **THEN** the response SHALL be `{ success: true, data: { ran: true, durationMs } }`
- **AND** the gate cache for the checkout SHALL be invalidated

#### Scenario: Script hook failure surfaces stderr

- **WHEN** a trusted `script` hook exits non-zero
- **THEN** the response SHALL be `{ success: false, code: "init_failed", stderr }`

#### Scenario: No hook declared

- **WHEN** `init` is requested for a checkout whose repo declares no `worktreeInit`
- **THEN** the response SHALL be `{ success: true, data: { ran: false, skippedReason: "no_hook" } }`

#### Scenario: Localhost-only

- **WHEN** the request originates from a non-loopback address not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope

## MODIFIED Requirements

### Requirement: Create worktree endpoint
The server SHALL expose `POST /api/git/worktree` (localhost-only) creating a new git worktree. Request body: `{ cwd: string, base: string, newBranch: string, path?: string, force?: boolean }`.

The endpoint SHALL:
1. Realpath-validate `cwd` and confirm it is inside a git repository.
2. Derive `path` if absent: `<repo-root>/.worktrees/<slug(newBranch)>`. The repo root SHALL be `git rev-parse --show-toplevel` of `cwd`.
3. Refuse with `path_exists` if the derived or supplied path already exists on disk and is not empty.
4. Run `git worktree add -b <newBranch> <path> <base>` (or with `--force` when `force === true`).
5. On success, append the line `.worktrees/` to `<repo-root>/.git/info/exclude` iff that exact line is not already present. SHALL NOT touch `.gitignore`. SHALL NOT fail the request if the exclude-write fails (log warning, continue).
6. Return `{ path: string, branch: string }`.

The endpoint SHALL NOT run any initialization or dependency-install step. Initialization is delegated to the gated, manually-triggered worktree-init hook (`GET /api/git/worktree/init-status` + `POST /api/git/worktree/init`). The previously embedded post-create bootstrap step is REMOVED.

Error response shape: `{ success: false, error: <code>, message: <human>, stderr?: string }`. Stable codes: `not_a_repo`, `cwd_invalid`, `branch_in_use`, `branch_exists`, `path_exists`, `base_not_found`, `git_failed`.

#### Scenario: Successful create with auto-derived path
- **WHEN** `POST /api/git/worktree` is called with `{ cwd: "/repo", base: "develop", newBranch: "feat/dark-mode" }`
- **THEN** the server SHALL derive path `/repo/.worktrees/feat-dark-mode`
- **AND** run `git worktree add -b feat/dark-mode /repo/.worktrees/feat-dark-mode develop`
- **AND** return `{ path: "/repo/.worktrees/feat-dark-mode", branch: "feat/dark-mode" }`
- **AND** SHALL NOT run any install/init step

#### Scenario: No auto-init on create
- **WHEN** a worktree is created for a repo that declares a `worktreeInit` hook
- **THEN** the create endpoint SHALL NOT execute the hook
- **AND** the new worktree's init-status SHALL subsequently report `needsInit` per its gate

#### Scenario: Idempotent exclude append
- **WHEN** the worktree is created and `.git/info/exclude` already contains the line `.worktrees/`
- **THEN** the server SHALL NOT append a duplicate line

#### Scenario: Localhost-only
- **WHEN** the request originates from a non-loopback address not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope
