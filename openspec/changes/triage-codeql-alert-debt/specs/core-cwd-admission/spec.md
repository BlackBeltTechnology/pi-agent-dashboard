## Purpose

Core (non-plugin) dashboard server routes that accept a caller-supplied working directory admit it against the host's known-folder set before touching the file system, using one shared guard that static analysis can recognise.

## ADDED Requirements

### Requirement: Core routes admit the caller cwd before disk access
A core server route that accepts a `cwd` from the request (query or body) SHALL
admit it before any file-system or git operation under it. A `cwd` SHALL be
admitted when it, after realpath canonicalization, is a known folder: the cwd of
a dashboard session, a pinned directory, or the main checkout of a repository
one of those belongs to. Routes covered: the file routes, the git and worktree
routes, the openspec routes, and the folder-project routes.

#### Scenario: Known session cwd is admitted
- **WHEN** a request names the cwd of a live dashboard session
- **THEN** the route SHALL proceed to its operation

#### Scenario: Linked worktree of a known repository is admitted
- **WHEN** a request names a linked git worktree whose main checkout is a pinned directory
- **THEN** the route SHALL proceed to its operation

#### Scenario: Unknown directory is refused before disk access
- **WHEN** a request names an existing directory that is not a known folder
- **THEN** the route SHALL refuse the request without reading, writing, listing or running git under that directory

#### Scenario: Symlink to an unknown directory is refused
- **WHEN** a request names a path that is a symlink inside a known folder pointing outside every known folder
- **THEN** the canonical target SHALL be judged and the request SHALL be refused

### Requirement: Worktree endpoints refuse unknown directories with the existing code
The git worktree endpoints SHALL refuse a `cwd` that is not admitted with the
existing stable error code `cwd_invalid` and a message stating the directory is
not a known folder. Missing, non-existent and non-directory cwds SHALL keep their
current `cwd_invalid` messages.

#### Scenario: Unknown directory on worktree create
- **WHEN** a worktree create request names an existing directory that is not a known folder
- **THEN** the response SHALL carry code `cwd_invalid` and a not-a-known-folder message, and no `git worktree` command SHALL run

#### Scenario: Existing validation messages unchanged
- **WHEN** a worktree request omits `cwd`, or names a missing path, or names a file
- **THEN** the response SHALL carry code `cwd_invalid` with the same message as before this change
