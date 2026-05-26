## MODIFIED Requirements

### Requirement: Git branch detection
The bridge extension SHALL detect the current git branch by running `git rev-parse --abbrev-ref HEAD` in the session's `cwd`. If the command fails (not a git repo), the branch SHALL be `undefined`. When in detached HEAD state, the extension SHALL detect the short commit SHA via `git rev-parse --short HEAD`.

In the same `gatherGitInfo` pass, the extension SHALL detect whether the cwd is a git worktree by comparing `git rev-parse --git-common-dir` against `git rev-parse --show-toplevel`. If `git-common-dir` resolves to a path outside `show-toplevel` (e.g. `<main-repo>/.git`), the cwd SHALL be classified as a worktree.

#### Scenario: Session in a git repository
- **WHEN** the extension gathers git info in a directory that is a git repository
- **THEN** the extension SHALL detect the current branch name

#### Scenario: Session not in a git repository
- **WHEN** the extension gathers git info in a directory that is not a git repository
- **THEN** the branch SHALL be `undefined` and no git info SHALL be sent

#### Scenario: Detached HEAD
- **WHEN** the git repository is in a detached HEAD state
- **THEN** `git rev-parse --abbrev-ref HEAD` returns `"HEAD"`
- **AND** the extension SHALL run `git rev-parse --short HEAD` to get the short commit SHA
- **AND** the branch SHALL be the short SHA (e.g., `"abc1234"`)
- **AND** no branch link SHALL be generated

#### Scenario: Session in main repo checkout
- **WHEN** `git-common-dir` resolves under `show-toplevel` (typically `<cwd>/.git`)
- **THEN** the extension SHALL emit `gitWorktree: undefined` (or omit the field) on the gathered info

#### Scenario: Session in a git worktree
- **WHEN** `git-common-dir` resolves to a path outside `show-toplevel`
- **THEN** the extension SHALL emit `gitWorktree: { mainPath, name }`
- **AND** `mainPath` SHALL be the absolute directory of the main worktree (the parent of `git-common-dir`)
- **AND** `name` SHALL be the basename of the worktree cwd

#### Scenario: Worktree detection failure
- **WHEN** either `rev-parse` invocation fails (e.g., insufficient git version, permission)
- **THEN** the extension SHALL fall through to `gitWorktree: undefined`
- **AND** SHALL NOT block the branch / remote / PR detection that follows

## ADDED Requirements

### Requirement: Worktree identity propagation through session protocol
The bridge SHALL include the `gitWorktree` object on `session_register` and `git_info_update` payloads when the cwd is a worktree. The server SHALL store `gitWorktree` on `DashboardSession` and forward it in `session_added` / `session_updated` browser messages. The field SHALL be optional; clients receiving an older bridge MUST treat its absence as "not a worktree".

#### Scenario: Worktree session register
- **WHEN** a bridge whose cwd is a worktree registers a session
- **THEN** the `session_register` payload SHALL include `gitWorktree: { mainPath, name }`

#### Scenario: Non-worktree session register
- **WHEN** a bridge whose cwd is a main checkout registers a session
- **THEN** the `gitWorktree` field SHALL be absent (not present as `null`)

#### Scenario: Live worktree state update
- **WHEN** a bridge's `gitWorktree` value changes (rare; e.g., user runs `git worktree repair`)
- **THEN** the bridge SHALL emit a `git_info_update` carrying the new value
- **AND** the server SHALL broadcast `session_updated` with the new `gitWorktree`

#### Scenario: Backward compatibility with older bridges
- **WHEN** a client receives a session payload without the `gitWorktree` field
- **THEN** the client SHALL treat the session as a plain checkout (no worktree pill, no group collapse)

### Requirement: Worktree base ref persisted in session meta
When a session is spawned by the dashboard via the worktree dialog (post `POST /api/git/worktree`), the server SHALL persist the base ref used to create the worktree into the session's `.meta.json` as `gitWorktreeBase: string`. Sessions spawned by any other channel (CLI `pi`, manual `git worktree add`, etc.) SHALL NOT have this field.

The server SHALL include `gitWorktree.base` on browser-facing session payloads when both:
- `session.gitWorktree` is present (cwd is a worktree), AND
- `gitWorktreeBase` is set in `.meta.json` for this session.

#### Scenario: Dialog-spawned worktree session
- **WHEN** the dashboard spawns a session via the worktree dialog with `base: "develop"`
- **THEN** the session's `.meta.json` SHALL contain `gitWorktreeBase: "develop"`
- **AND** subsequent `session_added` payloads SHALL include `gitWorktree: { mainPath, name, base: "develop" }`

#### Scenario: Session in worktree spawned by other means
- **WHEN** a session is registered for a worktree cwd but no `gitWorktreeBase` exists in `.meta.json`
- **THEN** the `gitWorktree` object SHALL include `mainPath` and `name` only (no `base`)
