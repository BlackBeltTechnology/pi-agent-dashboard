## MODIFIED Requirements

### Requirement: GitHub Pages deployment via GitHub Actions

The repository SHALL deploy the marketing site to GitHub Pages using the modern `actions/deploy-pages` workflow, without using a `gh-pages` branch. The published Pages artifact SHALL contain both the marketing site at the apex and the neutral shell at the `/app/` subpath.

A push path filter SHALL remain the fast path, but SHALL NOT be the only path. Every published artifact SHALL carry a marker naming the `develop` commit it was built from; the deploy workflow SHALL therefore publish only from `refs/heads/develop`, and a run on any other ref (e.g. a manual dispatch from a feature branch) SHALL skip its build and deploy jobs without publishing. The repository SHALL additionally run a daily scheduled staleness check (also manually dispatchable), in a workflow separate from the deploy workflow, that reads the marker from the live site and compares it against the most recent `develop` commit touching the deploy's own path set; the live site is current when that commit is an ancestor of (or equal to) the marker commit. When the live site is not current — or the marker is missing, unreachable, or names an unknown commit — the check SHALL dispatch the deploy workflow against `develop` and SHALL emit a warning stating that it is correcting a missed deploy — unless a run of the deploy workflow is already queued or in progress, in which case it SHALL NOT dispatch (so it never cancels that run through the deploy concurrency group) and SHALL leave correction to its next interval. When the query for queued or in-progress deploy runs itself fails, the check SHALL NOT dispatch, SHALL emit a notice naming the failure, and SHALL complete without failure, leaving correction to its next interval. When the dispatch request is rejected, the check SHALL fail. The check SHALL NOT deploy itself, SHALL NOT join the deploy workflow's concurrency group, SHALL hold no Pages or id-token permission, and SHALL NOT restore a dependency cache. A deploy that a push should have triggered but did not SHALL therefore be corrected within one day.

#### Scenario: Deploy workflow triggers on site or shell changes

- **GIVEN** a commit to `develop` that modifies any file under `site/**` (excluding the `site/design-scratch/**` design-source sandbox, which is filtered out), under `packages/shell/**`, or the deploy workflow itself
- **WHEN** the workflow runs
- **THEN** it builds the site, uploads the output as a Pages artifact, and deploys it via `actions/deploy-pages`

#### Scenario: Deploy workflow can be run manually

- **GIVEN** a maintainer needs to redeploy without a source change
- **WHEN** they trigger `workflow_dispatch` on the site-deploy workflow against `develop`
- **THEN** the workflow runs to completion and publishes the current `develop` content

#### Scenario: Custom domain is active

- **GIVEN** `site/public/CNAME` contains `pi-dashboard.dev`
- **WHEN** the Pages artifact is deployed
- **THEN** the site SHALL be served from `https://pi-dashboard.dev` rather than a
  `username.github.io/pi-agent-dashboard` path

#### Scenario: Shell is composed into the artifact under /app

- **GIVEN** a deploy run that has built the marketing site into `site/dist/`
- **WHEN** the workflow builds `packages/shell` and copies its output
- **THEN** the shell's built files SHALL land in `site/dist/app/` before the Pages artifact is
  uploaded, so a single artifact serves the apex and `/app/`

#### Scenario: A missed push trigger is corrected by the scheduled check

- **GIVEN** a commit on `develop` changed the site but no deploy run was created for it
- **WHEN** the scheduled staleness check next runs
- **THEN** it SHALL find that the live marker commit does not contain that site change
- **AND** it SHALL dispatch the deploy workflow against `develop`
- **AND** its run SHALL carry a warning stating that it is correcting a missed deploy

#### Scenario: An up-to-date site is not redeployed

- **GIVEN** the live marker commit contains the most recent site-relevant `develop` commit
- **WHEN** the scheduled staleness check runs
- **THEN** it SHALL complete without dispatching a deploy
- **AND** it SHALL NOT report a failure

#### Scenario: A missing marker is treated as stale

- **GIVEN** the live site serves no readable marker
- **WHEN** the scheduled staleness check runs
- **THEN** it SHALL dispatch the deploy workflow and warn that the marker was unavailable

#### Scenario: The check does not cancel an in-flight deploy

- **GIVEN** a deploy-workflow run is queued or in progress
- **WHEN** the scheduled staleness check finds the live site stale
- **THEN** it SHALL NOT dispatch a deploy
- **AND** the in-flight run SHALL NOT be cancelled
- **AND** the check SHALL complete without failure, leaving correction to its next interval

#### Scenario: An unreadable run list does not dispatch

- **GIVEN** the live site is stale
- **AND** the query for queued or in-progress deploy runs fails
- **WHEN** the scheduled staleness check runs
- **THEN** it SHALL NOT dispatch a deploy
- **AND** it SHALL emit a notice naming the failed query and complete without failure

#### Scenario: A rejected dispatch turns the check red

- **GIVEN** the live site is stale and no deploy run is queued or in progress
- **WHEN** the dispatch of the deploy workflow is rejected
- **THEN** the staleness check run SHALL fail

#### Scenario: A dispatch from a non-develop ref publishes nothing

- **WHEN** the deploy workflow is dispatched against a ref other than `develop`
- **THEN** its build and deploy jobs SHALL be skipped
- **AND** the live marker SHALL continue to name a `develop` commit
