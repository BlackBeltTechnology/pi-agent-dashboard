## ADDED Requirements

### Requirement: Variability classifier step
The UI phase SHALL include an optional variability step: `rsfr-variability-classifier` subagents, one per config-key batch, fill `prompts/variability-classifier.md`, write only `diagrams/variability/` records, and are accepted only when `check-variability` passes.

#### Scenario: Gate loop
- **WHEN** the record fails `check-variability`
- **THEN** the failing lines go back to the classifier and the record is never hand-edited to pass
