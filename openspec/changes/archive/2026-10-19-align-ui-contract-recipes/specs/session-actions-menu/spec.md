## ADDED Requirements

### Requirement: Menu text and targets meet the contract floors

In the session actions menu:

- group headings SHALL be at least 11 px, semibold, in the secondary text colour;
- each menu item SHALL be at least 44 px tall below the `sm` breakpoint and at least 36 px tall from `sm`;
- host-rendered item labels, the `More…` expander and its count SHALL use the primary text colour, and the PLUGINS group container SHALL set the primary text colour so that plugin output which does not set its own colour inherits it.

A disabled item's reason SHALL render as its own line under the label, at least 12 px in the secondary text colour, linked to the item for assistive technology. The reason SHALL wrap rather than be truncated into a trailing span. All enabled menu text and every disabled reason SHALL meet 4.5:1 contrast against the menu background in base dark, base light and nord dark.

#### Scenario: Heading and item sizes
- **WHEN** the session actions menu opens on a desktop viewport
- **THEN** every group heading SHALL have a computed font size of at least 11 px
- **AND** every menu item SHALL be at least 36 px tall

#### Scenario: Touch viewport targets
- **WHEN** a menu item renders below the `sm` breakpoint
- **THEN** it SHALL be at least 44 px tall (the menu only exists in the desktop layout, which is not shown below 768 px, so this floor is pinned at the class level, not in a narrow browser)

#### Scenario: Disabled reason is readable
- **WHEN** New worktree session is disabled because the session's directory no longer exists
- **THEN** the reason "session's directory no longer exists" SHALL render in full on its own line under the label
- **AND** the reason SHALL have a computed font size of at least 12 px
- **AND** the item SHALL reference the reason through `aria-describedby`

#### Scenario: Plugin items at full contrast
- **WHEN** a plugin contributes an item to the PLUGINS group without setting its own text colour
- **THEN** its label SHALL inherit the primary text colour
- **AND** it SHALL measure at least 4.5:1 against the menu background in base light
