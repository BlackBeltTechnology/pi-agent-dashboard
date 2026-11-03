## MODIFIED Requirements

### Requirement: Dock replaces the composer strip in other capabilities

Where another capability names the composer strip's OpenSpec group, its Git group, or the session-actions strip, those SHALL mean the dock's OpenSpec lane, Changes lane and dock. The context strip or queue panel as parts of the composer stack SHALL mean the dock, and the status row SHALL mean the toolbar's working-status word. The `access-grant-yolo` composer strip SHALL mean the YOLO footer.

#### Scenario: Worktree actions location
- **WHEN** a worktree session is bound
- **THEN** the worktree actions that `worktree-lifecycle` places in the composer strip's Git group SHALL render in the Changes lane header

#### Scenario: Canvas chip tray anchor
- **WHEN** the canvas chip tray anchors above the live composer stack
- **THEN** it SHALL render in the chip slot directly above the dock, or directly above the composer card when no dock renders

