## MODIFIED Requirements

### Requirement: Cards drag between and within columns

A proposal card SHALL be draggable to another column (reassigning its group) and to a new position within its column (reordering). Both SHALL persist. A draggable card SHALL present a grab cursor on hover and a grabbing cursor while pressed. While a card drag is in progress a pointer-following drag preview SHALL represent the card, and the column under the pointer SHALL be highlighted as the drop target.

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
