## ADDED Requirements

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
NOT resolve the same `cwd` twice within one request.

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

### Requirement: Main-worktree removal guard fails closed

The removal endpoints (`POST /api/git/worktree/remove` and
`POST /api/git/worktree/remove-batch`) SHALL classify each requested `cwd` as
exactly one of `main`, `removable`, or `unresolved`, derived from the shared
resolver rather than from a path equality against a derived root:

- resolver returns no result (non-repo, failed probe) → `unresolved`;
- the cwd is NOT a linked worktree (main checkout, a subdirectory of it, a
  submodule, a `--separate-git-dir` checkout, a bare repository) → `main`;
- the cwd IS a linked worktree but its OWN checkout root did not resolve (an
  inconclusive working-tree probe) → `unresolved`, even when a main checkout
  resolved from configuration — a partially-answered probe SHALL NOT authorise
  a delete;
- the cwd IS a linked worktree but no main checkout resolves, or the resolved
  main checkout carries a `.git` path segment → `unresolved`;
- the cwd IS a linked worktree with a plausible resolved main checkout →
  `removable`.

Only `removable` SHALL proceed to `git worktree remove`. `main` SHALL be
refused with code `is_main_worktree` and HTTP 400. `unresolved` SHALL be
refused with code `main_checkout_unresolved` and HTTP 400. A refusal SHALL NOT
delete, sweep, or modify anything on disk. The two refusals SHALL NOT be
collapsed into one code: "this is the main worktree" is not a truthful reason
for a repository whose main checkout could not be resolved.

In `remove-batch`, the classification SHALL be per item, SHALL NOT abort the
batch, and SHALL be reported in the item's `code` field in input order.

#### Scenario: Worktree of a bare hub is refused, not removed
- **GIVEN** `cwd` is a linked worktree of a bare repository, so no main checkout resolves
- **WHEN** `POST /api/git/worktree/remove` is called for that `cwd`
- **THEN** the response SHALL be `{ success: false, code: "main_checkout_unresolved" }` with HTTP 400
- **AND** the worktree directory SHALL still exist on disk

#### Scenario: Subdirectory of the main checkout is classified main
- **GIVEN** `cwd` is `<main>/src`, a subdirectory of the main checkout
- **WHEN** `POST /api/git/worktree/remove` is called for that `cwd`
- **THEN** the response SHALL be code `is_main_worktree` with HTTP 400
- **AND** no `git worktree remove` SHALL be invoked

#### Scenario: Submodule checkout is classified main
- **GIVEN** `cwd` is a submodule working tree (not a linked worktree)
- **WHEN** `POST /api/git/worktree/remove` is called for that `cwd`
- **THEN** the response SHALL be code `is_main_worktree` with HTTP 400

#### Scenario: Inconclusive working-tree probe is refused
- **GIVEN** `cwd` is a linked worktree whose main checkout resolves from repository configuration
- **AND** the working-tree probe for `cwd` itself yields no result
- **WHEN** `POST /api/git/worktree/remove` is called for that `cwd`
- **THEN** the response SHALL be code `main_checkout_unresolved` with HTTP 400
- **AND** nothing SHALL be deleted

#### Scenario: Ordinary linked worktree is still removable
- **GIVEN** `cwd` is a linked worktree of an ordinary checkout
- **WHEN** `POST /api/git/worktree/remove` is called for that `cwd`
- **THEN** the removal SHALL proceed as before

#### Scenario: Batch reports per-item classification without aborting
- **GIVEN** a batch of three items: an ordinary linked worktree, a main checkout, and a worktree of a bare hub
- **WHEN** `POST /api/git/worktree/remove-batch` is called
- **THEN** the response SHALL contain three results in input order
- **AND** their codes SHALL be success, `is_main_worktree`, and `main_checkout_unresolved` respectively

### Requirement: Batch removal cap is configurable

The maximum number of items `POST /api/git/worktree/remove-batch` accepts SHALL
be read from dashboard configuration rather than being a compile-time constant.
The default SHALL remain 50, so an existing deployment that sets nothing keeps
today's behaviour exactly.

The configured value SHALL be clamped into a bounded range and SHALL fall back
to the default when absent or not a positive integer. Both ends of the range
are failure modes rather than preferences: a cap of zero disables an endpoint
the UI depends on, and an unbounded cap turns one request into an unbounded
sequence of blocking removals on the event loop.

A request whose item count exceeds the EFFECTIVE cap SHALL be rejected with the
existing stable code `batch_too_large`, and the error message SHALL name the
effective cap rather than a hardcoded number. No git command SHALL run for a
rejected batch.

This requirement changes only WHERE the cap comes from. Per-item
classification, input ordering, and the no-abort rule are unchanged.

#### Scenario: Unset configuration keeps the default cap
- **GIVEN** no batch cap is configured
- **WHEN** a batch of 50 items is posted
- **THEN** the batch SHALL be accepted
- **AND** a batch of 51 items SHALL be rejected with `batch_too_large`

#### Scenario: Configured cap is honoured at its boundary
- **GIVEN** the batch cap is configured to 10
- **WHEN** a batch of 10 items is posted
- **THEN** the batch SHALL be accepted
- **AND** a batch of 11 items SHALL be rejected with `batch_too_large`
- **AND** no git command SHALL run for the rejected batch

#### Scenario: Invalid configured cap falls back to the default
- **GIVEN** the batch cap is configured to a non-positive, non-integer, or non-numeric value
- **WHEN** a batch is posted
- **THEN** the effective cap SHALL be the default
- **AND** the endpoint SHALL NOT reject every batch, and SHALL NOT accept an unbounded one

#### Scenario: Rejection message names the effective cap
- **GIVEN** the batch cap is configured to a value other than the default
- **WHEN** an oversized batch is rejected
- **THEN** the error message SHALL state the effective cap
- **AND** it SHALL NOT state a stale hardcoded number


## MODIFIED Requirements

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

### Requirement: List worktrees endpoint
The server SHALL expose `GET /api/git/worktrees?cwd=<path>` (localhost-only) returning every worktree of the repository containing `cwd`. The endpoint SHALL parse `git worktree list --porcelain` output.

Response shape: `{ worktrees: Array<{ path: string, branch: string | null, sha: string, bare: boolean, detached: boolean, isMain: boolean, exists: boolean }> }`. `path` SHALL be the absolute path returned by git. `branch` SHALL be the branch name with `refs/heads/` stripped, or `null` for detached / bare. `exists` SHALL report whether the registration's directory is present on disk; it is not derivable client-side, and without it a client cannot distinguish a live worktree from a stale registration that `remove` can never clear.

`isMain` SHALL be `true` for AT MOST ONE entry — the entry whose path is the repository's resolved main checkout, compared with the platform path comparison helper. `isMain` SHALL NOT be derived from the position of the record in porcelain output: for a bare repository, a submodule, and a `--separate-git-dir` checkout the first record is the git directory, not a checkout. The porcelain PARSER SHALL NOT stamp `isMain` positionally at all; the flag SHALL be assigned only from the resolved main checkout, so a path that never reaches the resolution cannot inherit a positional `true`. The resolved main checkout used here SHALL carry the same `.git`-path-segment rejection the operational anchor carries, so a repository-configured working-tree path pointing at a git directory cannot mark that record as the main checkout. When no main checkout resolves (a bare hub), NO entry SHALL be `isMain`; the `bare` flag remains the signal for the hub record.

This narrows `isMain` from "exactly one" to "at most one" and is therefore NOT a purely additive change: clients that assume a main entry always exists SHALL be updated in the same change. Specifically, a client surface listing worktrees SHALL NOT collapse to an empty default view when no entry is `isMain`, and SHALL NOT offer a removal affordance (per-row control or batch selection) for a bare repository's hub record merely because that record is no longer flagged `isMain`.

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

#### Scenario: Client tolerates a list with no main entry
- **GIVEN** a bare repository, for which no entry is `isMain`
- **WHEN** a client surface that selects the main entry renders the list
- **THEN** it SHALL render without error
- **AND** it SHALL NOT dereference an absent main entry

#### Scenario: Default view is not empty when no entry is main
- **GIVEN** a bare repository with one linked worktree, so no entry is `isMain`
- **WHEN** the worktree list renders in its default (unfiltered) view
- **THEN** the registered entries SHALL be visible
- **AND** the list SHALL NOT require a reveal control to show them

#### Scenario: Bare hub record offers no removal affordance
- **GIVEN** a bare repository whose hub record has `bare: true` and `isMain: false`
- **WHEN** the worktree list renders
- **THEN** that record SHALL NOT offer a per-row removal control
- **AND** it SHALL NOT be selectable for batch removal

#### Scenario: Bare hub record is never reported as main
- **GIVEN** a bare repository with one linked worktree
- **WHEN** the endpoint is called from the linked worktree
- **THEN** the bare hub entry SHALL have `isMain: false` and `bare: true`
- **AND** no entry SHALL have `isMain: true`

#### Scenario: Submodule never stamps a git-dir row main
- **GIVEN** `cwd` is inside a submodule
- **WHEN** the endpoint is called
- **THEN** no entry under `<super>/.git/` SHALL have `isMain: true`
- **AND** when the submodule's working tree appears as a record, that record SHALL be the main entry; git reports the main registration at the module git-dir path, so typically NO entry is main (the shape is "at most one", not "exactly one")

### Requirement: Orphan worktree path cleanup endpoint
The server SHALL expose `POST /api/git/worktree/orphan-cleanup` (localhost-gated) accepting `{ cwd: string, path: string }`. The endpoint SHALL delete `path` from disk if and only if ALL of the following hold:

- the repository containing `cwd` has a resolved main checkout (see "Worktree operations anchor at the resolved main checkout"),
- `path` is inside that resolved main checkout (anti-traversal), compared both logically and AFTER resolving symbolic links on both the target and the anchor,
- `path` exists and is a directory,
- `path` is NOT present in `git worktree list --porcelain` for `cwd`,
- `path` does NOT contain any `.git` entry (file or directory) at its top level,
- `path` contains no more than 20 files (default cap),
- no single file at `path` exceeds 1 MB (default cap).

The containment anchor SHALL be the resolved main checkout, not the request `cwd` and not the parent of the git common directory — an orphan directory SHALL remain cleanable from any worktree of the repository, and SHALL NOT be cleanable through a git directory's unrelated parent.

Refusals SHALL return stable error codes: `outside_repo`, `not_a_directory`, `looks_like_worktree`, `too_many_files`, `file_too_large`, `not_orphan` (path is in worktree list — refuse), `fs_failed` (a filesystem operation failed for a reason other than the target being absent — including a symlink resolution that fails with anything but a not-found error). On success the endpoint returns `{ ok: true }`.

The guards SHALL be evaluated in an order that keeps each refusal truthful: the logical containment test SHALL precede the existence check, the existence check SHALL precede symlink resolution, and symlink resolution SHALL precede the remaining guards. The relative order of the existing guards among themselves SHALL be preserved, so that an input matching several guards keeps the code it returns today. Resolving symbolic links on a path that does not exist fails, and that failure SHALL NOT be reported as `outside_repo` when the correct refusal is `not_a_directory`. A symlink resolution that fails for any other reason SHALL be refused with `fs_failed`, never passed. When the target passes the existence check but is gone by the time symbolic links are resolved, the endpoint SHALL refuse with `not_a_directory`; a target that disappears mid-check SHALL NOT fall through to any later guard, and SHALL NOT be reported as success.

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

#### Scenario: Missing path refuses as not_a_directory, not outside_repo
- **GIVEN** `path` is inside the resolved main checkout but does not exist on disk
- **WHEN** the endpoint is called
- **THEN** the endpoint SHALL refuse with code `not_a_directory`
- **AND** it SHALL NOT refuse with `outside_repo` or surface an unhandled error

#### Scenario: Refuse on path-traversal attempt
- **WHEN** `path` is not under the resolved main checkout (e.g. `/etc/passwd` or `../../somewhere`)
- **THEN** the endpoint SHALL refuse with code `outside_repo` and HTTP 400

#### Scenario: Refuse a symlink that escapes the anchor
- **GIVEN** `path` is inside the resolved main checkout but is a symbolic link whose target resolves outside it
- **WHEN** the endpoint is called
- **THEN** the endpoint SHALL refuse with code `outside_repo` and HTTP 400
- **AND** neither the link nor its target SHALL be deleted

#### Scenario: Refuse when no main checkout resolves
- **GIVEN** `cwd` is inside a bare repository or a worktree of a bare hub
- **WHEN** the endpoint is called
- **THEN** the endpoint SHALL refuse with code `outside_repo` and HTTP 400
- **AND** nothing SHALL be deleted

#### Scenario: Target removed mid-check refuses as not_a_directory
- **GIVEN** `path` passes the existence check but is deleted before symbolic links are resolved
- **WHEN** the endpoint continues
- **THEN** the endpoint SHALL refuse with code `not_a_directory`
- **AND** it SHALL NOT return success and SHALL NOT evaluate the later guards

#### Scenario: Unreadable symlink refuses rather than passing
- **GIVEN** `path` is inside the resolved main checkout and exists, but symlink resolution fails for a reason other than the path being absent
- **WHEN** the endpoint is called
- **THEN** the endpoint SHALL refuse with code `fs_failed`
- **AND** nothing SHALL be deleted

#### Scenario: Orphan under a submodule checkout is cleanable
- **GIVEN** `cwd` is inside a submodule and `path` is an orphan directory inside that submodule's working tree
- **WHEN** the endpoint is called and every other guard passes
- **THEN** the endpoint SHALL delete the directory and return `{ ok: true }`
