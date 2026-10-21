## Purpose

Core (non-plugin) dashboard server routes admit a caller-supplied working directory, and any path joined under it, against the host's known-folder set before performing their operation, using shared guards that static analysis can recognise.

## ADDED Requirements

### Requirement: Core routes admit the caller cwd before their operation
A core server route that accepts a `cwd` from the request SHALL admit it before
performing its operation (read, write, list, or git command) under it. A `cwd`
SHALL be admitted when, after realpath canonicalization, it is a known folder: a
dashboard session's cwd, a pinned directory, or the main checkout or a linked
worktree of a repository that one of those belongs to. Covered routes: file,
git, openspec and folder-project routes.

#### Scenario: Known session cwd is admitted
- **WHEN** a request names the cwd of a live dashboard session
- **THEN** the route SHALL perform its operation

#### Scenario: Pinned folder is admitted without a prompt
- **WHEN** a file-route request names a pinned directory that no session uses
- **THEN** the route SHALL perform its operation without raising the unknown-cwd verdict

#### Scenario: Linked worktree of a known repository is admitted
- **WHEN** a request names a linked git worktree whose main checkout is a pinned directory
- **THEN** the route SHALL perform its operation

#### Scenario: Unknown directory is refused before the operation
- **WHEN** a request names an existing directory that is not a known folder
- **THEN** the route SHALL refuse without performing its read, write, list or git command under that directory
- **AND** only the admission guard's own read-only canonicalization and probes MAY have run

#### Scenario: Symlink to an unknown directory is refused
- **WHEN** a request names a symlink inside a known folder whose target lies outside every known folder
- **THEN** the canonical target SHALL be judged and the request SHALL be refused

### Requirement: Indeterminate admission is a 503
When admission cannot be decided (the guard reports indeterminate, e.g. git
unavailable while deriving the main checkout), a core route SHALL answer 503 and
SHALL NOT perform its operation; it SHALL NOT answer with a refusal code.

#### Scenario: Git unavailable during admission
- **WHEN** admission of an unknown, existing directory is indeterminate because git cannot run
- **THEN** the response status SHALL be 503 and no operation SHALL run

### Requirement: Joined paths are contained in the admitted cwd
A path taken from the request and joined under an admitted cwd SHALL be
performed on only when it lies inside the admitted cwd both lexically and after
realpath canonicalization. This SHALL NOT replace or narrow path-anchor grants or
the layered file-read containment where those already govern a route.

#### Scenario: Traversal is refused
- **WHEN** a request joins `../outside.txt` under an admitted cwd
- **THEN** the route SHALL refuse with its existing out-of-scope status

#### Scenario: Symlink escape in the joined path is refused
- **WHEN** the joined path is a symlink inside the admitted cwd pointing outside it
- **THEN** the route SHALL refuse with its existing out-of-scope status

### Requirement: Git endpoints refuse unknown directories with the existing code
Every `/api/git/*` endpoint that validates its `cwd` SHALL refuse a directory that
is not admitted with the existing code `cwd_invalid` and a message stating the
directory is not a known folder and can be pinned. Missing, non-existent and
non-directory cwds SHALL keep their current `cwd_invalid` messages.

#### Scenario: Unknown directory on worktree create
- **WHEN** a worktree create request names an existing directory that is not a known folder
- **THEN** the response SHALL carry `cwd_invalid` and the not-a-known-folder message, and no `git worktree` command SHALL run

#### Scenario: Unpinned repository loses git access
- **WHEN** a git status request names a repository that is neither a session cwd nor pinned, nor a worktree of one
- **THEN** the response SHALL carry `cwd_invalid` and the not-a-known-folder message

#### Scenario: Existing validation messages unchanged
- **WHEN** a git request omits `cwd`, or names a missing path, or names a file
- **THEN** the response SHALL carry `cwd_invalid` with the same message as before this change

### Requirement: Admission is released after the request
An admission obtained by a core route SHALL be released when the request
completes, whether it succeeds, fails or the client disconnects.

#### Scenario: Token not live after response
- **WHEN** a file-route request completes
- **THEN** the admission token it obtained SHALL no longer be live
