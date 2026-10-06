## ADDED Requirements

### Requirement: Use-case linker step
The UI phase SHALL include an optional linker step: one `rsfr-uc-linker` subagent per use-case batch fills `prompts/uc-linker.md`, writes only `diagrams/uc-links/<UC-id>.json`, and is accepted only when `check-uc-links` passes.

#### Scenario: Gate loop
- **WHEN** the linker's record fails `check-uc-links`
- **THEN** the failing lines go back to the same linker and the record is never hand-edited to pass
