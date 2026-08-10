## MODIFIED Requirements

### Requirement: Header icon cluster stays in the top-right at any width

The folder header's trailing action cluster SHALL remain on a single line anchored to the top-right of the header
at every sidebar width, and SHALL NOT wrap to a second row or be pushed out of the card. The cluster SHALL be
non-shrinking (`flex: none`) with non-wrapping content (`white-space: nowrap`); the horizontal squeeze SHALL be
absorbed by the folder-name region, which SHALL be shrinkable (`min-width: 0`) and clipped with an ellipsis.

The status capsule SHALL sit between the folder-name region and the trailing cluster, SHALL itself be
non-shrinking (`flex: none`) with non-wrapping content, and SHALL NOT wrap to a second row. Like the cluster, it
sheds no content under width pressure: the horizontal squeeze is absorbed entirely by the shrinkable folder-name
region, which is the only shrinkable child of the row. This preserves the behaviour of the pill and rollup it
replaces.

Name truncation SHALL be prioritised so the folder's own name survives longest: the leading parent-path segment
SHALL shrink first and MAY collapse entirely, while the final path segment (the folder name) SHALL retain a
legible minimum before it ellipses.

#### Scenario: The cluster control remains visible when the sidebar is narrow

- **GIVEN** a folder header rendering the trailing cluster
- **WHEN** the sidebar is narrowed to 220 px
- **THEN** the folder actions trigger SHALL remain rendered on one line in the top-right
- **AND** the cluster SHALL NOT wrap to a second row

#### Scenario: Capsule survives narrowing intact; the name absorbs the squeeze

- **GIVEN** a folder header rendering a capsule with needs-you, error, working and idle segments
- **WHEN** the sidebar is narrowed to 220 px
- **THEN** every rendered segment SHALL remain rendered
- **AND** the capsule SHALL NOT wrap to a second row
- **AND** the folder-name region SHALL absorb the reduction by truncating

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
