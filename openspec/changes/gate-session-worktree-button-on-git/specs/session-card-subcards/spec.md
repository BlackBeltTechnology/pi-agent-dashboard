# session-card-subcards — delta

## MODIFIED Requirements

### Requirement: +Worktree button on session card
The session card SHALL render a `+Worktree` button next to `+Session`, gated by the `gitWorktreeEnabled` config flag (default true) — mirroring the folder-header `+Worktree` gate. It SHALL NOT be gated on `session.status` or `session.sessionFile`. It SHALL be hidden when the session is already a worktree session (`session.gitWorktree` set), since spawning a worktree from inside a worktree is redundant. It SHALL ALSO be hidden when the session's cwd is a **confirmed non-git** directory — `session.isGitRepo === false`. It SHALL remain visible when `session.isGitRepo` is `true` OR `undefined` (unknown / not-yet-probed / legacy), so a git repo whose probe timed out or a session predating the signal never loses the button. The gate SHALL NOT use `session.gitBranch` for this purpose — `gitBranch` is a data-arrival signal (absent during the register race, on probe failure, and after a server restart for cold sessions) and would wrongly hide the button for real git repos.

Click SHALL open the existing `WorktreeSpawnDialog` scoped to the parent session's `cwd`. When `session.attachedProposal` is a non-empty string, the dialog SHALL open via the proposal-aware path (pre-filled branch `os/<change>` + `attachProposal` carry-through); otherwise via the plain path (no proposal).

The button SHALL be `disabled` when `session.cwdMissing === true`, tooltip `session's directory no longer exists`. The card SHALL NOT implement its own worktree-creation, bootstrap, or `spawn_session` logic — it reuses the dialog's existing machinery.

#### Scenario: Visible next to +Session in a git repo
- **WHEN** a session card renders with `gitWorktreeEnabled !== false`, a worktree handler supplied, AND `session.isGitRepo === true`
- **THEN** the `+Worktree` button SHALL render alongside `+Session`

#### Scenario: Hidden when worktrees disabled
- **WHEN** the dashboard config has `gitWorktreeEnabled === false`
- **THEN** the `+Worktree` button SHALL NOT render (the `+Session` button is unaffected)

#### Scenario: Hidden in a confirmed non-git folder
- **WHEN** a session card renders with `gitWorktreeEnabled !== false` and a worktree handler supplied, but `session.isGitRepo === false`
- **THEN** the `+Worktree` button SHALL NOT render
- **AND** the `+Session` button SHALL be unaffected

#### Scenario: Visible when git status is unknown (no regression)
- **WHEN** a session card renders with `gitWorktreeEnabled !== false` and a worktree handler supplied, and `session.isGitRepo` is `undefined` (probe inconclusive, register race, or legacy session)
- **THEN** the `+Worktree` button SHALL render (unknown is not treated as non-git)

#### Scenario: Click with proposal opens proposal-aware dialog
- **WHEN** the user clicks `+Worktree` on a session with `attachedProposal = "add-dark-mode"`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with branch pre-filled `os/add-dark-mode` and `attachProposal` carried through

#### Scenario: Click without proposal opens plain dialog
- **WHEN** the user clicks `+Worktree` on a session with no `attachedProposal`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with no pre-filled proposal
