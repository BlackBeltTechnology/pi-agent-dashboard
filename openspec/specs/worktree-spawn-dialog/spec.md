# worktree-spawn-dialog Specification

## Purpose
TBD - created by archiving change auto-fill-branch-from-proposal-in-worktree-dialog. Update Purpose after archive.
## Requirements
### Requirement: `attachProposal` prop drives branch input reactively

The `WorktreeSpawnDialog` accepts an optional `attachProposal?: string` prop. The dialog SHALL react to changes of this prop at runtime (not only at mount) by updating the branch input, subject to a dirty-flag guard:

- The dialog SHALL track a `branchDirty` flag, initialized `false`. The flag SHALL flip to `true` on the first user `onChange` of the branch input. The mount-time value (from `initialBranch`) SHALL NOT flip the flag.
- When `attachProposal` changes to a non-empty string AND `branchDirty` is `false`, the dialog SHALL set the branch input to `"os/" + attachProposal`.
- When `attachProposal` changes to `undefined`/empty AND `branchDirty` is `false`, the dialog SHALL revert the branch input to `initialBranch ?? ""`.
- When `branchDirty` is `true`, the dialog SHALL NOT modify the branch input in response to `attachProposal` changes.

The path preview (`derivedPath`) SHALL update automatically through the existing `slug → derivedPath` `useMemo` chain — no separate effect required.

#### Scenario: Mount with attachProposal preloads branch
- **WHEN** the dialog mounts with `attachProposal="add-foo"` and no `initialBranch`
- **THEN** the branch input SHALL render `os/add-foo` on first paint
- **THEN** the path preview SHALL render `<repo>/.worktrees/add-foo`

#### Scenario: attachProposal arrives after mount and branch is pristine
- **WHEN** the dialog is mounted with no `attachProposal` AND the user has not typed in the branch input AND the parent re-renders with `attachProposal="add-foo"`
- **THEN** the branch input SHALL update to `os/add-foo`

#### Scenario: User-typed branch wins over later attachProposal change
- **WHEN** the dialog is mounted with no `attachProposal` AND the user types `feature/x` into the branch input AND the parent re-renders with `attachProposal="add-foo"`
- **THEN** the branch input SHALL remain `feature/x`

#### Scenario: attachProposal cleared while branch pristine reverts
- **WHEN** the dialog was rendered with `attachProposal="add-foo"` AND the user did NOT type in the branch input AND the parent re-renders with `attachProposal=undefined`
- **THEN** the branch input SHALL revert to `initialBranch ?? ""` (empty when no `initialBranch`)

#### Scenario: attachProposal swap while branch dirty is ignored
- **WHEN** the dialog was rendered with `attachProposal="add-foo"` AND the user typed `os/other` into the branch input AND the parent re-renders with `attachProposal="add-bar"`
- **THEN** the branch input SHALL remain `os/other`

#### Scenario: Backward-compat — initialBranch alone unchanged
- **WHEN** the dialog mounts with `initialBranch="os/preset"` and no `attachProposal`
- **THEN** the branch input SHALL render `os/preset` on first paint (preserving the existing per-change `⑂+` flow)

### Requirement: Base-branch field is a filterable typeahead combobox

The "Base branch" field in `WorktreeSpawnDialog` SHALL be rendered as a typeahead combobox (not a native HTML `<select>`). The combobox SHALL be collapsed by default, expand to a popover on user interaction, and allow the user to filter the available branches by typing.

The set of selectable branches SHALL be the union of local and remote branches returned by `GET /api/git/branches?cwd=…` for the dialog's `cwd`. The user SHALL NOT be able to commit a free-text value that does not match an existing branch: the base branch must already exist in the repository.

The component SHALL implement the WAI-ARIA combobox pattern: the trigger SHALL carry `role="combobox"`, `aria-expanded`, `aria-controls`, and `aria-haspopup="listbox"`; the popover listbox SHALL carry `role="listbox"` and each option `role="option"` with `aria-selected` reflecting the committed selection (the row whose branch name equals the chosen `base`), per the WAI-ARIA single-select listbox contract. The keyboard highlight is a visual-only cursor and SHALL NOT drive `aria-selected`.

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

### Requirement: From-a-pull-request creation mode

The "Create a new worktree" section of `WorktreeSpawnDialog` SHALL offer a source toggle with two modes: **From a branch** (the existing base-branch + new-branch-name + path fields) and **From a pull request**. The dialog SHALL default to **From a branch**, preserving existing behaviour.

In **From a pull request** mode, the dialog SHALL render a `PrCombobox` typeahead listing the repository's open pull requests (via `GET /api/git/pull-requests`). Selecting a PR SHALL derive a worktree path (default `<repo>/.worktrees/pr-<number>`, editable via the existing Path input) and, on submit, SHALL call `POST /api/git/worktree/from-pr` with `{ cwd, prNumber, path }`.

The **From a pull request** toggle SHALL degrade gracefully when `gh` is unavailable: the dialog SHALL NOT eagerly probe `gh` at mount; on first activation of the PR mode the `PrCombobox` SHALL fetch the PR list, and if the server returns `gh_not_found` or `gh_not_authed`, the toggle SHALL be disabled with an inline hint rather than presented as a working but dead control.

The PR list fetch SHALL surface loading, error, empty, and gh-unavailable states (PR data is a network round-trip, unlike the local branch list).

#### Scenario: Default mode is From a branch

- **WHEN** the dialog opens
- **THEN** the source toggle SHALL be set to "From a branch"
- **AND** the existing base-branch, new-branch-name, and path fields SHALL render
- **AND** no PR list fetch SHALL be issued

#### Scenario: Switching to PR mode loads PRs

- **WHEN** the user activates "From a pull request" for the first time
- **THEN** the `PrCombobox` SHALL fetch `GET /api/git/pull-requests?cwd=…`
- **AND** SHALL show a loading state until the response resolves
- **AND** on success SHALL list open PRs with number, title, author, and a CI/draft badge

#### Scenario: Selecting a PR derives the path

- **WHEN** the user selects PR #142 in PR mode
- **THEN** the path field SHALL derive to `<repo>/.worktrees/pr-142`
- **AND** the path SHALL remain editable

#### Scenario: PR-mode submit posts from-pr

- **WHEN** the user has selected a PR and submits in PR mode
- **THEN** the dialog SHALL call `POST /api/git/worktree/from-pr` with `{ cwd, prNumber, path }`
- **AND** SHALL NOT call the branch-based `POST /api/git/worktree`

#### Scenario: gh unavailable disables the PR toggle

- **WHEN** activating PR mode and the PR fetch returns `gh_not_found` or `gh_not_authed`
- **THEN** the "From a pull request" toggle SHALL become disabled
- **AND** an inline hint SHALL explain that `gh` must be installed/authenticated to checkout PRs
- **AND** the dialog SHALL remain usable in "From a branch" mode

#### Scenario: Typeahead filtering of PRs

- **WHEN** the `PrCombobox` is open and the user types
- **THEN** the list SHALL filter to PRs whose number, title, or head branch contains the typed text (case-insensitive)

#### Scenario: Keyboard selection in PR mode

- **WHEN** the `PrCombobox` popover is open
- **THEN** ArrowUp/ArrowDown SHALL move the highlight, Enter SHALL select the highlighted PR, and Escape SHALL close the popover without closing the dialog

#### Scenario: Branch mode unchanged

- **WHEN** the dialog is in "From a branch" mode
- **THEN** the base-branch + new-branch-name + path fields and the `POST /api/git/worktree` submit path SHALL behave exactly as before this change

