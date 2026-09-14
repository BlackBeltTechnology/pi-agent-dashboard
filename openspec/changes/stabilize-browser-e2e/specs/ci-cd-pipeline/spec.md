## ADDED Requirements

### Requirement: Sharded browser-E2E workflow runs on schedule, dispatch, and label

The project SHALL have a GitHub Actions workflow (`.github/workflows/ci-e2e-browser.yml`) that runs the `tests/e2e/` browser suite against the Docker harness on: `workflow_dispatch`; a nightly `schedule`; and `pull_request` targeting `develop` only when the PR carries the `e2e-browser` label. The workflow SHALL split the suite into a fixed number of shards, each shard on its own runner booting its own harness in managed mode, with a per-job time limit. Each shard SHALL upload a blob report and a final job SHALL merge them into one HTML report artifact. The workflow SHALL be advisory: it SHALL NOT be a required status check, and the label-triggered PR run SHALL be `continue-on-error`. Concurrency SHALL be grouped per ref with in-progress runs cancelled.

#### Scenario: Nightly run shards the suite
- **WHEN** the schedule fires on `develop`
- **THEN** N shard jobs SHALL run in parallel, each invoking `playwright test --shard=<i>/<N>`
- **AND** each job SHALL boot its harness with `docker/test-up.sh` and tear it down with `docker/test-down.sh` regardless of outcome

#### Scenario: Unlabelled PR does not run the suite
- **WHEN** a pull request without the `e2e-browser` label is opened against `develop`
- **THEN** no `ci-e2e-browser` job SHALL run

#### Scenario: Labelled PR runs advisory
- **WHEN** the `e2e-browser` label is added to a pull request
- **THEN** the workflow SHALL run and a red shard SHALL NOT block the merge

#### Scenario: Merged report is published
- **WHEN** every shard job completes
- **THEN** one artifact SHALL contain the merged HTML report covering every shard

### Requirement: Repo-lint pins the browser-E2E workflow contract

A repo-lint test SHALL assert that `ci-e2e-browser.yml` declares the three triggers, the label gate, per-job `timeout-minutes`, a shard matrix whose size equals the `--shard` denominator in the run step, the always-teardown step, and no `push` trigger, so the cadence cannot drift silently.

#### Scenario: Removing the always-teardown step fails lint
- **WHEN** the `if: always()` teardown step is removed
- **THEN** the repo-lint test SHALL fail naming the workflow
