# CI/CD Pipeline

## ADDED Requirements

### Requirement: Nightly Knip pass reports, it does not gate

The whole-graph Knip scan SHALL run in the nightly workflow rather than the
per-PR `ci.yml`, so its runtime never sits on the PR path. Nightly runs after
merge and therefore SHALL be described as detection, not prevention; the
preventive gate lives in the `ship-it` enforcer step under `code-quality-loop`.

#### Scenario: Nightly runs Knip

- **WHEN** the nightly workflow executes
- **THEN** a Knip job runs the whole-graph scan
- **AND** its per-class counts are recorded in the job output

#### Scenario: PR CI does not run Knip

- **WHEN** `ci.yml` executes for a pull request
- **THEN** no Knip job runs

#### Scenario: Nightly regression is visible

- **WHEN** the nightly Knip job finds a class above its baseline
- **THEN** the job fails so the regression is visible in the nightly report
- **AND** the failure names the class and the delta

### Requirement: Knip available in the Docker harness

The Docker harness SHALL be able to run the Knip pass, so dead-code checks are
reproducible in the same container used for other harness verification.

#### Scenario: Harness runs Knip

- **WHEN** the Knip pass is invoked inside the Docker harness
- **THEN** it completes and produces the same per-class counts as a host run
