# git-context — delta

## ADDED Requirements

### Requirement: Persistent is-git-repo tri-state
The system SHALL expose a per-session `isGitRepo` tri-state describing whether the session's cwd is a git repository, independent of branch-info arrival. The value SHALL be one of: `true` (confirmed git repo), `false` (confirmed non-git), or `undefined` (unknown — probe inconclusive or legacy session).

The bridge SHALL compute `isGitRepo` from `git rev-parse --is-inside-work-tree` (the `git.isGitRepo()` `Result`): a successful result SHALL yield its boolean value; a process exit with code `128` (git ran and definitively reported "not a repository") SHALL yield `false`; any other failure (spawn error such as missing git binary, timeout, or termination signal) SHALL yield `undefined`. A failed or timed-out probe SHALL NEVER yield `false` — inconclusive is not negative.

The bridge SHALL include `isGitRepo` on the `session_register` payload (computed synchronously at register time, so browsers receive it without the race that affects `git_info_update`) and MAY refresh it on `git_info_update`. The field SHALL be optional; a client or server receiving an older bridge MUST treat its absence as `undefined` (unknown).

The server SHALL store `isGitRepo` on `DashboardSession`, forward it in `session_added` / `session_updated` browser messages, and persist it into the session's `.meta.json` as `isGitRepo: boolean`. On cold start, `sessionFromMeta` SHALL restore `meta.isGitRepo` so ended/cold sessions in a git repo retain a truthy signal across server restarts without a live bridge.

#### Scenario: Confirmed git repo on register
- **WHEN** the bridge registers a session whose cwd is inside a git work tree
- **THEN** the `session_register` payload SHALL include `isGitRepo: true`
- **AND** the server SHALL persist `isGitRepo: true` to the session's `.meta.json`

#### Scenario: Confirmed non-git on register
- **WHEN** the bridge registers a session whose cwd is not a git repository (git exits `128`)
- **THEN** the `session_register` payload SHALL include `isGitRepo: false`

#### Scenario: Inconclusive probe yields unknown, never false
- **WHEN** the git probe fails to run or times out (missing binary, permission error, ≥15s timeout, killed by signal)
- **THEN** `isGitRepo` SHALL be `undefined`
- **AND** SHALL NOT be reported as `false`

#### Scenario: Survives server restart for cold sessions
- **WHEN** the server restarts and rebuilds an ended session from `.meta.json` where `meta.isGitRepo === true`, with no live bridge reconnected
- **THEN** the restored `DashboardSession.isGitRepo` SHALL be `true`

#### Scenario: Legacy bridge / session
- **WHEN** a session is registered by a bridge that does not send `isGitRepo`, or restored from a `.meta.json` lacking the field
- **THEN** `DashboardSession.isGitRepo` SHALL be `undefined`
