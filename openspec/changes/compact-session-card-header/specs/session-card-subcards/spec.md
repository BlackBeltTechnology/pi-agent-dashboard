## RENAMED Requirements

- FROM: `### Requirement: cwd-gone pill on session card`
- TO: `### Requirement: Missing-folder pill on session card`

## REMOVED Requirements

### Requirement: Desktop session card body groups sections into six subcards in order
**Reason**: The GIT subcard is removed; its only content (the `GitInfo` line) moves to the header git row. Superseded by "Desktop session card body groups sections into five subcards in order".
**Migration**: Tests asserting the `GIT` subcard title or six-subcard order assert the five-subcard order and the header git row instead.

### Requirement: GIT subcard renders worktree pill when session is in a git worktree
**Reason**: There is no GIT subcard; the worktree pill now leads the header git row. Superseded by "Header git row renders worktree pill when session is in a git worktree".
**Migration**: Tests locating `[data-testid="worktree-pill"]` inside a `GIT` subcard locate it as the first element of the header git row.

## MODIFIED Requirements

### Requirement: Missing-folder pill on session card
The desktop session card's title row SHALL render a small red pill when `session.cwdMissing === true`, independent of git state. The pill reads `folder missing` (i18n key `common.cwdGone`) and carries `data-testid="cwd-gone-pill"`. Its tooltip states that the session's folder no longer exists. Placement and styling are defined by the `session-card-header` capability.

#### Scenario: Pill renders for cwd-missing session
- **WHEN** the card renders a session with `cwdMissing: true`
- **THEN** the title row SHALL contain `[data-testid="cwd-gone-pill"]` with text `folder missing`
- **AND** no `[data-testid="cwd-gone-pill"]` SHALL render inside the git row

#### Scenario: Pill renders without git
- **WHEN** the card renders a session with `cwdMissing: true` and no `gitBranch`
- **THEN** the title row SHALL contain `[data-testid="cwd-gone-pill"]`

#### Scenario: Pill absent for healthy session
- **WHEN** `cwdMissing` is `undefined` or `false`
- **THEN** the pill SHALL NOT render

## ADDED Requirements

### Requirement: Desktop session card body groups sections into five subcards in order
The desktop branch of `SessionCard.tsx` SHALL render its grouped sections as `SessionSubcard` instances in the following top-to-bottom order: `OPENSPEC`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY`.

The header zone SHALL remain outside any subcard, above the first subcard. Its rows are defined by the `session-card-header` capability:
- the title row: status chip, name (double-click to rename), missing-folder pill, time, then the Archive / `⋯` / Exit controls;
- the status row;
- the git row;
- the meta row: model, session chips, context bar, cost.

The header zone SHALL NOT contain action chips (Resume, Fork, +Session, +Worktree); those actions live in the session actions menu. No footer action row SHALL render below the last subcard. The `session-card-action-bar` slot's output renders in the session actions menu.

The worktree card-slot wrapper (`data-testid="worktree-card-section-gap"`) keeps its position directly after the OPENSPEC subcard, so it now precedes `STATUS`, and keeps its stacking tokens.

There SHALL be no `GIT` subcard and no `WORKSPACE` subcard. Git branch / PR / worktree / dirty information is clickable status in the header git row. Worktree actions live in the session actions menu's GIT group. The `STATUS` subcard hosts the `session-card-badge` slot (goal / automation badge contributions).

#### Scenario: All five subcard titles appear in order when populated
- **WHEN** a desktop session card is rendered with content for every subcard
- **THEN** the rendered DOM SHALL contain centered title elements `OPENSPEC`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY` in that document order

#### Scenario: Header zone stays outside subcards
- **WHEN** a desktop session card is rendered
- **THEN** the session name, status row, git row and meta row SHALL render before the first `SessionSubcard` element
- **AND** none of those elements SHALL be descendants of a `SessionSubcard`

#### Scenario: GIT and WORKSPACE subcards no longer rendered
- **WHEN** a desktop session card is rendered for a worktree session with `gitBranch` set
- **THEN** no element with title text `GIT` or `WORKSPACE` SHALL appear in the rendered DOM

#### Scenario: No footer action row and no worktree actions row
- **WHEN** a desktop session card is rendered for a worktree session with an action-bar plugin claim
- **THEN** no element SHALL render below the last subcard
- **AND** the card SHALL NOT contain the Push, Open PR, Merge or Close worktree action buttons
- **AND** the git row's PR status link (`data-testid="worktree-pr-segment"`) is clickable status, not one of these action buttons

### Requirement: Header git row renders worktree pill when session is in a git worktree
When the header git row renders (see `session-card-header`) and `session.gitWorktree` is set, the git row SHALL render an inline `worktree` pill as its **first** element, before the `⎇ <branch>` text. The branch text itself SHALL be unchanged.

The pill SHALL carry class tokens `inline-flex`, `items-center`, `px-1.5 py-px`, `rounded-full`, `text-[11px]`, `font-semibold`, `flex-shrink-0`, `border border-[var(--tint-orange-border)]`, `text-[var(--tint-orange-fg)]`, `bg-[var(--tint-orange-bg)]`. It SHALL carry `data-testid="worktree-pill"`.

The pill SHALL render the bare text `worktree`, never the worktree name. When `session.gitWorktree.base` is also set, the pill's `title` attribute SHALL be `created from <base>`; when absent, `git worktree`. The pill SHALL NOT appear in the `STATUS` subcard.

#### Scenario: Session in worktree shows pill first in the git row
- **WHEN** a session card is rendered for a session with `gitWorktree: { mainPath: "/repo", name: "feat-x" }` and `gitBranch: "feat/dark"`
- **THEN** the rendered DOM SHALL NOT contain a `GIT` titled subcard
- **AND** the header git row SHALL contain an element with `data-testid="worktree-pill"` and text `worktree`
- **AND** the pill SHALL appear before the `feat/dark` branch element in document order

#### Scenario: Worktree pill does NOT appear in STATUS subcard
- **WHEN** a session card is rendered for a session with `gitWorktree` set AND a plugin claims `session-card-badge`
- **THEN** the `STATUS` titled subcard SHALL NOT contain any element with `data-testid="worktree-pill"`

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
- **THEN** the git row SHALL display `⎇ <branch>` exactly as it would for a non-worktree session (no replacement, no folder-name substitution)

#### Scenario: Mobile session card omits worktree pill
- **WHEN** the session card is rendered in mobile layout (no `SessionSubcard` wrappers)
- **THEN** the worktree pill SHALL NOT be rendered
- **AND** the mobile flat layout SHALL remain unchanged
