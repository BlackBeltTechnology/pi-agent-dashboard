## ADDED Requirements

### Requirement: Session card activity indicator names a failed run

When a session is idle or active and has an unresolved error (`hasError`), every activity indicator the card renders (the desktop status row and the mobile card's line 2) SHALL read "Failed" with the error glyph instead of "Idle", agreeing with the error status shape and the `error` status lane. Resuming, ended, needs-you, retry, current-tool and streaming labels SHALL keep their precedence over it. An ended session SHALL keep its ended-reason pill.

#### Scenario: Idle session with an error reads Failed
- **GIVEN** a session with `status: "idle"` and `hasError` true
- **WHEN** the card renders
- **THEN** the activity indicator SHALL read "Failed" with the error glyph
- **AND** SHALL NOT read "Idle"

#### Scenario: Mobile card line 2 reads Failed
- **GIVEN** a session with `status: "idle"` and `hasError` true
- **WHEN** the mobile card renders
- **THEN** its line-2 activity indicator SHALL read "Failed" with the error glyph and SHALL NOT read "Idle"
#### Scenario: Retry outranks Failed
- **GIVEN** a session with `hasError` true and `retryState` at attempt 2
- **THEN** the activity indicator SHALL read `Retry 2`

#### Scenario: Streaming outranks Failed
- **GIVEN** a session with `status: "streaming"` and a stale `hasError` true
- **THEN** the activity indicator SHALL read the thinking label, not "Failed"

#### Scenario: Ended session keeps its reason pill
- **GIVEN** a session with `status: "ended"`, `closedReason: "process_gone"` and `hasError` true
- **THEN** the activity indicator SHALL be the ended-reason pill, not "Failed"
