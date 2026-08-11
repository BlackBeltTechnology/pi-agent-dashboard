## ADDED Requirements

### Requirement: A bandwidth reduction SHALL preserve a live-looking subagent cadence

Any reduction of `tool_execution_update` wire traffic SHALL hold the rendered
subagent timeline at or above a declared minimum cadence, and that minimum SHALL
be stated as a number, not left implicit in an emitter's default.

Rationale: the collapse in `collapse-superseded-tool-execution-updates` is
retention-only precisely so the live stream stays intact. Throttling the wire
re-opens the question that change closed, so the guarantee must be restated
where the throttle lives.

#### Scenario: Throttled ticks still advance the rendered timeline

- **GIVEN** a subagent running continuously for at least 10 s
- **AND** bridge tick throttling active
- **WHEN** the rendered subagent timeline is observed over that window
- **THEN** it SHALL advance at or above the declared minimum cadence
- **AND** the browser SHALL receive at least 2 `tool_execution_update` frames,
  so the existing F4 scenario remains non-vacuous

#### Scenario: The throttle never suppresses the terminal state

- **GIVEN** a subagent whose final tick carries its completed state
- **WHEN** the throttle coalesces or drops intermediate ticks
- **THEN** the terminal state SHALL still reach the client
- **AND** a page reload SHALL fold to that same terminal state
