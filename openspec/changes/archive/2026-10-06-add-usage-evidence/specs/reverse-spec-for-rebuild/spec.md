## ADDED Requirements

### Requirement: Usage mapper step
The UI phase SHALL include an optional usage step: an `rsfr-usage-mapper` subagent fills `prompts/usage-mapper.md`, writes only `diagrams/usage/mapping.json`, never reads more of a snapshot than the draft's type list, and is accepted only when `check-usage` passes.

#### Scenario: Gate loop
- **WHEN** the mapping fails `check-usage`
- **THEN** the failing lines go back to the mapper and the record is never hand-edited to pass
