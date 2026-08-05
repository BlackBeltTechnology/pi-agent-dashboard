## ADDED Requirements

### Requirement: Navigation and selection are separate gestures

The Add Folders dialog SHALL behave as a file explorer: activating a directory row (click, or Enter on the
highlighted row) SHALL navigate INTO that directory and SHALL NOT commit it as the answer. Selection SHALL be
performed only via the row's checkbox control. Each row SHALL additionally render a trailing chevron
(`mdiChevronRight`) as an explicit descend affordance. The checkbox SHALL stop event propagation so ticking it
never navigates.

#### Scenario: Row activation descends instead of answering

- **WHEN** the user clicks the `work` row body in `/home/user`
- **THEN** the picker SHALL browse `/home/user/work` and the dialog SHALL remain open
- **AND** `work` SHALL NOT be added to the selection

#### Scenario: Checkbox selects without navigating

- **WHEN** the user clicks the checkbox on the `work` row
- **THEN** `work` SHALL become selected
- **AND** the browsed directory SHALL remain `/home/user`

#### Scenario: Trailing chevron descends

- **WHEN** the user clicks the trailing chevron on the `work` row
- **THEN** the picker SHALL browse `/home/user/work`

### Requirement: Multi-path selection basket

The dialog SHALL accumulate every checked directory into a selection basket rendered as removable pills, and
SHALL display the running count on its primary action. Selections SHALL persist while the user navigates to
other directories. Unticking a row's checkbox or clicking a pill's remove control SHALL deselect that path.
When the basket is empty the primary action SHALL be disabled and an explicit empty hint SHALL render.

#### Scenario: Selections survive navigation

- **GIVEN** the user has checked `/home/user/work`
- **WHEN** the user navigates into `/home/user/projects` and checks `alpha`
- **THEN** the basket SHALL contain both `/home/user/work` and `/home/user/projects/alpha`
- **AND** the primary action SHALL read a 2-item label

#### Scenario: Pill removal deselects

- **WHEN** the user clicks the remove control on the `work` pill
- **THEN** `work` SHALL leave the basket
- **AND** the `work` row's checkbox SHALL render unchecked when that directory is visible

#### Scenario: Empty basket disables commit

- **WHEN** no directory is selected
- **THEN** the primary action SHALL be disabled
- **AND** an empty-selection hint SHALL render in the basket region

### Requirement: Commit pins every selected folder

Committing the dialog SHALL pin every selected path — pinning is implicit and SHALL NOT be presented as a
user choice, because pin state is what makes a folder visible in the sidebar. The dialog SHALL therefore expose
no pin control. Each selected path SHALL be normalized before being sent, and a commit of N paths SHALL apply
to all N paths.

#### Scenario: Commit pins all selected paths

- **GIVEN** the basket contains `/home/user/work` and `/home/user/projects/alpha`
- **WHEN** the user commits the dialog
- **THEN** both paths SHALL be pinned
- **AND** the dialog SHALL close

#### Scenario: No pin control is offered

- **WHEN** the Add Folders dialog renders
- **THEN** it SHALL NOT render a "Pin to dashboard" checkbox, toggle, or destination option

### Requirement: Optional single-select workspace destination

The dialog SHALL offer an optional workspace destination that is SINGLE-select (radio semantics), honouring the
existing single-membership invariant that a folder belongs to at most one workspace. The default selection
SHALL be `None`. When a workspace is selected, committing SHALL add every selected path to that workspace in
addition to pinning it. A `+ New workspace…` affordance SHALL be available and, on completion, SHALL become
the selected destination.

#### Scenario: Commit with a workspace destination

- **GIVEN** the basket contains `/home/user/work` and the destination is workspace `Frontend`
- **WHEN** the user commits
- **THEN** `/home/user/work` SHALL be pinned AND added to `Frontend`

#### Scenario: Commit with None destination

- **GIVEN** the basket contains `/home/user/work` and the destination is `None`
- **WHEN** the user commits
- **THEN** `/home/user/work` SHALL be pinned and SHALL NOT be added to any workspace

#### Scenario: Destination is single-select

- **GIVEN** the destination `Frontend` is selected
- **WHEN** the user selects `Backend`
- **THEN** `Backend` SHALL become the only selected destination

### Requirement: Empty workspace destination state

When zero workspaces exist, the destination control SHALL render an explicit "None — no workspaces yet"
statement plus the `+ New workspace…` affordance, and SHALL NOT render an empty radio group or a blank control.

#### Scenario: No workspaces exist

- **WHEN** the dialog renders and no workspaces exist
- **THEN** a "no workspaces yet" statement SHALL render
- **AND** a `+ New workspace…` affordance SHALL render
- **AND** no workspace radio options SHALL render

### Requirement: Directories with live sessions are badged

Rows whose path is the cwd of one or more sessions SHALL render a session-count badge, so folders the user
already works in are discoverable without typing a path.

#### Scenario: Loose cwd carries a session badge

- **GIVEN** two sessions have cwd `/home/user/work`
- **WHEN** `/home/user` is browsed and the `work` row renders
- **THEN** the row SHALL display a badge indicating 2 sessions

#### Scenario: Directory with no sessions has no badge

- **WHEN** a directory that is no session's cwd renders
- **THEN** no session-count badge SHALL render on that row

### Requirement: Iconography uses MDI paths only

Every glyph in the dialog SHALL be rendered from an `@mdi/js` path so it inherits `currentColor` and stays
stable across platform fonts. Emoji characters SHALL NOT be used for the parent row, directory rows, the create
affordance, or any control.

#### Scenario: No emoji glyphs render

- **WHEN** the dialog renders a parent row, directory rows, and the create-here row
- **THEN** none of them SHALL contain the characters `⬆`, `📁`, or `＋`
- **AND** each SHALL render an SVG path sourced from `@mdi/js`
