# worktree-spawn-dialog — delta

## ADDED Requirements

### Requirement: Base-branch field is a filterable typeahead combobox

The "Base branch" field in `WorktreeSpawnDialog` SHALL be rendered as a typeahead combobox (not a native HTML `<select>`). The combobox SHALL be collapsed by default, expand to a popover on user interaction, and allow the user to filter the available branches by typing.

The set of selectable branches SHALL be the union of local and remote branches returned by `GET /api/git/branches?cwd=…` for the dialog's `cwd`. The user SHALL NOT be able to commit a free-text value that does not match an existing branch: the base branch must already exist in the repository.

The component SHALL implement the WAI-ARIA combobox pattern: the trigger SHALL carry `role="combobox"`, `aria-expanded`, `aria-controls`, and `aria-haspopup="listbox"`; the popover listbox SHALL carry `role="listbox"` and each option `role="option"` with `aria-selected` reflecting the committed selection (row matching chosen `base`), per the WAI-ARIA single-select listbox contract. Keyboard highlight is a visual-only cursor.

#### Scenario: Collapsed by default

- **WHEN** the dialog mounts and finishes loading branches
- **THEN** the base-branch field SHALL render a single collapsed trigger button showing the currently selected base
- **AND** no listbox or filter input SHALL be present in the DOM

#### Scenario: Opening the combobox

- **WHEN** the user clicks the base-branch trigger
- **THEN** a popover SHALL open below the trigger containing a filter input and a listbox of branches
- **AND** the filter input SHALL receive focus
- **AND** `aria-expanded` on the trigger SHALL be `true`

#### Scenario: Typeahead filtering

- **WHEN** the popover is open AND the user types text into the filter input
- **THEN** the listbox SHALL display only branches whose name contains the typed text (case-insensitive substring match)
- **AND** branches not matching SHALL be removed from the rendered listbox

#### Scenario: Keyboard selection

- **WHEN** the popover is open
- **THEN** ArrowDown / ArrowUp SHALL move the highlight through the filtered branches (with wraparound)
- **AND** Enter on a highlighted branch SHALL set `base` to that branch's name AND close the popover
- **AND** Escape SHALL close the popover without changing `base` AND SHALL NOT propagate to the parent dialog (the dialog SHALL remain open)

#### Scenario: Mouse selection

- **WHEN** the popover is open AND the user clicks a branch row
- **THEN** `base` SHALL be set to that branch's name AND the popover SHALL close

#### Scenario: Outside-click closes popover

- **WHEN** the popover is open AND the user clicks outside the combobox (but still inside the dialog)
- **THEN** the popover SHALL close without changing `base`
- **AND** the dialog SHALL remain open

#### Scenario: No-match Enter is a no-op

- **WHEN** the popover is open AND the filter text matches zero branches AND the user presses Enter
- **THEN** `base` SHALL NOT change
- **AND** the popover SHALL remain open
- **AND** no synthetic branch SHALL be created from the filter text

#### Scenario: Local and remote sections

- **WHEN** the listbox is displayed and both local and remote branches are present
- **THEN** local branches SHALL appear first followed by a visual separator labelled "Remote" and then remote branches
- **AND** when only one of local or remote is present, no separator SHALL render

#### Scenario: Current-branch marker

- **WHEN** the listbox displays branches AND one of them is the repository's current branch
- **THEN** that branch SHALL be marked with a `●` indicator
- **AND** the current branch SHALL remain selectable as a base (in contrast to `BranchPicker`'s checkout flow, where current is non-selectable)

#### Scenario: No usable default base

- **WHEN** the dialog computes `hasUsableBase === false` (no current branch and no fallback)
- **THEN** the trigger SHALL render the placeholder text `"no usable default base — pick one"`
- **AND** the submit button SHALL remain disabled until the user selects a base

#### Scenario: Public dialog contract unchanged

- **WHEN** the user selects a base via the combobox and submits
- **THEN** the resulting `onSpawn` payload SHALL carry the same `base` field shape as before this change
- **AND** the dialog's other props (`cwd`, `onCancel`, `initialBranch`, `attachProposal`) SHALL behave identically to before
