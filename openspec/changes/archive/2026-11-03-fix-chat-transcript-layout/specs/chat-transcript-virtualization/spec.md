## MODIFIED Requirements

### Requirement: Content-aware pre-measure row-height estimate

The virtualizer's pre-measure size estimate for a transcript row SHALL scale with the row's payload rather than being a constant per row type, so that first-paint estimate error is small for large rows. The estimate SHALL be a pure, O(1) function of already-available row data (text length, presence of an image or inline-terminal block, row kind) and MUST NOT re-measure the DOM or walk content blocks on every scroll pass. A tool burst row SHALL be estimated at its collapsed header height regardless of member count or whether it currently renders expanded (running and small, or manually opened); expanded bursts are measured on mount.

#### Scenario: Larger text payload yields a larger estimate
- **WHEN** two rows of the same role differ only in text length
- **THEN** the row with more text SHALL receive a larger pre-measure estimate (monotonic in text length), up to a bounded clamp

#### Scenario: Image-bearing row reserves image height
- **WHEN** a row contains an inline image block
- **THEN** its estimate SHALL include a fixed reserve for the image's capped render height, in addition to its text estimate

#### Scenario: Estimate stays O(1) under windowing
- **WHEN** the virtualizer computes estimates during a scroll
- **THEN** each row's estimate SHALL be derived from precomputed per-row data (text length computed once when the display-row list is built), not by re-walking the row's content blocks per call

#### Scenario: Collapsed burst is estimated at header height
- **GIVEN** a tool burst row that renders collapsed
- **WHEN** the virtualizer estimates it before measurement
- **THEN** the estimate SHALL be the collapsed header height, not an expanded-body height

#### Scenario: Burst estimate is independent of member count and open state
- **GIVEN** tool burst rows with 1, 8 and 47 members, one of them running and rendered expanded
- **WHEN** the virtualizer estimates each before measurement
- **THEN** every estimate SHALL be the same collapsed header height
