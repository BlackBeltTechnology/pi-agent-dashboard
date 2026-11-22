## MODIFIED Requirements

### Requirement: Shared-root set
The shared-root set SHALL be `os.homedir()` plus every pinned directory, session
cwd, workspace folder, worktree-init trust root, and persisted project-scope
access-grant subject that is grantable (`isUngrantableSubject` false), recomputed
on every request. A path equal to or under `~/.ssh`, `~/.pi` or a directory of the requirement "Credential and browser-profile directories are sensitive grant subjects" of `path-anchor-grants` SHALL be outside
the set, and a source root that equals or contains one (other than `os.homedir()`) SHALL be dropped. A root source that fails to read SHALL contribute no roots.

#### Scenario: remote browse inside a pinned directory outside $HOME succeeds
- **GIVEN** `/srv/work` is pinned
- **WHEN** a non-local request browses `/srv/work`
- **THEN** the listing SHALL succeed with `confined: true`

#### Scenario: newly pinned directory is browsable immediately
- **WHEN** a directory is pinned and a non-local request browses it on the next request
- **THEN** the listing SHALL succeed without a server restart

#### Scenario: pinned filesystem root is not a root
- **GIVEN** `/` is pinned
- **WHEN** a non-local request browses `/etc`
- **THEN** the response SHALL be 403

#### Scenario: sensitive home subtree refused
- **WHEN** a non-local request browses `$HOME/.ssh`
- **THEN** the response SHALL be 403

#### Scenario: symlink escaping a root is never offered in a listing
- **GIVEN** `$HOME/Dropbox` is a symlink to `/Volumes/ext/Dropbox`, which is outside every root
- **WHEN** a non-local request lists `$HOME`
- **THEN** the entries SHALL NOT include `Dropbox` (a directory listing never includes symlinked directories)

#### Scenario: non-existent path inside a root keeps its not-found error
- **WHEN** a non-local request browses `$HOME/does-not-exist`
- **THEN** the response SHALL be `{ success: false, error: "directory not found" }`, not 403

#### Scenario: access-grant subject is a root
- **GIVEN** a persisted access grant for `/data/shared`
- **WHEN** a non-local request browses `/data/shared/sub`
- **THEN** the listing SHALL succeed

#### Scenario: cloud credential directory refused
- **WHEN** a non-local request browses `$HOME/.aws`
- **THEN** the response SHALL be 403

#### Scenario: browser profile directory refused
- **WHEN** a non-local request browses the Chrome user-data directory of the platform below `$HOME`
- **THEN** the response SHALL be 403

#### Scenario: a pinned directory inside a credential directory is not a root
- **GIVEN** `$HOME/.aws/cache` is pinned
- **WHEN** the shared-root set is computed
- **THEN** `$HOME/.aws/cache` SHALL NOT be in the set
