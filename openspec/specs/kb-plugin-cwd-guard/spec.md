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

The cwd guard SHALL resolve the checkout roots of ANY unknown `cwd` server-side
(`git-checkout-root-resolution`) and SHALL admit it when the resolved `mainCheckout` is a
known folder. Because the resolution of any path inside a checkout yields that checkout, this
rule admits NOT ONLY a linked worktree whose main working tree is known, but ANY subdirectory
at any depth of ANY known git repo — e.g. `/repo/src` is admitted whenever `/repo` alone is a
known folder. The main working-tree path SHALL be derived server-side via git and never taken
from client input.

This is a deliberately permissive surface: admission is anchored to the *durable git repo root*, not to the exact known path, so any descendant of a known repo (including nested and worktree subdirectories) opens a store and touches disk under that repo. The guard does NOT restrict admitted paths to the repo root or to linked-worktree roots.

Admission is NOT bounded to the admitted `cwd`'s own files. An admitted `cwd` selects a
project configuration whose filesystem sources and database path MAY be absolute or MAY
climb above the `cwd`; reindexing an admitted `cwd` therefore reads every directory that
configuration names and writes the database wherever it names. The guard SHALL treat
admission as authority over arbitrary configured paths, not over the `cwd` subtree, and
SHALL NOT relax any check on the reasoning that reach is confined to the `cwd`.

The main working-tree path SHALL be the `mainCheckout` of the shared checkout-root resolution
(`git-checkout-root-resolution`), NOT the parent of the git-common-dir. The parent-of-common-dir
derivation names a real checkout only when the git dir happens to sit inside it, and
otherwise yields either a nonexistent directory or a real but unrelated one; the guard SHALL
NOT admit a cwd on that basis.

A canonical request `cwd` containing an exact `.git` path SEGMENT SHALL be rejected BEFORE
either admission path, including the direct known-folder match. A git-internal directory is
never a legitimate knowledge-base root, so a stray pinned directory or session cwd of
`<repo>/.git` SHALL NOT admit itself; the rejection SHALL occur before any store is opened or
disk is read.

The guard SHALL validate the resolved `mainCheckout` before using it as a trust anchor,
because the resolver returns a user-controlled `core.worktree` value verbatim and does not
judge it. The guard SHALL apply the shared repository-binding check of
`git-checkout-root-resolution`: a resolved `mainCheckout` SHALL be matched against the
known-folder set ONLY when it is BOUND to the repository of the request `cwd` — it contains
no `.git` path segment, it re-resolves to the same common dir as the `cwd`, and it is its
own checkout root. An unbound `mainCheckout` SHALL be treated as no main path and SHALL NOT
be matched against the known-folder set — rejection is the safe response for an
authorization consumer, which SHALL NOT assume the resolver filtered the value. This closes
the case in which a repository-local `core.worktree` names an unrelated KNOWN folder to
admit an otherwise-unknown `cwd`.

When no `mainCheckout` resolves — a worktree of a bare repository, or a failed probe — the
guard SHALL derive no main path, yielding rejection unless the cwd is independently known. A
submodule SHALL NOT inherit trust from its superproject: it is an independent project whose
`mainCheckout` is its own checkout, so it SHALL be admitted only by being a known folder in
its own right, or by its own checkout being one.

#### Scenario: Subdirectory of a known repo admitted
- **WHEN** only `/repo` is in the known-folder set and a request carries `cwd = /repo/src` (an ordinary non-worktree subdirectory of that repo)
- **THEN** the guard resolves the checkout roots of `/repo/src`, obtains `mainCheckout = /repo`, finds it in the known-folder set, and admits `/repo/src`
- **AND** the store for `/repo/src` is opened and disk under it is read

#### Scenario: Worktree of a known main repo admitted
- **WHEN** a request `cwd` is a git worktree whose main working tree is in the known-folder set, but the worktree path itself is not
- **THEN** the guard derives the main working-tree path via git, confirms it is bound to the worktree's repository, canonicalizes it, finds it in the known-folder set, and admits the worktree

#### Scenario: Path under an unknown repo rejected
- **WHEN** a request `cwd` resolves via git to a repo whose main working tree is not in the known-folder set
- **THEN** the guard rejects it with `403` and no store is opened

#### Scenario: Non-git unknown path rejected
- **WHEN** the request `cwd` is not a known folder and git cannot resolve a git-common-dir for it (not inside any repo)
- **THEN** the guard treats it as unknown and rejects it with `403`

#### Scenario: Submodule does not inherit admission from its superproject
- **GIVEN** a known folder `/super` and a submodule checkout at `/super/models/sub` that is NOT itself a known folder
- **WHEN** a request carries `cwd = /super/models/sub`, whose `mainCheckout` resolves to `/super/models/sub` itself
- **THEN** the guard SHALL NOT admit it via `/super`
- **AND** SHALL reject the request with `403`
- **AND** when `/super/models/sub` is itself added as a known folder, the same request SHALL be admitted by the known-folder rule

#### Scenario: Worktree of a known submodule is admitted via the submodule
- **GIVEN** a known folder `/super/models/sub` and a worktree created from that submodule, the worktree itself not being a known folder
- **WHEN** a request carries that worktree as `cwd`
- **THEN** the guard SHALL resolve `mainCheckout` to `/super/models/sub`, find it bound to the worktree's repository and present in the known-folder set, and admit the worktree

#### Scenario: An implausible resolved main checkout is not used as a trust anchor
- **GIVEN** a linked worktree whose repository-local `core.worktree` points at a path inside a git directory that happens to be inside a known folder
- **WHEN** a request carries that worktree as `cwd` and the worktree itself is not a known folder
- **THEN** the guard SHALL treat the resolved value as no main path
- **AND** SHALL reject the request with `403`
- **AND** SHALL NOT admit the cwd on the basis of that path being under a known folder

#### Scenario: A core.worktree aimed at an unrelated known folder does not admit the cwd
- **GIVEN** a known folder `/known/other` that is an ordinary checkout of a DIFFERENT repository, and a linked worktree of an UNKNOWN repository whose repository-local `core.worktree` is set to `/known/other`
- **WHEN** a request carries that worktree as `cwd`
- **THEN** the guard SHALL find the resolved `mainCheckout = /known/other` UNBOUND to the worktree's repository, because it re-resolves to a different common dir
- **AND** SHALL treat it as no main path and reject the request with `403`
- **AND** SHALL NOT open a store or read disk for that cwd

#### Scenario: Worktree of a bare repository is rejected unless independently known
- **GIVEN** a worktree created from a bare hub, for which no `mainCheckout` resolves
- **WHEN** a request carries that worktree as `cwd` and it is not a known folder
- **THEN** the guard SHALL derive no main path and SHALL reject the request with `403`

#### Scenario: A `.git` cwd is rejected even when it is itself a known folder
- **GIVEN** a known-folder set that contains `<repo>/.git`
- **WHEN** a request carries `cwd = <repo>/.git`
- **THEN** the guard SHALL reject the request with `403`
- **AND** SHALL NOT open a store or read disk for that path

#### Scenario: Separate-git-dir cwd is not admitted via an unrelated sibling
- **GIVEN** a checkout at `/work/app` created with `--separate-git-dir=/known/elsewhere.git`, where `/known` IS a known folder but `/work/app` is not
- **WHEN** a request carries `cwd = /work/app`
- **THEN** the guard SHALL NOT admit it by taking the parent of `/known/elsewhere.git`
- **AND** SHALL reject the request with `403`

#### Scenario: Admitted cwd reach is measured, not assumed
- **GIVEN** an admitted `cwd` whose project configuration names a filesystem source outside the `cwd` (an absolute path or a `..` reference) and an absolute database path outside the `cwd`
- **WHEN** a reindex is run for that `cwd`
- **THEN** the indexer reads the outside source and writes the outside database — demonstrating that admission is authority over configured paths, not over the `cwd` subtree
- **AND** this measured reach is the reason the binding check SHALL reject rather than tolerate an unbound `mainCheckout`

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
