## ADDED Requirements

### Requirement: Config-root resolution decoupled from git

The server SHALL resolve the directory that holds a checkout's worktree-init
configuration via `resolveConfigRoot(cwd)`, independent of whether the cwd is a
git repository:

- WHEN `cwd` is inside a git repository or worktree, `resolveConfigRoot` SHALL
  return `resolveMainPath(cwd)` (the git common-dir's parent), preserving the
  existing worktree→main-repo mapping.
- WHEN `cwd` is NOT a git repository AND `cwd/.pi/settings.json` exists,
  `resolveConfigRoot` SHALL return `cwd`.
- WHEN `cwd` is NOT a git repository AND `cwd/.pi/settings.json` does not exist,
  `resolveConfigRoot` SHALL return `null`.

For a non-git directory the config root SHALL be exactly `cwd`; the server SHALL
NOT walk upward to a parent directory's `.pi/settings.json`. `resolveConfigRoot`
only locates a config file: its git branch MAY run read-only git discovery probes
(`isGitRepo`/`resolveMainPath` shell out to `git rev-parse`), but it SHALL NOT
execute any repo-declared hook command (`gate`/`run`).

The init-status (`GET /api/git/worktree/init-status`) and init
(`POST /api/git/worktree/init`) endpoints SHALL use `resolveConfigRoot` in place
of the previous `isGitRepo` guard plus `resolveMainPath` call. Worktree
creation, removal, and lifecycle endpoints SHALL continue to require a git
repository and SHALL be unaffected by this requirement.

#### Scenario: Git checkout resolves to main repo root

- **WHEN** `resolveConfigRoot(cwd)` is called for a cwd inside a git worktree
- **THEN** it SHALL return the same path as `resolveMainPath(cwd)`

#### Scenario: Non-git dir with settings resolves to itself

- **WHEN** `cwd` is not a git repository and `cwd/.pi/settings.json` exists
- **THEN** `resolveConfigRoot(cwd)` SHALL return `cwd`

#### Scenario: Non-git dir without settings resolves to null

- **WHEN** `cwd` is not a git repository and `cwd/.pi/settings.json` does not exist
- **THEN** `resolveConfigRoot(cwd)` SHALL return `null`

#### Scenario: Git dir with unresolvable common-dir resolves to null

- **GIVEN** a cwd where `isGitRepo` is true but `resolveMainPath` returns `null` (degenerate git state)
- **WHEN** `resolveConfigRoot(cwd)` is called
- **THEN** it SHALL return `null`
- **AND** it SHALL NOT fall through to the non-git `cwd/.pi/settings.json` check
- **AND** init-status SHALL report `{ success: true, data: { hasHook: false } }` rather than `not_a_repo`

#### Scenario: No upward walk for non-git dir

- **GIVEN** a parent directory `P` that is not a git repository and contains `P/.pi/settings.json`
- **AND** a child directory `P/child` that is not a git repository and has no `P/child/.pi/settings.json`
- **WHEN** `resolveConfigRoot("P/child")` is called
- **THEN** it SHALL return `null` (it SHALL NOT inherit `P`'s settings)

### Requirement: Init endpoints read a hook in a non-git directory

The init-status and init endpoints SHALL report a declared hook for a non-git
directory whose config root `resolveConfigRoot` yields. A non-git directory with
a valid `.pi/settings.json#worktreeInit` SHALL NOT be reported as `not_a_repo`.
When `resolveConfigRoot` returns `null`, init-status SHALL report
`{ hasHook: false }` (a successful response) rather than a `not_a_repo` error,
and `POST /init` SHALL return the endpoint's existing no-hook envelope
`{ success: true, data: { ran: false, skippedReason: "no_hook" } }` (no new
response shape). A non-git dir's untrusted hook SHALL return the existing
`{ success: false, code: "init_untrusted", data: { hook, hash } }` from
`POST /init`, unchanged from the git path.

TOFU trust SHALL apply identically to a non-git config root: an untrusted hook
in a non-git directory SHALL report `{ hasHook: true, trusted: false }` and the
server SHALL NOT spawn its gate or run until trust is recorded.

#### Scenario: Non-git dir with untrusted hook reports presence only

- **WHEN** init-status is requested for a non-git directory whose `.pi/settings.json` declares a `worktreeInit` hook that is not yet trusted
- **THEN** the response SHALL be `{ success: true, data: { hasHook: true, trusted: false } }`
- **AND** the server SHALL NOT spawn the gate

#### Scenario: Non-git dir with no hook is not an error

- **WHEN** init-status is requested for a non-git directory with no `.pi/settings.json`
- **THEN** the response SHALL be `{ success: true, data: { hasHook: false } }`
- **AND** the response SHALL NOT be `not_a_repo`

#### Scenario: Non-git dir with settings.json but no worktreeInit

- **GIVEN** a non-git directory that HAS `.pi/settings.json` but the file has no (or a malformed) `worktreeInit` key
- **WHEN** init-status is requested
- **THEN** `resolveConfigRoot` SHALL return the directory (root resolves) and `readInitHook` SHALL fail-open to `null`
- **AND** the response SHALL be `{ success: true, data: { hasHook: false } }` (same as a git repo without a hook)

#### Scenario: Non-git dir with trusted hook evaluates the gate

- **WHEN** init-status is requested for a non-git directory whose hook is trusted
- **THEN** the gate SHALL be evaluated (cached) in that directory
- **AND** the response SHALL be `{ hasHook: true, needsInit, trusted: true }`

#### Scenario: POST init on non-git dir with untrusted hook does not execute

- **WHEN** `POST /api/git/worktree/init` is called for a non-git directory whose declared hook is not trusted
- **THEN** the server SHALL NOT run the hook (no gate spawn, no run spawn)
- **AND** the response SHALL be `{ success: false, code: "init_untrusted", data: { hook, hash } }`

#### Scenario: POST init on non-git dir with no hook returns the no-hook envelope

- **WHEN** `POST /api/git/worktree/init` is called for a non-git directory with no `.pi/settings.json`
- **THEN** the response SHALL be `{ success: true, data: { ran: false, skippedReason: "no_hook" } }`
- **AND** the response SHALL NOT be `not_a_repo`
