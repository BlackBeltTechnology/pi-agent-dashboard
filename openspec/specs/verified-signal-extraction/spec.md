# verified-signal-extraction Specification

## Purpose
TBD - created by archiving change distill-session-knowledge. Update Purpose after archive.
## Requirements
### Requirement: Extract five signal classes anchored on verification

The miner SHALL detect five signal classes from segmented trajectories — tool-usage
faults/corrections, ask_user decisions, user corrections, multi-step procedures, and
recurring documentation summaries — and SHALL admit a candidate only when its span ends
in a verified-good state (an `isError` flip true→false on the same tool, a passing check
such as test/lint exit 0, or a following user confirmation). Spans without a verified-good
terminal state SHALL be dropped.

#### Scenario: Fault-fix pair detected

- **WHEN** a `toolResult` has `isError=true` followed by a retry of the same tool with `isError=false`
- **THEN** the miner SHALL emit a fault candidate `{wrongCall, error, fixCall}`

#### Scenario: Non-recovering error ignored

- **WHEN** a `toolResult` has `isError=true` with no subsequent flip to `isError=false`
- **THEN** the miner SHALL NOT emit a fault candidate

#### Scenario: ask_user decision captured

- **WHEN** a `toolCall name=ask_user` is followed by its `toolResult`
- **THEN** the miner SHALL emit a decision candidate `{question, answer}`

#### Scenario: Procedure candidate gated by length and verification

- **WHEN** an episode contains more than five toolCalls and ends in a verified-good state
- **THEN** the miner SHALL emit a procedure candidate
- **AND** a shorter or unverified span SHALL NOT produce one

#### Scenario: User correction captured after an assistant action

- **WHEN** a `user` message matching the correction lexicon follows an assistant action
- **THEN** the miner SHALL emit a correction candidate `{correction, precededBy, rule}`
- **AND** a correction that establishes a reusable rule SHALL set `rule=true`

#### Scenario: Documentation candidate deferred to recurrence

- **WHEN** an assistant turn contains a recurring summary (headings/bullets)
- **THEN** the miner SHALL emit a documentation candidate anchored on cross-session frequency
- **AND** the verification gate SHALL retain it for the recurrence gate rather than dropping it

