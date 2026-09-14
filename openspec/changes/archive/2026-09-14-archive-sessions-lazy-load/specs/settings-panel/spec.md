## ADDED Requirements

### Requirement: Sessions page exposes archive threshold and sweep interval
The Sessions page SHALL render, in its "Session list" section, a numeric field for `sessionList.archiveAfterDays` (min 0, default 30, unit "days", hint that 0 disables auto-archive) and a numeric field for `sessionList.archiveSweepIntervalMinutes` (min 1, default 60, unit "min"). Both SHALL buffer into the settings draft and persist through the config write endpoint with the shared Save bar.

#### Scenario: Fields render with defaults
- **WHEN** the Sessions page opens with no `sessionList` config present
- **THEN** the archive-after field SHALL show `30` and the sweep-interval field SHALL show `60`

#### Scenario: Save persists values
- **WHEN** the user sets archive-after to `14` and saves
- **THEN** the config write endpoint SHALL receive `sessionList.archiveAfterDays = 14` and the page SHALL no longer be dirty

#### Scenario: Validation
- **WHEN** the user enters `-1` for archive-after or `0` for sweep-interval
- **THEN** the field SHALL show a validation error and Save SHALL be disabled
