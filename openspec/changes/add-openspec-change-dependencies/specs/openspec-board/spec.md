## ADDED Requirements

### Requirement: Dependency chips on proposal cards

When dependency UI is visible for the cwd, a card SHALL render chips derived from `OpenSpecChange.dependencies`. Dependency UI is visible when `workflowSchema.configured` is `pi-spec-driven` or any change has `dependencies.hasFile`. The chips are:
- **blocked by N**: open edges, error tone.
- **satisfied**: shown in the hover list only.
- **blocks N**.
- **overlaps N**: muted.
- a **wave** badge (none when `wave` is null).
- an **issues** badge: error or warning tone by worst severity.

Hover or focus SHALL list the names with source and reason. Activating a name SHALL scroll to and highlight that change's card, or open the archive entry for an archived name. Inferred edges SHALL be visually distinguishable from declared ones. When dependency UI is not visible, or a change carries no `dependencies` field, no chip SHALL render.

#### Scenario: Blocked card

- **GIVEN** `add-acme-dns01-certs` is blocked by the active `add-tailscale-cert-tls` (declared) and is in wave 2
- **WHEN** the board renders
- **THEN** the card SHALL show "blocked by 1" in error tone and a wave 2 badge
- **AND** focusing the chip SHALL list `add-tailscale-cert-tls` with source `declared`

#### Scenario: Hidden when not adopted

- **GIVEN** the default schema is `spec-driven` and no change has `dependencies.yaml`
- **WHEN** the board renders
- **THEN** no dependency chip or wave badge SHALL render

### Requirement: Execution-order view

The board filter bar SHALL offer a view toggle `Default | Execution order` when dependency UI is visible and at least one change carries a `dependencies` field. In execution order, each column SHALL sort its cards by `wave` ascending, then name. Changes with `wave: null` SHALL sort after waved changes with their issues badge, and changes without a `dependencies` field after those, each group by name. The view SHALL NOT reorder existing `changeOrder` entries; a card moved to another column is appended there. Drag behaviour in this view is defined by "Cards drag between and within columns".

#### Scenario: Waves order the column

- **GIVEN** a column holding `c` (wave 3), `a` (wave 1), `b` (wave 2)
- **WHEN** the user selects Execution order
- **THEN** the column SHALL render `a`, `b`, `c`
- **AND** `groups.json` SHALL be unchanged

### Requirement: Dependency editor dialog

A card action "Dependencies…" SHALL be available whenever the change carries a `dependencies` field, even while dependency UI is hidden (so a `spec-driven` project can opt in by declaring a first dependency). It SHALL open a dialog for that change listing:
- its declared `blocked_by` entries, each removable;
- inferred edges where this change is the blocked side, each with "Not a dependency", which adds the blocker to this change's `not_blocked_by`;
- `related` entries;
- the changes it blocks, read-only, each with a link opening that change's dialog;
- a picker over active and archived change names to add a blocker.

The dialog SHALL load the file's declared lists (with reasons) and `file` stamp from `GET /api/openspec/dependencies` and edit only those, so existing `not_blocked_by` entries and reasons survive a save and prose-derived `related` entries are never written. When GET reports `declaredError`, the dialog SHALL show it and SHALL NOT save unless the user explicitly confirms replacing the invalid file. Saving SHALL call `PUT /api/openspec/dependencies` for this change only, with `expected` set to the GET's `file`, and show the server error on failure; on 409 `modified` it SHALL offer to reload, on 409 `locked` to retry. The dialog SHALL be keyboard operable with labelled controls.

#### Scenario: Reject an inferred edge

- **GIVEN** an inferred edge `foo` blocked by `bar`, produced by `bar`'s proposal
- **WHEN** the user opens `foo`'s dialog, chooses "Not a dependency" and saves
- **THEN** `foo/dependencies.yaml` SHALL list `bar` under `not_blocked_by`
- **AND** after the next poll the edge SHALL no longer render

### Requirement: Undeclared dependencies explain a planning state

A change whose `artifacts` include `dependencies` with status `ready` stays `PLANNING` even when proposal, design and specs are done, while the four-segment stepper shows those segments complete. Its proposal card SHALL then show, regardless of dependency-UI visibility, a "Declare dependencies" hint opening the Dependencies dialog, so the user can see why the change is not ready.

Artifact letter rendering (`ArtifactLetters` / `artifactLetter`) SHALL map `dependencies` to `L` with the tooltip "Dependencies", so it no longer collides with `design` (`D`). Unknown artifact ids keep the first-letter fallback. On the fallback poll path (CLI without `status --all`) the artifact list is the legacy four and no `dependencies` field exists, so neither the hint nor any dependency UI renders there.

#### Scenario: Planning reason is visible

- **GIVEN** a `pi-spec-driven` change with proposal, design and specs done and `dependencies: ready`
- **WHEN** the board renders
- **THEN** its card SHALL show the "Declare dependencies" hint
- **AND** activating the hint SHALL open the Dependencies dialog for that change

#### Scenario: Letters are distinct

- **WHEN** a change's artifacts are `proposal, design, specs, tasks, dependencies`
- **THEN** the rendered letters SHALL be `P D S T L`

## MODIFIED Requirements

### Requirement: Proposal cards
Each change SHALL render as a card showing its name, the compact lifecycle bar, its session list, card actions, and — only when the change carries a CLI `error` — an error badge (see "Card shows a per-change CLI error"). When dependency UI is visible, the card also shows the dependency chips, wave badge and issues badge (see "Dependency chips on proposal cards"). When its `dependencies` artifact is `ready`, the card shows the "Declare dependencies" hint (see "Undeclared dependencies explain a planning state"). The card SHALL NOT render a separate state pill or a separate task-progress bar; the lifecycle bar carries both.

#### Scenario: Card content
- **WHEN** a change `add-auth` is `IMPLEMENTING` with `3/8` tasks
- **THEN** its card SHALL show the name, the lifecycle bar with the `Tasks` segment labelled `3/8`, its sessions, and `New session` / `New worktree` actions
- **AND** no state pill and no standalone progress bar SHALL render on the card

#### Scenario: Card with dependencies
- **GIVEN** dependency UI is visible and `add-auth` is blocked by one active change in wave 2
- **THEN** its card SHALL additionally show the "blocked by 1" chip and the wave 2 badge

### Requirement: Cards drag between and within columns

A proposal card SHALL be draggable to another column (reassigning its group) and to a new position within its column (reordering). Both SHALL persist. The rules below describe the Default view. While the board's Execution-order view is active they are replaced as follows: reordering within a column SHALL be disabled (cards render in wave order, so a within-column drop has nothing to persist); the midpoint rule and the insertion marker SHALL NOT apply; dragging to another column SHALL remain enabled, SHALL reassign the group and SHALL persist, and a drop on another column SHALL resolve to its append slot, indicated by the append affordance in its active state; a drop on the card's own column SHALL change nothing. Unless a scenario names the Execution-order view, the scenarios of this requirement describe the Default view. A draggable card SHALL present a grab cursor on hover and a grabbing cursor while pressed. While a card drag is in progress a pointer-following drag preview SHALL represent the card, and the column under the pointer SHALL be highlighted as the drop target.

The drop position SHALL be resolved by a single rule, applied identically for same-column and cross-column drags and independently of drag direction: when the pointer is over a card, a pointer above that card's vertical midpoint SHALL resolve to the slot *before* it and a pointer below that midpoint SHALL resolve to the slot *after* it. A pointer exactly at a midpoint SHALL resolve to the slot *after*. Every slot in a column, including the slot after the final card, SHALL be reachable by pointer.

The entire column — header, body, and padding — SHALL accept a card drop. While a card drag is in progress each column, including an empty column, SHALL present an append affordance at least 44px tall that resolves to the last position. The affordance SHALL remain within the visible bounds of the column body regardless of the body's scroll position, and SHALL NOT depend on residual empty space in the column body.

While a card drag is in progress the resolved drop slot SHALL be continuously indicated, with no pointer position over a column leaving the resolved slot unindicated. A slot between two cards SHALL be indicated by an insertion marker rendered in the gap the card would occupy. The final slot SHALL be indicated by the append affordance entering its active state, which SHALL depend on the resolved slot being last — not on the pointer being over the affordance.

#### Scenario: Drag card to another column

- **WHEN** the user drags `add-auth` from `Backlog` into `In flight`
- **THEN** the change's group assignment SHALL change to `In flight` and persist

#### Scenario: Reorder card within a column

- **WHEN** the user drags `add-auth` above `fix-bug` in the same column
- **THEN** `add-auth` SHALL render before `fix-bug` and the new intra-group order SHALL persist

#### Scenario: Card hover shows grab cursor

- **WHEN** the pointer hovers a proposal card
- **THEN** the cursor SHALL be a grab (open-hand) cursor

#### Scenario: Card drag shows preview and drop highlight

- **WHEN** the user presses and drags a proposal card
- **THEN** the cursor SHALL change to a grabbing cursor
- **AND** a drag preview SHALL follow the pointer
- **AND** the column under the pointer SHALL be highlighted as the drop target

#### Scenario: Drop below a card's midpoint inserts after it

- **GIVEN** a column ordered `a`, `b`, `c`
- **WHEN** the user drags a card and holds the pointer below the vertical midpoint of `b`
- **THEN** the resolved drop slot SHALL be between `b` and `c`
- **AND** releasing SHALL place the dragged card between `b` and `c`

#### Scenario: Drop above a card's midpoint inserts before it

- **GIVEN** a column ordered `a`, `b`, `c`
- **WHEN** the user drags a card and holds the pointer above the vertical midpoint of `b`
- **THEN** the resolved drop slot SHALL be between `a` and `b`

#### Scenario: Dragging a card onto its adjacent neighbour moves it

- **GIVEN** a column ordered `a`, `b`, `c`, `d`
- **WHEN** the user drags `b` downward and releases below the vertical midpoint of the adjacent card `c`
- **THEN** the column SHALL be ordered `a`, `c`, `b`, `d`
- **AND** the drag SHALL NOT resolve to `b`'s original position

#### Scenario: Drop resolution does not depend on drag direction or source column

- **GIVEN** a column ordered `a`, `b`, `c`
- **WHEN** a card is released below the vertical midpoint of `b`, whether it was dragged upward from within the column, downward from within the column, or in from another column
- **THEN** all three cases SHALL resolve to the same slot, between `b` and `c`

#### Scenario: Card can be dropped into the last position

- **GIVEN** a column whose content overflows its visible height, ordered `a`, `b`, `c`
- **WHEN** the user drags a card and holds the pointer below the vertical midpoint of the last card `c`
- **THEN** the resolved drop slot SHALL be after `c`
- **AND** releasing SHALL place the dragged card last in that column and the new order SHALL persist

#### Scenario: Append affordance resolves to the last position

- **WHEN** a card drag is in progress
- **THEN** each column SHALL render an append affordance at least 44px tall
- **AND** holding the pointer over that affordance SHALL resolve the drop slot to the last position
- **AND** the affordance SHALL be hidden when no card drag is in progress

#### Scenario: Append affordance is reachable without scrolling

- **GIVEN** a column whose content overflows its visible height, scrolled to the top
- **WHEN** a card drag is in progress
- **THEN** the append affordance SHALL be visible within the column body's visible bounds without the user scrolling
- **AND** it SHALL remain visible as the body is scrolled

#### Scenario: Append affordance in an empty column

- **GIVEN** a column containing no cards
- **WHEN** a card drag is in progress
- **THEN** that column SHALL present the append affordance
- **AND** dropping on it SHALL place the card as the column's only card

#### Scenario: Dropping on the append affordance preserves the column's existing order

- **GIVEN** a column ordered `a`, `b`, `c`
- **WHEN** a card `X` from another column is dropped on that column's append affordance
- **THEN** the column SHALL be ordered `a`, `b`, `c`, `X`
- **AND** the persisted order SHALL retain `a`, `b`, `c` — it SHALL NOT be replaced by a single entry

#### Scenario: Insertion marker shows the resolved slot

- **WHEN** a card drag is in progress and the pointer is over a column
- **THEN** an insertion marker SHALL be rendered in the gap corresponding to the resolved drop slot
- **AND** moving the pointer across a card's midpoint SHALL move the marker to the newly resolved gap

#### Scenario: The final slot is indicated without the pointer being over the append affordance

- **GIVEN** a column ordered `a`, `b`, `c`
- **WHEN** the user drags a card and holds the pointer below the vertical midpoint of the last card `c`, not over the append affordance
- **THEN** the resolved slot SHALL be after `c`
- **AND** that slot SHALL be indicated by the append affordance in its active state
- **AND** the drag SHALL NOT leave the resolved slot unindicated

#### Scenario: Column header accepts a drop

- **WHEN** the user drags a card over a column's header
- **THEN** that column SHALL be highlighted as the drop target
- **AND** releasing SHALL move the card into that column

#### Scenario: Non-target columns recede during a drag

- **WHEN** a card drag is in progress and the pointer is over one column
- **THEN** that column SHALL be visually emphasised as the drop target
- **AND** the remaining columns SHALL be visually de-emphasised

#### Scenario: Overflowing column auto-scrolls at its edges

- **GIVEN** a viewport wider than 900px, where column bodies scroll internally
- **AND** a column whose content overflows its visible height
- **WHEN** the user drags a card and holds the pointer within the top or bottom edge zone of that column's body
- **THEN** the column body SHALL scroll toward that edge
- **AND** the active edge zone SHALL be visually indicated

#### Scenario: Release outside any column cancels the drag

- **WHEN** the user releases a dragged card while the pointer is not over any column — including over the gutter between two columns
- **THEN** no group assignment or ordering SHALL change
- **AND** the card SHALL NOT be moved into a neighbouring column
- **AND** the insertion marker, append affordances, and drag preview SHALL be removed

#### Scenario: Interrupted drag clears all drag affordances

- **GIVEN** a card drag is in progress
- **WHEN** the drag is interrupted rather than released — by pointer cancellation, by the tab becoming hidden, or by the window losing focus
- **THEN** no group assignment or ordering SHALL change
- **AND** the insertion marker, append affordances, and drag preview SHALL be removed

#### Scenario: Column reorder still works after the collision-detection change

- **GIVEN** columns ordered `Backlog`, `In flight`, `Done`
- **WHEN** the user drags the `Done` column onto the `Backlog` column, releasing over any part of it
- **THEN** the columns SHALL be reordered and the new order SHALL persist
- **AND** the drag SHALL NOT silently no-op

#### Scenario: Execution order allows only column moves

- **GIVEN** the Execution-order view is active
- **WHEN** the user drags `add-auth` above `fix-bug` in the same column
- **THEN** no order change SHALL persist
- **AND WHEN** the user drags `add-auth` into `In flight`
- **THEN** its group assignment SHALL change to `In flight` and persist, and `changeOrder` for `In flight` SHALL list it last
