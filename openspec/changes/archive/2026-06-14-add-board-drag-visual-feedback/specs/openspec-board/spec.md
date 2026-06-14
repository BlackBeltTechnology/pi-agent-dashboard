## MODIFIED Requirements

### Requirement: Group column reorder is persisted
The user SHALL be able to reorder columns by dragging a column header. The new order SHALL persist via the existing group `order` field. While a column drag is in progress the board SHALL show visual feedback: the column header SHALL present a grab/grabbing cursor, a pointer-following drag preview SHALL represent the column being moved, and the drop target SHALL be highlighted.

#### Scenario: Drag column to new position
- **WHEN** the user drags the `Backlog` header before `In flight`
- **THEN** the columns SHALL reorder and the server SHALL persist each moved group's new `order`

#### Scenario: Column drag shows feedback
- **WHEN** the user presses and drags a column header
- **THEN** the cursor SHALL change to a grabbing cursor
- **AND** a drag preview SHALL follow the pointer
- **AND** the column position the drag would drop into SHALL be visually highlighted

### Requirement: Cards drag between and within columns
A proposal card SHALL be draggable to another column (reassigning its group) and to a new position within its column (reordering). Both SHALL persist. A draggable card SHALL present a grab cursor on hover and a grabbing cursor while pressed. While a card drag is in progress a pointer-following drag preview SHALL represent the card, and the column under the pointer SHALL be highlighted as the drop target.

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
