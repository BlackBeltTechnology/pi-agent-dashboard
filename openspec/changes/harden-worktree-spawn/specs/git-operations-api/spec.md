## MODIFIED Requirements

### Requirement: Create worktree endpoint
The server SHALL expose `POST /api/git/worktree` (localhost-only) creating a new git worktree. Request body: `{ cwd: string, base: string, newBranch: string, path?: string, force?: boolean, requestId?: string }`.

The endpoint SHALL:
1. Realpath-validate `cwd` and confirm it is inside a git repository.
2. Derive `path` if absent: `<repo-root>/.worktrees/<slug(newBranch)>`. The repo root SHALL be `git rev-parse --show-toplevel` of `cwd` (so opening the dialog from inside a sibling worktree still resolves to the parent repo).
3. Refuse with `path_exists` if the derived or supplied path already exists on disk (regardless of `force`, unless the existing path is empty).
4. Run `git worktree add -b <newBranch> <path> <base>` (or with `--force` when `force === true`).
5. On success, append the line `.worktrees/` (with trailing slash, no leading slash) to `<repo-root>/.git/info/exclude` if and only if that exact line is not already present. SHALL NOT touch `.gitignore`. SHALL NOT fail the request if the exclude-write itself fails (log warning, continue).
6. After `git worktree add` succeeds, invoke the bootstrap step described in the "Worktree bootstrap step" requirement below. The HTTP response SHALL NOT be sent until bootstrap completes, fails, or is skipped.
7. Return `{ path: string, branch: string, bootstrap: { ran: boolean, durationMs?: number, skippedReason?: string } }`.

Error response shape: `{ success: false, error: <code>, message: <human>, stderr?: string }`. Stable codes:
- `not_a_repo` — cwd not in a git repository
- `cwd_invalid` — cwd missing or fails realpath
- `branch_in_use` — newBranch already checked out elsewhere
- `branch_exists` — newBranch already exists (when no `--force`)
- `path_exists` — target path already exists and is not empty
- `base_not_found` — base ref does not resolve
- `git_failed` — any other git failure (preserve stderr)
- `bootstrap_failed` — `git worktree add` succeeded but the post-create install step failed; the worktree on disk SHALL be left intact for the user to inspect

#### Scenario: Successful create with auto-derived path
- **WHEN** `POST /api/git/worktree` is called with `{ cwd: "/repo", base: "develop", newBranch: "feat/dark-mode" }`
- **THEN** the server SHALL derive path `/repo/.worktrees/feat-dark-mode`
- **AND** run `git worktree add -b feat/dark-mode /repo/.worktrees/feat-dark-mode develop`
- **AND** run the bootstrap step
- **AND** return `{ path: "/repo/.worktrees/feat-dark-mode", branch: "feat/dark-mode", bootstrap: { ran: <bool>, ... } }`
- **AND** ensure `.worktrees/` is in `/repo/.git/info/exclude` (appending if absent)

#### Scenario: Successful create with explicit path
- **WHEN** the request includes `path: "/custom/place"`
- **THEN** the server SHALL use the explicit path verbatim
- **AND** SHALL NOT modify `.git/info/exclude` (the user is opting out of the convention)
- **AND** SHALL still invoke the bootstrap step against `/custom/place`

#### Scenario: Slug derivation
- **WHEN** `newBranch` is `"feat/Dark Mode!"`
- **THEN** the derived slug SHALL be `feat-dark-mode`
- **AND** the derived path SHALL be `<repo-root>/.worktrees/feat-dark-mode`

#### Scenario: Branch already checked out elsewhere
- **WHEN** `newBranch` is already checked out in another worktree
- **THEN** the response SHALL be `{ success: false, error: "branch_in_use", ... }`
- **AND** the bootstrap step SHALL NOT run

#### Scenario: Path collision
- **WHEN** the derived or supplied path already exists and contains files
- **THEN** the response SHALL be `{ success: false, error: "path_exists", ... }`
- **AND** the server SHALL NOT run `git worktree add`
- **AND** the bootstrap step SHALL NOT run

#### Scenario: Base ref is a remote branch
- **WHEN** `base` is `"origin/feature"`
- **THEN** the server SHALL run `git worktree add -b <newBranch> <path> origin/feature`
- **AND** the resulting worktree's `newBranch` SHALL track the remote branch by default

#### Scenario: Idempotent exclude append
- **WHEN** the worktree is created and `.git/info/exclude` already contains the line `.worktrees/`
- **THEN** the server SHALL NOT append a duplicate line

#### Scenario: Exclude write failure does not fail the request
- **WHEN** `.git/info/exclude` is not writable but the worktree was created successfully
- **THEN** the response SHALL be a success (with the new path)
- **AND** the server SHALL log a warning containing the exclude-write failure

#### Scenario: Localhost-only
- **WHEN** the request originates from a non-loopback address and is not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope

#### Scenario: Bootstrap failure leaves worktree intact
- **WHEN** `git worktree add` succeeds but the bootstrap install command exits non-zero
- **THEN** the response SHALL be `{ success: false, error: "bootstrap_failed", stderr: "<install stderr tail>", message: "<short hint>" }`
- **AND** the worktree directory SHALL remain on disk (NOT auto-`git worktree remove`)
- **AND** the `.git/info/exclude` line SHALL still have been appended on success

## ADDED Requirements

### Requirement: Worktree bootstrap step
After `POST /api/git/worktree` succeeds at `git worktree add`, the server SHALL conditionally run a dependency-install step in the newly created worktree directory. The step is gated by a pure `detectBootstrapRequirement(repoRoot)` heuristic that returns `{ required: true }` if and only if the parent repo's `.pi/settings.json` declares one or more `packages[]` entries whose `source` (resolved relative to `.pi/`) points into the repo itself or any descendant directory AND the entry's `extensions[]` list references at least one path under that resolved source. For all other repos (including those with `npm:`-style packages or with no `.pi/settings.json` at all) the heuristic SHALL return `{ required: false }` and the bootstrap step SHALL be skipped.

When `required` is true, the server SHALL pick the install command by lockfile presence in the new worktree:
- `package-lock.json` → `npm ci`
- `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`
- `yarn.lock` → `yarn install --frozen-lockfile`
- `bun.lock` or `bun.lockb` → `bun install --frozen-lockfile`
- No lockfile → skip with `skippedReason: "no_lockfile"`

While the install runs, the server SHALL stream `bootstrap_progress` events over the requesting browser's WebSocket (when `requestId` is provided in the body), throttled to at most one event per 250 ms per request, each carrying the most recent ≤ 4 KB tail of combined stdout/stderr. On success the server SHALL emit `bootstrap_done`. On non-zero exit the server SHALL emit `bootstrap_failed { code, message, stderr }` and respond with `bootstrap_failed`.

#### Scenario: Repo with worktree-local-bridge gets bootstrap
- **WHEN** the parent repo's `.pi/settings.json` has `{ "packages": [ { "source": "..", "extensions": ["+packages/extension/src/bridge.ts"] } ] }` AND `<worktree>/package-lock.json` exists
- **THEN** the server SHALL invoke `npm ci` with cwd = the new worktree path
- **AND** SHALL emit `bootstrap_progress` events tagged with the request's `requestId`
- **AND** SHALL respond with `{ path, branch, bootstrap: { ran: true, durationMs: <ms> } }` on success

#### Scenario: Repo with npm-only packages skips bootstrap
- **WHEN** the parent repo's `.pi/settings.json` lists only `"npm:..."` style packages and no worktree-local TS bridges
- **THEN** the bootstrap step SHALL be skipped
- **AND** the response SHALL be `{ path, branch, bootstrap: { ran: false, skippedReason: "not_required" } }`

#### Scenario: Repo with no `.pi/settings.json` skips bootstrap
- **WHEN** the parent repo has no `.pi/settings.json` file
- **THEN** the bootstrap step SHALL be skipped
- **AND** the response SHALL be `{ path, branch, bootstrap: { ran: false, skippedReason: "not_required" } }`

#### Scenario: No lockfile in new worktree
- **WHEN** bootstrap is required but the new worktree has no recognized lockfile
- **THEN** the bootstrap step SHALL be skipped
- **AND** the response SHALL be `{ path, branch, bootstrap: { ran: false, skippedReason: "no_lockfile" } }`

#### Scenario: Install fails with non-zero exit
- **WHEN** `npm ci` exits with code 1
- **THEN** the server SHALL emit `bootstrap_failed { requestId, cwd, code: "install_nonzero_exit", message: <hint>, stderr: <tail> }`
- **AND** the HTTP response SHALL be `{ success: false, error: "bootstrap_failed", stderr: <tail>, message: <hint> }`

#### Scenario: Progress throttling
- **WHEN** `npm ci` writes 10 000 lines/sec of output
- **THEN** the server SHALL emit at most 4 `bootstrap_progress` events per second
- **AND** each event's `line` field SHALL contain the most recent ≤ 4 KB of combined output

#### Scenario: requestId absent — progress events suppressed
- **WHEN** `POST /api/git/worktree` is called without `requestId`
- **THEN** the server SHALL still run the bootstrap step
- **AND** SHALL NOT emit `bootstrap_progress` / `bootstrap_done` / `bootstrap_failed` events
- **AND** the bootstrap result SHALL still appear in the HTTP response body

### Requirement: Bootstrap-status probe endpoint
The server SHALL expose `GET /api/git/worktree/bootstrap-status?cwd=<path>` (localhost-only) returning `{ needsBootstrap: boolean, reason: "not_required" | "ok" | "no_node_modules" | "stale_lockfile" }` for the worktree at `cwd`. `cwd` SHALL be realpath-validated and confirmed to be inside a git repository.

The decision tree:
1. If `detectBootstrapRequirement(<repo-root-of-cwd>).required === false` → `{ needsBootstrap: false, reason: "not_required" }`
2. Else if `<cwd>/node_modules` does NOT exist or is empty → `{ needsBootstrap: true, reason: "no_node_modules" }`
3. Else if the worktree has `package-lock.json` and `mtime(package-lock.json) > mtime(node_modules/.package-lock.json)` → `{ needsBootstrap: true, reason: "stale_lockfile" }`
4. Else → `{ needsBootstrap: false, reason: "ok" }`

#### Scenario: Non-bootstrap repo
- **WHEN** `cwd` is in a repo with no worktree-local-bridge `.pi/settings.json`
- **THEN** the response SHALL be `{ needsBootstrap: false, reason: "not_required" }`

#### Scenario: Bootstrap repo with healthy node_modules
- **WHEN** `cwd` is in a worktree-local-bridge repo AND `<cwd>/node_modules` exists and is non-empty AND lockfile is fresh
- **THEN** the response SHALL be `{ needsBootstrap: false, reason: "ok" }`

#### Scenario: Bootstrap repo missing node_modules
- **WHEN** `cwd` is in a worktree-local-bridge repo AND `<cwd>/node_modules` is absent
- **THEN** the response SHALL be `{ needsBootstrap: true, reason: "no_node_modules" }`

#### Scenario: Bootstrap repo with stale node_modules
- **WHEN** `cwd` is in a worktree-local-bridge repo AND `<cwd>/package-lock.json` mtime exceeds `<cwd>/node_modules/.package-lock.json` mtime
- **THEN** the response SHALL be `{ needsBootstrap: true, reason: "stale_lockfile" }`

#### Scenario: Localhost-only
- **WHEN** the request originates from a non-loopback address and is not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope

### Requirement: Bootstrap progress events on browser channel
The server SHALL extend `ServerToBrowserMessage` with three new event types delivered over the existing browser-gateway WebSocket:

- `bootstrap_progress { requestId: string, cwd: string, line: string }` — emitted at most 4 times per second per `requestId`, carrying the latest ≤ 4 KB of install-process output.
- `bootstrap_done { requestId: string, cwd: string, durationMs: number }` — emitted once when the install command exits with code 0.
- `bootstrap_failed { requestId: string, cwd: string, code: string, message: string, stderr: string }` — emitted once when the install command exits non-zero or fails to spawn.

Events SHALL be sent only to the originating browser connection identified by `requestId` lookup, NOT broadcast.

#### Scenario: Progress reaches originating browser only
- **WHEN** browser A initiates the create-worktree request with `requestId: "abc"` and browser B is also connected
- **THEN** browser A SHALL receive every `bootstrap_progress` / `bootstrap_done` / `bootstrap_failed` event for `requestId: "abc"`
- **AND** browser B SHALL NOT receive those events

#### Scenario: Terminal events fire exactly once
- **WHEN** an install succeeds
- **THEN** exactly one `bootstrap_done` SHALL be emitted
- **AND** no `bootstrap_failed` SHALL be emitted

- **WHEN** an install fails
- **THEN** exactly one `bootstrap_failed` SHALL be emitted
- **AND** no `bootstrap_done` SHALL be emitted
