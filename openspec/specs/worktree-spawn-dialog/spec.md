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

The "Create a new worktree" section of `WorktreeSpawnDialog` SHALL offer a **ternary** source toggle with three modes: **Fork to new branch**, **Check out existing branch**, and **From a pull request**. Each mode reveals its own field set; switching modes preserves picker selections where the underlying ref shape is compatible.

The three modes SHALL behave as follows:

1. **Fork to new branch** (`mode === "fork"`) — the existing fork form. Picker selects a base ref; the user types a new branch name; submit calls `createWorktree({cwd, base, newBranch, path?})`. Path is derived from `slugifyBranch(newBranch)`.

2. **Check out existing branch** (`mode === "checkout"`) — picker selects a branch ref directly; no new-branch input is rendered; submit calls `createWorktree({cwd, base, path?})` with `newBranch` omitted (the server runs `git worktree add <path> <base>` without `-b`). Path is derived from `slugifyBranch(localNameOf(base))` where `localNameOf("origin/foo") === "foo"`. The picker label SHALL read **Branch** (not **Base branch**) in this mode. `canSubmit` SHALL require only `base.trim().length > 0`.

3. **From a pull request** (`mode === "from-pr"`) — the PR-change form. `PrCombobox` selects an open PR; submit calls `POST /api/git/worktree/from-pr` with `{cwd, prNumber, path}`. Lazy-load and gh-unavailable behaviour is unchanged from the original PR-change requirement.

The new-branch input (`data-testid="worktree-new-branch-input"`) SHALL be present in the DOM only when `mode === "fork"`. The `PrCombobox` SHALL be present only when `mode === "from-pr"`.

When the server returns `branch_in_use` for a `"checkout"`-mode submit, the dialog SHALL render the full server `message` (which includes the path of the worktree currently holding the branch) inline below the picker.

#### Scenario: Three-way toggle renders in create section

- **WHEN** the dialog opens and finishes loading branches
- **THEN** a radio group with three options "Fork to new branch", "Check out existing branch", and "From a pull request" SHALL be visible inside the "Create a new worktree" section

#### Scenario: Fork mode field set

- **WHEN** `mode === "fork"`
- **THEN** the base-branch combobox, the new-branch input, and the derived-path preview SHALL render
- **AND** the new-branch input (`data-testid="worktree-new-branch-input"`) SHALL be present in the DOM
- **AND** submit SHALL call `POST /api/git/worktree` with `{cwd, base, newBranch, path?}`

#### Scenario: Checkout mode field set

- **WHEN** `mode === "checkout"`
- **THEN** the picker SHALL render with the label "Branch"
- **AND** the new-branch input SHALL NOT be present in the DOM
- **AND** the path preview SHALL render `<repo>/.worktrees/<slug(localNameOf(base))>`
- **AND** submit SHALL call `POST /api/git/worktree` with `{cwd, base, path?}` and no `newBranch` field

#### Scenario: Checkout mode renders branch_in_use with holding-worktree path

- **WHEN** `mode === "checkout"` AND the server returns `{success: false, error: "branch_in_use", message: "...at '/repo/.worktrees/bar'..."}`
- **THEN** the dialog SHALL render the full server `message` (including the path `/repo/.worktrees/bar`) inline below the picker

#### Scenario: PR mode unchanged

- **WHEN** `mode === "from-pr"`
- **THEN** the `PrCombobox`, gh-unavailable degradation, lazy-load on first activation, and `POST /api/git/worktree/from-pr` submit path SHALL behave exactly as specified by the `add-worktree-from-pull-request` change before this widening
- **AND** the binary-toggle scenarios from that change SHALL continue to hold with the option key renamed (`"from-branch"` → `"fork"`)

#### Scenario: Mode flip preserves compatible selections

- **WHEN** the user picks `base = "main"` in `"checkout"` mode AND flips to `"fork"` mode
- **THEN** the base-branch combobox SHALL retain `"main"` as the selected base
- **AND** the new-branch input SHALL render empty (or with the `attachProposal`-derived value if applicable)

### Requirement: Default mode derived from attachProposal

When `WorktreeSpawnDialog` mounts, it SHALL pick the initial `mode` based on the `attachProposal` prop, refining the original default introduced by `add-worktree-from-pull-request`:

- `attachProposal` is a non-empty string → initial `mode === "fork"`.
- `attachProposal` is `undefined` or empty → initial `mode === "checkout"`.
- `mode === "from-pr"` SHALL never be the auto-picked default (preserving the lazy-load contract from `add-worktree-from-pull-request`).

Subsequent runtime changes to `attachProposal` SHALL NOT flip the mode automatically; the user remains in control after first paint via the radio toggle.

#### Scenario: Plain +Worktree defaults to checkout

- **WHEN** the dialog mounts with `attachProposal` undefined
- **THEN** the mode selector SHALL show "Check out existing branch" as selected on first paint
- **AND** the new-branch input SHALL NOT be present in the DOM
- **AND** no PR list fetch SHALL be issued

#### Scenario: Proposal-driven +Worktree defaults to fork

- **WHEN** the dialog mounts with `attachProposal = "add-foo"`
- **THEN** the mode selector SHALL show "Fork to new branch" as selected on first paint
- **AND** the new-branch input SHALL be present with value `os/add-foo` (existing `attachProposal` behaviour from `auto-fill-branch-from-proposal-in-worktree-dialog`)

#### Scenario: User can flip mode after auto-pick

- **WHEN** the dialog mounted in `"checkout"` mode AND the user clicks the "Fork to new branch" radio
- **THEN** `mode` SHALL become `"fork"` AND the new-branch input SHALL appear
- **AND** the `base` selection SHALL be preserved across the flip

#### Scenario: attachProposal change after mount does not flip mode

- **WHEN** the dialog mounted with `attachProposal = undefined` (mode = `"checkout"`) AND the parent re-renders with `attachProposal = "add-foo"`
- **THEN** `mode` SHALL remain `"checkout"` (user-controlled after first paint)
- **AND** the existing `attachProposal`-reactivity on the branch input SHALL still apply if the user later flips to `"fork"` mode

### Requirement: Dialog signals spawn lifecycle for placeholder feedback
`WorktreeSpawnDialog` SHALL accept optional callbacks `onSpawnStart?(parentCwd: string)` and `onSpawnAbort?(parentCwd: string)` so the host can render a placeholder card from the moment of submit and remove it on early failure. `parentCwd` SHALL be the dialog's `cwd` prop (the parent repo group cwd), so the placeholder renders in the group that will host the new worktree session.

The dialog SHALL invoke `onSpawnStart(cwd)` at the START of every submit path — both the existing-worktree one-click `Spawn →` row and the create-new submit — BEFORE issuing any `createWorktree` or spawn call. The dialog SHALL invoke `onSpawnAbort(cwd)` when `createWorktree` rejects or returns a non-ok result, and SHALL keep the dialog open displaying the error. On success the dialog SHALL proceed to its existing `onSpawn(path, opts)` call; the host clears the placeholder later via the normal `session_added` / `spawn_result` flow keyed on `placeholderCwd`.

Both callbacks SHALL be optional; when absent the dialog SHALL behave exactly as before (back-compat).

#### Scenario: onSpawnStart fires at submit before createWorktree
- **WHEN** the user clicks "Spawn →" to create a new worktree
- **THEN** the dialog SHALL call `onSpawnStart(cwd)` before the `createWorktree` request is sent
- **AND** the host SHALL render a placeholder in the `cwd` group immediately, covering the `createWorktree` latency window

#### Scenario: onSpawnStart fires for existing-worktree spawn
- **WHEN** the user clicks `Spawn →` on an existing-worktree row
- **THEN** the dialog SHALL call `onSpawnStart(cwd)` before invoking `onSpawn(entry.path, …)`

#### Scenario: onSpawnAbort fires when createWorktree fails
- **WHEN** `createWorktree` rejects with a stable error code (e.g. `branch_in_use`, `path_exists`, `base_not_found`)
- **THEN** the dialog SHALL call `onSpawnAbort(cwd)`
- **AND** the dialog SHALL remain open rendering the error
- **AND** the host SHALL remove the placeholder immediately rather than waiting for the safety timeout

#### Scenario: Successful create proceeds to onSpawn
- **WHEN** `createWorktree` succeeds and returns `res.path`
- **THEN** the dialog SHALL NOT call `onSpawnAbort`
- **AND** the dialog SHALL call `onSpawn(res.path, opts)` as today, leaving the placeholder in place until `session_added` clears it

#### Scenario: Callbacks optional (back-compat)
- **WHEN** the dialog is mounted without `onSpawnStart` / `onSpawnAbort`
- **THEN** submit and failure paths SHALL behave exactly as before, with no placeholder lifecycle signals

### Requirement: The existing-worktrees list SHALL be a shared, filterable component

The list currently inlined as `WorktreeSpawnDialog` §1 SHALL be extracted into a
single `WorktreeList` component parameterised by a `mode` of `spawn` | `manage`,
and SHALL be the only implementation rendering worktree rows on either surface.

The filter SHALL be derived client-side from the fields already present on
`WorktreeEntry` (`path`, `branch`, `sha`, `bare`, `detached`, `isMain`). It SHALL
NOT require a new server field for its predicates, because the main worktree's
own path is present in the same response and `inTree` is therefore derivable as
`path.startsWith(main.path + "/.worktrees/")`. Path comparison SHALL normalise
`\` to `/` first, so a Windows porcelain path does not report every row as
out-of-tree.

The default visible predicate SHALL be `isMain || (!detached && inTree)`.

#### Scenario: Default view hides harness noise
- **WHEN** the list receives 8 entries — 1 main, 2 non-detached under `.worktrees/`, 4 detached under `.worktrees/ab-impl/`, and 1 detached outside the repo tree
- **THEN** exactly 3 rows SHALL render: the main worktree and the 2 non-detached in-tree worktrees

#### Scenario: Hidden rows are never silently dropped
- **WHEN** any entry is excluded by the default predicate
- **THEN** a toggle chip SHALL render carrying the live count of entries it hides — `Detached (5)`, `Outside .worktrees (1)`
- **AND** activating that chip SHALL reveal those rows

This scenario is mandatory, not cosmetic. It does NOT rest on a claim that this
server creates detached worktrees — it does not: checkout mode resolves a local
branch name and PR mode passes `-b`, so both produce attached branches. The
reason the count is mandatory is that detached rows arrive from sources the
dashboard does not control (external harnesses, manual `git worktree add`, tools
operating on the same repo), and the list cannot distinguish "noise" from "the
thing the user is looking for" by provenance. A default that hides rows is only
honest if what it hid is always visible as a count.

#### Scenario: Every hidden row is revealable by some chip
- **WHEN** the list receives an entry that is **not** detached and lies outside the repo tree (creatable today via the spawn dialog's free-text path field)
- **THEN** that entry SHALL be hidden by the default predicate
- **AND** it SHALL be counted by the `Outside .worktrees` chip, whose activation reveals it
- **AND** no entry SHALL be excluded from the view without being counted by at least one chip

#### Scenario: Shown count is a union, not a sum
- **WHEN** an entry is both detached and outside the repo tree, so it belongs to two chip groups
- **THEN** the `N of M shown` count SHALL count that entry once
- **AND** revealing either chip SHALL make the row appear exactly once

#### Scenario: Text query matches path and branch
- **WHEN** the user types a substring into the filter input
- **THEN** only entries whose `path` or `branch` contains that substring SHALL render, intersected with the active toggle state
- **AND** entries whose `branch` is `null` (detached or bare) SHALL be matched on `path` alone without error

#### Scenario: Spawn mode preserves the one-click contract
- **WHEN** `mode` is `spawn` and a row is clicked
- **THEN** the existing `onSpawn(entry.path, opts)` behaviour SHALL fire unchanged
- **AND** no checkbox or `✕` control SHALL render

### Requirement: The main worktree SHALL NOT be offered for removal

The row whose entry has `isMain: true` SHALL NOT expose any destructive control
on either surface. `git worktree remove` rejects the main worktree regardless,
so offering the affordance can only produce a guaranteed-failing click.

#### Scenario: Main row renders no destructive control
- **WHEN** `mode` is `manage` and an entry has `isMain: true`
- **THEN** that row SHALL render neither a `✕` control nor a selection checkbox
- **AND** a "select all" affordance SHALL NOT include it in the selection

### Requirement: Manage rows SHALL NOT nest interactive controls inside a button

Spawn mode renders the whole row as a `<button>`. Manage mode places a checkbox
and a `✕` inside the row, and interactive elements SHALL NOT be nested inside a
button element — it is invalid HTML and breaks keyboard and assistive-technology
traversal. All new user-facing strings SHALL use the `i18nT` helper already used
throughout the host component.

#### Scenario: Manage row container is not a button
- **WHEN** `mode` is `manage`
- **THEN** the row container SHALL NOT be a `<button>` element
- **AND** the checkbox and `✕` SHALL each be independently focusable in DOM order

#### Scenario: Spawn row keeps its whole-row target
- **WHEN** `mode` is `spawn`
- **THEN** the row SHALL remain a single `<button>` with no nested interactive controls

