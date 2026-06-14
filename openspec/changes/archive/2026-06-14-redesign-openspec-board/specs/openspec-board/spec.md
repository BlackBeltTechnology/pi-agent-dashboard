## ADDED Requirements

### Requirement: OpenSpec board route
The dashboard SHALL provide a full-page OpenSpec board at the overlay route `/folder/:encodedCwd/openspec`, reached from the folder-card OpenSpec button. The board SHALL show a top bar (Back, breadcrumb, Refresh, Specs, Archive, New proposal) and a column area.

#### Scenario: Navigate to board
- **WHEN** the user clicks the folder-card `OpenSpec (N) →` button
- **THEN** the app SHALL navigate to `/folder/<encodedCwd>/openspec` and render the board for that cwd

#### Scenario: Back returns to folder list
- **WHEN** the user clicks Back on the board
- **THEN** the app SHALL return to the previous folder/session view

### Requirement: Group columns
The board SHALL render one column per OpenSpec group plus an always-present `Ungrouped` column. Each column header SHALL show the group color dot, name, change count, a `＋` new-proposal control, a `⚙` manage control, and a drag grip.

#### Scenario: One column per group
- **WHEN** the cwd has groups `["In flight", "Backlog"]`
- **THEN** the board SHALL render columns `In flight`, `Backlog`, and `Ungrouped`

#### Scenario: Empty column
- **WHEN** a group has no changes
- **THEN** its column SHALL render the header and an empty-state body (no cards)

### Requirement: Group column reorder is persisted
The user SHALL be able to reorder columns by dragging a column header. The new order SHALL persist via the existing group `order` field.

#### Scenario: Drag column to new position
- **WHEN** the user drags the `Backlog` header before `In flight`
- **THEN** the columns SHALL reorder and the server SHALL persist each moved group's new `order`

### Requirement: Proposal cards
Each change SHALL render as a card showing its name, state pill, lifecycle stepper, task progress bar, session list, and card actions.

#### Scenario: Card content
- **WHEN** a change `add-auth` is `IMPLEMENTING` with `3/8` tasks
- **THEN** its card SHALL show the name, an `IMPLEMENTING` pill, the stepper, a `3/8 tasks` progress bar, its sessions, and `New session` / `New worktree` actions

### Requirement: Cards drag between and within columns
A proposal card SHALL be draggable to another column (reassigning its group) and to a new position within its column (reordering). Both SHALL persist.

#### Scenario: Drag card to another column
- **WHEN** the user drags `add-auth` from `Backlog` into `In flight`
- **THEN** the change's group assignment SHALL change to `In flight` and persist

#### Scenario: Reorder card within a column
- **WHEN** the user drags `add-auth` above `fix-bug` in the same column
- **THEN** `add-auth` SHALL render before `fix-bug` and the new intra-group order SHALL persist

### Requirement: Lifecycle stepper on cards
Each card SHALL render the OpenSpec lifecycle stepper (Explore→Proposal→Design→Specs→Tasks→Apply→Archive) with done/current/todo node states; the Tasks node SHALL show `completed/total`. The connecting line SHALL NOT bleed through node interiors.

#### Scenario: Stepper reflects state
- **WHEN** a change has proposal/design/specs done and is implementing with `6/14` tasks
- **THEN** Explore..Specs nodes SHALL render done (check), Tasks SHALL render current with `6/14`, Apply/Archive SHALL render todo

#### Scenario: Node opens artifact
- **WHEN** the user clicks the Proposal/Design/Specs node
- **THEN** the artifact reader SHALL open for that artifact

### Requirement: Card actions
Each card SHALL provide `New session` (spawn attached) and `New worktree` (spawn attached in a worktree) actions.

#### Scenario: Spawn attached session
- **WHEN** the user clicks `New session` on a card
- **THEN** a session SHALL be spawned attached to that change's cwd

### Requirement: Board filter bar
The board SHALL provide a filter bar with free-text search, proposal-state pills (All/planning/ready/implementing/complete), and session-status pills (Any/Live/Waiting/Ended). Filters SHALL combine.

#### Scenario: Text filter matches proposals and sessions
- **WHEN** the user types `auth`
- **THEN** only cards whose change name or any session name contains `auth` SHALL remain

#### Scenario: State filter
- **WHEN** the user selects the `implementing` state pill
- **THEN** only `IMPLEMENTING` cards SHALL remain

#### Scenario: Session-status filter
- **WHEN** the user selects the `Live` session pill
- **THEN** only cards with at least one live session SHALL remain, showing only their live session rows

### Requirement: New-proposal dialog
The board SHALL open a New-proposal dialog from the top-bar `New proposal` and from each column's `＋`. The dialog SHALL collect a name, a group (defaulting to the launching column's group), and a "create in a new worktree" option, then spawn a session running the new-change flow with the created change auto-assigned to the chosen group.

#### Scenario: Column ＋ pre-fills group
- **WHEN** the user clicks `＋` on the `Backlog` column
- **THEN** the dialog SHALL open with Group pre-selected to `Backlog`

#### Scenario: Create and spawn
- **WHEN** the user submits the dialog with name `add-auth` and group `Backlog`
- **THEN** a session SHALL be spawned running the new-change flow, and the created change SHALL be assigned to `Backlog`

#### Scenario: Worktree option
- **WHEN** the "create in a new worktree" option is checked on submit
- **THEN** the spawned session SHALL run in a new worktree `os/<name>`

### Requirement: Add group control
The board SHALL provide an `Add group` affordance at the end of the column area that creates a new group.

#### Scenario: Add a group
- **WHEN** the user activates `Add group` and names it
- **THEN** a new empty column SHALL appear and the group SHALL persist

### Requirement: Responsive column layout
The board SHALL adapt to viewport width: horizontal scrolling columns on desktop, columns wrapping to multiple rows on tablet widths, and full-width stacked columns on phone widths.

#### Scenario: Desktop kanban
- **WHEN** the viewport is wider than 900px
- **THEN** columns SHALL lay out horizontally with horizontal scroll

#### Scenario: Tablet wrap
- **WHEN** the viewport is 540–900px
- **THEN** columns SHALL wrap to multiple rows with no horizontal scroll

#### Scenario: Phone stack
- **WHEN** the viewport is 540px or narrower
- **THEN** columns SHALL stack full-width and the top bar SHALL wrap
