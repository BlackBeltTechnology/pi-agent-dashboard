## ADDED Requirements

### Requirement: The pi-requiring browser-E2E configurations each have a variant leg

`.github/workflows/ci-e2e-browser.yml` SHALL carry two variant-harness jobs, `e2e-team` and `e2e-identity-matrix`, that run the team configuration (`playwright.team.config.ts`) and the identity-matrix configuration (`playwright.identity-matrix.config.ts`) respectively. Each job SHALL use the shard matrix's job-level gate and its `continue-on-error` expression verbatim, so it runs exactly when the shard matrix runs and is advisory exactly where the shard matrix is; this requirement adds no trigger to the workflow. Each job SHALL install the `pi` CLI at the exact version the Docker harness image (`docker/Dockerfile`) pins — the single source of truth, not the package manifests' compatibility floor — rather than a floating latest. Each job SHALL build what its configuration needs before running specs, as explicit workflow steps rather than relying on package-manager pre-scripts: the web client for both, and additionally the team app for the team configuration. Each job SHALL run Playwright with an HTML reporter and upload that report as its own artifact (`playwright-report-team`, `playwright-report-identity-matrix`) on every outcome, including failure; the variant legs SHALL NOT be added to the merged shard report (`merge-report` keeps depending on the shard matrix and the browser-relay leg only), so a variant leg cannot break the merge.

A repo-lint test SHALL assert that both jobs exist, carry the shard matrix's gate and `continue-on-error` expression, install `pi` at the Dockerfile's pinned version, run their build steps before the Playwright step, upload their own HTML report, and declare `timeout-minutes`, so removing or weakening a leg is a lint failure rather than a silent coverage loss.

#### Scenario: The pi-requiring configurations each have a leg
- **WHEN** the shard matrix of the browser-E2E workflow runs
- **THEN** one job SHALL run the team configuration and one job SHALL run the identity-matrix configuration
- **AND** each SHALL install the `pi` CLI and build its prerequisites before running specs

#### Scenario: A red variant leg on a labelled PR does not block the merge
- **WHEN** a variant leg fails on a pull-request run
- **THEN** the job SHALL be `continue-on-error` on that run, as the shard matrix is

#### Scenario: The pi version is pinned to the harness image
- **WHEN** a `pi`-installing leg resolves the version to install
- **THEN** it SHALL use the version `docker/Dockerfile` pins
- **AND** the repo-lint test SHALL fail when the workflow literal and the Dockerfile literal differ

#### Scenario: Each variant leg publishes its own report
- **WHEN** a variant leg finishes, pass or fail
- **THEN** its HTML report SHALL be uploaded under its own artifact name
- **AND** the merged shard report job SHALL NOT depend on the variant legs

#### Scenario: Removing a variant leg fails lint
- **WHEN** the `e2e-team` or `e2e-identity-matrix` job is deleted from the workflow
- **THEN** the repo-lint test SHALL fail naming the missing job id
