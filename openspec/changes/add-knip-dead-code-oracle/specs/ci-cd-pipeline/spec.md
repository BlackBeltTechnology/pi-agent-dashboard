# CI/CD Pipeline

## ADDED Requirements

### Requirement: Nightly Knip pass

The whole-graph Knip scan SHALL run in the nightly workflow rather than the
per-PR `ci.yml`, so its runtime and batched findings never sit on the PR path.

#### Scenario: Nightly runs Knip

- **WHEN** the nightly workflow executes
- **THEN** a Knip job runs the whole-graph scan
- **AND** its findings are recorded in the job output

#### Scenario: PR CI does not run Knip

- **WHEN** `ci.yml` executes for a pull request
- **THEN** no Knip job runs

#### Scenario: Advisory job does not fail nightly

- **WHEN** the Knip job reports findings while the baseline is not yet clean
- **THEN** the job is marked successful via `continue-on-error`
- **AND** the nightly workflow conclusion is unaffected

### Requirement: Knip available in the Docker harness

The Docker harness SHALL be able to run the Knip pass, so dead-code checks are
reproducible in the same container used for other harness verification.

#### Scenario: Harness runs Knip

- **WHEN** the Knip pass is invoked inside the Docker harness
- **THEN** it completes and produces the same finding classes as a host run
