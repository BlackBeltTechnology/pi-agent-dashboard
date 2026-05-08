## ADDED Requirements

### Requirement: Drag-to-reorder removed
Drag-to-reorder of session cards within folder groups SHALL be removed. Sessions SHALL be ordered by the server (last active at top) without user reordering.

#### Scenario: No drag handles
- **WHEN** session cards render in the sidebar
- **THEN** no drag handles SHALL appear on session cards

#### Scenario: Session order is server-managed
- **WHEN** a new session is spawned
- **THEN** it SHALL appear at the top of its folder group
