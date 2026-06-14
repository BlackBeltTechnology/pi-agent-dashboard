## ADDED Requirements

### Requirement: Persisted per-change order within a group
The system SHALL persist a manual ordering of changes within each group (including the implicit Ungrouped group). The order SHALL survive reload and be broadcast like group/assignment changes.

#### Scenario: Reorder persists
- **WHEN** the user drags `b-change` above `a-change` within group `UI`
- **THEN** the new order `[b-change, a-change]` SHALL be persisted for group `UI`
- **AND** a subsequent board load SHALL render `b-change` before `a-change`

#### Scenario: Order is per-group
- **WHEN** `a-change` is reordered within group `UI`
- **THEN** the ordering of changes in other groups SHALL be unaffected

### Requirement: Default order when no manual order exists
When a group has no persisted manual order for a change, the system SHALL fall back to the deterministic default sort: in-progress changes first, then complete, then by name.

#### Scenario: New change appended deterministically
- **WHEN** a change with no stored order is added to a group with manually-ordered changes
- **THEN** it SHALL be placed per the default sort relative to unordered peers, without disturbing the stored order of others

#### Scenario: Missing order never errors
- **WHEN** the board loads a group whose order data is absent
- **THEN** the board SHALL render using the default sort and SHALL NOT error

### Requirement: Reassigning a change updates ordering
When a change is moved to a different group, it SHALL be removed from its old group's order and inserted into the target group's order at the drop position.

#### Scenario: Move keeps target position
- **WHEN** `add-auth` is dragged from `Backlog` to position 1 in `In flight`
- **THEN** `add-auth` SHALL be removed from `Backlog`'s order and inserted at index 1 of `In flight`'s order
