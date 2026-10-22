# core-cwd-admission Specification

## Purpose
Core (non-plugin) dashboard server routes for git and OpenSpec operations admit a caller-supplied working directory, and any single path segment joined under it, before performing their operation, using shared guards that static analysis can recognise.

## Requirements

### Requirement: Git and openspec routes admit the caller cwd before their operation
A git or openspec server route that accepts a `cwd` from the request SHALL admit
it with the shared cwd admission guard before performing its operation (read,
write, list, CLI or git command) under it. A `cwd` SHALL be admitted when, after
realpath canonicalization, it is a known folder (a session cwd, a pinned
directory or a workspace folder), or when the main checkout of the git repository containing it is a
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

#### Scenario: Workspace-only folder is admitted
- **WHEN** a request names a folder that is in a workspace but is neither pinned nor a session cwd
- **THEN** the route SHALL perform its operation
- **AND** admission SHALL NOT spawn git

### Requirement: Admission uses the unfiltered known-folder set
The known-folder set used for admission SHALL be the union of session cwds,
pinned directories and the folders of every workspace, not filtered by route-specific predicates such as the
presence of an `openspec/` root. A route that falls back to a server-chosen cwd
when the request names none SHALL keep that fallback, and a server-chosen list
(e.g. `update` with `all`) SHALL NOT be re-admitted.

#### Scenario: Pinned folder without an openspec root is admitted on an openspec read
- **WHEN** an openspec tasks request names a pinned directory that has no `openspec/` directory
- **THEN** admission SHALL admit it and the route SHALL answer with its normal no-openspec result

#### Scenario: No cwd keeps the server-chosen fallback
- **WHEN** an openspec config request names no `cwd`
- **THEN** the route SHALL use its existing server-chosen fallback cwd as before this change

#### Scenario: Gated openspec write sites do not gain workspace folders
- **WHEN** an openspec init request names a workspace-only folder
- **THEN** the response SHALL be the existing init refusal

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
When admission cannot be decided, a git, openspec, file-family, package,
canvas-types or resource-toggle route SHALL answer `503` with `Retry-After: 1` and body
`{ success: false, code: "cwd-admission-unavailable", error:
"cwd-admission-unavailable", message, retryAfterMs }`, and SHALL NOT perform its
operation. The live-preview per-asset re-check SHALL instead refuse the asset
with the proxy's existing refusal, without a prompt, and `watch_files` SHALL
ignore the message.

#### Scenario: Git unavailable during admission
- **WHEN** admission of an unknown, existing directory is indeterminate because git cannot run
- **THEN** the response SHALL be 503 with `Retry-After` and code `cwd-admission-unavailable`, and no operation SHALL run

#### Scenario: Unreadable known folder makes non-matching requests indeterminate
- **WHEN** one pinned directory cannot be canonicalized for a reason other than non-existence, and a request names a directory that matches no other known folder
- **THEN** the response SHALL be 503 with code `cwd-admission-unavailable`
- **AND** a request naming a resolvable known folder SHALL still be admitted

#### Scenario: File read with undecidable admission
- **WHEN** admission of a `GET /api/file` request's `cwd` is indeterminate
- **THEN** the response SHALL be 503 with `Retry-After: 1` and code `cwd-admission-unavailable`, and no file SHALL be read

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
An admission obtained by a git, openspec, folder-project, file-family, package,
canvas-types or resource-toggle route SHALL be released when the request completes, whether it
succeeds, fails, throws or the client disconnects. A gate helper that admits
SHALL release its admission before it returns.

#### Scenario: Token not live after response
- **WHEN** a git-route request completes
- **THEN** the admission token it obtained SHALL no longer be live

#### Scenario: Token released when the operation throws
- **WHEN** an openspec or folder-project operation throws after admission
- **THEN** the admission token SHALL no longer be live once the error response is sent

#### Scenario: File gate releases its token
- **WHEN** a file-family gate helper returns, admitted or refused
- **THEN** no admission token it obtained SHALL be live

### Requirement: File-family routes admit the caller cwd before touching disk
A file-family route SHALL admit a request `cwd` with the shared cwd admission
guard, using the same known-folder set and rules as git and openspec routes,
before touching any path under it. File-family routes are the `/api/file*` routes
(including md, office, sheet, EML and digest), `/api/grep`, system open and
reveal, editor-pane handler saves, and live-preview `start-static` with its per-asset re-check. Containment, grants and write-target checks SHALL still apply
after admission.

#### Scenario: Pinned folder without a session is readable
- **WHEN** `GET /api/file` names a pinned directory that no session uses as cwd, and a path inside it
- **THEN** the file SHALL be returned

#### Scenario: Sessionless worktree of a pinned repository is previewable
- **WHEN** `GET /api/file/raw` names a linked worktree of a pinned repository that no session uses, and an image inside it
- **THEN** the image SHALL be served

#### Scenario: Unknown cwd keeps the existing refusal
- **WHEN** `GET /api/file` names a directory that is not admitted
- **THEN** the response SHALL be `403 { success: false, error: "unknown session path", code: "cwd_unknown" }`
- **AND** no path under it SHALL be resolved against the filesystem

#### Scenario: Relative cwd is refused
- **WHEN** `GET /api/file/tree` names `cwd=.`
- **THEN** the response SHALL be the route's refusal with `code: "cwd_unknown"`, and the server's own working directory SHALL NOT be listed

#### Scenario: Sibling of a known linked worktree is refused on a file route
- **WHEN** `GET /api/file` names a linked worktree whose repository is known only through a session in a sibling linked worktree
- **THEN** the response SHALL be 403 with `code: "cwd_unknown"`

#### Scenario: Containment still applies after admission
- **WHEN** `GET /api/file` names a pinned directory and the path `../../etc/passwd`
- **THEN** the response SHALL be `403 "path outside working directory"`

#### Scenario: System open in a pinned folder
- **WHEN** `POST /api/open-in-system` names a pinned directory with no session and a file inside it
- **THEN** the OS opener SHALL be spawned for that file

#### Scenario: Live-preview asset re-check runs admission per request
- **GIVEN** a static live preview started for a pinned directory
- **WHEN** the directory is unpinned and no session uses it, and the next asset is requested
- **THEN** that asset SHALL be refused

### Requirement: Openspec group routes and file watching admit the caller cwd
The `/api/openspec/groups*` routes and the `watch_files` browser message SHALL
admit their `cwd` with the shared guard before touching disk. A refused or
undecidable `watch_files` cwd SHALL be ignored without a reply.

#### Scenario: File watch in a pinned folder
- **WHEN** the browser sends `watch_files` for a pinned directory with no session
- **THEN** the server SHALL watch the named open files under it

#### Scenario: File watch for an unknown cwd is ignored
- **WHEN** the browser sends `watch_files` for a directory that is not admitted
- **THEN** no watcher SHALL be created and no reply SHALL be sent

### Requirement: File-family refusals keep their body and add a code
A file-family route SHALL refuse a `cwd` that is not an absolute path, or that
admission refuses, with the route's existing status and `error` string plus
`code: "cwd_unknown"`.

#### Scenario: Non-absolute cwd on a file route
- **WHEN** `GET /api/file` names `cwd=src`
- **THEN** the response SHALL be `403 { success: false, error: "unknown session path", code: "cwd_unknown" }`

### Requirement: The file-exists prompt follows admission
`GET /api/file/exists` SHALL refuse a non-absolute `cwd` without prompting, then
admit its `cwd` with the shared guard. An admitted `cwd` SHALL proceed without a
prompt; a refused one SHALL raise the existing operator prompt. Allow-always SHALL
admit only when the re-run guard admits; allow-once SHALL admit only that request,
when the re-resolved real path equals the verdict subject. An indeterminate
admission or re-run SHALL answer the shared 503 without prompting.

#### Scenario: Worktree of a pinned repository needs no prompt
- **WHEN** an exists request names a sessionless linked worktree of a pinned repository
- **THEN** the probe SHALL run without an operator prompt

#### Scenario: Undecidable admission does not prompt
- **WHEN** admission of an exists request's `cwd` is indeterminate
- **THEN** the response SHALL be 503 with code `cwd-admission-unavailable` and no prompt SHALL be raised

#### Scenario: Relative cwd is refused without a prompt
- **WHEN** an exists request names `cwd=.`
- **THEN** the response SHALL be the `"unknown cwd"` 403 with `code: "cwd_unknown"` and no prompt SHALL be raised

#### Scenario: Allow-always admits a worktree of the newly pinned repository
- **WHEN** an exists request names a sessionless linked worktree whose repository is unknown, and the operator answers allow-always (pinning it)
- **THEN** the request SHALL proceed

#### Scenario: Allowed unknown cwd proceeds once
- **WHEN** an exists request names an unknown directory and the operator answers allow-once
- **THEN** that request SHALL proceed and a following request for the same directory SHALL prompt again

### Requirement: Package, canvas-types and resource-toggle routes admit a supplied cwd
The package routes (`installed`, `install`, `remove`, `update`, `move` for each
of `fromCwd` and `toCwd`, `reset-to-npm`, `check-updates`) and `/api/canvas-types`
(GET and PATCH) and `POST /api/resources/toggle` SHALL admit a non-empty `cwd`
before acting under it. A refusal SHALL be `403` with `code: "cwd_unknown"` and
`error: "cwd not allowed"`. A request without a `cwd` SHALL keep its existing
behaviour.

#### Scenario: Local install into an unknown directory is refused
- **WHEN** `POST /api/packages/install` names scope `local` and a `cwd` that is not admitted
- **THEN** the response SHALL be 403 `cwd_unknown` and no package operation SHALL start

#### Scenario: Move with one unknown side is refused
- **WHEN** `POST /api/packages/move` names an admitted `fromCwd` and a `toCwd` that is not admitted
- **THEN** the response SHALL be 403 `cwd_unknown` and nothing SHALL move

#### Scenario: Canvas-types write to an unknown project is refused
- **WHEN** `PATCH /api/canvas-types` names scope `project` and a `cwd` that is not admitted
- **THEN** the response SHALL be 403 `cwd_unknown` and no settings file SHALL be read or written

#### Scenario: Resource toggle in an unknown project is refused
- **WHEN** `POST /api/resources/toggle` names scope `local` and a `cwd` that is not admitted
- **THEN** the response SHALL be 403 `cwd_unknown`, no settings file SHALL be written and no trust challenge SHALL be registered

#### Scenario: Non-string cwd is refused
- **WHEN** `POST /api/packages/install` sends `cwd` as an array
- **THEN** the response SHALL be 403 `cwd_unknown` and no package operation SHALL start

#### Scenario: Installed list without cwd keeps its fallback
- **WHEN** `GET /api/packages/installed` names no `cwd`
- **THEN** the route SHALL answer as before this change
