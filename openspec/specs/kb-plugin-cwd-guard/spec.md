# kb-plugin-cwd-guard Specification

## Purpose

Every kb-plugin operation that opens a KB store or touches disk is driven by an untrusted `cwd` supplied by an HTTP query string or a browser `plugin_action` payload. This capability guards that `cwd`: it must resolve to a host-trusted known folder (an active session cwd or a pinned directory), or resolve — via server-side git — to a git repo whose main working tree is such a folder, before any store open or disk read is permitted. This prevents an attacker-controlled path from driving arbitrary-path indexing or file access.

## Requirements

### Requirement: Known-folder admission

The cwd guard SHALL admit a `cwd` only when it matches the host-provided known-folder set — the union of active session cwds and pinned directories — or is admitted by the git-repo-main rule below, and SHALL reject every other `cwd`. When the host does not provide the known-folder service, the guard SHALL fall back to admitting active session cwds alone.

#### Scenario: Known cwd admitted
- **WHEN** a request carries a `cwd` that is present in the known-folder set
- **THEN** the guard admits it and the operation proceeds to open the store

#### Scenario: Unknown cwd rejected before any disk access
- **WHEN** a request carries a `cwd` that is not in the known-folder set and does not resolve to a git repo whose main working tree is a known folder
- **THEN** the guard responds `403` with body `{ "error": "cwd not allowed" }`
- **AND** no store is opened and no disk read is performed

#### Scenario: Missing cwd rejected
- **WHEN** a request omits the `cwd` parameter
- **THEN** the guard responds `400` with body `{ "error": "Missing cwd" }`

### Requirement: Canonicalization defeats symlink and traversal aliases

The cwd guard SHALL canonicalize both the incoming `cwd` and every known-folder entry by resolving the path and following symlinks before comparison, so that a known folder reached through a symlinked alias or a non-canonical path is still recognized as the same folder. A path that cannot be resolved on disk SHALL retain its resolved (non-symlink-followed) form for comparison.

#### Scenario: Known folder reached through a symlinked alias
- **WHEN** the known-folder entry is a canonical path and the request `cwd` is a symlink that resolves to that same canonical path
- **THEN** the guard canonicalizes both sides identically and admits the `cwd`

#### Scenario: Traversal or non-canonical path normalized
- **WHEN** the request `cwd` contains `..` segments or platform symlink prefixes (e.g. `/var` → `/private/var`) that resolve to a known folder
- **THEN** the guard resolves and symlink-follows the path before matching, admitting it only if the canonical form is a known folder

### Requirement: Git-repo-main admission (broad subdirectory reach)

The cwd guard SHALL run a server-side `git rev-parse --git-common-dir` on ANY unknown `cwd` and SHALL admit it when the parent of the resolved git-common-dir is a known folder. Because the git-common-dir of any path inside a repo resolves to that repo's shared git directory, this rule admits NOT ONLY a linked worktree whose main working tree is known, but ANY subdirectory at any depth of ANY known git repo — e.g. `/repo/src` is admitted whenever `/repo` alone is a known folder. The main working-tree path SHALL be derived server-side via git and never taken from client input.

This is a deliberately permissive surface: admission is anchored to the *durable git repo root*, not to the exact known path, so any descendant of a known repo (including nested and worktree subdirectories) opens a store and touches disk under that repo. The guard does NOT restrict admitted paths to the repo root or to linked-worktree roots.

#### Scenario: Subdirectory of a known repo admitted
- **WHEN** only `/repo` is in the known-folder set and a request carries `cwd = /repo/src` (an ordinary non-worktree subdirectory of that repo)
- **THEN** the guard runs `git -C /repo/src rev-parse --git-common-dir`, resolves `/repo/.git`, takes its parent `/repo`, finds it in the known-folder set, and admits `/repo/src`
- **AND** the store for `/repo/src` is opened and disk under it is read

#### Scenario: Worktree of a known main repo admitted
- **WHEN** a request `cwd` is a git worktree whose main working tree is in the known-folder set, but the worktree path itself is not
- **THEN** the guard derives the main working-tree path via git, canonicalizes it, finds it in the known-folder set, and admits the worktree

#### Scenario: Path under an unknown repo rejected
- **WHEN** a request `cwd` resolves via git to a repo whose main working tree is not in the known-folder set
- **THEN** the guard rejects it with `403` and no store is opened

#### Scenario: Non-git unknown path rejected
- **WHEN** the request `cwd` is not a known folder and git cannot resolve a git-common-dir for it (not inside any repo)
- **THEN** the guard treats it as unknown and rejects it with `403`

### Requirement: Config patch shape validation

The `config.set` plugin_action SHALL reject a patch that is missing, not a plain object, or an array — before any config merge or disk write. Arrays and non-objects SHALL NOT be treated as valid patches even though a bare `typeof` check would pass an array.

#### Scenario: Array patch rejected before mutation
- **WHEN** a `config.set` plugin_action carries a `patch` that is an array (or any non-object, or is missing)
- **THEN** the handler logs a warning and returns without merging config or writing to disk

### Requirement: Uniform enforcement across entry points

The cwd guard SHALL apply the same admission logic to every operation that opens a store or writes config, whether the operation arrives as a REST route (`GET /api/kb/stats`, `POST /api/kb/reindex`, `GET`/`PUT /api/kb/config`) or as a browser `plugin_action` message, and SHALL enforce it before invoking the operation's core.

#### Scenario: REST route guarded before store open
- **WHEN** any `/api/kb/*` route receives a request
- **THEN** the guard validates `cwd` first and returns the rejection status without opening a store when the `cwd` is missing or not admitted

#### Scenario: plugin_action guarded before core invocation
- **WHEN** a `plugin_action` message for the kb plugin carries a `cwd` that is not admitted
- **THEN** the handler logs a warning and returns without running reindex or config mutation
