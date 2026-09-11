## MODIFIED Requirements

### Requirement: Below-floor candidates are shown but not selectable
The dashboard SHALL render candidates that fail the compatibility floor, with
the reason, and SHALL refuse to select them. Because `piCompatibility.minimum`
now tracks the pinned runtime in lockstep, a candidate one patch release behind
the pin is below the floor and SHALL be treated exactly like any other
below-floor candidate — shown, reasoned, and unselectable. The floor SHALL NOT
be softened for near-pin candidates.

#### Scenario: Below-floor candidate is disabled with a reason
- **WHEN** a candidate's version is below `piCompatibility.minimum`
- **THEN** its row SHALL render in a disabled state naming the required minimum
  and stating that the bridge extension will not load
- **AND** selecting it SHALL have no effect on either consumer

#### Scenario: Previously-supported pi becomes unselectable after the lockstep raise
- **GIVEN** a machine with a discoverable pi install in the `0.78.x`–`0.84.x`
  range that was selectable before the floor was raised
- **WHEN** `GET /api/pi/installs` is called after the floor moves to the pinned
  version
- **THEN** that candidate SHALL still be enumerated rather than omitted
- **AND** it SHALL be flagged as not meeting the floor, naming the required
  minimum version
- **AND** it SHALL be unselectable

#### Scenario: Unknown-version candidate is still not floor-failed
- **WHEN** a candidate resolves to an executable with no readable package version
- **THEN** the lockstep floor SHALL NOT cause it to be flagged as failing the
  floor
- **AND** it SHALL remain selectable with its existing unknown-version warning
