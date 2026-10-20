## MODIFIED Requirements

### Requirement: Commit pins every selected folder

Committing the dialog SHALL pin every commit target — pinning is implicit and SHALL NOT be presented as a user
choice, because pin state is what makes a folder visible in the sidebar. The dialog SHALL therefore expose no
pin control. The commit targets SHALL be the selected rows when any are selected, and otherwise the directory
currently browsed. Each target SHALL be normalized before being sent. Targets that are already pinned SHALL be
skipped. A commit of N new targets SHALL apply to all N.

#### Scenario: Commit with nothing selected adds the browsed folder

- **GIVEN** the picker is browsing `/home/user/work` with no selection and `/home/user/work` is not pinned
- **WHEN** the user commits the dialog
- **THEN** `/home/user/work` SHALL be pinned
- **AND** the dialog SHALL close

#### Scenario: Commit pins all selected paths

- **GIVEN** `alpha` and `beta` are selected while browsing `/home/user/projects`
- **WHEN** the user commits the dialog
- **THEN** `/home/user/projects/alpha` and `/home/user/projects/beta` SHALL be pinned
- **AND** `/home/user/projects` itself SHALL NOT be pinned

#### Scenario: Windows paths commit in native form

- **GIVEN** the picker is browsing `C:\Users\me\` with no selection
- **WHEN** the user commits
- **THEN** the pinned path SHALL be `C:\Users\me` (normalized, native separators)

#### Scenario: Commit targets the folder just opened

- **GIVEN** the picker was browsing `/home/user` with no selection
- **WHEN** the user opens `work` and commits as soon as its listing renders
- **THEN** `/home/user/work` SHALL be pinned
- **AND** `/home/user` SHALL NOT be pinned

#### Scenario: Home directory is not an implicit target

- **GIVEN** the dialog has just opened with no initial path, so the first browse returned the user's home
  directory `/home/user`, and nothing is selected
- **THEN** the primary action SHALL be disabled with a hint to select or open a folder
- **AND** committing SHALL pin nothing, with or without the pi-trust option checked

#### Scenario: No pin control is offered

- **WHEN** the Add Folders dialog renders
- **THEN** it SHALL NOT render a "Pin to dashboard" checkbox, toggle, or destination option

## ADDED Requirements

### Requirement: File-manager selection and navigation gestures

On a fine pointer, a single primary click on a child directory row SHALL select that row only and SHALL NOT
navigate; a double-click SHALL navigate INTO it. Clicking with the add-to-selection modifier SHALL toggle the row
without affecting other selected rows; Shift-click SHALL select the contiguous range from the anchor row (a plain click when no anchor exists). A click
on empty list space SHALL clear the selection. A single click on the parent (`..`) row SHALL navigate up.

#### Scenario: Single click selects without navigating

- **GIVEN** the picker is browsing `/home/user` on a fine pointer
- **WHEN** the user single-clicks the `work` row
- **THEN** `work` SHALL be the only selected row
- **AND** the browsed directory SHALL remain `/home/user`

#### Scenario: Single click replaces an existing selection

- **GIVEN** `work` is selected in `/home/user`
- **WHEN** the user single-clicks the `notes` row without a modifier
- **THEN** `notes` SHALL be the only selected row

#### Scenario: Double click opens

- **WHEN** the user double-clicks the `work` row in `/home/user`
- **THEN** the picker SHALL browse `/home/user/work` and the dialog SHALL remain open

#### Scenario: Shift-click selects a range

- **GIVEN** rows `a`, `b`, `c`, `d` are listed and `a` was the last plain-clicked row
- **WHEN** the user Shift-clicks `c`
- **THEN** `a`, `b` and `c` SHALL be selected and `d` SHALL NOT

#### Scenario: Shift-click without an anchor selects one row

- **GIVEN** rows `a`, `b`, `c` are listed and no row has been clicked since the folder opened
- **WHEN** the user Shift-clicks `b`
- **THEN** only `b` SHALL be selected and `b` SHALL become the anchor

#### Scenario: Click on empty list space clears selection

- **GIVEN** `work` is selected
- **WHEN** the user clicks list space that is not a row
- **THEN** no row SHALL be selected

### Requirement: Add-to-selection modifier follows the browser OS

The add-to-selection modifier SHALL be the Command key when the browser runs on macOS or iPadOS and the Control
key on every other platform, determined from the browser's OS (not the dashboard host's). On macOS a Control-click
SHALL NOT toggle selection.

#### Scenario: Platform modifier toggles multi-selection

- **GIVEN** `work` is selected in `/home/user` on macOS
- **WHEN** the user Command-clicks `notes`
- **THEN** both `work` and `notes` SHALL be selected
- **AND** Command-clicking `work` again SHALL deselect only `work`

#### Scenario: Control is the modifier on Windows and Linux

- **GIVEN** `work` is selected in `/home/user` on Windows or Linux
- **WHEN** the user Control-clicks `notes`
- **THEN** both `work` and `notes` SHALL be selected

### Requirement: Touch gestures

For a touch pointer, a tap on a child directory row SHALL navigate INTO it. A long-press (held at least 400 ms
without significant movement) SHALL enter select mode with that row selected; in select mode a tap SHALL toggle
the tapped row, and deselecting the last row SHALL leave select mode. Rows SHALL be at least 44 CSS px tall on a
coarse pointer.

#### Scenario: Touch tap opens

- **GIVEN** a coarse pointer and the picker browsing `/home/user`
- **WHEN** the user taps the `work` row
- **THEN** the picker SHALL browse `/home/user/work`

#### Scenario: Touch long-press enters select mode

- **GIVEN** a coarse pointer and the picker browsing `/home/user`
- **WHEN** the user long-presses the `work` row
- **THEN** `work` SHALL be selected and the browsed directory SHALL remain `/home/user`
- **AND** a subsequent tap on `notes` SHALL add `notes` to the selection instead of opening it

### Requirement: Keyboard selection and navigation

Keyboard focus SHALL stay on the path input, which SHALL reference the anchor row via `aria-activedescendant`.
ArrowUp/ArrowDown SHALL move a single selection and Shift+Arrow SHALL extend it. Enter with exactly one selected
directory SHALL navigate into it; on macOS Command+ArrowDown SHALL do the same. The go-up shortcut SHALL be
Command+ArrowUp on macOS and Alt+ArrowUp elsewhere. Space SHALL NOT toggle selection; there is no highlight
distinct from the selection.

#### Scenario: Keyboard opens and goes up

- **GIVEN** `work` is the only selected row in `/home/user`
- **WHEN** the user presses Enter
- **THEN** the picker SHALL browse `/home/user/work`
- **AND** pressing the platform go-up shortcut SHALL return to `/home/user`

### Requirement: Keys shared with text editing and dialog chrome

Backspace SHALL navigate to the parent, and the add-to-selection modifier + A SHALL select every listed child row,
only while the path input's text equals the browsed directory path; otherwise both SHALL edit the text. Escape
SHALL clear a non-empty selection and keep the dialog open, and SHALL close the dialog only when nothing is
selected. Tab SHALL move focus to the next dialog control.

#### Scenario: Escape clears before it closes

- **GIVEN** `work` and `notes` are selected
- **WHEN** the user presses Escape
- **THEN** no row SHALL be selected and the dialog SHALL remain open
- **AND** a second Escape SHALL close the dialog

#### Scenario: Tab leaves the path input

- **GIVEN** focus is in the path input
- **WHEN** the user presses Tab
- **THEN** focus SHALL move to the next dialog control

#### Scenario: Backspace edits a typed path

- **GIVEN** the user has typed `/home/user/wo` while browsing `/home/user`
- **WHEN** the user presses Backspace
- **THEN** the input SHALL read `/home/user/w` and the browsed directory SHALL remain `/home/user`

### Requirement: Rows carry no checkbox or chevron

Child directory rows SHALL render no checkbox and no trailing descend chevron. Each row SHALL expose its selected
state via `aria-selected`, and the list SHALL declare `aria-multiselectable="true"`. A polite live region SHALL
announce the selected count whenever it changes.

#### Scenario: No checkbox or chevron renders

- **WHEN** the dialog renders child directory rows
- **THEN** no row SHALL contain a checkbox control or a trailing descend chevron

#### Scenario: Selection is announced

- **GIVEN** no row is selected
- **WHEN** the user Command/Control-clicks `work` and then `notes`
- **THEN** the live region SHALL announce a 1-item count and then a 2-item count
- **AND** the listbox SHALL carry `aria-multiselectable="true"`

### Requirement: Selection is scoped to the browsed folder

Navigating to any other directory SHALL clear the selection. No selection basket or removable pills SHALL render.
A status line SHALL name the commit target: the browsed directory's full path when nothing is selected, otherwise
the selected folders plus a clear-selection control. The primary action SHALL read `Add "<leaf>"` (straight quotes) for one new target
and `Add N folders` for N > 1 new targets.

#### Scenario: Selection clears on navigation

- **GIVEN** `work` and `notes` are selected in `/home/user`
- **WHEN** the user opens `projects`
- **THEN** no row SHALL be selected while browsing `/home/user/projects`

#### Scenario: Selection clears on typed navigation

- **GIVEN** `work` is selected in `/home/user`
- **WHEN** the user types `/tmp/` into the path input and the listing for `/tmp` renders
- **THEN** no row SHALL be selected
- **AND** committing SHALL NOT pin `/home/user/work`

#### Scenario: Status line names the browsed folder when nothing is selected

- **GIVEN** the picker is browsing `/home/user/projects` with no selection
- **THEN** the status line SHALL display `/home/user/projects` (home may be abbreviated as `~`)
- **AND** the primary action SHALL read `Add "projects"`

#### Scenario: Primary label reflects a multi-selection

- **GIVEN** `work` and `notes` are selected
- **THEN** the primary action SHALL read `Add 2 folders`
- **AND** the status line SHALL offer a clear-selection control

#### Scenario: No basket renders

- **WHEN** the dialog renders with any selection
- **THEN** no removable selection pills SHALL render

### Requirement: Already-added folders are marked and skipped

Rows whose path is already pinned SHALL render an `added` marker, compared by the same path-key normalization
used for session badges (trailing-separator and platform case drift collapse). Already-pinned targets SHALL be
excluded from the commit and from the primary action's count. When every commit target is already pinned, the
primary action SHALL be disabled and SHALL state that the folder is already added.

#### Scenario: Pinned child row is marked

- **GIVEN** `/home/user/work` is pinned
- **WHEN** `/home/user` is browsed
- **THEN** the `work` row SHALL display an `added` marker

#### Scenario: Browsed folder already added disables commit

- **GIVEN** `/home/user/work` is pinned and is browsed with no selection
- **THEN** the primary action SHALL be disabled and indicate the folder is already added

#### Scenario: Mixed selection skips the pinned folder

- **GIVEN** `work` (pinned) and `notes` (not pinned) are selected
- **WHEN** the user commits
- **THEN** only `/home/user/notes` SHALL be pinned
- **AND** the primary action SHALL have read `Add "notes"`

#### Scenario: Select-all includes added rows but counts only new ones

- **GIVEN** `/home/user` lists `work` (pinned), `notes` and `music`, and the path input text equals `/home/user/`
- **WHEN** the user presses the add-to-selection modifier + A
- **THEN** all three rows SHALL be selected
- **AND** the primary action SHALL read `Add 2 folders`, and committing SHALL pin only `notes` and `music`

## REMOVED Requirements

### Requirement: Navigation and selection are separate gestures

**Reason**: Replaced by "File-manager selection and navigation gestures" — click selects, double-click/tap opens, platform modifier multi-selects; no checkbox or chevron. The old keyboard contract (Space toggles the highlighted row, Enter descends the highlighted row, Tab acts on the highlight) is removed with it; "Keyboard selection and navigation" replaces it.
**Migration**: Single-click a row to select it; double-click (or tap on touch) to open. Keyboard users move the selection with arrows and press Enter to open.

### Requirement: Multi-path selection basket

**Reason**: Replaced by "Selection is scoped to the browsed folder" — no basket/pills; selection clears on navigation, a status line names the target.
**Migration**: Add folders from different parents in separate passes.

### Requirement: Current directory is selectable via a self-row

**Reason**: The commit targets the browsed directory whenever nothing is selected, so a dedicated self-row is redundant and was a main source of confusion.
**Migration**: Navigate into the folder and press the primary action with nothing selected.

### Requirement: Browsable entries are grouped under a CONTENTS label

**Reason**: The label existed only to separate the removed self-row from child rows.
**Migration**: None; the list shows `..` and child rows directly.
