## MODIFIED Requirements

### Requirement: Desktop session card keeps only state and its inline controls

The desktop session card SHALL render no action chips, no action rows, and no per-subcard option menus.

**Kept on the card:**
- **Header controls:** the Archive button (when archiving is offered) and the Exit ✕ button (for alive sessions). The session actions trigger SHALL NOT render in the header.
- **Edge control:** the session actions trigger, centred on the card's right edge (see `session-actions-menu`).
- **Controls that act on one running thing**, unchanged:
  - the PROCESS subcard's row controls (stop an individual in-flight tool, kill a background process, expand or collapse the drawer);
  - the `ProcessSafetyChip` that replaces a hidden PROCESS subcard;
  - the abort control on a running flow's status in the FLOWS subcard.
- **The disabled-OPENSPEC remediation control.**
- **Clickable status:** the OpenSpec lifecycle bar, the attached change link, the archived / missing / main-checkout letters and badges, the git branch control, the dirty-files pill, the PR link, and plugin status pills (for example, KB / MCP worktree pills).

Every other action SHALL be reached through the session actions menu (`session-actions-menu`).

The `session-card-action-bar` slot's output SHALL NOT render on the desktop card, although its claims stay mounted (see `session-actions-menu`). The Rename button SHALL NOT render in the header; double-clicking the name SHALL still start an inline rename, and Rename… is offered in the menu.

#### Scenario: No action chips on an ended session card
- **WHEN** a desktop card renders for an ended session with a `sessionFile` in a git repo
- **THEN** no Resume, Fork, +Session or +Worktree button SHALL render on the card
- **AND** the header SHALL render the Archive button
- **AND** the card SHALL render `session-actions-trigger-<id>` on its right edge, outside the header

#### Scenario: PROCESS row controls stay on the card
- **WHEN** a desktop card renders for a session with an in-flight bash tool and a background process
- **THEN** the tool row's stop control and the process row's kill control SHALL render inside the PROCESS subcard as before
- **AND** no Archive button SHALL render (unchanged rule: never archive while running)

#### Scenario: Disabled OPENSPEC keeps its remediation control
- **WHEN** a desktop card renders an OPENSPEC subcard in a BROKEN readiness state
- **THEN** its single remediation control SHALL render and route as before

#### Scenario: Double-click rename still works
- **WHEN** the user double-clicks the session name on a non-ended desktop card
- **THEN** the inline rename input SHALL appear

### Requirement: Desktop session card body groups sections into five subcards in order
The desktop branch of `SessionCard.tsx` SHALL render its grouped sections as `SessionSubcard` instances in the following top-to-bottom order: `OPENSPEC`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY`.

The header zone SHALL remain outside any subcard, above the first subcard. Its rows are defined by the `session-card-header` capability:
- the title row: status chip, name (double-click to rename), missing-folder pill, time, then the Archive / Exit controls (the session actions trigger is not in the header; it sits on the card's right edge, see `session-actions-menu`);
- the status row;
- the git row;
- the meta row: model, session chips, context bar, cost.

The header zone SHALL NOT contain action chips (Resume, Fork, +Session, +Worktree); those actions live in the session actions menu. No footer action row SHALL render below the last subcard. The session actions edge trigger is absolutely positioned at the card's vertical centre, so it does not count as rendering below the last subcard. The `session-card-action-bar` slot's output renders in the session actions menu.

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
- **THEN** no element SHALL render below the last subcard (the absolutely positioned session actions edge trigger, vertically centred on the card, is not below it even though it is the card root's last DOM child)
- **AND** the card SHALL NOT contain the Push, Open PR, Merge or Close worktree action buttons
- **AND** the git row's PR status link (`data-testid="worktree-pr-segment"`) is clickable status, not one of these action buttons
