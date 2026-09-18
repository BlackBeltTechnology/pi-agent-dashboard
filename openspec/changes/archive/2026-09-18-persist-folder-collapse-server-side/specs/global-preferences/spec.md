## ADDED Requirements

### Requirement: Collapsed folders persisted in preferences
The system SHALL persist `collapsedFolders` as a JSON array of canonicalized
directory paths in `preferences.json`, alongside `pinnedDirectories` and
`sessionOrder`. A path present in the array means that folder group is
collapsed; absence means expanded. The array SHALL be subject to the same
debounced atomic write behavior as the other preferences, and SHALL be
broadcast to connected browser clients whenever it changes, so that every open
dashboard converges on the same state.

#### Scenario: Collapse a folder
- **WHEN** a client reports a folder as collapsed
- **THEN** the canonicalized directory path SHALL be added to the `collapsedFolders` array in `preferences.json`

#### Scenario: Expand a folder
- **WHEN** a client reports a folder as expanded
- **THEN** the canonicalized directory path SHALL be removed from the `collapsedFolders` array in `preferences.json`

#### Scenario: Field absent in an existing preferences file
- **WHEN** the server starts and `preferences.json` exists but has no `collapsedFolders` field
- **THEN** the system SHALL treat it as an empty array rather than failing to load the file

#### Scenario: Change broadcast to open clients
- **WHEN** `collapsedFolders` changes
- **THEN** the updated array SHALL be broadcast to connected browser clients

#### Scenario: Delivered on connect
- **WHEN** a browser client connects
- **THEN** the current `collapsedFolders` array SHALL be delivered to that client as part of its initial state, without waiting for a subsequent change

#### Scenario: Paths stored as given, not symlink-resolved
- **WHEN** a collapsed folder path is stored or read back
- **THEN** it SHALL be normalized only by the shared path-key rule and SHALL NOT be symlink-resolved, so that it still matches the path a client can compute locally
