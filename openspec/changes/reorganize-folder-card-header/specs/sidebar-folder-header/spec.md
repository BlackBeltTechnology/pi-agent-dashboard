## ADDED Requirements

### Requirement: Folder card assigns one job per tier

A directory card SHALL separate its content into tiers with distinct responsibilities:
identity and urgency (the name row), git facts, structural calls to action, and directory
state pills. A tier SHALL NOT mix responsibilities.

The git-facts tier SHALL contain no action controls beyond the affordances on the facts
themselves (branch, dirty count). Every directory mutation SHALL be reachable from the
folder actions menu, and SHALL NOT be duplicated as a standalone control elsewhere on the
card.

#### Scenario: Git-facts tier holds no action controls

- **WHEN** an expanded directory card renders
- **THEN** the git-facts row SHALL NOT contain a settings control, an initialize control, or a cleanup control

#### Scenario: State pills never mutate

- **WHEN** the directory state pill grid renders
- **THEN** every pill SHALL present a count or status
- **AND** no pill SHALL open a mutation menu or perform a directory mutation

#### Scenario: Mutations have exactly one home

- **GIVEN** a directory mutation exposed by the card
- **WHEN** the card renders
- **THEN** that mutation SHALL be reachable from the folder actions menu
- **AND** SHALL NOT also render as a standalone control in the name row or git-facts row

### Requirement: Folder actions menu groups directory mutations

The folder header's trailing cluster SHALL be a single overflow-menu control. Activating it
SHALL open a menu whose items are grouped by concern: workspace membership actions, then
directory actions.

The control SHALL expose `aria-haspopup="menu"` and an `aria-expanded` state bound to
whether its menu is open. Menu items SHALL expose `role="menuitem"`. Activating the control
SHALL stop click propagation so it neither navigates to the directory home page nor toggles
the folder's collapsed state.

Menu open state SHALL be keyed per folder so that opening one folder's menu does not open
another's.

#### Scenario: Cluster is a single control

- **WHEN** a folder header renders its trailing cluster
- **THEN** exactly one control SHALL render in the cluster
- **AND** the urgency-sort, pin, add-to-workspace and remove-from-workspace controls SHALL NOT render as separate cluster buttons

#### Scenario: Menu is grouped by concern

- **WHEN** the folder actions menu opens for a folder inside a workspace
- **THEN** it SHALL present a workspace group containing add-to-workspace and remove-from-workspace
- **AND** a directory group containing project setup, pin, urgency sort, and directory settings

#### Scenario: Opening the menu does not navigate or collapse

- **GIVEN** an expanded folder
- **WHEN** the user activates the folder actions control
- **THEN** the menu SHALL open
- **AND** the client SHALL NOT navigate to the directory home page
- **AND** the folder SHALL remain expanded

## MODIFIED Requirements

### Requirement: Header icon cluster stays in the top-right at any width

The folder header's trailing action cluster SHALL remain on a single line anchored to the top-right of the header
at every sidebar width, and SHALL NOT wrap to a second row or be pushed out of the card. The cluster SHALL be
non-shrinking (`flex: none`) with non-wrapping content (`white-space: nowrap`); the horizontal squeeze SHALL be
absorbed by the folder-name region, which SHALL be shrinkable (`min-width: 0`) and clipped with an ellipsis.

Name truncation SHALL be prioritised so the folder's own name survives longest: the leading parent-path segment
SHALL shrink first and MAY collapse entirely, while the final path segment (the folder name) SHALL retain a
legible minimum before it ellipses.

The status capsule sits between the name region and the cluster. Under horizontal pressure its idle-count segment
SHALL be dropped before the name region is squeezed further, and its leading alert segment SHALL never be dropped.

#### Scenario: The cluster control remains visible when the sidebar is narrow

- **GIVEN** a folder header rendering the trailing cluster
- **WHEN** the sidebar is narrowed to 220 px
- **THEN** the folder actions control SHALL remain rendered in the top-right
- **AND** the cluster SHALL NOT wrap to a second row

#### Scenario: Parent path collapses before the folder name

- **GIVEN** a folder whose path is `/home/user/Documents/general`
- **WHEN** available width is insufficient for the whole path
- **THEN** the `/home/user/Documents/` parent portion SHALL be truncated or collapsed first
- **AND** the `general` segment SHALL remain at least partially legible

#### Scenario: Long folder name does not displace the cluster

- **GIVEN** a folder whose final path segment is very long
- **WHEN** the header renders
- **THEN** the name SHALL be clipped with an ellipsis
- **AND** the cluster SHALL stay fully within the header's right edge

#### Scenario: Idle count yields before the alert segment

- **GIVEN** a folder with blocked sessions and a narrow sidebar
- **WHEN** the header cannot fit the full status capsule
- **THEN** the idle-count segment SHALL be dropped first
- **AND** the leading alert segment SHALL remain visible
