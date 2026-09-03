## ADDED Requirements

### Requirement: Persisted path-anchor grant store

The system SHALL persist granted filesystem directories at `~/.pi/dashboard/access-grants.json`. Each entry SHALL record the granted directory subject, its scope, the time it was granted, and the origin that requested it. A missing or malformed store SHALL be treated as empty.

This store is deliberately richer than `worktree-init-trust.json`, which is a flat map of key to `true` carrying no subject, time, or origin — those three fields are required here because the Access tab must display them. Scope SHALL follow the existing `"session" | "project"` convention, where a session-scoped grant lives only in memory and does not survive a restart.

#### Scenario: First grant creates the store

- **GIVEN** no grant store file exists
- **WHEN** a user grants a directory
- **THEN** the store SHALL be created containing that subject

#### Scenario: Malformed store degrades to empty

- **WHEN** the store file is unreadable or not valid JSON
- **THEN** it SHALL be treated as holding no grants
- **AND** containment SHALL fall back to derived anchors only

#### Scenario: Project-scoped grants survive restart

- **GIVEN** a subject was granted at project scope
- **WHEN** the server restarts
- **THEN** the grant SHALL still be in effect

#### Scenario: Session-scoped grants do not survive restart

- **GIVEN** a subject was granted at session scope
- **WHEN** the server restarts
- **THEN** the grant SHALL no longer be in effect

### Requirement: Grant subject is a directory, stored as a real path

A grant subject SHALL be a directory, not an individual file path. When a denial concerns a file, the subject offered for grant SHALL be that file's containing directory.

The subject SHALL be resolved through `realpath` at the moment the grant is recorded, and the resolved value SHALL be what is persisted and what any review surface displays. Persisting the lexical path instead would let the admitted set follow a symlink's later retargeting: a grant of a symlinked directory would silently admit whatever that symlink is repointed at, without the user ever approving the new target. Storing the real path binds the grant to the directory the user actually saw when granting.

#### Scenario: File denial offers its directory

- **WHEN** a read of `/a/b/c.txt` is refused by containment
- **THEN** the grant subject SHALL be `/a/b`

#### Scenario: A symlinked subject is stored as its target

- **GIVEN** `/wt/current` is a symlink to `/wt/v1`
- **WHEN** `/wt/current` is granted
- **THEN** the persisted subject SHALL be `/wt/v1`

#### Scenario: Retargeting a symlinked subject does not move the grant

- **GIVEN** `/wt/current` was granted while pointing at `/wt/v1`
- **WHEN** `/wt/current` is later repointed at `/wt/v2`
- **THEN** reads under `/wt/v2` SHALL be refused, because the grant is bound to `/wt/v1`

#### Scenario: Granted directory covers later reads within it

- **GIVEN** `/a/b` has been granted
- **WHEN** `/a/b/d.txt` is later read
- **THEN** it SHALL be allowed without any further user action

### Requirement: A grant admits its own subtree and nothing more

A persisted grant SHALL be evaluated by a dedicated subtree check — the resolved path is the granted directory or lies under it — applied only after the existing containment layers have already refused.

A grant SHALL NOT be supplied to `isAllowed` as an additional anchor. That function performs a git-common-root widening pass over every anchor it receives, so supplying a granted subdirectory as an anchor would silently admit the entire repository containing it. The grant check SHALL perform no git-root resolution and no widening of any kind.

The grant check SHALL resolve symlinks before comparing, matching the symlink safety the existing git-root layer already provides. A lexical-only comparison would allow a symlink inside a granted directory to reach a target outside it.

#### Scenario: Empty store preserves current behaviour

- **GIVEN** the grant store holds no entries
- **WHEN** any path is checked for containment
- **THEN** the outcome SHALL be identical to containment without the grant check

#### Scenario: Granted directory admits its subtree

- **GIVEN** `/a/b` is granted
- **WHEN** a path under `/a/b` is checked
- **THEN** it SHALL be allowed

#### Scenario: A granted subdirectory does NOT admit its repository

- **GIVEN** `/repo/sub` is granted and `/repo` is a git repository whose common root is `/repo`
- **WHEN** `/repo/other/secret.txt` is checked, outside every derived anchor
- **THEN** it SHALL be refused — the grant SHALL NOT widen to the git common root

#### Scenario: A granted directory does not admit its parent

- **GIVEN** `/a/b` is granted
- **WHEN** `/a/sibling` is checked
- **THEN** it SHALL be refused

#### Scenario: A symlink escaping a granted directory is refused

- **GIVEN** `/a/b` is granted and contains a symlink whose real target is `/elsewhere/secret`
- **WHEN** a read resolves through that symlink
- **THEN** it SHALL be refused — the grant check SHALL compare real paths, not lexical ones

#### Scenario: A symlink within a granted directory is allowed

- **GIVEN** `/a/b` is granted and contains a symlink whose real target is also under `/a/b`
- **WHEN** a read resolves through that symlink
- **THEN** it SHALL be allowed

#### Scenario: The existing containment predicate is unchanged

- **WHEN** the grant feature is present but the store is empty
- **THEN** every pre-existing file-read-containment behaviour SHALL be unchanged, including the git-common-root widening of derived anchors

### Requirement: Grants are revocable and revocation takes effect immediately

The system SHALL support removing a grant. After revocation, paths that were allowed only by that grant SHALL be refused again without requiring a restart.

#### Scenario: Revoked anchor stops admitting

- **GIVEN** `/a/b` was granted and a read under it succeeds
- **WHEN** the grant is revoked
- **THEN** a subsequent read under `/a/b` SHALL be refused
