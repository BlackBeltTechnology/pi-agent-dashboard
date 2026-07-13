# git-operations-api Specification

## Purpose
REST API for git operations: branches, checkout, init, stash, worktrees, lifecycle (remove/merge/push/PR), and pull-request listing/checkout.
## Requirements
### Requirement: List branches endpoint
The server SHALL expose `GET /api/git/branches` (localhost-only) that returns all local and remote branches for a given directory.

#### Scenario: Successful branch listing
- **WHEN** `GET /api/git/branches?cwd=/path` is called for a git repository
- **THEN** the response SHALL include `current` (current branch name or short SHA), `detached` (boolean), and `branches` array
- **AND** each branch entry SHALL have `name` (string), `isRemote` (boolean), and `isCurrent` (boolean)
- **AND** branches SHALL be sorted by most recent committer date (descending)

#### Scenario: Not a git repository
- **WHEN** the `cwd` is not inside a git repository
- **THEN** the response SHALL return `{ success: false, error: "not a git repository" }`

#### Scenario: Remote branches included
- **WHEN** remote tracking branches exist
- **THEN** remote branches SHALL be included with `isRemote: true`
- **AND** the `refs/remotes/origin/` prefix SHALL be stripped to show just the branch name (e.g., `origin/feature-x`)
- **AND** `HEAD` pointer entries (e.g., `origin/HEAD`) SHALL be excluded

### Requirement: Checkout endpoint
The server SHALL expose `POST /api/git/checkout` (localhost-only) that switches branches with optional stash support.

#### Scenario: Clean checkout of local branch
- **WHEN** `POST /api/git/checkout` is called with `{ cwd, branch, stash: false }` and the working tree is clean
- **THEN** the server SHALL run `git checkout <branch>` and return `{ success: true }`

#### Scenario: Dirty working tree without stash
- **WHEN** the working tree has uncommitted changes and `stash` is `false`
- **THEN** the server SHALL return HTTP 409 with `{ success: false, dirty: true, files: string[] }`
- **AND** the files array SHALL contain the list of modified/untracked files from `git status --porcelain`

#### Scenario: Checkout with stash
- **WHEN** `stash` is `true` and the working tree is dirty
- **THEN** the server SHALL run `git stash push -u` before `git checkout <branch>`
- **AND** return `{ success: true, stashed: true }`

#### Scenario: Remote branch checkout
- **WHEN** the branch name starts with `origin/` and no local branch of that name exists
- **THEN** the server SHALL run `git checkout -b <local-name> <remote-name>` to create a local tracking branch

#### Scenario: Already on target branch
- **WHEN** the target branch is the current branch
- **THEN** the server SHALL return `{ success: true }` without running any git commands

### Requirement: Git init endpoint
The server SHALL expose `POST /api/git/init` (localhost-only) that initializes a git repository.

#### Scenario: Successful init
- **WHEN** `POST /api/git/init` is called with `{ cwd }` and the directory is not inside a git repository
- **THEN** the server SHALL run `git init` in the `cwd` and return `{ success: true }`

#### Scenario: Already a git repository
- **WHEN** the `cwd` is already inside a git repository
- **THEN** the server SHALL return `{ success: false, error: "already a git repository" }`

### Requirement: Stash pop endpoint
The server SHALL expose `POST /api/git/stash-pop` (localhost-only) that pops the most recent stash.

#### Scenario: Clean stash pop
- **WHEN** `POST /api/git/stash-pop` is called and the pop applies cleanly
- **THEN** the server SHALL return `{ success: true, conflicts: false }`

#### Scenario: Stash pop with conflicts
- **WHEN** the stash pop results in merge conflicts
- **THEN** the server SHALL return `{ success: true, conflicts: true }`

#### Scenario: No stash entries
- **WHEN** there are no stash entries to pop
- **THEN** the server SHALL return `{ success: false, error: "no stash entries" }`

### Requirement: Read HEAD endpoint
The server SHALL expose `GET /api/git/head?cwd=<path>` (localhost-only) returning the current HEAD state of the given directory. The endpoint SHALL be used by the worktree dialog to compute its default base branch.

Response shape: `{ branch: string | null, detached: boolean, sha: string | null }`. On error, `{ success: false, error: <code>, message: <human> }` with stable codes (`not_a_repo`, `cwd_invalid`, `git_failed`).

#### Scenario: Attached HEAD on a branch
- **WHEN** `GET /api/git/head?cwd=/repo` is called and HEAD points to `develop`
- **THEN** the response SHALL be `{ branch: "develop", detached: false, sha: "<short>" }`

#### Scenario: Detached HEAD
- **WHEN** the repository's HEAD is detached at commit `abc1234`
- **THEN** the response SHALL be `{ branch: null, detached: true, sha: "abc1234" }`

#### Scenario: Not a git repository
- **WHEN** the cwd is not inside a git repository
- **THEN** the response SHALL be `{ success: false, error: "not_a_repo", message: "<human-readable>" }`

#### Scenario: Missing or invalid cwd
- **WHEN** the `cwd` query parameter is absent or fails realpath validation
- **THEN** the response SHALL be `{ success: false, error: "cwd_invalid" }`

#### Scenario: Localhost-only
- **WHEN** the request originates from a non-loopback address and is not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope

### Requirement: List worktrees endpoint
The server SHALL expose `GET /api/git/worktrees?cwd=<path>` (localhost-only) returning every worktree of the repository containing `cwd`. The endpoint SHALL parse `git worktree list --porcelain` output.

Response shape: `{ worktrees: Array<{ path: string, branch: string | null, sha: string, bare: boolean, detached: boolean, isMain: boolean }> }`. `path` SHALL be the absolute path returned by git. `branch` SHALL be the branch name with `refs/heads/` stripped, or `null` for detached / bare. `isMain` SHALL be `true` for exactly one entry — the main worktree (the first record in porcelain output).

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

### Requirement: Create worktree endpoint

The server SHALL expose `POST /api/git/worktree` (localhost-only) creating a new git worktree. Request body: `{ cwd: string, base: string, newBranch?: string, path?: string, force?: boolean }`.

The endpoint SHALL:

1. Realpath-validate `cwd` and confirm it is inside a git repository.
2. Derive `path` if absent:
   - When `newBranch` is provided: `<repo-root>/.worktrees/<slug(newBranch)>`.
   - When `newBranch` is absent: `<repo-root>/.worktrees/<slug(localNameOf(base))>` where `localNameOf("origin/foo") === "foo"` and `localNameOf("foo") === "foo"`.
   The repo root SHALL be resolved via `git rev-parse --git-common-dir` of `cwd` and walked to its parent (the main worktree), so that the path lands consistently regardless of which sibling worktree opened the dialog.
3. Refuse with `path_exists` if the derived or supplied path already exists on disk and is not empty.
4. Run the appropriate git command:
   - When `newBranch` is provided: `git worktree add -b <newBranch> <path> <base>` (fork mode; current behaviour).
   - When `newBranch` is absent: `git worktree add <path> <base>` (checkout mode; relies on git DWIM to create a tracking branch when `base` is `origin/<x>` and no matching local branch exists).
   - `--force` SHALL be passed when `force === true` in either mode.
5. On success, append the line `.worktrees/` to `<repo-root>/.git/info/exclude` iff that exact line is not already present. SHALL NOT touch `.gitignore`. SHALL NOT fail the request if the exclude-write fails (log warning, continue).
6. Return `{ path: string, branch: string }`. In checkout mode, `branch` SHALL be the locally-checked-out branch name (for `base = "origin/foo"` DWIM, `branch === "foo"`, not `"origin/foo"`).

The endpoint SHALL NOT run any initialization or dependency-install step. Initialization is delegated to the gated, manually-triggered worktree-init hook (`GET /api/git/worktree/init-status` + `POST /api/git/worktree/init`).

Error response shape: `{ success: false, error: <code>, message: <human>, stderr?: string }`. Stable codes: `not_a_repo`, `cwd_invalid`, `branch_in_use`, `branch_exists`, `path_exists`, `base_not_found`, `git_failed`.

When the server maps a git error to `branch_in_use`, the `message` field SHALL include the path of the worktree currently holding the branch when git's stderr exposes it (pattern `already used by worktree at '<path>'`). When the path cannot be parsed, the message SHALL fall back to a generic phrasing.

#### Scenario: Fork mode — successful create with auto-derived path

- **WHEN** `POST /api/git/worktree` is called with `{ cwd: "/repo", base: "develop", newBranch: "feat/dark-mode" }`
- **THEN** the server SHALL derive path `/repo/.worktrees/feat-dark-mode`
- **AND** run `git worktree add -b feat/dark-mode /repo/.worktrees/feat-dark-mode develop`
- **AND** return `{ path: "/repo/.worktrees/feat-dark-mode", branch: "feat/dark-mode" }`

#### Scenario: Checkout mode — existing local branch

- **WHEN** `POST /api/git/worktree` is called with `{ cwd: "/repo", base: "stale-feature" }` (no `newBranch`)
- **AND** local branch `stale-feature` exists and is not checked out in any worktree
- **THEN** the server SHALL derive path `/repo/.worktrees/stale-feature`
- **AND** run `git worktree add /repo/.worktrees/stale-feature stale-feature`
- **AND** return `{ path: "/repo/.worktrees/stale-feature", branch: "stale-feature" }`

#### Scenario: Checkout mode — remote-only branch DWIM

- **WHEN** `POST /api/git/worktree` is called with `{ cwd: "/repo", base: "origin/old-experiment" }` (no `newBranch`)
- **AND** no local branch `old-experiment` exists
- **THEN** the server SHALL derive path `/repo/.worktrees/old-experiment` (NOT `/repo/.worktrees/origin-old-experiment`)
- **AND** run `git worktree add /repo/.worktrees/old-experiment origin/old-experiment`
- **AND** git SHALL create local branch `old-experiment` tracking `origin/old-experiment`
- **AND** the server SHALL return `{ path: "/repo/.worktrees/old-experiment", branch: "old-experiment" }`

#### Scenario: Checkout mode — branch already checked out elsewhere

- **WHEN** `POST /api/git/worktree` is called with `{ cwd: "/repo", base: "foo" }` (no `newBranch`)
- **AND** branch `foo` is already checked out in worktree at `/repo/.worktrees/bar`
- **THEN** the server SHALL return `{ success: false, error: "branch_in_use", message: <text including "/repo/.worktrees/bar">, stderr: <git output> }`

#### Scenario: No auto-init on create

- **WHEN** a worktree is created (in either mode) for a repo that declares a `worktreeInit` hook
- **THEN** the create endpoint SHALL NOT execute the hook

#### Scenario: Idempotent exclude append

- **WHEN** the worktree is created and `.git/info/exclude` already contains the line `.worktrees/`
- **THEN** the server SHALL NOT append a duplicate line

#### Scenario: Localhost-only

- **WHEN** the request originates from a non-loopback address not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope

### Requirement: Four worktree-lifecycle endpoints registered
The server SHALL register the four new endpoints under `/api/git/worktree/*` defined in the `worktree-lifecycle` capability:

- `POST /api/git/worktree/remove`
- `POST /api/git/worktree/merge`
- `POST /api/git/worktree/push`
- `POST /api/git/worktree/pr`
- `GET /api/git/worktree/diff-stat`

Every route SHALL apply the existing `validateCwd` (realpath check via `safeRealpathSync`) and SHALL be gated on loopback / trusted-bypass like the existing `POST /api/git/worktree` (create) route.

#### Scenario: All routes accept POST/GET shape from existing dialog
- **WHEN** any of the four routes is called with a valid cwd
- **THEN** the request body shape SHALL match what `git-api.ts` client helpers send

#### Scenario: Non-loopback origin rejected
- **WHEN** the request originates from a non-loopback address and is not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope

### Requirement: Orphan worktree path cleanup endpoint
The server SHALL expose `POST /api/git/worktree/orphan-cleanup` (localhost-gated) accepting `{ cwd: string, path: string }`. The endpoint SHALL delete `path` from disk if and only if ALL of the following hold:

- `path` is inside `cwd` (anti-traversal),
- `path` exists and is a directory,
- `path` is NOT present in `git worktree list --porcelain` for `cwd`,
- `path` does NOT contain any `.git` entry (file or directory) at its top level,
- `path` contains no more than 20 files (default cap),
- no single file at `path` exceeds 1 MB (default cap).

Refusals SHALL return stable error codes: `outside_repo`, `not_a_directory`, `looks_like_worktree`, `too_many_files`, `file_too_large`, `not_orphan` (path is in worktree list — refuse). On success the endpoint returns `{ ok: true }`.

The endpoint is designed for one purpose: unblocking the worktree-spawn dialog when a previous failed attempt left an orphan directory. It is deliberately conservative — anything that looks like real work refuses.

#### Scenario: Cleanup succeeds on small orphan dir
- **WHEN** `path` exists, is a directory, contains only 2 stray files (e.g. `tsconfig.json`, `vitest.config.ts`), has no `.git` entry, and is NOT in the worktree list
- **THEN** the endpoint SHALL delete the directory recursively and return `{ ok: true }` with HTTP 200

#### Scenario: Refuse on registered worktree
- **WHEN** `path` IS present in `git worktree list --porcelain`
- **THEN** the endpoint SHALL refuse with code `not_orphan` and HTTP 409
- **THEN** the directory SHALL NOT be touched

#### Scenario: Refuse when .git entry present
- **WHEN** the orphan dir contains a top-level `.git` file or directory
- **THEN** the endpoint SHALL refuse with code `looks_like_worktree` and HTTP 409

#### Scenario: Refuse on too many files
- **WHEN** the orphan dir contains more than 20 files at any depth
- **THEN** the endpoint SHALL refuse with code `too_many_files` and HTTP 409

#### Scenario: Refuse on large file
- **WHEN** any file inside the orphan dir exceeds 1 MB
- **THEN** the endpoint SHALL refuse with code `file_too_large` and HTTP 409

#### Scenario: Refuse on path-traversal attempt
- **WHEN** `path` is not under `cwd` (e.g. `/etc/passwd` or `../../somewhere`)
- **THEN** the endpoint SHALL refuse with code `outside_repo` and HTTP 400

### Requirement: path_exists envelope carries orphanLikely
The `POST /api/git/worktree` endpoint SHALL extend its `path_exists` error envelope with a boolean `orphanLikely` field. The field SHALL be `true` when the target path exists on disk but is NOT present in `git worktree list --porcelain`, and `false` otherwise (including when the path IS a registered worktree).

#### Scenario: Orphan dir collision sets orphanLikely true
- **WHEN** the target path exists on disk and is NOT a registered worktree
- **THEN** the response body SHALL be `{ ok: false, code: "path_exists", orphanLikely: true, ... }`

#### Scenario: Registered-worktree collision sets orphanLikely false
- **WHEN** the target path IS already a registered worktree
- **THEN** the response body SHALL be `{ ok: false, code: "path_exists", orphanLikely: false, ... }`

### Requirement: Worktree init-status endpoint

The server SHALL expose `GET /api/git/worktree/init-status` (localhost-only) reporting whether a checkout needs initialization per its declared hook. Query/body carries `cwd`. The server SHALL validate `cwd`, resolve the repo root, and `readInitHook(repoRoot)`.

- When no hook is declared, respond `{ success: true, data: { hasHook: false, configured: boolean } }`, where `configured` distinguishes an unconfigured directory from a configured project that simply declares no `worktreeInit` hook:
  - `configured: false` when the resolved config root is `null` (no reachable `.pi/settings.json`) — the directory is not yet a pi project.
  - `configured: true` when a config root resolves and `<configRoot>/.pi/settings.json` exists but declares no (valid) `worktreeInit` hook — the directory is already a pi project.
- When a hook is declared but NOT trusted, respond `{ success: true, data: { hasHook: true, trusted: false } }` WITHOUT evaluating the gate (the gate is repo-declared bash and SHALL NOT run before TOFU trust).
- When a hook is declared AND trusted, evaluate the gate (using the cache) and respond `{ success: true, data: { hasHook: true, needsInit: boolean, trusted: true } }`.

The `configured` field SHALL be present only on `hasHook: false` responses; it SHALL be absent when `hasHook` is `true`. The endpoint replaces the removed `GET /api/git/worktree/bootstrap-status`.

#### Scenario: Unconfigured directory reports configured false

- **WHEN** `init-status` is requested for a directory with no reachable `.pi/settings.json` (config root is `null`)
- **THEN** the response SHALL be `{ success: true, data: { hasHook: false, configured: false } }`

#### Scenario: Configured project without a hook reports configured true

- **WHEN** `init-status` is requested for a checkout whose resolved config root has a `.pi/settings.json` that declares no valid `worktreeInit` hook
- **THEN** the response SHALL be `{ success: true, data: { hasHook: false, configured: true } }`

#### Scenario: Hook present but untrusted does not run the gate

- **WHEN** `init-status` is requested for a checkout whose hook is not yet trusted
- **THEN** the server SHALL NOT spawn the gate
- **AND** the response SHALL be `{ hasHook: true, trusted: false }` with no `needsInit`
- **AND** the response SHALL NOT include a `configured` field

#### Scenario: Hook present + trusted, gate says needs init

- **WHEN** the hook is trusted AND the gate exits `0` for the checkout
- **THEN** the response SHALL include `{ hasHook: true, needsInit: true, trusted: true }`

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

### Requirement: List pull requests endpoint

The server SHALL expose `GET /api/git/pull-requests?cwd=…` returning the open pull requests for the repository at `cwd`. The endpoint SHALL run behind the `networkGuard` preHandler and SHALL resolve the `gh` binary via the tool registry before invoking it.

The handler SHALL shell out to `gh pr list --json number,title,headRefName,headRefOid,author,isDraft,isCrossRepository,statusCheckRollup --limit 100`, parse the result into a `PullRequestInfo[]`, and collapse each PR's `statusCheckRollup` into a single `checkRollup` summary (`"passing" | "failing" | "pending" | "none"`).

`gh` failures SHALL map to stable codes consistent with the existing PR-create route: `gh_not_found` when the binary is unresolved, `gh_not_authed` when authentication fails, `no_remote` when no GitHub remote is configured.

#### Scenario: Successful list

- **WHEN** a client requests `GET /api/git/pull-requests?cwd=<repo>` for a repo with open PRs and an authenticated `gh`
- **THEN** the response SHALL be `{ success: true, data: PullRequestInfo[] }`
- **AND** each entry SHALL carry `number`, `title`, `headRefName`, `headRefOid`, `author`, `isDraft`, `isCrossRepository`, and `checkRollup`

#### Scenario: gh binary not found

- **WHEN** the `gh` binary cannot be resolved via the tool registry
- **THEN** the response SHALL be a failure envelope with code `gh_not_found` and HTTP status 400
- **AND** no `gh` subprocess SHALL be spawned

#### Scenario: gh not authenticated

- **WHEN** `gh pr list` fails because the user is not authenticated
- **THEN** the response SHALL be a failure envelope with code `gh_not_authed` and HTTP status 401

#### Scenario: No GitHub remote

- **WHEN** the repository has no GitHub remote configured
- **THEN** the response SHALL be a failure envelope with code `no_remote` and HTTP status 400

#### Scenario: Invalid cwd

- **WHEN** the `cwd` query parameter fails validation
- **THEN** the response SHALL be a failure envelope with HTTP status 400 and SHALL NOT invoke `gh`

### Requirement: Create worktree from pull request endpoint

The server SHALL expose `POST /api/git/worktree/from-pr` accepting `{ cwd: string; prNumber: number; path?: string }`. The endpoint SHALL run behind `networkGuard`, validate `cwd`, and resolve `gh` before proceeding.

The handler SHALL materialise the pull request's head commit into a new git worktree without modifying the repository's current working tree. The worktree SHALL be checked out at the PR head, on a local branch derived from the PR number (`pr-<number>` unless the spike decides otherwise). The mechanic SHALL handle pull requests originating from forks (`isCrossRepository: true`), not only same-repository PRs.

The handler SHALL reuse the worktree-creation success/failure contract of the existing create-worktree endpoint: 409 for `branch_exists` / `branch_in_use` / `path_exists`, 400 for `not_a_repo` / `base_not_found`, plus `pr_not_found` (404) and `gh_not_authed` (401) for PR-specific failures.

#### Scenario: Same-repository PR checkout

- **WHEN** a client posts `{ cwd, prNumber }` for an open same-repo PR
- **THEN** a new worktree SHALL be created at the PR head commit
- **AND** the response SHALL be `{ success: true, data: { path, branch, prNumber } }`
- **AND** the repository's pre-existing working tree HEAD SHALL be unchanged

#### Scenario: Fork PR checkout

- **WHEN** a client posts `{ cwd, prNumber }` for an open PR whose head is on a fork (`isCrossRepository: true`)
- **THEN** the worktree SHALL still be created at the PR head commit
- **AND** the operation SHALL NOT require pre-existing fork-remote configuration

#### Scenario: PR not found

- **WHEN** the posted `prNumber` does not correspond to an open PR
- **THEN** the response SHALL be a failure envelope with code `pr_not_found` and HTTP status 404

#### Scenario: Re-checkout collision

- **WHEN** a worktree or local branch for the same PR already exists
- **THEN** the response SHALL reuse the existing `branch_exists` / `branch_in_use` / `path_exists` codes with HTTP status 409
- **AND** the existing worktree SHALL NOT be silently overwritten

#### Scenario: gh unavailable

- **WHEN** `gh` cannot be resolved or the user is not authenticated
- **THEN** the response SHALL be `gh_not_found` (400) or `gh_not_authed` (401) respectively
- **AND** no worktree SHALL be created

### Requirement: Active worktree-inits endpoint
The server SHALL expose `GET /api/git/worktree/active-inits` returning the current
worktree-init runs known to the cwd-keyed registry: all `running` entries plus any terminal
entries still within their retention TTL.

#### Scenario: Reports a running run
- **WHEN** an init run for `cwd` is in flight and `GET /api/git/worktree/active-inits` is called
- **THEN** the response SHALL include an entry for `cwd` with `phase: "running"`, `startedAt`, and the latest `lastLine` when available

#### Scenario: Reports a recent terminal run
- **WHEN** a run for `cwd` finished within the retention TTL
- **THEN** the response SHALL include an entry for `cwd` with `phase: "done"` or `phase: "failed"` (with `code` on failure)

#### Scenario: Omits expired and absent runs
- **WHEN** no run for a `cwd` is running and none finished within the TTL
- **THEN** the response SHALL NOT include an entry for that `cwd`

### Requirement: Worktree-init progress channel is cwd-addressable
The worktree-init progress channel SHALL accept subscriptions addressed by `cwd` in addition
to the existing client-minted `requestId`, and progress/done/failed messages SHALL carry the
run's `cwd`. The existing `requestId`-addressed delivery SHALL continue to work for
back-compat.

#### Scenario: cwd subscription receives events
- **WHEN** a client sends `worktree_init_subscribe` addressed by `cwd`
- **THEN** the server SHALL deliver subsequent progress/done/failed events for that run to the subscriber
- **AND** each message SHALL include the run's `cwd`

#### Scenario: requestId subscription still works
- **WHEN** a client subscribes by the legacy `requestId`
- **THEN** the server SHALL still deliver that run's events to the requestId subscriber

