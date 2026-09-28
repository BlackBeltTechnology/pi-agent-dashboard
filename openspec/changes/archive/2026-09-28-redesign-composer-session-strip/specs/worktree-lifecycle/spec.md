## MODIFIED Requirements

### Requirement: WorktreeActionsMenu component
The client SHALL render `<WorktreeActionsMenu>` inside the WORKSPACE subcard, and inside the composer strip's Git group, whenever `session.gitWorktree` is set.

When `session.gitPrNumber` is set, the menu SHALL render a **PR status segment** in place of the former "View PR #N" label.
- The segment SHALL show the PR number and its state. Each state SHALL have a distinct glyph and a word or accessible name, never colour alone:
  - `draft`: when `gitPrDraft` is true;
  - `open`: with a checks marker for passing / failing / pending when `gitPrChecks` is known;
  - `merged` and `closed`: each with its own glyph, and no checks marker.
- When the state fields are absent (older bridge), the segment SHALL show the number only.
- The segment SHALL be a link to `session.gitPrUrl` when that URL is present, and plain text otherwise. Opening the link SHALL NOT require `gh`.

The actions after the segment depend on state:
- **No PR, or PR closed:** Push, Open PR (gh-gated, see below) and Merge.
- **PR open or draft:** Push and Merge.
- **PR merged:** no Merge; Push only when the worktree has local commits ahead.
- **Always:** Close worktree renders last, visually separated from the other actions.

Whenever Merge renders, it SHALL render as the filled primary action only when all of these hold; otherwise it SHALL render outlined and enabled:
- the session is in a worktree,
- the PR is open,
- it is not a draft,
- `gitPrChecks` is `passing` or `none`,
- the PR status was successfully detected within the last 15 minutes,
- the session is not working,
- and either no OpenSpec change is attached, or the attached change's state is known and is `COMPLETE`.

An attached change whose state is not yet known SHALL NOT make Merge primary. The same rule SHALL decide Merge emphasis on the session card and in the composer strip, and on each surface a single decision SHALL drive both the Merge emphasis and the OpenSpec primary's emphasis.

While the session is working (streaming or auto-retrying), Push, Open PR and Merge SHALL be disabled on every surface that renders the menu.

#### Scenario: All visible actions present for worktree session without PR when gh is available
- **WHEN** the menu renders for a worktree session with no `gitPrNumber`
- **AND** `gh` is resolvable via the tool registry
- **THEN** the menu SHALL show Push, Open PR, Merge, Close worktree buttons

#### Scenario: Open PR hidden when gh is not available
- **WHEN** the menu renders for a worktree session with no `gitPrNumber`
- **AND** `gh` is NOT resolvable via the tool registry
- **THEN** the menu SHALL show Push, Merge, Close worktree buttons
- **AND** the Open PR button SHALL NOT render

#### Scenario: View PR remains visible without gh when PR already exists
- **WHEN** `session.gitPrNumber` and `session.gitPrUrl` are set
- **AND** `gh` is NOT resolvable
- **THEN** the menu SHALL still render the PR status segment as a link to `session.gitPrUrl`

#### Scenario: Open PR toggles to View PR when PR exists
- **WHEN** `session.gitPrNumber = 747`, `gitPrState = "open"`, `gitPrDraft = false`, `gitPrChecks = "passing"`
- **THEN** the Open PR button SHALL NOT render
- **AND** a segment reading `#747` with an open-state marker and a passing-checks marker SHALL render, linking to `session.gitPrUrl`

#### Scenario: Segment without URL is not a link
- **WHEN** `session.gitPrNumber = 747` and `session.gitPrUrl` is absent
- **THEN** the segment SHALL render `#747` as plain text, not as a link

#### Scenario: Legacy bridge shows number only
- **WHEN** `session.gitPrNumber = 747` and `gitPrState`, `gitPrDraft`, `gitPrChecks` are absent
- **THEN** the segment SHALL show `#747` without a state or checks marker
- **AND** Merge SHALL render outlined

#### Scenario: Merged PR hides push and merge
- **WHEN** `gitPrState = "merged"` and the worktree has no local commits ahead
- **THEN** the segment SHALL show a merged marker
- **AND** neither Push nor Merge SHALL render

#### Scenario: Merged PR with new local commits offers Push
- **WHEN** `gitPrState = "merged"` and `gitStatus.ahead = 2`
- **THEN** Push SHALL render and Merge SHALL NOT

#### Scenario: Stale PR status never makes Merge primary
- **WHEN** the PR looks open and green but was last detected 20 minutes ago
- **THEN** Merge SHALL render outlined

#### Scenario: Closed PR offers a new PR
- **WHEN** `gitPrState = "closed"` and `gh` is resolvable
- **THEN** the segment SHALL show a closed marker
- **AND** Push, Open PR and Merge SHALL render

#### Scenario: Merge is primary only for a green PR on a finished change
- **WHEN** the PR is open, not a draft, `gitPrChecks = "passing"`, and the attached change is `COMPLETE`
- **THEN** Merge SHALL render as a filled primary

#### Scenario: Merge is primary without CI when no change is attached
- **WHEN** the PR is open, not a draft, `gitPrChecks = "none"`, and no change is attached
- **THEN** Merge SHALL render as a filled primary

#### Scenario: Merge outlined while the change is still implementing
- **WHEN** the PR is open, not a draft, `gitPrChecks = "passing"`, and the attached change is `IMPLEMENTING`
- **THEN** Merge SHALL render outlined and enabled

#### Scenario: Merge outlined while change state is loading
- **WHEN** the PR is open and green, a change is attached, and its state is not yet known
- **THEN** Merge SHALL render outlined

#### Scenario: Session card keeps a single filled primary
- **WHEN** the session card shows a `COMPLETE` attached change and an open, non-draft PR with passing checks
- **THEN** the card's Merge SHALL render filled
- **AND** the card's OpenSpec primary SHALL render outlined

#### Scenario: Non-worktree session never demotes the OpenSpec primary
- **WHEN** a session outside any worktree has an open, green PR and an attached `IMPLEMENTING` change
- **THEN** the OpenSpec primary SHALL render filled

#### Scenario: Card worktree actions disabled while working
- **WHEN** a worktree session is streaming
- **THEN** the session card's Push and Merge SHALL be disabled
- **AND** Merge SHALL render outlined, even if the PR is open and green

#### Scenario: Menu hidden for non-worktree sessions
- **WHEN** `session.gitWorktree` is undefined
- **THEN** `<WorktreeActionsMenu>` SHALL NOT render

#### Scenario: Mobile renders single action sheet trigger
- **WHEN** `useMobile()` returns true
- **THEN** the menu SHALL collapse into a single `⋯` button opening an action sheet listing the same visible actions, including the PR status segment

## ADDED Requirements

### Requirement: Merge confirmation warns on unfinished PR checks
The merge confirmation dialog SHALL show a warning when the session's open PR has checks `failing` or `pending`, and a "PR status may be stale" warning when the PR status was last detected more than 15 minutes ago. It SHALL name the PR and state, e.g. "PR #742 checks are failing". The warning SHALL NOT block the merge, because the merge is local. When `gitPrChecks` is `passing`, `none` or absent, no warning SHALL render.

#### Scenario: Failing checks warn
- **WHEN** the user opens the merge confirmation for a session with `gitPrNumber = 742` and `gitPrChecks = "failing"`
- **THEN** the dialog SHALL show a warning that PR #742 checks are failing
- **AND** the confirm action SHALL remain enabled

#### Scenario: Pending checks warn
- **WHEN** `gitPrChecks = "pending"`
- **THEN** the dialog SHALL show a warning that the checks are still running

#### Scenario: Stale status warns
- **WHEN** the PR status was last detected 20 minutes ago
- **THEN** the dialog SHALL warn that the PR status may be stale

#### Scenario: Passing checks do not warn
- **WHEN** `gitPrChecks = "passing"`
- **THEN** the dialog SHALL NOT show a checks warning
