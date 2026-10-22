## ADDED Requirements

### Requirement: Git endpoints admit the cwd before endpoint-specific validation
Every `/api/git/*` endpoint that accepts a `cwd` SHALL admit it (see
`core-cwd-admission`) before any other check on it, other than presence and type. A cwd
that is not admitted SHALL be refused with `400 { success: false, code:
"cwd_unknown" }` and a message stating it is not a known folder and the
repository can be pinned. Admission SHALL take precedence over every
endpoint-specific outcome (e.g. `not_a_repo`).

#### Scenario: Unknown directory on worktree create
- **WHEN** a worktree create request names an existing directory that is not admitted
- **THEN** the response SHALL be 400 `cwd_unknown` with the not-a-known-folder message, and no `git worktree` command SHALL run

#### Scenario: Unknown directory on a mutating lifecycle endpoint
- **WHEN** a remove, prune, merge, push or PR-create request names an existing directory that is not admitted
- **THEN** the response SHALL be 400 `cwd_unknown`, and no git command SHALL run

#### Scenario: Unknown directory on git init
- **WHEN** a `POST /api/git/init` request names an existing directory that is not admitted
- **THEN** the response SHALL be 400 `cwd_unknown`, and no repository SHALL be created

#### Scenario: Unknown directory on branch checkout
- **WHEN** a `POST /api/git/checkout` request names an existing directory that is not admitted
- **THEN** the response SHALL be 400 `cwd_unknown`, and no git command SHALL run

#### Scenario: Unknown non-repository directory
- **WHEN** a HEAD request names an existing non-repository directory that is not admitted
- **THEN** the response SHALL be 400 `cwd_unknown`, not `not_a_repo`

#### Scenario: Known non-repository directory
- **WHEN** a HEAD request names a pinned directory that is not a git repository
- **THEN** the response SHALL be `not_a_repo` as before this change

### Requirement: Git cwd validation codes extend the stable code sets
An omitted cwd SHALL keep `cwd_invalid` "cwd required". An admitted cwd that does
not exist or is not a directory SHALL keep `cwd_invalid` with its existing
message. `cwd_unknown` and `cwd-admission-unavailable` SHALL extend every git
endpoint's set of stable error codes.

#### Scenario: Unknown missing path reveals no existence
- **WHEN** a git request names a path that does not exist and is not a known folder
- **THEN** the response SHALL be 400 `cwd_unknown`

#### Scenario: Known missing path keeps its message
- **WHEN** a git request names a session cwd whose directory was deleted
- **THEN** the response SHALL be 400 `cwd_invalid` with message `cwd does not exist`

#### Scenario: Omitted cwd unchanged
- **WHEN** a git request omits `cwd`
- **THEN** the response SHALL be 400 `cwd_invalid` with message `cwd required`

## MODIFIED Requirements

### Requirement: Four worktree-lifecycle endpoints registered
The server SHALL register the four new endpoints under `/api/git/worktree/*` defined in the `worktree-lifecycle` capability:

- `POST /api/git/worktree/remove`
- `POST /api/git/worktree/merge`
- `POST /api/git/worktree/push`
- `POST /api/git/worktree/pr`
- `GET /api/git/worktree/diff-stat`

Every route SHALL apply `validateCwd`, which admits the `cwd` with the shared cwd admission guard before any other check (see "Git endpoints admit the cwd before endpoint-specific validation"), and SHALL be gated on loopback / trusted-bypass like the existing `POST /api/git/worktree` (create) route.

#### Scenario: All routes accept POST/GET shape from existing dialog
- **WHEN** any of the four routes is called with a valid cwd
- **THEN** the request body shape SHALL match what `git-api.ts` client helpers send

#### Scenario: Non-loopback origin rejected
- **WHEN** the request originates from a non-loopback address and is not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope


### Requirement: Read HEAD endpoint
The server SHALL expose `GET /api/git/head?cwd=<path>` (localhost-only) returning the current HEAD state of the given directory. The endpoint SHALL be used by the worktree dialog to compute its default base branch.

Response shape: `{ branch: string | null, detached: boolean, sha: string | null }`. On error, `{ success: false, error: <code>, message: <human> }` with stable codes (`not_a_repo`, `cwd_invalid`, `cwd_unknown`, `cwd-admission-unavailable`, `git_failed`).

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
- **WHEN** the `cwd` query parameter is absent, or names an admitted path that does not exist or is not a directory
- **THEN** the response SHALL be `{ success: false, error: "cwd_invalid" }`

#### Scenario: Cwd not admitted
- **WHEN** the `cwd` query parameter names a path the cwd admission guard refuses
- **THEN** the response SHALL carry `cwd_unknown`

#### Scenario: Localhost-only
- **WHEN** the request originates from a non-loopback address and is not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope


### Requirement: Create worktree endpoint

The server SHALL expose `POST /api/git/worktree` (localhost-only) creating a new git worktree. Request body: `{ cwd: string, base: string, newBranch?: string, path?: string, force?: boolean }`.

The endpoint SHALL:

1. Realpath-validate `cwd` and resolve the repository's main checkout (see "Worktree operations anchor at the resolved main checkout"). When no main checkout resolves, the endpoint SHALL refuse with `not_a_repo` and SHALL NOT proceed to any later step.
2. Derive `path` if absent:
   - When `newBranch` is provided: `<main-checkout>/.worktrees/<slug(newBranch)>`.
   - When `newBranch` is absent: `<main-checkout>/.worktrees/<slug(localNameOf(base))>` where `localNameOf("origin/foo") === "foo"` and `localNameOf("foo") === "foo"`.
   The repo root SHALL be the RESOLVED MAIN CHECKOUT. It SHALL NOT be resolved via `git rev-parse --git-common-dir` walked to its parent: that derivation names a path under `.git/` for a submodule and a path owning no checkout for a bare hub. The path SHALL still land consistently regardless of which sibling worktree opened the dialog.
3. Refuse with `path_exists` if the derived or supplied path already exists on disk and is not empty.
4. Run the appropriate git command:
   - When `newBranch` is provided: `git worktree add -b <newBranch> <path> <base>` (fork mode; current behaviour).
   - When `newBranch` is absent: `git worktree add <path> <base>` (checkout mode; relies on git DWIM to create a tracking branch when `base` is `origin/<x>` and no matching local branch exists).
   - `--force` SHALL be passed when `force === true` in either mode.
5. On success, append the line `.worktrees/` to the repository's `info/exclude` inside its COMMON GIT DIRECTORY iff that exact line is not already present. The location SHALL NOT be assumed to be `<repo-root>/.git/info/exclude`: for a submodule and a `--separate-git-dir` checkout the git directory is not a `.git` child of the checkout. SHALL NOT touch `.gitignore`. SHALL NOT fail the request if the exclude-write fails (log warning, continue).
6. Return `{ path: string, branch: string }`. In checkout mode, `branch` SHALL be the locally-checked-out branch name (for `base = "origin/foo"` DWIM, `branch === "foo"`, not `"origin/foo"`).

The endpoint SHALL NOT run any initialization or dependency-install step. Initialization is delegated to the gated, manually-triggered worktree-init hook (`GET /api/git/worktree/init-status` + `POST /api/git/worktree/init`).

Error response shape: `{ success: false, error: <code>, message: <human>, stderr?: string }`. Stable codes: `not_a_repo`, `cwd_invalid`, `cwd_unknown`, `cwd-admission-unavailable`, `branch_in_use`, `branch_exists`, `path_exists`, `base_not_found`, `git_failed`.

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

#### Scenario: Submodule derives its path under the submodule checkout

- **GIVEN** `cwd` is inside a submodule whose git dir is `<super>/.git/modules/<name>`
- **WHEN** `POST /api/git/worktree` is called without an explicit `path`
- **THEN** the derived path SHALL be under the submodule's working tree
- **AND** it SHALL NOT be under `<super>/.git/`

#### Scenario: Bare hub refuses instead of deriving a path

- **GIVEN** `cwd` is inside a bare repository or a worktree of a bare hub
- **WHEN** `POST /api/git/worktree` is called
- **THEN** the server SHALL return `not_a_repo`
- **AND** no directory SHALL be created on disk

#### Scenario: No auto-init on create

- **WHEN** a worktree is created (in either mode) for a repo that declares a `worktreeInit` hook
- **THEN** the create endpoint SHALL NOT execute the hook

#### Scenario: Idempotent exclude append

- **WHEN** the worktree is created and the repository's `info/exclude` already contains the line `.worktrees/`
- **THEN** the server SHALL NOT append a duplicate line

#### Scenario: Localhost-only

- **WHEN** the request originates from a non-loopback address not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope

### Requirement: Worktree operations anchor at the resolved main checkout

Every server-side worktree operation SHALL derive the repository's main
checkout from the shared checkout-root resolver (the `mainCheckout` fact of
`packages/shared/src/platform/git.ts`), and SHALL NOT derive it from the parent
directory of `git rev-parse --git-common-dir`.

The resolved main checkout SHALL additionally be rejected by the server when it
carries a `.git` path SEGMENT (exact component equality; a checkout located at
`/work/app.git` SHALL NOT be rejected).

When no main checkout resolves — a bare repository, a worktree of a bare hub,
an inconclusive probe, or a rejected `.git`-segment path — the operation SHALL
REFUSE with its established error code and SHALL NOT substitute the request
`cwd`, the containing checkout, or any path derived from the git directory:

- `POST /api/git/worktree` and `POST /api/git/worktree/from-pr` SHALL return
  `not_a_repo` and SHALL NOT derive or create a worktree path — including when
  an explicit `path` was supplied, because the anchor also bounds where a
  worktree may be created;
- `POST /api/git/worktree/{merge,prune}` and
  `GET /api/git/worktree/diff-stat` SHALL return `not_a_worktree`;
- `POST /api/git/worktree/{remove,remove-batch}` SHALL refuse via the
  removal-guard classification below, which owns their refusal codes; the
  generic `not_a_worktree` SHALL NOT be returned by those endpoints for an
  unresolved main checkout;
- `POST /api/git/worktree/orphan-cleanup` SHALL return `outside_repo`.

`POST /api/git/worktree/push` and `POST /api/git/worktree/pr` SHALL NOT be
made to depend on the resolved main checkout. Both operate entirely within the
request `cwd` (`git push`, `gh pr create`) and succeed today in states where no
main checkout resolves; requiring an anchor they never consumed would remove
working behaviour. Any residual unread main-checkout resolution in those paths
SHALL be deleted rather than converted into a refusal.

The resolution SHALL be performed at most ONCE PER DISTINCT `cwd` per request
and threaded to the operation, and SHALL be issued with an explicit per-probe
timeout suited to a request path rather than the default batch-job budget. A
batch endpoint that classifies per item resolves once per item `cwd`; it SHALL
NOT resolve the same `cwd` twice within one request. The cwd admission guard's own
main-checkout derivation (see `core-cwd-admission`) is a guard probe that runs
before the operation and is not counted as this resolution.

#### Scenario: Submodule checkout resolves to the submodule working tree
- **GIVEN** `cwd` is inside a submodule whose git dir is `<super>/.git/modules/<name>`
- **WHEN** any worktree operation resolves the main checkout for that `cwd`
- **THEN** the resolved path SHALL be the submodule's working tree
- **AND** it SHALL NOT be a path under `<super>/.git/`

#### Scenario: Worktree of a submodule resolves to the submodule working tree
- **GIVEN** `cwd` is a linked worktree created from inside a submodule
- **WHEN** any worktree operation resolves the main checkout for that `cwd`
- **THEN** the resolved path SHALL be the submodule's working tree

#### Scenario: Separate-git-dir checkout resolves to its working tree
- **GIVEN** a checkout created with `--separate-git-dir`, whose git dir lives outside the checkout
- **WHEN** any worktree operation resolves the main checkout for that `cwd`
- **THEN** the resolved path SHALL be the checkout itself
- **AND** it SHALL NOT be the parent directory of the separate git dir

#### Scenario: Worktree of a bare hub refuses rather than guessing a root
- **GIVEN** `cwd` is a linked worktree of a bare repository
- **WHEN** `POST /api/git/worktree/merge` is called for that `cwd`
- **THEN** the response SHALL be a refusal with code `not_a_worktree`
- **AND** no git command SHALL be run against the bare hub's parent directory

#### Scenario: Removal endpoints use the guard code, not the generic one
- **GIVEN** `cwd` is a linked worktree of a bare repository
- **WHEN** `POST /api/git/worktree/remove` is called for that `cwd`
- **THEN** the refusal code SHALL be `main_checkout_unresolved`
- **AND** it SHALL NOT be `not_a_worktree`

#### Scenario: Create refuses instead of deriving a path under a git dir
- **GIVEN** a `cwd` for which no main checkout resolves
- **WHEN** `POST /api/git/worktree` is called without an explicit `path`
- **THEN** the response SHALL be `not_a_repo`
- **AND** no directory SHALL be created on disk

#### Scenario: Create with an explicit path also refuses when unresolved
- **GIVEN** `cwd` is inside a bare repository, so no main checkout resolves
- **WHEN** `POST /api/git/worktree` is called WITH an explicit `path`
- **THEN** the response SHALL be `not_a_repo`
- **AND** no directory SHALL be created on disk

#### Scenario: Push and PR still work where no main checkout resolves
- **GIVEN** `cwd` is a linked worktree of a bare hub, so no main checkout resolves
- **WHEN** `POST /api/git/worktree/push` or `POST /api/git/worktree/pr` is called
- **THEN** the operation SHALL proceed against `cwd` as it does today
- **AND** it SHALL NOT be refused with `not_a_worktree`

#### Scenario: Merge and diff-stat refuse with 400, not 500
- **GIVEN** a `cwd` for which no main checkout resolves
- **WHEN** `POST /api/git/worktree/merge` or `GET /api/git/worktree/diff-stat` is called
- **THEN** the response code SHALL be `not_a_worktree` with HTTP 400
- **AND** it SHALL NOT be the previous `git_failed` with HTTP 500

#### Scenario: Resolved root carrying a .git segment is rejected
- **GIVEN** a repository whose repo-local `core.worktree` points at a path containing a `.git` path component
- **WHEN** a worktree operation resolves the main checkout for that `cwd`
- **THEN** the resolution SHALL be treated as unresolved
- **AND** the operation SHALL refuse with its established error code

#### Scenario: Admission derivation is not the anchor resolution
- **WHEN** a remove request names a sessionless linked worktree of a pinned repository, so admission derives its main checkout
- **THEN** the remove operation SHALL still resolve its anchor at most once for that `cwd`
