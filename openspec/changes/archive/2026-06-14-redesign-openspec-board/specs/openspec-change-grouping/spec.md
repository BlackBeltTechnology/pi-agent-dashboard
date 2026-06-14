## ADDED Requirements

### Requirement: Groups render as board columns with inline management
On the OpenSpec board, each group SHALL render as a column whose header exposes inline management: rename, recolor, delete, a new-proposal `＋`, and a drag grip for reordering. The standalone "Manage groups" modal entry point is no longer required for these actions.

#### Scenario: Inline manage from column header
- **WHEN** the user activates a column header's `⚙` control
- **THEN** rename, recolor, and delete affordances for that group SHALL be available without opening a separate folder-card modal

#### Scenario: New proposal scoped to column
- **WHEN** the user activates a column header's `＋` control
- **THEN** the new-proposal dialog SHALL open pre-scoped to that column's group

### Requirement: Column order uses persisted group order
Column ordering on the board SHALL be driven by the existing persisted group `order`, and dragging a column header SHALL update that order.

#### Scenario: Column order reflects stored order
- **WHEN** groups have `order` values `[In flight=0, Backlog=1]`
- **THEN** the board SHALL render `In flight` left of `Backlog`

#### Scenario: Drag updates stored order
- **WHEN** the user drags `Backlog` before `In flight`
- **THEN** the server SHALL persist the updated `order` for the moved groups via the existing group update route
