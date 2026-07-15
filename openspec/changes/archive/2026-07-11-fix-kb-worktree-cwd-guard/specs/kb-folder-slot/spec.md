## ADDED Requirements

### Requirement: KB cwd admission

Every `/api/kb/*` route SHALL validate the query `cwd` against the host-provided known-folder set (live session cwds ∪ pinned directories) BEFORE opening a store or touching disk. The match SHALL be realpath-canonicalized on BOTH sides — the query `cwd` and each known folder are resolved to an absolute path and, best-effort, symlink-followed — so that two paths denoting the same directory match regardless of symlink traversal. In addition, when the direct match fails, a `cwd` that is a git worktree whose MAIN working-tree path is a known folder SHALL be admitted; the main path is derived server-side via git and never taken from client input. A `cwd` that is neither a known folder nor a git worktree of a known folder SHALL be rejected with `403`.

#### Scenario: Symlink-equivalent cwd matches a known folder
- **WHEN** `GET /api/kb/stats?cwd=A` is called where `A` reaches a known folder `K` through a symlink (for example `/tmp` for a session/pinned `/private/tmp`)
- **THEN** the canonicalized `A` equals the canonicalized `K`
- **AND** the request is admitted (not `403`)

#### Scenario: Session-less worktree of a known repo is admitted
- **WHEN** `POST /api/kb/reindex?cwd=W` (or `GET /api/kb/stats?cwd=W`) is called for a git worktree `W` that has NO live pi session and is NOT pinned, whose main repository `R` IS a known folder
- **THEN** the guard server-derives `W`'s main working-tree path via git and finds it equals a known folder `R`
- **AND** the request is admitted so `W` is indexable and its stats are readable

#### Scenario: Worktree whose main repo is not known is rejected
- **WHEN** `GET /api/kb/stats?cwd=W` is called for a git worktree `W` whose main repository is NOT a known folder
- **THEN** the request is rejected with `403` and no store is opened

#### Scenario: Unknown non-worktree cwd is rejected
- **WHEN** `GET /api/kb/stats?cwd=X` is called with a cwd that is neither a known folder nor a git worktree of a known folder
- **THEN** the request is rejected with `403` and no store is opened

#### Scenario: Missing cwd is rejected
- **WHEN** any `/api/kb/*` route is called with no `cwd` query parameter
- **THEN** the request is rejected with `400`
