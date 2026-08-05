## ADDED Requirements

### Requirement: Header icon cluster stays in the top-right at any width

The folder header's trailing action cluster SHALL remain on a single line anchored to the top-right of the header
at every sidebar width, and SHALL NOT wrap to a second row or be pushed out of the card. The cluster SHALL be
non-shrinking (`flex: none`) with non-wrapping content (`white-space: nowrap`); the horizontal squeeze SHALL be
absorbed by the folder-name region, which SHALL be shrinkable (`min-width: 0`) and clipped with an ellipsis.

Name truncation SHALL be prioritised so the folder's own name survives longest: the leading parent-path segment
SHALL shrink first and MAY collapse entirely, while the final path segment (the folder name) SHALL retain a
legible minimum before it ellipses.

#### Scenario: All cluster icons remain visible when the sidebar is narrow

- **GIVEN** a folder header rendering the full cluster (urgency sort, add-to-workspace, open-home, pin)
- **WHEN** the sidebar is narrowed to 220 px
- **THEN** every cluster button SHALL remain rendered on one line in the top-right
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
