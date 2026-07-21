# session-identity Delta Specification

## ADDED Requirements

### Requirement: Same-id resume wipe-skip tolerates pi setup-entry count drift
When a bridge re-registers an existing sessionId, the server's decision to skip the event-store wipe SHALL tolerate a bounded difference between the bridge-reported `eventCount` and the last known entry count, to account for pi's auto-appended setup entries (`model_change`, `thinking_level_change`) on session start. The wipe SHALL be skipped only when the store already holds events AND the count delta is within the bounded setup-entry allowance; otherwise the server SHALL wipe and reset as before.

#### Scenario: Unchanged transcript resume skips the wipe
- **WHEN** a session is resumed and the bridge reports an `eventCount` that differs from the stored `lastEntryCount` only by the bounded setup-entry allowance
- **AND** the event store already holds events for that session
- **THEN** the server SHALL skip `deleteEventsForSession` and SHALL NOT broadcast a session state reset
- **AND** replayed entries SHALL NOT be re-inserted into the store

#### Scenario: Resume after new turns wipes and refills
- **WHEN** a session is resumed and the bridge-reported `eventCount` differs from the stored count by more than the setup-entry allowance
- **THEN** the server SHALL wipe the event store for that session and broadcast a state reset
- **AND** SHALL accept the replayed tail as the new store contents

#### Scenario: Empty store always full-loads
- **WHEN** a session re-registers and the event store holds no events for it
- **THEN** the server SHALL NOT skip the wipe path and SHALL populate the store from the replay regardless of the count delta
