## ADDED Requirements

### Requirement: Desktop session card header zone renders four rows in a fixed order
The desktop branch of `SessionCard.tsx` SHALL open its header zone with these four rows, top to bottom:

1. **Title row**: status chip, session name, missing-folder pill (when applicable), relative time, then the existing header controls.
2. **Status row**: the activity indicator, with the host-pressure indicator right-aligned.
3. **Git row**: worktree pill, branch, PR status, dirty / drift pill.
4. **Meta row**: model label, session chips (Moved / Origin device / Driver), context usage bar, cost.

A row whose every element renders nothing SHALL NOT render at all. No empty spacer row is allowed.

Rows 2–4 SHALL share one text column whose left edge aligns with the start of the session name, not with the status chip. The offset SHALL be one shared value defined next to the desktop status chip's size classes (chip width plus title-row gap). Call sites SHALL NOT repeat it as a literal.

The other existing header-zone elements keep their current relative order **after** the meta row: the OpenSpec activity badge line, the tag strip, and the pi-below-floor warning. Their content and visibility rules do not change. After them, the card body order is: OPENSPEC subcard, worktree card-slot wrapper, STATUS, PROCESS, FLOWS, MEMORY (see `session-card-subcards`).

The mobile session card's rendered output SHALL NOT change. Shared components it renders may receive their inputs differently.

#### Scenario: Rows render in order for a fully populated card
- **WHEN** a desktop card renders a streaming worktree session with `gitBranch`, `gitPrNumber`, `gitStatus.dirtyCount > 0`, `model`, and `cost > 0`
- **THEN** in document order the card SHALL contain the session name, then the activity indicator, then `[data-testid="worktree-pill"]`, then the branch text, then the model text, then the cost text
- **AND** all of them SHALL precede the first `SessionSubcard` element

#### Scenario: Rows 2–4 align with the session name
- **WHEN** a desktop card renders a session with every row populated, in the browser E2E harness at its default font and zoom
- **THEN** the computed left edge of the status row, the git row and the meta row SHALL each equal the left edge of the session-name element within 1 px

#### Scenario: Existing header extras follow the meta row
- **WHEN** a desktop card renders a session with an OpenSpec activity badge and user tags
- **THEN** the OpenSpec activity badge line and the tag strip SHALL render after the meta row and before the first `SessionSubcard`

#### Scenario: Empty git row is not rendered
- **WHEN** a desktop card renders a session with `gitBranch` absent
- **THEN** no git row element SHALL be rendered
- **AND** the meta row SHALL directly follow the status row

#### Scenario: Mobile card unchanged
- **WHEN** the session card renders in the mobile layout for a streaming session with a current tool and host pressure
- **THEN** no status row, git row or header missing-folder pill introduced by this requirement SHALL render
- **AND** the mobile line-2 activity text and host-pressure indicator SHALL render the same text as before this change

### Requirement: Status row carries the activity indicator and host pressure
The status row SHALL render the existing `ActivityIndicator` output (Resuming, ended reason, Needs you, Retry N, current tool, Thinking…, Idle) unchanged in content, plus `HostPressureIndicator` right-aligned. The activity container keeps its historic `data-testid="session-card-meta"`: it identifies the status row's activity container, not the meta row.

The activity container SHALL be the shrinking element (`min-w-0`, clipped). The status row SHALL NOT wrap or overflow the card. Variants whose text can be long (current tool, Needs you, Retry) truncate with an ellipsis. The host-pressure indicator SHALL NOT shrink.

When both `ActivityIndicator` and `HostPressureIndicator` render nothing, the status row SHALL NOT render. That includes an ended session whose ended-reason pill renders nothing (moved away, or no `closedReason`). The decision and both indicators SHALL be computed from the same inputs: one `hasWidgetBarPrompt` read and one card-level clock value. The clock ticks only while `session.hostPressure` is present, as today, so idle cards do not re-render on a timer. They SHALL share one implementation of the indicators' complete branch list, so the row never renders empty and never hides content. The host-pressure level SHALL still advance over time without any other re-render trigger.

#### Scenario: Running tool shows in the status row
- **WHEN** a desktop card renders a session with `currentTool: "bash"`
- **THEN** the status row SHALL contain the text `bash`
- **AND** the status row SHALL appear after the title row and before the git row

#### Scenario: Long tool text truncates
- **WHEN** the activity text is wider than the status row
- **THEN** the activity text SHALL be ellipsized on one line
- **AND** the host-pressure indicator, when present, SHALL remain fully visible

#### Scenario: Nothing to show hides the row
- **WHEN** a desktop card renders an ended session with no `closedReason`, not moved away, whose host-pressure derivation is healthy
- **THEN** no status row element SHALL be rendered

#### Scenario: Host pressure appears without another update
- **WHEN** a streaming session's last heartbeat ages past the host-pressure threshold and no session update arrives
- **THEN** the status row SHALL show the host-pressure indicator within one clock tick (≤ 5 s)

### Requirement: Git row orders worktree first and truncates only the branch
The git row SHALL render, in order: the `worktree` pill (when `session.gitWorktree` is set), the branch icon and branch text (link when `gitBranchUrl` is set), the PR status (when `gitPrNumber` is set), then the dirty / drift pill.

The git row SHALL render exactly when the `GitInfo` line rendered before this change: (`showGitInfo` is true OR `session.gitWorktree` is set) AND `session.gitBranch` is present AND the `git` card section is visible.

Only the branch text SHALL shrink (ellipsis, full name in `title`). The worktree pill, PR status and dirty / drift pill SHALL NOT shrink. The git row SHALL NOT overflow the card. The branch keeps at least 6 characters' width. When the pills plus that minimum do not fit on one line, the trailing pills wrap to a second git line instead of shrinking or overflowing.

The PR status SHALL reuse the PR-segment rendering previously shown in the worktree actions row: state glyph, `#N`, state word (`draft`, `open`, `merged` or `closed`) and, for an open non-draft PR, the checks summary. It links to `gitPrUrl` when known and keeps `data-testid="worktree-pr-segment"`. A legacy session carrying only `gitPrNumber` SHALL render `#N` alone. Its colours are unchanged from the worktree actions row.

The missing-folder pill SHALL NOT render in the git row.

#### Scenario: Worktree pill leads the git row
- **WHEN** a desktop card renders a worktree session with `gitBranch: "os/feat-x"` and `gitPrNumber: 812`
- **THEN** `[data-testid="worktree-pill"]` SHALL precede the branch text in document order
- **AND** the branch text SHALL precede `[data-testid="worktree-pr-segment"]`

#### Scenario: Narrow card keeps the pills visible
- **WHEN** a worktree session with a 60-character branch name, an open PR with passing checks, and `dirtyCount: 12`, `ahead: 4`, `behind: 1` renders in a 260 px wide card
- **THEN** the branch text SHALL be ellipsized and its element SHALL be at least 6 characters wide
- **AND** the worktree pill, the PR segment and `[data-testid="git-dirty-pill"]` SHALL each be fully inside the card's content box, wrapping to a second git line if needed

#### Scenario: Non-worktree member of a multi-session folder has no git row
- **WHEN** a desktop card renders a non-worktree session whose folder group has two or more sessions
- **THEN** no git row SHALL render on that card
- **AND** the folder header SHALL keep showing the branch

#### Scenario: Worktree session without a branch yet has no git row
- **WHEN** a desktop card renders a worktree session whose `gitBranch` has not arrived yet
- **THEN** no git row and no `[data-testid="worktree-pill"]` SHALL render (unchanged from before this change)

#### Scenario: Legacy PR number only
- **WHEN** a session has `gitPrNumber: 5` and no `gitPrState`
- **THEN** the git row SHALL show `#5` with no state word and no checks summary

### Requirement: Meta row shows the model id with context and cost
The meta row SHALL render the model label, then the existing `MovedBadge`, `OriginDeviceChip` and `DriverChip`. A flexible gap follows, then the context usage bar (when the `contextUsageBar` display preference is on) and the cost (when `cost > 0`).

The model label SHALL show the model id part of `session.model`: the text after the first `/`, per `parseModelId`. When that part is empty, the full value is shown. The thinking level, when present, is appended in parentheses as today. The element's `title` SHALL carry the full `session.model` value. A model value without `/` SHALL be shown unchanged.

The model label SHALL be the element that shrinks first (ellipsis, keeping at least 6 characters' width). The session chips, context bar and cost SHALL NOT shrink. The meta row SHALL NOT overflow the card. When the trailing items plus the model minimum do not fit, the trailing items wrap to a second meta line.

When `session.model` is absent, no model label SHALL render. Whether any session chip renders SHALL be decided by the chips' own predicates, shared with the row gate rather than re-implemented. The context bar counts as visible whenever the `contextUsageBar` preference is on, including when it shows "No context data". The meta row SHALL NOT render when it has no model label, no session chip, the context bar preference is off, and there is no cost.

#### Scenario: Provider prefix is hidden on the card
- **WHEN** a session has `model: "anthropic/claude-opus-4-1"` and `thinkingLevel: "high"`
- **THEN** the meta row SHALL show `claude-opus-4-1 (high)`
- **AND** the model element's `title` SHALL contain `anthropic/claude-opus-4-1`

#### Scenario: Bare model id unchanged
- **WHEN** a session has `model: "gpt-5"`
- **THEN** the meta row SHALL show `gpt-5`

#### Scenario: Narrow card with all session chips does not overflow
- **WHEN** a session with a long model id, a Moved badge, an origin-device chip, a driver chip, the context bar and `cost > 0` renders in a 260 px card
- **THEN** every meta-row element SHALL be fully inside the card's content box, the model label ellipsized or the trailing items wrapped

#### Scenario: Absent model omits the label
- **WHEN** a session has no `model` and `cost: 0.12`
- **THEN** the meta row SHALL render the cost and no model label

#### Scenario: Zero cost hides the cost
- **WHEN** a session has `cost: 0`
- **THEN** the meta row SHALL NOT render a cost element

### Requirement: Missing-folder pill sits in the title row and is independent of git
When `session.cwdMissing === true`, the title row SHALL render the missing-folder pill (`data-testid="cwd-gone-pill"`) after the session name and before the relative time, regardless of git state, worktree state or folder-group size. The session name SHALL shrink before the pill does.

The pill text SHALL be `folder missing` (i18n key `common.cwdGone`). Its `title` SHALL state that the session's folder no longer exists. Its styling SHALL be `inline-flex items-center px-1.5 py-0 rounded-full border text-[11px]`, normal case, with `--tint-red-border` / `--tint-red-fg` / `--tint-red-bg` and `flex-shrink-0`. These are the same tokens as the ended-reason and moved pills.

#### Scenario: Non-git session shows the pill
- **WHEN** a desktop card renders a session with `cwdMissing: true` and `gitBranch` absent
- **THEN** the title row SHALL contain `[data-testid="cwd-gone-pill"]` with text `folder missing`

#### Scenario: Multi-session member shows the pill
- **WHEN** a desktop card renders a non-worktree session with `cwdMissing: true` in a folder group of two or more sessions
- **THEN** the title row SHALL contain `[data-testid="cwd-gone-pill"]`

#### Scenario: Long name does not push the pill out
- **WHEN** a session with a 70-character name and `cwdMissing: true` renders in a 260 px card
- **THEN** the session name SHALL be ellipsized
- **AND** the pill SHALL be fully inside the card's content box
