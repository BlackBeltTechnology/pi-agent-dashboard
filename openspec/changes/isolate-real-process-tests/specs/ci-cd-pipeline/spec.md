## ADDED Requirements

### Requirement: CI uploads the vitest JSON report on every run
The `ci.yml` unit-test step SHALL produce a vitest JSON report and upload it as a workflow artifact on success and failure alike, so a failed or retried timing test is attributable from the run page without log mining.

#### Scenario: Artifact present on a red run
- **WHEN** `pnpm test` fails in CI
- **THEN** an artifact containing the vitest JSON report SHALL be attached to the run

#### Scenario: Artifact present on a green run
- **WHEN** `pnpm test` passes in CI
- **THEN** the same artifact SHALL be attached
