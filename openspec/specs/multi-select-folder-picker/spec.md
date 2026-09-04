# multi-select-folder-picker Specification

## Purpose
TBD - created by archiving change redesign-folder-workspace-add-flow. Update Purpose after archive.

## Requirements

### Requirement: Navigation and selection are separate gestures

The Add Folders dialog SHALL behave as a file explorer: activating a **child directory row** (click, or Enter on the
highlighted row) SHALL navigate INTO that directory and SHALL NOT commit it as the answer. Selection SHALL be
performed only via the row's checkbox control. Each **child directory row** SHALL additionally render a trailing chevron
(`mdiChevronRight`) as an explicit descend affordance. The checkbox SHALL stop event propagation so ticking it
never navigates.

The **current-directory self-row** (see "Current directory is selectable via a self-row") is exempt from the
navigate-on-activation and trailing-chevron rules: it represents the directory already being browsed, so it SHALL
NOT render a trailing chevron and activating it (click, or Enter on the highlighted self-row) SHALL toggle its
selection rather than navigate. Its checkbox SHALL behave identically to a child row's checkbox.

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

#### Scenario: Self-row activation toggles selection instead of navigating

- **GIVEN** the picker is browsing `/home/user`
- **WHEN** the user clicks the self-row body (or presses Enter while it is highlighted)
- **THEN** `/home/user` SHALL toggle its membership in the selection basket
- **AND** the browsed directory SHALL remain `/home/user`

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

### Requirement: Current directory is selectable via a self-row

The Add Folders dialog SHALL render a dedicated **self-row** representing the directory currently being browsed, so the user can add the folder they have navigated into without leaving it. The self-row SHALL use the same checkbox/selection grammar as child rows: ticking it SHALL add the current directory to the selection basket and unticking it (or removing its pill) SHALL deselect it, using the identical basket, commit, pin, and workspace-destination behavior defined for child selections. The self-row's checked state SHALL be determined by the SAME path comparison the basket already applies to child selections, so a directory selected via the self-row and the same directory selected via a child row resolve to a single basket entry and a single checked state, collapsing the trailing-separator drift that comparison already collapses. This change SHALL NOT alter the basket's existing case-sensitivity behavior for child paths (case-drift dedup is out of scope). The self-row SHALL be visually distinguished from child rows — it SHALL use the open-folder glyph (not the closed-folder glyph) and SHALL NOT render a trailing descend chevron. The self-row SHALL appear at the top of the list, above the browsable entries. When the current directory is the cwd of one or more sessions, the self-row SHALL render the same session-count badge that child rows render. The self-row SHALL render only when a current directory is resolved to a non-empty absolute path; while no such directory is resolved (for example during the initial default-directory load) no self-row SHALL render.

#### Scenario: Self-row adds the current directory to the basket

- **GIVEN** the picker is browsing `/home/user`
- **WHEN** the user ticks the self-row checkbox
- **THEN** `/home/user` SHALL be added to the selection basket
- **AND** the browsed directory SHALL remain `/home/user`
- **AND** the primary action SHALL read a 1-item label

#### Scenario: Self-row has no chevron and uses the open-folder glyph

- **WHEN** the dialog renders the self-row for the current directory
- **THEN** the self-row SHALL render the open-folder MDI glyph
- **AND** the self-row SHALL NOT render a trailing descend chevron

#### Scenario: Committing a self-row selection pins the current directory

- **GIVEN** the self-row for `/home/user` is ticked and it is the only selection
- **WHEN** the user commits the dialog
- **THEN** `/home/user` SHALL be pinned
- **AND** the dialog SHALL close

#### Scenario: Self-row selection coexists with child selections

- **GIVEN** the self-row for `/home/user` is ticked
- **WHEN** the user navigates into `/home/user/projects` and ticks the `alpha` child row
- **THEN** the basket SHALL contain both `/home/user` and `/home/user/projects/alpha`
- **AND** the primary action SHALL read a 2-item label

#### Scenario: Self-row and equivalent child row do not double-count

- **GIVEN** the user has ticked the self-row while browsing `/home/user/work/` (browsed path carries a trailing separator)
- **WHEN** the user navigates to `/home/user` and the `work` child row (path `/home/user/work`) renders
- **THEN** the `work` child row SHALL render as checked
- **AND** the basket SHALL contain the directory exactly once

#### Scenario: Current directory with live sessions is badged on the self-row

- **GIVEN** two sessions have cwd `/home/user`
- **WHEN** the picker is browsing `/home/user` and the self-row renders
- **THEN** the self-row SHALL display a badge indicating 2 sessions

#### Scenario: Filesystem-root self-row has a non-empty pill label

- **GIVEN** the picker is browsing a filesystem root (for example `/`)
- **WHEN** the user ticks the self-row and the basket pill renders
- **THEN** the pill SHALL display a non-empty label
- **AND** the pill's accessible remove control SHALL have a non-empty label

#### Scenario: Self-row is absent when no current directory is resolved

- **WHEN** the dialog is in its initial default-directory load with no resolved current directory
- **THEN** no self-row SHALL render

### Requirement: Browsable entries are grouped under a CONTENTS label

The Add Folders dialog SHALL separate the current-directory self-row from the browsable entries with a single small group label reading `CONTENTS`. The label SHALL be presented as a compact uppercase eyebrow (muted) and SHALL sit between the self-row and the parent (`..`) / child rows. The label SHALL be presentational only: it SHALL NOT be a selectable option, SHALL NOT receive keyboard focus, and SHALL NOT participate in the picker's up/down highlight traversal, so keyboard navigation over the selectable rows is unaffected. No additional label SHALL be required over the self-row — its tint and open-folder glyph SHALL identify it as the current directory.

#### Scenario: CONTENTS label separates the two groups

- **WHEN** the dialog renders with a resolved current directory
- **THEN** a `CONTENTS` group label SHALL render below the self-row and above the parent (`..`) and child rows

#### Scenario: CONTENTS label is skipped by keyboard traversal

- **GIVEN** the dialog has rendered a self-row, the `CONTENTS` label, and child rows
- **WHEN** the user moves the highlight down from the self-row
- **THEN** the highlight SHALL move to the next selectable row and SHALL NOT land on the `CONTENTS` label

#### Scenario: No label renders over the self-row

- **WHEN** the dialog renders the self-row
- **THEN** no separate group label SHALL render above the self-row
