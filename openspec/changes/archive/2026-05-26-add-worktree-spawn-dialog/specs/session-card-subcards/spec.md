## ADDED Requirements

### Requirement: WORKSPACE subcard renders worktree pill when session is in a git worktree
When `session.gitWorktree` is set, the WORKSPACE subcard SHALL render an inline `worktree` pill immediately after the existing `⎇ <branch>` GitInfo line. The branch line itself SHALL be unchanged (the `⎇ <branch>` text and link remain primary identity).

The pill SHALL carry class tokens consistent with other small badges in the WORKSPACE subcard: `inline-flex`, `items-center`, `px-1.5 py-px`, `rounded-full`, `text-[9px]`, `uppercase`, `tracking-wider`, `border border-[var(--border-subtle)]`, `text-[var(--text-muted)]`, `bg-[var(--bg-tertiary)]`. The pill SHALL carry `data-testid="worktree-pill"`.

The pill SHALL render text `worktree`. When `session.gitWorktree.base` is also set (the worktree was created by the dashboard, so the base ref is known), the pill's `title` attribute SHALL be `created from <base>` (e.g., `created from develop`). When `base` is absent (worktree created outside the dashboard), the `title` SHALL be `git worktree` (no fabricated base claim).

The WORKSPACE subcard's empty-hide rule SHALL be unchanged: presence of `gitWorktree` alone SHALL NOT keep the subcard visible if `showGitInfo` is false and no other slot contributes. (The pill is bound to the GitInfo line and follows its visibility.)

#### Scenario: Session in worktree shows pill next to branch
- **WHEN** a session card is rendered for a session with `gitWorktree: { mainPath: "/repo", name: "feat-x" }` and `gitBranch: "feat/dark"`
- **THEN** the rendered DOM SHALL contain a `WORKSPACE`-titled subcard
- **AND** the subcard SHALL contain the existing GitInfo line showing `⎇ feat/dark`
- **AND** the subcard SHALL contain an inline element with `data-testid="worktree-pill"` and text `worktree`
- **AND** the pill SHALL appear after the branch element in document order

#### Scenario: Pill tooltip with known base
- **WHEN** a session has `gitWorktree.base: "develop"`
- **THEN** the pill's `title` attribute SHALL be `created from develop`

#### Scenario: Pill tooltip without known base
- **WHEN** a session has `gitWorktree` set but `gitWorktree.base` is absent
- **THEN** the pill's `title` attribute SHALL be `git worktree`

#### Scenario: Session in main checkout has no pill
- **WHEN** a session card is rendered for a session with `gitWorktree` absent or `undefined`
- **THEN** the rendered DOM SHALL NOT contain any element with `data-testid="worktree-pill"`

#### Scenario: Branch text unchanged for worktree sessions
- **WHEN** a session card is rendered for a worktree session
- **THEN** the GitInfo line SHALL display `⎇ <branch>` exactly as it would for a non-worktree session (no replacement, no folder-name substitution)

#### Scenario: Mobile session card omits worktree pill
- **WHEN** the session card is rendered in mobile layout (no `SessionSubcard` wrappers)
- **THEN** the worktree pill SHALL NOT be rendered
- **AND** the mobile flat layout SHALL remain unchanged
