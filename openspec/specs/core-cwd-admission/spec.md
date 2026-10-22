# core-cwd-admission Specification

## Purpose
Core (non-plugin) dashboard server routes for git and OpenSpec operations admit a caller-supplied working directory, and any single path segment joined under it, before performing their operation, using shared guards that static analysis can recognise.

## Requirements

### Requirement: Git and openspec routes admit the caller cwd before their operation
A git or openspec server route that accepts a `cwd` from the request SHALL admit
it with the shared cwd admission guard before performing its operation (read,
write, list, CLI or git command) under it. A `cwd` SHALL be admitted when, after
realpath canonicalization, it is a known folder (a session cwd or a pinned
directory), or when the main checkout of the git repository containing it is a
known folder.

#### Scenario: Known session cwd is admitted without git probes
- **WHEN** a request names the cwd of a live dashboard session
- **THEN** the route SHALL perform its operation
- **AND** admission SHALL NOT spawn git

#### Scenario: Linked worktree of a pinned repository is admitted
- **WHEN** a request names a linked git worktree whose main checkout is a pinned directory
- **THEN** the route SHALL perform its operation

#### Scenario: Worktree spawned from the dashboard is admitted for auto-init
- **WHEN** a worktree is created and a session is spawned in it, and the client then requests its init status
- **THEN** the request SHALL be admitted

#### Scenario: Subdirectory of a known repository is admitted
- **WHEN** a request names a subdirectory of a git repository whose main checkout is a session cwd
- **THEN** the route SHALL perform its operation

#### Scenario: Sibling of a known linked worktree is refused
- **WHEN** the only known folder of a repository is a session inside linked worktree A, and a request names linked worktree B of the same repository
- **THEN** the route SHALL refuse

#### Scenario: Main checkout of a known linked worktree is refused
- **WHEN** the only known folder of a repository is a session inside a linked worktree, and a request names the repository's main checkout
- **THEN** the route SHALL refuse

#### Scenario: Child repository of a pinned non-repository folder is refused
- **WHEN** a pinned directory is not a git repository, and a request names a git repository inside it that is neither pinned nor a session cwd
- **THEN** the route SHALL refuse

#### Scenario: Unknown directory is refused before the operation
- **WHEN** a request names an existing directory that is not admitted
- **THEN** the route SHALL refuse without performing its operation under that directory
- **AND** no filesystem call other than the admission guard's own canonicalization and probes SHALL have run on the request value

#### Scenario: Regular file is refused, not indeterminate
- **WHEN** a request names a regular file inside a known repository
- **THEN** admission SHALL refuse it, and the response SHALL NOT be 503

#### Scenario: Symlink to an unknown directory is refused
- **WHEN** a request names a symlink inside a known folder whose target lies outside every known folder and its repositories
- **THEN** the canonical target SHALL be judged and the request SHALL be refused

### Requirement: Admission uses the unfiltered known-folder set
The known-folder set used for admission SHALL be the union of session cwds and
pinned directories, not filtered by route-specific predicates such as the
presence of an `openspec/` root. A route that falls back to a server-chosen cwd
when the request names none SHALL keep that fallback, and a server-chosen list
(e.g. `update` with `all`) SHALL NOT be re-admitted.

#### Scenario: Pinned folder without an openspec root is admitted on an openspec read
- **WHEN** an openspec tasks request names a pinned directory that has no `openspec/` directory
- **THEN** admission SHALL admit it and the route SHALL answer with its normal no-openspec result

#### Scenario: No cwd keeps the server-chosen fallback
- **WHEN** an openspec config request names no `cwd`
- **THEN** the route SHALL use its existing server-chosen fallback cwd as before this change

### Requirement: Gated openspec write routes keep exact membership
The openspec init, workflow-schema and dependencies routes SHALL, after
admission, keep their existing exact known-target membership check, opt-out
check and global-config exclusion, with their existing refusal status and body.

#### Scenario: Worktree of a pinned repository is not widened on init
- **WHEN** an openspec init request names a linked worktree of a pinned repository, and the worktree itself is neither pinned nor a session cwd
- **THEN** the response SHALL be the existing init refusal (400, cwd is not a known session or pinned directory)

#### Scenario: Symlink spelling of an opted-out directory stays refused
- **WHEN** a workflow-schema request names a pinned symlink whose canonical target is an opted-out directory
- **THEN** the response SHALL be the existing opt-out refusal

#### Scenario: Subdirectory of an opted-out repository stays refused
- **WHEN** a dependencies request names a subdirectory of an opted-out directory
- **THEN** the response SHALL be 403 with error code `cwd-not-tracked` as before this change

### Requirement: Ungated openspec routes refuse unknown cwds
An openspec route that did not refuse unknown cwds before this change SHALL
refuse a caller-supplied cwd that is not admitted, or whose `openspec/` directory
is the global OpenSpec config directory, with `403 { success: false, code:
"cwd_unknown", error: "cwd not allowed", reason, hint }`.

#### Scenario: Unknown cwd on tasks
- **WHEN** an openspec tasks request names an existing directory that is not admitted
- **THEN** the response SHALL be 403 `cwd_unknown` with `reason` and `hint`, and no tasks file SHALL be read

#### Scenario: Global config directory refused through a symlink
- **WHEN** an openspec tasks request names a pinned symlink whose canonical target's `openspec/` is the global OpenSpec config directory
- **THEN** the response SHALL be 403 `cwd_unknown`

#### Scenario: Global config directory refused
- **WHEN** an openspec tasks-toggle request names the directory whose `openspec/` is the global OpenSpec config directory, even if it is pinned
- **THEN** the response SHALL be 403 `cwd_unknown`, and no file SHALL be written

### Requirement: Indeterminate admission is a 503 with the shared identifier
When admission cannot be decided, a git or openspec route SHALL answer `503` with
`Retry-After: 1` and body `{ success: false, code: "cwd-admission-unavailable",
error: "cwd-admission-unavailable", message, retryAfterMs }`, and SHALL NOT
perform its operation.

#### Scenario: Git unavailable during admission
- **WHEN** admission of an unknown, existing directory is indeterminate because git cannot run
- **THEN** the response SHALL be 503 with `Retry-After` and code `cwd-admission-unavailable`, and no operation SHALL run

#### Scenario: Unreadable known folder makes non-matching requests indeterminate
- **WHEN** one pinned directory cannot be canonicalized for a reason other than non-existence, and a request names a directory that matches no other known folder
- **THEN** the response SHALL be 503 with code `cwd-admission-unavailable`
- **AND** a request naming a resolvable known folder SHALL still be admitted

### Requirement: Request path segments are single portable segments
A request value that an openspec route passes on to be joined under the cwd as a
single path segment (a change name) SHALL be a single portable path segment;
otherwise the route SHALL answer `400 { success: false, code: "invalid_name" }`
without reading or writing.

#### Scenario: Traversal in a change name is refused
- **WHEN** an openspec tasks request names change `../../outside`
- **THEN** the response SHALL be 400 `invalid_name` and no file SHALL be read

#### Scenario: Separator in a change name is refused
- **WHEN** an openspec tasks-toggle request names change `a/b`
- **THEN** the response SHALL be 400 `invalid_name` and no file SHALL be written

### Requirement: Admission is released after the request
An admission obtained by a git, openspec or folder-project route SHALL be
released when the request completes, whether it succeeds, fails, throws or the
client disconnects.

#### Scenario: Token not live after response
- **WHEN** a git-route request completes
- **THEN** the admission token it obtained SHALL no longer be live

#### Scenario: Token released when the operation throws
- **WHEN** an openspec or folder-project operation throws after admission
- **THEN** the admission token SHALL no longer be live once the error response is sent
