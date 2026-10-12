## ADDED Requirements

### Requirement: Tool row duration prefers pi's recorded execution time

When a top-level `tool_execution_end` (one without a `parentToolCallId`) carries a finite, non-negative number `durationMs` (pi ≥ 1.1.0: the monotonic time `execute()` took), the reducer SHALL set the tool row's `duration` to that value. Otherwise it SHALL keep deriving `duration` from the event timestamps (end minus the row's `startedAt`), and leave it undefined when there is no start time. Transcript replay SHALL copy a tool-result message's `durationMs`, under the same guard, onto the `tool_execution_end` it synthesizes, so a reloaded session shows the same duration as the live one. A nested tool event SHALL keep following the nested-call rules, including its live span.

#### Scenario: Recorded duration wins over timestamps
- **WHEN** a tool row started at timestamp `1000` and its `tool_execution_end` arrives at timestamp `5000` with `durationMs: 1200`
- **THEN** the row's `duration` SHALL be `1200`

#### Scenario: Older pi falls back to timestamps
- **WHEN** the `tool_execution_end` has no `durationMs`, the row started at `1000` and the end arrives at `5000`
- **THEN** the row's `duration` SHALL be `4000`

#### Scenario: Invalid durationMs is ignored
- **WHEN** the `tool_execution_end` carries `durationMs` of `-5` or `"1200"`
- **THEN** the row's `duration` SHALL come from the timestamps

#### Scenario: Replay keeps the recorded duration
- **WHEN** a session is replayed from a transcript whose tool-result message has `durationMs: 850`
- **THEN** the synthesized `tool_execution_end` SHALL carry `durationMs: 850` and the row's `duration` SHALL be `850`
