## MODIFIED Requirements

### Requirement: CI uploads the vitest JSON report on every run
Every `ci.yml` and `nightly-tests.yml` job that runs vitest SHALL produce a vitest JSON report and SHALL upload it as a workflow artifact on success and on failure. This covers each unit shard, the real-process job, the packaging-scenarios job, and the nightly budget job. Artifact names SHALL be unique per job and shard, so a failed or retried timing test is attributable from the run page without log mining. A job that was cancelled before vitest wrote a report MAY upload nothing. A consumer SHALL report any job that the selection expected to run tests and that uploaded no report as having no report, and SHALL NOT treat it as passing. A shard with no assigned files is not expected to upload a report.

In `nightly-tests.yml`, a job rerun in a later attempt SHALL replace its earlier artifact of the same name, so the report reflects the latest attempt. The first attempt's failing tests SHALL survive in a separate attempt summary artifact.

#### Scenario: Artifact present on a red run
- **WHEN** a unit shard fails in CI
- **THEN** an artifact containing that shard's vitest JSON report SHALL be attached to the run

#### Scenario: Artifact present on a green run
- **WHEN** a unit shard passes in CI
- **THEN** the same per-shard artifact SHALL be attached

#### Scenario: Shard artifacts do not collide
- **WHEN** several unit shards run in one workflow run
- **THEN** each SHALL upload under a distinct artifact name and all SHALL be present

#### Scenario: Budget job uploads its report
- **WHEN** the nightly budget job runs, green or red
- **THEN** a `vitest-report-budget` artifact SHALL be attached to the run

#### Scenario: A rerun replaces the shard artifact
- **WHEN** nightly unit shard 2 fails on the first attempt and is rerun
- **THEN** the run SHALL hold one `vitest-report-unit-2` artifact, from the rerun
- **AND** the first attempt's failing tests SHALL remain readable from the attempt summary artifact
