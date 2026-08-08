## MODIFIED Requirements

### Requirement: Pin toggle on directory group headers

Each directory group header SHALL expose a pin toggle as an item in the folder actions menu, not as an icon in the header row. The item SHALL read as pinning when the directory is unpinned and as unpinning when it is pinned. The item SHALL be present only where pinning is meaningful — that is, outside a workspace container.

The left side of the header SHALL continue to display a folder icon: `mdiFolderOpen` when the group is expanded, `mdiFolder` when collapsed.

Pinned state SHALL remain visually distinguishable on the header itself without a dedicated toggle button, so the user can still tell pinned groups apart at a glance.

#### Scenario: Pinned directory group header

- **WHEN** a directory group is pinned and expanded
- **THEN** the left icon SHALL be `mdiFolderOpen`
- **AND** the header SHALL carry a visual indication that the group is pinned
- **AND** no pin toggle button SHALL render in the header row

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
