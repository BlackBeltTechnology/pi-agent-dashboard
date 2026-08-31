# markdown-knowledge-base — delta

## ADDED Requirements

### Requirement: The `doc_type` lane trade-off SHALL be discoverable from the tool schema
`kb_search` SHALL describe its `doc_type` parameter in the tool schema and SHALL carry a prompt guideline stating which lane suits which question, because the correct value is query-dependent and measurably harmful when chosen wrongly.

#### Scenario: Parameter carries a description
- **WHEN** the `kb_search` tool schema is registered
- **THEN** the `doc_type` parameter SHALL carry a description naming the lane trade-off
- **AND** the description SHALL NOT recommend a single value unconditionally

#### Scenario: Guideline distinguishes the two lanes
- **WHEN** an agent reads the `kb_search` prompt guidelines
- **THEN** they SHALL state that a file or symbol lookup uses `doc_type` of `agents`
- **AND** they SHALL state that a conceptual or how-does-X query leaves `doc_type` unset

### Requirement: The reserved agents lane SHALL be able to contest rank 1
The lane interleave SHALL be able to place a reserved-lane candidate at the first result slot, not only earn share further down the page, so the per-file record can lead a file-lookup result set.

#### Scenario: Competitive agents candidate leads the page
- **WHEN** a query's best `agents` candidate is competitive with the best unrestricted candidate and the lane policy is enabled
- **THEN** the `agents` candidate MAY occupy result slot 1

#### Scenario: Lane policy is configurable
- **WHEN** the rank-1 lane policy is disabled in config
- **THEN** interleaving SHALL behave exactly as before the change

#### Scenario: An explicit doc_type still wins
- **WHEN** a caller passes an explicit `doc_type`
- **THEN** the reserved-lane policy SHALL NOT override that restriction

### Requirement: Lane changes SHALL be justified against both golden sets
A lane-composition default SHALL NOT be adopted on single-fixture evidence, because the two lanes trade off against each other.

#### Scenario: Both fixtures reported together
- **WHEN** a lane-composition default is proposed
- **THEN** source-intent and markdown-intent metrics SHALL both be recorded
- **AND** a gain in one lane paired with an unreported regression in the other SHALL NOT be accepted as evidence
