## ADDED Requirements

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
