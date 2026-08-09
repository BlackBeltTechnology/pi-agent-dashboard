## MODIFIED Requirements

### Requirement: Add-to-workspace affordance

The add-to-workspace gesture SHALL be presented as an item inside the folder actions menu, under the workspace group, rather than as a pill in the row's action cluster. The item SHALL render an `mdiViewGridPlus` glyph plus a label conveying the full verb ("Add to workspace…"), so the visible noun is never the sole cue.

The affordance SHALL be present in **one** surface only: the sidebar folder-group header, which owns the cwd being assigned. It SHALL NOT be surfaced on session cards — a session's directory membership is a property of its directory, and duplicating the control per session renders N identical controls with one effect.

The menu trigger SHALL expose `aria-haspopup` with `aria-expanded` reflecting popover state, and the item SHALL meet the platform touch-target minimum via the menu's own mobile presentation.

#### Scenario: Affordance renders as a menu item

- **WHEN** a top-level folder row's actions menu opens
- **THEN** the workspace group SHALL contain an item with the `mdiViewGridPlus` glyph and a label conveying "add to workspace"
- **AND** no add-to-workspace pill SHALL render in the row's action cluster

#### Scenario: Session cards carry no add-to-workspace affordance

- **WHEN** a session card renders inside a folder
- **THEN** it SHALL NOT render an add-to-workspace control
- **AND** the folder header's menu SHALL remain the only place the gesture is offered for that cwd

#### Scenario: Popover state is exposed on the trigger

- **WHEN** the add-to-workspace popover is open
- **THEN** the control that opened it SHALL expose `aria-expanded` reflecting that state
