## MODIFIED Requirements

### Requirement: A scheduled nightly build SHALL verify the full release round-trip with zero public npm writes

The project SHALL provide a `nightly.yml` workflow triggered on a daily `cron` and on `workflow_dispatch`. The cron SHALL be active (not commented out); the land-dark rollout of change `add-nightly-verdaccio-build` is complete. It SHALL publish every non-private workspace to an ephemeral private registry (Verdaccio) and build the full Electron installer matrix against that registry, so the publish→install→bundle→run path is exercised without writing to npmjs.com.

No other run (a dispatched run, or a manual re-run of an older run) SHALL be able to cancel a scheduled `nightly.yml` run, hold it pending through a concurrency group, replace it, or cancel or skip its `report` job. Queueing caused by the runner limits of the account is outside the workflow and outside this rule.

The zero-public-write rule SHALL hold for every job in `nightly.yml` and for every reusable workflow it calls: no `npm publish` to a non-loopback registry, no GitHub Release, no tag push and no version-bump commit.

#### Scenario: Nightly runs on schedule and on demand

- **GIVEN** the `nightly.yml` workflow
- **WHEN** the daily `cron` fires **OR** a maintainer triggers `workflow_dispatch`
- **THEN** the workflow SHALL resolve a throwaway version `<base>-nightly.<YYYYMMDD>.<sha7>` and proceed to build against Verdaccio

#### Scenario: Cron is active

- **WHEN** `nightly.yml` is parsed
- **THEN** `on.schedule` SHALL hold one uncommented `cron` entry that fires once a day

#### Scenario: No run can cancel, hold or replace a scheduled run

- **GIVEN** a scheduled `nightly.yml` run is queued or in progress
- **WHEN** a maintainer dispatches `nightly.yml`, or re-runs an older scheduled run, one or more times
- **THEN** no concurrency group SHALL cancel, hold or replace the scheduled run, and it SHALL run to completion, including its `report` job
- **AND** `nightly.yml` SHALL contain no `concurrency:` key outside comments, at workflow or job level

#### Scenario: Zero public npm writes

- **GIVEN** a full nightly run (all legs of every job) completes
- **WHEN** the org's published npm package versions are compared before and after the run
- **THEN** no new version SHALL appear on npmjs.com for any `@blackbelt-technology/*` package

#### Scenario: No Release, tag, or version commit

- **GIVEN** the nightly workflow definition and every reusable workflow it calls via a local `uses:`
- **WHEN** the safety contract test inspects them
- **THEN** none of them SHALL contain `softprops/action-gh-release`, `actions/create-release`, a tag `git push`, a version-bump `git commit`, or an `npm publish` targeting a non-loopback registry

#### Scenario: Every registry is loopback

- **WHEN** `nightly.yml` is parsed
- **THEN** every `REGISTRY`, `npm_config_registry` and `registry_url` value in it SHALL be a loopback URL

### Requirement: A red nightly SHALL be visible without watching CI

On failure of a scheduled run, the workflow SHALL open or update a single tracking GitHub issue labelled `nightly` identifying the failing leg and linking the run. Every issue write of the workflow SHALL go to that single issue: it SHALL NOT open a second `nightly` issue while one is open. Every issue write it makes for a red attempt SHALL name each failing job and matrix leg and link that attempt's run: a write that rewrites the issue body does so in the body, and its accompanying comment MAY be the one line `Still red at <sha>.`; a write that leaves the body unchanged does so in its comment; when the run's job list cannot be read, it SHALL name the failing jobs from the job results and say that the leg list is unavailable. The `report` job SHALL run after every other job of the workflow, whatever their result. Only a scheduled run SHALL write the tracking issue. When the first attempt of a scheduled run has at least one job that did not succeed, its report SHALL open or update that issue. A job that was skipped, cancelled or timed out SHALL count as not succeeded. When every job of that attempt succeeded, its report SHALL comment on the open `nightly` issue, if there is one, and close it. When a re-run attempt of a scheduled run has a job that did not succeed, its report SHALL comment on the open `nightly` issue without changing the issue body, or open the issue when none is open. A re-run attempt SHALL NOT close the issue and SHALL NOT comment that the run is green; a green re-run attempt SHALL write its verdict to the run summary only. A manually dispatched run SHALL write its verdict to the run summary only and SHALL NOT open, update or close the issue. If an issue call fails, the report SHALL name the failed call in the run summary and in an error annotation, and the `report` job SHALL fail. If the report cannot list the run's jobs, it SHALL say so in the report and SHALL still decide red or green from the job results it has; it SHALL NOT report green because a list was unavailable. If the job results themselves are missing or unreadable, the verdict SHALL be red. Only the `report` job SHALL hold `issues: write`. The report SHALL use the same reporter script as `nightly-tests.yml`, not a second issue mechanism.

#### Scenario: Failure opens a tracking issue

- **GIVEN** at least one electron leg fails during a scheduled nightly run
- **WHEN** the `report` job runs
- **THEN** a GitHub issue labelled `nightly` SHALL exist (created or updated) naming the failing leg with the run URL

#### Scenario: Report waits for every job

- **WHEN** `nightly.yml` is parsed
- **THEN** the `report` job's `needs` SHALL list every other job of the workflow
- **AND** its `if:` SHALL be `always()`

#### Scenario: Any failing job is reported

- **GIVEN** a scheduled nightly run where only the `knip` or `smoke` job fails, is cancelled or times out
- **WHEN** the `report` job runs
- **THEN** the `nightly` issue SHALL be created or updated and SHALL name that job or leg

#### Scenario: Skipped job is red

- **GIVEN** a scheduled nightly run where `resolve` fails and the jobs that need it are skipped
- **WHEN** the `report` job runs
- **THEN** the verdict SHALL be red
- **AND** each skipped job SHALL be listed with the result `skipped`

#### Scenario: Repeat failure updates, not duplicates

- **GIVEN** an open issue labelled `nightly`
- **WHEN** the next scheduled run is red
- **THEN** that issue SHALL be updated and commented on, and no second `nightly` issue SHALL be created

#### Scenario: Recovery closes the issue

- **GIVEN** an open issue labelled `nightly`
- **WHEN** the first attempt of a scheduled run finishes with every job successful
- **THEN** the `report` job SHALL comment on the issue and close it

#### Scenario: A red re-run makes a red night visible

- **GIVEN** a red scheduled run whose first-attempt `report` job failed before it wrote the issue
- **AND** no open issue labelled `nightly`
- **WHEN** a maintainer re-runs that run's failed jobs and the re-run attempt is red
- **THEN** the re-run attempt's `report` job SHALL open a `nightly` issue that names the failing jobs and links the run

#### Scenario: A red re-run comments and keeps the body

- **GIVEN** an open issue labelled `nightly`
- **WHEN** a re-run attempt of that or an older scheduled run finishes red
- **THEN** the `report` job SHALL add one comment that names the attempt number, each failing job and matrix leg, the run URL and its commit
- **AND** the issue body SHALL stay unchanged and the issue SHALL stay open

#### Scenario: A re-run never closes the issue

- **GIVEN** an open issue labelled `nightly` that describes a red scheduled run
- **WHEN** a maintainer re-runs that run or an older scheduled run, and the re-run attempt finishes green
- **THEN** the re-run attempt's verdict SHALL appear in its run summary, which SHALL say that a re-run never closes the issue
- **AND** the `nightly` issue SHALL stay open, with its body unchanged and no new comment
- **AND** the verdict SHALL NOT depend on a first-attempt record, which `nightly.yml` never writes

#### Scenario: A failed issue call is named

- **GIVEN** a scheduled run whose `report` job cannot complete an issue call
- **WHEN** the `report` job runs
- **THEN** the run summary and an error annotation SHALL name the failed call
- **AND** the `report` job SHALL fail

#### Scenario: Dispatch runs never touch the issue

- **WHEN** a manually dispatched `nightly.yml` run finishes, red or green
- **THEN** the verdict SHALL appear in the run summary
- **AND** no `nightly` issue SHALL be created, updated or closed by that run

#### Scenario: Job list unavailable does not turn the night green

- **GIVEN** a scheduled run where a job did not succeed
- **AND** the request for the run's job list fails
- **WHEN** the `report` job runs
- **THEN** the report SHALL state that the failed-job list is unavailable
- **AND** it SHALL name the failing jobs from the job results and link the run
- **AND** the verdict SHALL be red and the `nightly` issue SHALL be created or updated

#### Scenario: Missing job results are red

- **GIVEN** a scheduled run whose `report` job receives no readable job results (empty, missing or invalid)
- **WHEN** the `report` job runs
- **THEN** the report SHALL state that the job results are unavailable
- **AND** the verdict SHALL be red and the `nightly` issue SHALL be created or updated

#### Scenario: Only the report job can write issues

- **WHEN** `nightly.yml` is parsed
- **THEN** the top-level permissions SHALL be `contents: read`
- **AND** `issues: write` SHALL appear only in the `report` job's permissions

#### Scenario: The report uses the shared reporter

- **WHEN** `nightly.yml` is parsed
- **THEN** the `report` job's run step SHALL invoke `scripts/test-selection/nightly-report.mjs` with exactly the flags `--jobs-only`, `--no-close-on-rerun`, `--label nightly` and `--name "Nightly Verdaccio build"`
- **AND** `nightly.yml` SHALL contain no `actions/github-script` step

## ADDED Requirements

### Requirement: The nightly SHALL publish under the npm version the release publishes with

`nightly.yml` `verify-publish` SHALL run `npm install -g npm@latest` first, as the `publish.yml` `publish` job does. Under that npm it SHALL set the nightly version, build, and publish every non-private workspace to a loopback Verdaccio one package at a time in release order, generating and linting the server's runtime lock before the server. These are the rehearsal's own copies of the release commands, not the step text of `publish.yml`.

#### Scenario: npm is upgraded before the version is set

- **WHEN** the `verify-publish` job of `nightly.yml` is parsed
- **THEN** a step running `npm install -g npm@latest` SHALL come before the `pnpm install` step, before the `npm pkg set` step and before the step that publishes to Verdaccio

#### Scenario: npm drift fails the night

- **GIVEN** a new `npm@latest` that rejects `npm pkg set`, the runtime-lock generation, or a per-package `npm publish` to the loopback registry
- **WHEN** a scheduled nightly runs
- **THEN** `verify-publish` SHALL fail
- **AND** the `nightly` issue SHALL name `verify-publish`

#### Scenario: verify-publish publishes only to loopback

- **WHEN** the `verify-publish` job of `nightly.yml` is parsed
- **THEN** its `REGISTRY` value SHALL be a loopback URL
- **AND** it SHALL contain no bulk `npm publish --workspaces` line, which the release does not run

### Requirement: An npm@latest failure SHALL NOT skip the other rehearsal jobs

No job of `nightly.yml` other than `report` SHALL wait for `verify-publish`, so a red `verify-publish` leaves every other rehearsal job running.

#### Scenario: verify-publish gates no other job

- **WHEN** `nightly.yml` is parsed
- **THEN** no job other than `report` SHALL list `verify-publish` in its `needs`

### Requirement: The nightly SHALL run the standalone-install smoke

`nightly.yml` SHALL call the reusable `_smoke.yml` with the commit under test as `ref`, so the install-smoke legs the tag gate runs are exercised every night. The smoke legs pack the working tree into tarballs and install those. They SHALL NOT be described as a registry rehearsal.

#### Scenario: Smoke runs nightly against the tested commit

- **WHEN** `nightly.yml` is parsed
- **THEN** a `smoke` job SHALL invoke `uses: ./.github/workflows/_smoke.yml` with `ref: ${{ github.sha }}`
- **AND** on a scheduled run a failing smoke leg SHALL be named in the `nightly` issue
