## MODIFIED Requirements

### Requirement: Config-root resolution decoupled from git

The server SHALL resolve the directory that holds a checkout's worktree-init configuration via `resolveConfigRoot(cwd)`, independent of whether the cwd is a git repository:

- WHEN `cwd` is inside a Git checkout or linked worktree, `resolveConfigRoot` SHALL run `git rev-parse --show-toplevel` from `cwd` and return that checkout's own top-level directory.
- WHEN `cwd` is NOT a git repository AND `cwd/.pi/settings.json` exists, `resolveConfigRoot` SHALL return `cwd`.
- WHEN `cwd` is NOT a git repository AND `cwd/.pi/settings.json` does not exist, `resolveConfigRoot` SHALL return `null`.

For a linked worktree, the config root SHALL NOT fall back to the primary checkout or Git common directory. For a non-git directory, the config root SHALL be exactly `cwd`; the server SHALL NOT walk upward to a parent directory's `.pi/settings.json`. `resolveConfigRoot` only locates a config file: its Git branch MAY run read-only Git discovery probes, but it SHALL NOT execute any repo-declared hook command (`gate`/`run`).

The init-status (`GET /api/git/worktree/init-status`) and init (`POST /api/git/worktree/init`) endpoints SHALL use `resolveConfigRoot`. Worktree creation, removal, and lifecycle endpoints SHALL continue to require a Git repository and SHALL be unaffected by this requirement.

#### Scenario: Git checkout resolves to main repo root

- **GIVEN** `cwd` is inside the primary Git checkout
- **WHEN** `resolveConfigRoot(cwd)` is called
- **THEN** it SHALL return that checkout's top-level path

#### Scenario: Linked worktree resolves to its own top level

- **GIVEN** a primary checkout and linked worktree with different `.pi/settings.json#worktreeInit` commands
- **WHEN** `resolveConfigRoot(cwd)` is called from the linked worktree
- **THEN** it SHALL return the linked worktree's top-level path
- **AND** init status, trust hashing, gate evaluation, and execution SHALL use the linked worktree command

#### Scenario: Linked worktree does not inherit missing settings

- **GIVEN** a linked worktree without `.pi/settings.json`
- **AND** a primary checkout with `.pi/settings.json`
- **WHEN** init status is requested for the linked worktree
- **THEN** it SHALL report no target hook
- **AND** SHALL NOT read the primary checkout's hook

#### Scenario: Non-git dir with settings resolves to itself

- **WHEN** `cwd` is not a Git repository and `cwd/.pi/settings.json` exists
- **THEN** `resolveConfigRoot(cwd)` SHALL return `cwd`

#### Scenario: Non-git dir without settings resolves to null

- **WHEN** `cwd` is not a Git repository and `cwd/.pi/settings.json` does not exist
- **THEN** `resolveConfigRoot(cwd)` SHALL return `null`

#### Scenario: Git dir with unresolvable common-dir resolves to null

- **GIVEN** a cwd where `isGitRepo` is true but `git rev-parse --show-toplevel` fails
- **WHEN** `resolveConfigRoot(cwd)` is called
- **THEN** it SHALL return `null`
- **AND** it SHALL NOT fall through to the non-git `cwd/.pi/settings.json` check
- **AND** init-status SHALL report `{ success: true, data: { hasHook: false } }` rather than `not_a_repo`

#### Scenario: No upward walk for non-git dir

- **GIVEN** a parent directory `P` that is not a Git repository and contains `P/.pi/settings.json`
- **AND** a child directory `P/child` that is not a Git repository and has no `P/child/.pi/settings.json`
- **WHEN** `resolveConfigRoot("P/child")` is called
- **THEN** it SHALL return `null`

## ADDED Requirements

### Requirement: Repository hook uses declared package manager and workspace KB CLI

This repository's declared hook SHALL use the package manager named by the root `packageManager` field and the matching lockfile. After building the workspace KB package, it SHALL invoke that built workspace CLI directly and SHALL NOT use bare `npx kb` registry resolution.

#### Scenario: KB index command cannot resolve the unrelated registry package

- **WHEN** the repository worktree hook reaches its KB index step
- **THEN** it SHALL execute the built CLI under `packages/kb/dist`
- **AND** SHALL contain no bare `npx kb` command
