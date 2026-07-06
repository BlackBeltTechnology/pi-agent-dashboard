## ADDED Requirements

### Requirement: Instructions picker SHALL render candidates as a collapsible folder tree

On the Instructions page, the scoped `.md` candidate list SHALL be rendered as a
nested folder tree derived from each candidate's `relPath`, not as a flat list of
full paths. Path segments SHALL fold into directory rows; file rows SHALL display
only the file's basename. Directory rows SHALL be collapsible via a chevron
affordance and SHALL be indented by depth. The tree SHALL be a plain tree: a
directory containing a single child SHALL NOT be auto-collapsed into its child.

Selecting a file row SHALL preserve the existing URL-encoded selection behavior
(a `?file=<encoded relPath>` history push).

#### Scenario: Flat candidates fold into directories

- **GIVEN** the candidate set contains `.pi/agents/Explore.md` and `.pi/agents/react-expert.md`
- **WHEN** the Instructions picker renders
- **THEN** a `.pi` directory row SHALL contain an `agents` directory row
- **AND** the `agents` row SHALL contain file rows labeled `Explore.md` and `react-expert.md`
- **AND** each file row SHALL display only the basename, not the full `relPath`

#### Scenario: Single-child directory is not collapsed

- **GIVEN** the candidate set contains `.pi/skills/autofix/SKILL.md`
- **WHEN** the picker renders
- **THEN** a `skills` row SHALL contain an `autofix` row which SHALL contain a `SKILL.md` file row
- **AND** the `autofix` and `SKILL.md` rows SHALL NOT be merged into one row

#### Scenario: Selecting a tree file still pushes the file URL

- **WHEN** the user clicks the `AGENTS.md` file row in the tree
- **THEN** the URL SHALL push `?file=AGENTS.md` and the editor SHALL load `AGENTS.md`

### Requirement: Folder collapse state SHALL default to expanded and persist

Directory rows SHALL default to expanded on first load (no persisted state).
Collapsing or expanding a directory SHALL persist to `localStorage` under a
`dashboard:`-namespaced key (matching the repo's existing sidebar-state
convention) so the state survives a page reload. Only collapsed directory paths SHALL be stored, so a
directory newly appearing in the candidate set SHALL default to expanded without
migration. When the active substring filter is non-empty, directories with a
matching descendant SHALL be force-expanded regardless of persisted state.

#### Scenario: Folders start expanded

- **GIVEN** no persisted collapse state exists
- **WHEN** the Instructions picker first renders
- **THEN** every directory row SHALL be expanded

#### Scenario: Collapse state survives reload

- **GIVEN** the user collapses the `.pi` directory
- **WHEN** the page is reloaded
- **THEN** the `.pi` directory SHALL still be collapsed
- **AND** directories the user did not collapse SHALL remain expanded

#### Scenario: Filtering force-expands matching branches

- **GIVEN** the `.pi` directory is collapsed
- **WHEN** the user types a filter that matches `.pi/agents/Explore.md`
- **THEN** the `.pi` and `agents` directories SHALL be shown expanded so the match is visible

### Requirement: Instructions tree column SHALL be resizable and persisted

On viewports at or above the `md` breakpoint, a draggable gutter SHALL separate
the tree column from the editor pane. Dragging the gutter SHALL resize the tree
column, clamped to a minimum and maximum width. The chosen width SHALL persist to
`localStorage` under a `dashboard:`-namespaced key and SHALL be restored on the
next load. On mobile (below the `md` breakpoint) no resize gutter SHALL render.

#### Scenario: Dragging the gutter resizes the column

- **GIVEN** the Instructions page is open at desktop width
- **WHEN** the user drags the gutter between the tree and the editor to the right
- **THEN** the tree column SHALL widen and the editor pane SHALL narrow accordingly
- **AND** the width SHALL not exceed the maximum nor fall below the minimum bound

#### Scenario: Column width survives reload

- **GIVEN** the user resized the tree column to a non-default width
- **WHEN** the page is reloaded
- **THEN** the tree column SHALL render at the previously chosen width

### Requirement: Instructions page SHALL use a master/detail layout on mobile

On viewports below the `md` breakpoint, the Instructions page SHALL show either
the folder tree or the editor at full width, not a side-by-side split, and SHALL
NOT show a resize gutter. The active pane SHALL be derived from `?file=`: absent
→ tree fills the viewport; present → editor fills the viewport. Because the
default-selection behavior is viewport-gated (see the MODIFIED URL-encoded
requirement below), `?file=` absent is a reachable state on mobile and the tree
is shown. The mobile editor SHALL present its own back control that navigates to
the page route with `?file=` cleared, returning to the tree WITHOUT relying on
the global depth-aware back action. File and directory rows SHALL present touch
targets at least 44px tall.

#### Scenario: Tree fills the viewport when no file is selected

- **GIVEN** a mobile viewport with no `?file=` selection
- **WHEN** the Instructions page renders
- **THEN** the folder tree SHALL occupy the full width
- **AND** the editor SHALL NOT be shown and no resize gutter SHALL be present

#### Scenario: Selecting a file swaps to the editor

- **GIVEN** a mobile viewport showing the tree
- **WHEN** the user taps a file row
- **THEN** the editor SHALL replace the tree at full width

#### Scenario: Mobile editor back control returns to the tree

- **GIVEN** a mobile viewport showing the editor for `?file=AGENTS.md`
- **WHEN** the user activates the editor's back control
- **THEN** the URL SHALL navigate to the Instructions page route with `?file=` cleared
- **AND** the tree SHALL fill the viewport (no default file re-selected)

## MODIFIED Requirements

### Requirement: Instructions file selection SHALL be URL-encoded

On the Instructions page, selecting a file in the scoped file picker SHALL be a URL navigation, not React-only component state. Selecting a candidate SHALL push `/folder/:cwd/settings/instructions?file=<encoded relPath>` (global scope: `/settings/:page?...` equivalent) via history push. The active file SHALL be derived from the `?file=` query so the URL is the single source of truth for which file is shown.

Because each selection is a discrete history entry, the browser/OS back button and the shared depth-aware back action SHALL walk file→file→page→launcher rather than ejecting to the card list on the first back invocation. Selecting a file SHALL NOT change the settings route's depth (it remains depth 1).

Default selection SHALL be viewport-gated. At or above the `md` breakpoint, when `?file=` is absent the page SHALL apply its default selection (AGENTS.md, else the first candidate). Below the `md` breakpoint the page SHALL NOT auto-apply a default selection when `?file=` is absent — it SHALL leave the selection empty so the mobile master/detail layout can show the tree.

When `?file=` names a path not present in the current candidate set (e.g. deleted or out of scope after refresh), the page SHALL fall back to the default selection at ≥`md`, and to the empty (tree) state below `md`, without error.

#### Scenario: Selecting a file pushes a history entry
- **GIVEN** the Instructions page is open at `/folder/<encoded cwd>/settings/instructions`
- **WHEN** the user picks `AGENTS.md` from the scoped picker
- **THEN** the URL SHALL become `/folder/<encoded cwd>/settings/instructions?file=AGENTS.md`
- **AND** a new browser history entry SHALL be created (push, not replace)
- **AND** the editor SHALL load `AGENTS.md`

#### Scenario: Back walks between selected files
- **GIVEN** the user selected `AGENTS.md` then `.pi/notes.md` on the Instructions page
- **WHEN** the user invokes the back action once
- **THEN** the URL SHALL return to `?file=AGENTS.md` and that file SHALL be shown
- **AND** the app SHALL NOT navigate to `/`

#### Scenario: Refresh restores the selected file
- **WHEN** the user refreshes at `/folder/<encoded cwd>/settings/instructions?file=AGENTS.md`
- **THEN** once candidates load, `AGENTS.md` SHALL be the active selection

#### Scenario: Desktop applies a default when file is absent
- **GIVEN** a viewport at or above `md` with no `?file=` selection
- **WHEN** the Instructions page loads candidates
- **THEN** the page SHALL apply its default selection and show that file in the editor

#### Scenario: Mobile shows no default when file is absent
- **GIVEN** a viewport below `md` with no `?file=` selection
- **WHEN** the Instructions page loads candidates
- **THEN** the page SHALL NOT auto-select a file and the tree SHALL fill the viewport

#### Scenario: Unknown file falls back to default
- **WHEN** the page loads at `?file=does/not/exist.md` and no candidate matches
- **THEN** at ≥`md` the page SHALL apply its default selection with no error
- **AND** below `md` the page SHALL show the tree with no selection and no error
