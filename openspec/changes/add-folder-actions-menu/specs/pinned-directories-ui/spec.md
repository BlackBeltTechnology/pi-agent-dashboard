## MODIFIED Requirements

### Requirement: Pin toggle on directory group headers

Each directory group header SHALL expose a pin toggle as an item in the folder actions menu, not as an icon in the header row. The item SHALL read as pinning when the directory is unpinned and as unpinning when it is pinned. The item SHALL be present only where pinning is meaningful — that is, outside a workspace container.

The left side of the header SHALL continue to display a folder icon: `mdiFolderOpen` when the group is expanded, `mdiFolder` when collapsed.

Pinned state SHALL remain visually distinguishable on the header itself without a dedicated toggle button. The header SHALL retain a **non-interactive** `mdiPin` indicator when the directory is pinned, and render no indicator when it is not, so the user can still tell pinned groups apart at a glance.

This knowingly places `mdiPin` in two roles on one card: state in the header, and action inside the menu. That is accepted as the least-bad option — a different indicator glyph would sever the visual link to the action that produces it. The two are distinguishable by interactivity: the header indicator is not a button and has no hover or focus affordance.

#### Scenario: Pinned directory group header

- **WHEN** a directory group is pinned and expanded
- **THEN** the left icon SHALL be `mdiFolderOpen`
- **AND** the header SHALL render a non-interactive `mdiPin` indicator
- **AND** that indicator SHALL NOT be focusable or activatable
- **AND** no pin toggle button SHALL render in the header row

#### Scenario: Unpinned group renders no indicator

- **WHEN** a directory group is not pinned
- **THEN** the header SHALL render no `mdiPin` indicator

#### Scenario: Unpin from the menu

- **GIVEN** a pinned directory outside any workspace
- **WHEN** the user opens the folder actions menu and activates the pin item
- **THEN** the directory SHALL be unpinned

#### Scenario: Pin from the menu

- **GIVEN** an unpinned directory outside any workspace
- **WHEN** the user opens the folder actions menu and activates the pin item
- **THEN** the directory SHALL be pinned

#### Scenario: Workspace-owned folder offers no pin item

- **GIVEN** a folder inside a workspace container
- **WHEN** the folder actions menu opens
- **THEN** no pin item SHALL render
