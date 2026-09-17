## ADDED Requirements

### Requirement: Memory fields on the Sessions and Server pages

The settings panel SHALL expose the heap configuration: the `sessionHeap` fields
on the Sessions page and the `serverHeap` field on the Server page.

Both top-level keys SHALL be registered in the settings field-to-page mapping,
and the save payload computation SHALL include them, so a change is attributed
to the right page and is actually persisted.

Each field SHALL state the unit (megabytes) and its effective default.

#### Scenario: Session heap edit is attributed to the Sessions page
- **WHEN** the operator edits `sessionHeap.maxOldSpaceMb`
- **THEN** the unsaved-changes indicator SHALL attribute the change to the Sessions page

#### Scenario: Server heap edit is attributed to the Server page
- **WHEN** the operator edits `serverHeap.maxOldSpaceMb`
- **THEN** the unsaved-changes indicator SHALL attribute the change to the Server page

#### Scenario: Heap edits survive save
- **WHEN** the operator changes a heap field and saves
- **THEN** the save payload SHALL include the changed key
- **AND** reloading the settings panel SHALL show the saved value

### Requirement: Heap fields state when they take effect

Each heap field SHALL tell the operator when a change becomes effective, because
neither field applies to anything already running.

The session fields SHALL indicate that they apply to sessions started after the
change. The server field SHALL indicate that it requires a cold start and does
not take effect on an in-place restart.

#### Scenario: Session field states its boundary
- **WHEN** the operator views the session heap fields
- **THEN** the panel SHALL state that the value applies to newly started sessions

#### Scenario: Server field states the cold-start requirement
- **WHEN** the operator views the server heap field
- **THEN** the panel SHALL state that a cold start is required

### Requirement: Out-of-range heap input is refused at entry

The panel SHALL refuse a `maxOldSpaceMb` value below the supported floor of
`64`, and SHALL warn on a value above `8192` rather than refusing it.

Refusal at entry SHALL NOT be the only protection: an out-of-range value that
reaches the config by any other route still falls back to the default at load
time.

#### Scenario: Below-floor entry is refused
- **WHEN** the operator enters `16` for a `maxOldSpaceMb` field
- **THEN** the panel SHALL refuse the value and explain the floor

#### Scenario: Unusually large entry is warned, not blocked
- **WHEN** the operator enters a value above `8192`
- **THEN** the panel SHALL warn
- **AND** the value SHALL remain saveable
