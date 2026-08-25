## ADDED Requirements

### Requirement: The open-inspector pull path SHALL be verified against a watched, growing timeline

The parent change's cadence is asserted only at the hook level. A mounted
inspector watching a RUNNING subagent SHALL be shown to converge on the rendered
timeline, and the cost of that pull SHALL be measured against the push traffic it
replaced.

#### Scenario: A mounted inspector converges on a growing timeline

- **GIVEN** a subagent that stays running long enough to be observed
- **AND** its inspector is mounted before the timeline grows
- **WHEN** the timeline grows from 5 to 30 entries
- **THEN** the RENDERED entry count converges to 30
- **AND** no close/reopen of the inspector is required

#### Scenario: The cadence costs no more than the push it replaced

- **GIVEN** the same workload with N inspectors held open
- **WHEN** resync replies/s and per-subscriber reply bytes/s are measured
- **THEN** the reply byte rate SHALL NOT exceed the push byte rate the strip removed
- **AND** exceeding it SHALL trigger the D4 v2 escalation rather than a cadence tweak

#### Scenario: The inspector-open share is measured representatively

- **GIVEN** a workload in which inspectors ARE opened during subagent runtime
- **WHEN** the inspector-open share of subagent runtime is read
- **THEN** the recorded number SHALL come from that watched workload, not from an unwatched run
- **AND** a share above 50 % SHALL be reported as the C4 kill-switch condition

### Requirement: The crash-without-terminal-frame regression SHALL be pinned

A run that terminates without emitting a terminal frame SHALL replay as scalar
state with no mid-run timeline, and the render SHALL be neither corrupt nor
blank. The parent change documents this regression but leaves it unexercised,
which is how a documented regression quietly becomes an undocumented one.

#### Scenario: pi killed mid-run, session replayed

- **GIVEN** a subagent running with an accumulated timeline
- **WHEN** the pi process is killed before any terminal frame is emitted
- **AND** the session is replayed afterwards
- **THEN** the subagent renders its scalar state
- **AND** no mid-run timeline is shown
- **AND** the render is neither corrupt nor blank
