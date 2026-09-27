## ADDED Requirements

### Requirement: Collapsible lanes inside a folder group
When a folder group renders lanes (per the `session-list-group-by` capability), each lane header SHALL carry a chevron toggle (▸ collapsed, ▾ expanded) and SHALL toggle that lane's cards independently of the folder's own collapse state. Lanes SHALL default to expanded. Lane collapse SHALL use the same collapse animation as folder groups. Lane collapse state SHALL be persisted server-side, keyed by the folder's canonical collapse key plus the lane id, so it is shared across browsers and devices. Collapsing the folder SHALL hide all its lanes; expanding the folder SHALL restore each lane's own persisted state.

A collapsed `location` lane header SHALL show a status rollup of its hidden sessions using the same segments, shapes, and tokens as the folder status capsule. A collapsed `status` lane header SHALL show only its count, since all its sessions share one status.

#### Scenario: Collapse a lane
- **WHEN** the user clicks the "Working" lane header chevron in folder `/repo`
- **THEN** the lane's cards SHALL animate closed and the chevron SHALL change to ▸
- **AND** the collapsed state SHALL persist across reload and across browsers

#### Scenario: Folder collapse overrides, lane state is kept
- **WHEN** the "Idle" lane of `/repo` is collapsed and the user collapses and then expands `/repo`
- **THEN** after expanding, the "Idle" lane SHALL still be collapsed and other lanes SHALL be expanded

#### Scenario: Lane default state
- **WHEN** a lane renders for the first time with no persisted state
- **THEN** it SHALL be expanded

#### Scenario: Lane state survives a mode switch
- **WHEN** the "Working" lane of `/repo` is collapsed, the user switches `/repo` to `location`, and later back to `status`
- **THEN** the "Working" lane SHALL render collapsed again
