# session-card-redesign Specification

## Purpose
TBD - created by archiving change redesign-session-card. Update Purpose after archive.
## Requirements
### Requirement: Session card renders from a single JSX path
The SessionCard component SHALL use a single JSX render path that adapts to viewport width via Tailwind responsive classes (`hidden`, `md:inline`, `md:flex`, etc.). There SHALL NOT be separate desktop and mobile render branches (`if (isMobile)` with duplicated JSX).

#### Scenario: Single render on desktop
- **WHEN** viewport width is >= 768px
- **THEN** the card SHALL render all elements marked with `md:*` responsive classes
- **AND** SHALL NOT render elements marked with `md:hidden`

#### Scenario: Single render on mobile
- **WHEN** viewport width is < 768px
- **THEN** the card SHALL render mobile-only elements
- **AND** SHALL hide desktop-only elements via `hidden md:inline`, `md:hidden` etc.

### Requirement: Card layout — mobile
On mobile viewports (< 768px), the session card SHALL display the following elements in vertical rows:

Row 1: Status dot + session name (left) + cost (right, only when > 0)
Row 2: Model name + thinking level
Row 3: Meta chips (git branch, worktree indicator) — only when data present
Row 4: Attached proposal chip — only when attachedProposal is set

#### Scenario: Mobile card with all data
- **WHEN** a session has gitBranch, worktree, attachedProposal, model, and cost > 0
- **THEN** all four rows SHALL render in order
- **AND** cost SHALL be right-aligned in row 1

#### Scenario: Mobile card with cost = 0
- **WHEN** session cost is 0 or null
- **THEN** cost SHALL NOT appear in row 1

#### Scenario: Mobile card without meta
- **WHEN** session has no gitBranch and no worktree
- **THEN** row 3 SHALL NOT render

#### Scenario: Mobile card without attached proposal
- **WHEN** session has no attachedProposal
- **THEN** row 4 SHALL NOT render

### Requirement: Card layout — desktop
On desktop viewports (>= 768px), the session card SHALL display:

Row 1: Status dot + source icon + session name (left) + rename/hide/shutdown buttons + relative time (right)
Row 2: Model name + thinking level (left) + resume/fork buttons (right)
Row 3: Activity indicator (left) + context usage bar + cost (right)
Row 4: OpenSpec badge — only when openspecPhase or openspecChange is set
Row 5: Meta chips (git branch, worktree, attached proposal) — when data present

#### Scenario: Desktop card with all data
- **WHEN** viewport >= 768px and session has all optional fields populated
- **THEN** all five rows SHALL render in order

#### Scenario: Desktop card without OpenSpec activity
- **WHEN** session has no openspecPhase and no openspecChange
- **THEN** row 4 SHALL NOT render

#### Scenario: Desktop card without meta chips
- **WHEN** session has no gitBranch, no worktree, and no attachedProposal
- **THEN** row 5 SHALL NOT render

### Requirement: Meta information rendered as compact chips
Git branch, worktree indicator, and attached proposal SHALL be rendered as inline chips (`px-1.5 py-0.5 rounded-full text-[10px] border border-[var(--border-subtle)]`) in a single row. Each chip SHALL truncate with ellipsis when its text overflows, with a max-width appropriate to the viewport.

#### Scenario: Git branch chip renders
- **WHEN** session.gitBranch is set
- **THEN** a chip with branch icon and branch name SHALL render

#### Scenario: Git branch chip with PR number
- **WHEN** session.gitBranch and session.gitPrNumber are both set
- **THEN** the chip SHALL include the PR number (e.g., `feature/x · #42`)

#### Scenario: Worktree chip renders
- **WHEN** session.worktree is set
- **THEN** a chip with worktree icon and branch name SHALL render

#### Scenario: Attached proposal chip renders
- **WHEN** session.attachedProposal is set
- **THEN** a chip with paperclip icon and change name SHALL render

#### Scenario: Multiple chips in one row
- **WHEN** gitBranch, worktree, and attachedProposal are all set
- **THEN** all three chips SHALL render in a single horizontal row with small gaps

### Requirement: Cost hidden when zero
The cost display ($X.XX) SHALL NOT render when `session.cost` is 0, null, or undefined.

#### Scenario: Cost is 0
- **WHEN** session.cost is 0
- **THEN** no cost element SHALL appear in the card

#### Scenario: Cost is positive
- **WHEN** session.cost is 0.42
- **THEN** "$0.42" SHALL render in the card

### Requirement: Minimalist visual style
The session card SHALL use Apple-style minimalist visual language: soft shadows (`shadow-md shadow-[var(--shadow-card)]`), subtle borders, backdrop-blur on selected state, and generous padding. On hover (desktop only), the card SHALL lift slightly (`hover:-translate-y-0.5`).

#### Scenario: Default card appearance
- **WHEN** a card is not selected
- **THEN** it SHALL render with `bg-[var(--bg-tertiary)]`, `border-[var(--border-subtle)]`, and `rounded-xl`

#### Scenario: Selected card appearance
- **WHEN** a card is selected
- **THEN** it SHALL render with `bg-blue-500/5 backdrop-blur-sm border-blue-500/60`

#### Scenario: Card hover on desktop
- **WHEN** user hovers over a card on desktop
- **THEN** the card SHALL lift slightly via `hover:-translate-y-0.5` transition

### Requirement: Removed elements not rendered
The SessionCard SHALL NOT render any of the following elements that were previously present:
- Token stats (in/out/cache)
- Flow badge (FlowActivityBadge)
- Flow launcher (SessionFlowActions)
- OpenSpec actions (SessionOpenSpecActions)
- Plugin slots (SessionCardBadgeSlot, SessionCardActionBarSlot)
- Process list (ProcessList)
- Drag handle (SortableSessionCard wrapper)
- Inline rename input (InlineRenameInput)

#### Scenario: Card does not render token stats
- **WHEN** a session has token data (tokensIn, tokensOut)
- **THEN** token stats SHALL NOT appear in the card

#### Scenario: Card does not render flow badge
- **WHEN** session has activeFlowName set
- **THEN** FlowActivityBadge SHALL NOT render

#### Scenario: Card does not render OpenSpec actions
- **WHEN** openspecChanges prop is provided
- **THEN** SessionOpenSpecActions SHALL NOT render

#### Scenario: Card does not render drag handle
- **WHEN** card renders
- **THEN** no SortableSessionCard wrapper SHALL be present
- **AND** no drag handle element SHALL render

### Requirement: Activity indicator — desktop only
The ActivityIndicator (current tool, "Waiting for input", "Thinking…") SHALL render only on desktop viewports (>= 768px). On mobile, it SHALL be hidden.

#### Scenario: Activity indicator hidden on mobile
- **WHEN** viewport < 768px and session has currentTool set
- **THEN** ActivityIndicator SHALL NOT render

#### Scenario: Activity indicator shown on desktop
- **WHEN** viewport >= 768px and session has currentTool set
- **THEN** ActivityIndicator SHALL render

### Requirement: Context usage bar — desktop only
The ContextUsageBar SHALL render only on desktop viewports. On mobile, it SHALL be hidden.

#### Scenario: Context bar hidden on mobile
- **WHEN** viewport < 768px and contextUsage data is available
- **THEN** ContextUsageBar SHALL NOT render

#### Scenario: Context bar shown on desktop
- **WHEN** viewport >= 768px and contextUsage data is available
- **THEN** ContextUsageBar SHALL render

### Requirement: OpenSpec badge — desktop only
The OpenSpecActivityBadge SHALL render only on desktop viewports. On mobile, it SHALL be hidden.

#### Scenario: OpenSpec badge hidden on mobile
- **WHEN** viewport < 768px and session.openspecPhase is set
- **THEN** OpenSpecActivityBadge SHALL NOT render

### Requirement: Resume/fork buttons — desktop only
The Resume and Fork buttons SHALL render only on desktop viewports. On mobile, they SHALL be hidden.

#### Scenario: Resume/Fork hidden on mobile
- **WHEN** viewport < 768px and session is ended
- **THEN** Resume and Fork buttons SHALL NOT render

### Requirement: Rename/hide/shutdown buttons — desktop only
The rename pencil, hide/eye, and shutdown close buttons SHALL render only on desktop viewports. On mobile, they SHALL be hidden.

#### Scenario: Action buttons hidden on mobile
- **WHEN** viewport < 768px
- **THEN** rename, hide, and shutdown buttons SHALL NOT render

### Requirement: Source icon — desktop only
The source indicator icon (TUI, Headless, tmux, Zed, Terminal) SHALL render only on desktop viewports. On mobile, it SHALL be hidden.

#### Scenario: Source icon hidden on mobile
- **WHEN** viewport < 768px
- **THEN** source icon SHALL NOT render

### Requirement: Relative time — desktop only
The relative time display (e.g., "2m", "1h") SHALL render only on desktop viewports. On mobile, it SHALL be hidden.

#### Scenario: Time hidden on mobile
- **WHEN** viewport < 768px
- **THEN** relative time SHALL NOT render

### Requirement: Status dot always visible
The colored status dot (green/yellow/red) SHALL render on both desktop and mobile viewports.

#### Scenario: Status dot on mobile
- **WHEN** viewport < 768px
- **THEN** status dot SHALL render

#### Scenario: Status dot on desktop
- **WHEN** viewport >= 768px
- **THEN** status dot SHALL render

