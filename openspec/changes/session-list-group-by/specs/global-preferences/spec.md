## ADDED Requirements

### Requirement: Session grouping preferences persisted in preferences
The system SHALL persist three optional fields in `preferences.json`, subject to the same debounced atomic write behavior as the other preferences:

- `defaultGroupBy` — one of `none`, `status`, `location`. Absent means `none`.
- `folderGroupBy` — an object mapping a canonicalized directory path to one of `none`, `status`, `location`. An absent key means the folder follows `defaultGroupBy`.
- `collapsedLanes` — an array of `<canonicalized directory path>::<lane id>` strings. Presence means that lane is collapsed.

Paths SHALL be canonicalized with the same rule used for `collapsedFolders`. Values outside the allowed modes SHALL be rejected on write and dropped on load. The system SHALL NOT remove a `folderGroupBy` or `collapsedLanes` entry on the grounds that no currently loaded session matches its path. Every change SHALL be broadcast to all connected browser clients, and the current values SHALL be sent to a connecting browser before any message that materializes folder groups.

#### Scenario: Set a folder mode
- **WHEN** a client sets `/repo` to `status`
- **THEN** `folderGroupBy` in `preferences.json` SHALL map the canonicalized `/repo` to `status`

#### Scenario: Clear a folder mode
- **WHEN** a client sets `/repo` to "use default"
- **THEN** the canonicalized `/repo` key SHALL be removed from `folderGroupBy`

#### Scenario: Set the default
- **WHEN** a client sets the default grouping to `location`
- **THEN** `defaultGroupBy` in `preferences.json` SHALL be `location`

#### Scenario: Invalid value rejected
- **WHEN** a client sends a group-by mode that is not `none`, `status`, or `location`
- **THEN** the server SHALL NOT change `preferences.json` and SHALL NOT broadcast

#### Scenario: Fields absent in an existing preferences file
- **WHEN** the server starts and `preferences.json` has none of the three fields
- **THEN** the effective default SHALL be `none`, no folder SHALL have an explicit mode, and no lane SHALL be collapsed

#### Scenario: Entry for folder without loaded sessions survives
- **WHEN** `folderGroupBy` holds an entry for a pinned folder with zero sessions and the set of loaded sessions changes
- **THEN** the entry SHALL be retained

#### Scenario: Sent before folder groups materialize
- **WHEN** a browser connects
- **THEN** the grouping preferences SHALL be delivered before the pinned-directory and workspace messages of the connect burst
