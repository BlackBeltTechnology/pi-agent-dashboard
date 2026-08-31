## MODIFIED Requirements

### Requirement: Card actions
Each card SHALL provide `New session` (spawn attached) and `New worktree` (spawn attached in a worktree) actions.

The availability of `New worktree` SHALL be derived from the board folder's **static** git state and the global worktree preference only. It SHALL NOT depend on whether any session is currently live, on any session's current branch, or on how many sessions exist for the folder.

When the global worktree preference is off, `New worktree` SHALL be unavailable with a reason pointing at the setting, regardless of git state. While the preference has not yet loaded it SHALL be treated as on.

Otherwise the folder's git state SHALL resolve, in order:
1. a server-reported git HEAD for the board folder naming a branch ⇒ git repository;
2. otherwise the persisted per-session git-repo flag across every session of that folder, live or ended — not a git repository only when a session reports so explicitly;
3. otherwise unknown, which SHALL be treated as a git repository (fail-open).

A server report of "no HEAD" for the folder SHALL NOT be treated as evidence that the folder is not a git repository, because that report also covers a repository with no commits and a failed read.

Folder identity for both the HEAD lookup and the session match SHALL use the same path-normalization the server uses to key its folder reports, so that the board and the sidebar resolve the same folder identically.

When `New worktree` is unavailable, the board action SHALL remain visible in a disabled state carrying a human-readable reason, rather than being removed from the card.

The board's new-proposal dialog SHALL offer its worktree option only when `New worktree` is available for the board folder.

#### Scenario: Spawn attached session
- **WHEN** the user clicks `New session` on a card
- **THEN** a session SHALL be spawned attached to that change's cwd

#### Scenario: Availability survives all sessions ending
- **WHEN** the board folder is a git repository and every session rooted at that folder has ended, with all live sessions running in worktrees elsewhere
- **THEN** `New worktree` SHALL remain enabled on every card

#### Scenario: Availability with no sessions at all
- **WHEN** the board is opened for a pinned git folder that has no sessions, and the server has reported a branch for that folder
- **THEN** `New worktree` SHALL be enabled

#### Scenario: Confirmed non-git folder
- **WHEN** a session of the board folder reports that the folder is not a git repository
- **THEN** `New worktree` SHALL render disabled with a reason stating the folder is not a git repository
- **AND** it SHALL NOT be removed from the card

#### Scenario: Absent HEAD report does not disable
- **WHEN** the server has reported no HEAD for the board folder and no session of that folder reports it is not a git repository
- **THEN** `New worktree` SHALL be enabled

#### Scenario: Unknown git state fails open
- **WHEN** the client has no server HEAD report for the board folder and no session reports the folder's git state
- **THEN** `New worktree` SHALL be enabled

#### Scenario: Worktrees disabled by preference
- **WHEN** the global worktree preference is off
- **THEN** `New worktree` SHALL render disabled with a reason pointing at the setting, on every card, regardless of the folder's git state

#### Scenario: Preference still loading does not show a disabled reason
- **WHEN** the board renders before the global worktree preference has loaded
- **THEN** `New worktree` SHALL NOT render as disabled for the preference reason

#### Scenario: New-proposal dialog follows the same availability
- **WHEN** `New worktree` is unavailable for the board folder
- **THEN** the board's new-proposal dialog SHALL NOT offer to create the proposal in a worktree

#### Scenario: Board and sidebar agree on availability
- **WHEN** the sidebar folder header for a folder treats its `+Worktree` affordance as available
- **THEN** the board for that same folder SHALL treat `New worktree` as available, and vice versa
- **AND** this SHALL hold for a folder with no sessions at all
