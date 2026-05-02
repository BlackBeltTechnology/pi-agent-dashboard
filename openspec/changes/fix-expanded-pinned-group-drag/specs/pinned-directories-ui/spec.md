## MODIFIED Requirements

### Requirement: Drag-to-reorder pinned directories
Users SHALL be able to reorder pinned directory groups by dragging, regardless of whether the source group, the target group, or both are expanded or collapsed at the moment the drag begins. The sidebar's drag-and-drop collision detection SHALL constrain candidate drop targets to droppables of the same drag `type` as the active draggable before measuring distances, so that nested sortable contexts (e.g., session cards inside an expanded group) do not capture a pinned-group drag intended for another pinned group.

#### Scenario: Drag pinned directory to new position
- **WHEN** a user drags a pinned directory group from position 1 to position 3
- **THEN** the pinned directories list SHALL update to reflect the new order and persist the change

#### Scenario: Drag only within pinned section
- **WHEN** a user attempts to drag a pinned directory
- **THEN** the drag SHALL only allow reordering within the pinned section (cannot drag to unpinned section)

#### Scenario: Unpinned directories are not draggable
- **WHEN** a user attempts to drag an unpinned directory group
- **THEN** the drag SHALL not initiate (unpinned groups are auto-sorted by recency)

#### Scenario: Reorder works when source and target are both expanded
- **WHEN** two pinned directory groups are both expanded (their session cards are visible) and a user drags the source group's drag-handle onto the target group's header
- **THEN** the pinned directories list SHALL update to reflect the swapped order and persist the change
- **AND** no session card inside either group SHALL be reordered

#### Scenario: Reorder works when source is expanded and target is collapsed
- **WHEN** the dragged pinned group is expanded but the target group is collapsed
- **THEN** the pinned directories list SHALL update to reflect the new order and persist the change

#### Scenario: Reorder works when source is collapsed and target is expanded
- **WHEN** the dragged pinned group is collapsed but the target group is expanded
- **THEN** the pinned directories list SHALL update to reflect the new order and persist the change

#### Scenario: Session-card drag inside an expanded group does not reorder pinned groups
- **WHEN** a user drags a session card from one position to another inside an expanded pinned group
- **THEN** only the per-folder session order SHALL update; the pinned directories order SHALL remain unchanged
