## ADDED Requirements

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
The server SHALL expose `POST /api/git/worktree` (localhost-only) creating a new git worktree. Request body: `{ cwd: string, base: string, newBranch: string, path?: string, force?: boolean }`.

The endpoint SHALL:
1. Realpath-validate `cwd` and confirm it is inside a git repository.
2. Derive `path` if absent: `<repo-root>/.worktrees/<slug(newBranch)>`. The repo root SHALL be `git rev-parse --show-toplevel` of `cwd` (so opening the dialog from inside a sibling worktree still resolves to the parent repo).
3. Refuse with `path_exists` if the derived or supplied path already exists on disk (regardless of `force`, unless the existing path is empty).
4. Run `git worktree add -b <newBranch> <path> <base>` (or with `--force` when `force === true`).
5. On success, append the line `.worktrees/` (with trailing slash, no leading slash) to `<repo-root>/.git/info/exclude` if and only if that exact line is not already present. SHALL NOT touch `.gitignore`. SHALL NOT fail the request if the exclude-write itself fails (log warning, continue).
6. Return `{ path: string, branch: string }`.

Error response shape: `{ success: false, error: <code>, message: <human>, stderr?: string }`. Stable codes:
- `not_a_repo` — cwd not in a git repository
- `cwd_invalid` — cwd missing or fails realpath
- `branch_in_use` — newBranch already checked out elsewhere
- `branch_exists` — newBranch already exists (when no `--force`)
- `path_exists` — target path already exists and is not empty
- `base_not_found` — base ref does not resolve
- `git_failed` — any other git failure (preserve stderr)

#### Scenario: Successful create with auto-derived path
- **WHEN** `POST /api/git/worktree` is called with `{ cwd: "/repo", base: "develop", newBranch: "feat/dark-mode" }`
- **THEN** the server SHALL derive path `/repo/.worktrees/feat-dark-mode`
- **AND** run `git worktree add -b feat/dark-mode /repo/.worktrees/feat-dark-mode develop`
- **AND** return `{ path: "/repo/.worktrees/feat-dark-mode", branch: "feat/dark-mode" }`
- **AND** ensure `.worktrees/` is in `/repo/.git/info/exclude` (appending if absent)

#### Scenario: Successful create with explicit path
- **WHEN** the request includes `path: "/custom/place"`
- **THEN** the server SHALL use the explicit path verbatim
- **AND** SHALL NOT modify `.git/info/exclude` (the user is opting out of the convention)

#### Scenario: Slug derivation
- **WHEN** `newBranch` is `"feat/Dark Mode!"`
- **THEN** the derived slug SHALL be `feat-dark-mode`
- **AND** the derived path SHALL be `<repo-root>/.worktrees/feat-dark-mode`

#### Scenario: Branch already checked out elsewhere
- **WHEN** `newBranch` is already checked out in another worktree
- **THEN** the response SHALL be `{ success: false, error: "branch_in_use", ... }`

#### Scenario: Path collision
- **WHEN** the derived or supplied path already exists and contains files
- **THEN** the response SHALL be `{ success: false, error: "path_exists", ... }`
- **AND** the server SHALL NOT run `git worktree add`

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
