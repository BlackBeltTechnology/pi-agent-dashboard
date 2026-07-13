# session-uncommitted-indicator

## ADDED Requirements

### Requirement: Session card surfaces uncommitted working-tree state

The session card SHALL display the count of uncommitted files (staged + unstaged + untracked) and the branch's ahead/behind drift versus its upstream, sourced from `DashboardSession.gitStatus`. The indicator SHALL be hidden when the working tree is clean AND the branch is in sync.

#### Scenario: Dirty working tree shows a count pill
- WHEN a session's cwd has 5 uncommitted files
- THEN the GIT subcard shows an amber `● 5 uncommitted` pill
- AND the pill is a button that opens the commit dialog

#### Scenario: Ahead/behind drift is shown when non-zero
- WHEN the branch is 2 commits ahead and 1 behind upstream
- THEN the card shows `↑2` and `↓1` chips
- AND when ahead and behind are both 0 no drift chips render

#### Scenario: Clean and in-sync hides the indicator
- WHEN the working tree is clean AND ahead = 0 AND behind = 0
- THEN no dirty pill and no drift chips are rendered

#### Scenario: Legacy or inconclusive probe renders nothing
- WHEN `gitStatus` is absent on the session
- THEN the indicator renders nothing and no error is shown

### Requirement: Indicator attaches to the shell's existing git surface

The indicator SHALL render on the same surface the shell already uses for git — the per-card `GitInfo` for a solo or worktree session, and the folder-header `GroupGitInfo` for two or more non-worktree sessions sharing a cwd. It SHALL NOT be duplicated on the individual cards in the grouped case.

#### Scenario: Grouped same-cwd sessions show one folder-header indicator
- WHEN two or more non-worktree sessions share the same cwd
- THEN the dirty/drift indicator renders once in the folder header
- AND no dirty/drift indicator renders on the individual session cards

#### Scenario: Solo and worktree sessions show a per-card indicator
- WHEN a folder has exactly one session, OR the session is a git worktree
- THEN the indicator renders on that session's card

#### Scenario: Folder count sourced without per-session redundancy
- WHEN N sessions share one cwd
- THEN the folder-header count is read from the folder-head poll (one read per cwd)
- AND the feature does not require each of the N sessions to carry a redundant status

### Requirement: Hybrid delivery of git status

The system SHALL deliver `gitStatus` both by passive broadcast on the bridge's existing VCS tick and by on-demand refresh, without introducing a new polling loop.

#### Scenario: Passive broadcast on the VCS tick
- WHEN the bridge's 30 s VCS tick observes a changed working-tree state
- THEN it emits `git_info_update` carrying `gitStatus`
- AND no message is emitted when the status is unchanged since the last tick

#### Scenario: On-demand refresh erases staleness
- WHEN the user focuses or expands a session card
- THEN the client requests `GET /api/git/status?cwd=` and updates the pill from the fresh read
- AND the status is refreshed again immediately after a successful commit
