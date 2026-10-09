## MODIFIED Requirements

### Requirement: The expanded inspector SHALL show the in-progress block

The expanded and popout subagent views SHALL render the in-progress block as a trailing entry after the finished timeline entries, styled like the main chat's live thinking or text block, and SHALL replace it with the finished entry once the block ends. When the producer streams block deltas, the entry SHALL show the full block assembled so far and grow as pieces arrive. Otherwise it SHALL show the current `liveTail`. The collapsed card's one-line ticker SHALL keep using `liveTail`.

#### Scenario: In-progress entry visible before resync
- **WHEN** the inspector is open and a tick carries `liveTail`, but no resync has delivered new entries
- **THEN** the trailing in-progress entry shows the tail text

#### Scenario: Live entry suppresses the empty state
- **WHEN** a running subagent has no finished entries and a non-empty in-progress block
- **THEN** the inspector shows the in-progress entry and does not show "No detail available yet"

#### Scenario: Block grows beyond the tail length
- **GIVEN** a producer streaming block deltas
- **WHEN** a thinking block reaches 1,500 characters
- **THEN** the inspector's in-progress entry shows all 1,500 characters from the block start, not a 280-character window
