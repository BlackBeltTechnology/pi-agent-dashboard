# nightly-verification Specification

## Purpose
TBD - created by archiving change add-nightly-verdaccio-build. Update Purpose after archive.

## Requirements

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

### Requirement: The nightly SHALL resolve bundled scoped dependencies from the ephemeral registry, not the public one

The nightly Electron bundle SHALL take every `@blackbelt-technology/*` production dependency (e.g. `pi-dashboard-bus-client`, `pi-dashboard-document-converter`) from the working-tree source, either as a bundled workspace or from the local Verdaccio serving that source, and never from the public registry, so unreleased code is what gets verified. The nightly builds its bundle through the release-lock path: the server, published to Verdaccio with a runtime lock generated against Verdaccio, supplies the lock.

#### Scenario: Working-tree source shadows the public version

- **GIVEN** a scoped package whose working-tree source is ahead of its last public npm version
- **WHEN** the nightly publishes it to Verdaccio and builds the bundle
- **THEN** the bundle SHALL contain the working-tree copy (a bundled workspace source, or the Verdaccio copy) rather than the public version, and the built server SHALL run

#### Scenario: Registry override requires no change to `bundle-server.mjs`

- **GIVEN** `bundle-server.mjs` spawns npm with the process environment
- **WHEN** the workflow exports `npm_config_registry=http://localhost:4873`
- **THEN** every npm call the bundle step makes (`npm pack` of the server and `npm ci` of the lock) SHALL target Verdaccio, with no registry-specific code in `bundle-server.mjs`

#### Scenario: Local-only scope prevents version collisions

- **GIVEN** the Verdaccio config with no `proxy` on `@blackbelt-technology/*`
- **WHEN** the nightly publishes a version whose `<base>` already exists on public npm
- **THEN** the local publish SHALL succeed (no upstream fallthrough, no `EPUBLISHCONFLICT`), while third-party `**` packages SHALL still resolve via the `npmjs` proxy uplink

### Requirement: The nightly SHALL assert the Electron bundle contains every runtime plugin

A per-leg gate SHALL verify that `resources/plugins/` in the built bundle contains every non-fixture runtime plugin discoverable in `packages/*plugin*`, failing the build (and naming the missing plugin) on any omission.

#### Scenario: Missing runtime plugin fails the build

- **GIVEN** a runtime plugin present in `packages/` but absent from the built bundle's `resources/plugins/`
- **WHEN** the completeness gate runs
- **THEN** the leg SHALL fail with a non-zero exit that names the missing plugin

#### Scenario: Fixture and non-runtime packages are excluded

- **GIVEN** a plugin package with `pi-dashboard-plugin.fixture === true` (e.g. `demo-plugin`) or a non-runtime authoring package (e.g. `dashboard-plugin-skill`)
- **WHEN** the completeness gate runs
- **THEN** those packages SHALL NOT be required in the bundle and SHALL NOT fail the gate

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

### Requirement: A scheduled nightly SHALL run the full unit suite
The project SHALL provide a `nightly-tests.yml` workflow, triggered on an active daily `cron` and on `workflow_dispatch`, that runs on `develop`. Its jobs are:
- the full sharded vitest suite in `full` selection mode, with chromium installed, the built client asserted present before tests run, and every slow-tier test included;
- the real-process phase;
- `pnpm run test:ci-scenarios`;
- the budget lane: every `*.budget.test.*` file, run under `RUN_BUDGET_TESTS=1`, one file at a time, in a job of its own on `ubuntu-latest`.

Every vitest job SHALL upload its JSON report. The workflow SHALL declare no `concurrency` group, at workflow or job level, so that no dispatch or re-run can hold a scheduled run pending or replace it. The cron SHALL be active when the workflow lands. It SHALL NOT follow a land-dark rollout, because pull requests and `develop` pushes run affected-only tests and this workflow is the only full-suite run. The workflow SHALL NOT depend on `nightly.yml` or its Electron/Verdaccio legs.

#### Scenario: Nightly runs everything
- **WHEN** the nightly-tests cron fires
- **THEN** every test file collected by the root vitest config and the real-process config SHALL execute, including every slow-tier file
- **AND** `test:ci-scenarios` SHALL execute
- **AND** every case in every `*.budget.test.*` file SHALL execute in the budget job

#### Scenario: Budget job does not share a runner with the shards
- **WHEN** the nightly runs the budget lane
- **THEN** the budget files SHALL run in a job that runs no unit shard, real-process or packaging-scenario tests

#### Scenario: Cron is active
- **WHEN** the nightly-tests contract test inspects `nightly-tests.yml`
- **THEN** the workflow SHALL declare an uncommented `schedule` `cron` trigger and a `workflow_dispatch` trigger

#### Scenario: A dispatch cannot displace a scheduled run
- **WHEN** a `workflow_dispatch` run of `nightly-tests.yml` is in progress at the cron time and a second dispatch is queued
- **THEN** the scheduled run SHALL start and report
- **AND** the nightly-tests contract test SHALL fail if `nightly-tests.yml` contains a `concurrency:` key outside comments, at workflow or job level

#### Scenario: Independent of the release round-trip
- **WHEN** `nightly.yml` is disabled or failing
- **THEN** `nightly-tests.yml` SHALL still run on schedule

### Requirement: A red test nightly SHALL name the failing tests and the commit range
When a scheduled nightly-tests run fails on its first attempt and that attempt deferred (below), its failed jobs SHALL be rerun once. A separate workflow, `nightly-tests-rerun.yml`, triggered when the run completes, SHALL read the first attempt's record and SHALL request the rerun, from a job that holds only `actions: write`, only when the record says the first attempt deferred. A first attempt that did not defer, or whose record that job cannot read, SHALL NOT be rerun automatically. The report job SHALL keep `contents: read`, `issues: write` and `actions: read`. Every first attempt SHALL record its failing tests, its failed jobs, its jobs with no report, and whether it deferred. On a scheduled first attempt that is red, the report job SHALL defer, that is SHALL NOT open or update an issue, only when it can read through the API that both `nightly-tests-rerun.yml` and `nightly-tests-watchdog.yml` are active, and only when it reports no later than a fixed UTC deadline: a fixed UTC time of day on the UTC date the run was created. A first attempt that reports after that instant, on a later UTC date included, SHALL NOT defer. The deadline SHALL be late enough that a first attempt of an on-time run that uses every `timeout-minutes` still defers, and early enough that a first attempt reporting at the deadline, followed by the rest of its `report` job, the `rerun` job and a full second attempt, each using its `timeout-minutes`, ends at least two hours before the watchdog runs; a contract test SHALL check both from the parsed workflow files. When either workflow is disabled, missing, or its state cannot be read, or the run's creation time cannot be read, or the deadline has passed, the first attempt SHALL open or update the issue as if no rerun existed. The rerun and the watchdog SHALL live in separate workflow files, so that a fault in one file cannot stop both.

The mechanism SHALL fail closed. A night is reported red, with the issue opened or updated, when any of these holds:
- the rerun attempt fails;
- a later attempt cannot read the first attempt's record, and the first attempt may have deferred: it was a scheduled attempt that did not succeed, or its event and conclusion cannot be read through the API. This holds whatever the later attempt's own verdict. A later attempt whose first attempt is known not to have deferred (the record says so, or the API shows the first attempt was green or not scheduled) SHALL be judged on its own verdict;
- a watchdog finds that the latest scheduled run did not end green and that no open `nightly-tests` issue names its run URL. The watchdog is a scheduled job in `nightly-tests-watchdog.yml`, holds `contents: read`, `issues: write` and `actions: read`, and restores no cache. It covers a rerun that was never requested, a deferred first attempt whose record the rerun workflow could not read, a rerun request that was refused, and a rerun whose report did not run. It SHALL run at least two hours after the latest time an automatic rerun can end, computed as the deferral deadline plus the `timeout-minutes` of `report`, of the `rerun` job, and of one full attempt (`select`, the longest test job and `report`). Because the deadline is no earlier than the cron time plus `select` and the longest test job, that end also bounds an on-time night with its rerun. A contract test SHALL compute that end from the parsed workflow files and the deadline constant and SHALL fail when the watchdog's cron is earlier than that end plus two hours.

When the run is red, the report job, or the watchdog, SHALL open or update one GitHub issue labelled `nightly-tests`. The issue SHALL list:
- the failing test files parsed from the uploaded reports;
- every job that was expected to run tests but uploaded no report, named as having no report;
- the run URL;
- the `develop` commit range `A..B`;
- under a separate "Passed on rerun" heading, each test that failed on the first attempt and passed on the rerun, and each job that failed on the first attempt without a failed assertion in a readable report (a timeout, a cancellation, an install failure, or no report) and succeeded on the rerun;
- when the issue comes from the watchdog or from an unreadable first-attempt record, that reason in place of the lists it could not compute.

A test or job that failed on the first attempt and passed on the rerun SHALL be listed as passed on rerun in the run's step summary. It SHALL NOT by itself make the run red or open an issue.

`A` is the head commit of the most recent successful **scheduled** nightly-tests run on `develop` whose head is an ancestor of `B`. `B` is the failing run's head. Runs started by `workflow_dispatch` SHALL NOT serve as the anchor and SHALL NOT be rerun. When no such anchor exists, the issue SHALL say so instead of naming a range. When `A` equals `B`, the issue SHALL state that no commits landed since the last green run.

A later successful scheduled run, including one that turns green on its rerun, SHALL comment on the open issue, recording the green commit and any tests that passed on rerun, and SHALL close the issue.

#### Scenario: Failure opens an issue with the range
- **WHEN** a scheduled nightly-tests run fails at commit `B` on its first attempt and on its rerun, and the last green scheduled run was at `A`, an ancestor of `B`
- **THEN** an issue labelled `nightly-tests` SHALL exist naming the failing test files, the run URL, and the range `A..B`

#### Scenario: A first-attempt failure is rerun, not reported
- **WHEN** a scheduled nightly-tests run's first attempt fails before the deferral deadline, and both `nightly-tests-rerun.yml` and `nightly-tests-watchdog.yml` are active
- **THEN** its failed jobs SHALL be rerun once
- **AND** the first attempt's report job SHALL NOT create, update or close a `nightly-tests` issue

#### Scenario: Passed on rerun is listed, not raised
- **WHEN** `kb-search-perf.budget.test.ts` fails on the first attempt and passes on the rerun, and every other job succeeds
- **THEN** the run SHALL be green
- **AND** the step summary SHALL list that test under "Passed on rerun"
- **AND** no `nightly-tests` issue SHALL be opened

#### Scenario: A job that hung and then passed is listed, not raised
- **WHEN** the `real-process` job times out on the first attempt with no failed assertion in its report, and succeeds on the rerun, and every other job succeeds
- **THEN** the run SHALL be green
- **AND** the step summary SHALL list the `real-process` job under "Passed on rerun"

#### Scenario: A first attempt that did not defer is not rerun
- **WHEN** a scheduled run's first attempt is red and did not defer, because the deadline had passed or a rerun or watchdog workflow was inactive
- **THEN** `nightly-tests-rerun.yml` SHALL NOT request a rerun
- **AND** the issue the first attempt opened or updated SHALL stay open until a later green scheduled run closes it

#### Scenario: A manual re-run of a night that did not defer is judged on its own result
- **WHEN** a person re-runs a scheduled night whose first-attempt record says it did not defer, or whose record is missing while the API shows the first attempt green or not scheduled, and every job of the re-run succeeds
- **THEN** the re-run SHALL be green
- **AND** it SHALL NOT be reported red because of the first attempt

#### Scenario: A manual re-run with no record and no API answer is red
- **WHEN** a person re-runs a scheduled night, the first-attempt record is missing, and the API call for the first attempt's event and conclusion fails
- **THEN** the re-run SHALL be reported red, whatever its own verdict

#### Scenario: A regression that fails twice is raised
- **WHEN** a test fails on the first attempt and fails again on the rerun
- **THEN** the issue SHALL be opened or updated naming that test's file
- **AND** tests that passed on the rerun in the same run SHALL appear only under "Passed on rerun"

#### Scenario: A disabled rerun workflow disables the deferral
- **WHEN** a scheduled run's first attempt is red and `nightly-tests-rerun.yml` or `nightly-tests-watchdog.yml` is disabled, deleted, or its state cannot be read
- **THEN** the first attempt's report job SHALL open or update the `nightly-tests` issue

#### Scenario: A late first attempt reports itself
- **WHEN** a scheduled run starts so late that its first attempt is red after the deferral deadline
- **THEN** that first attempt SHALL open or update the `nightly-tests` issue
- **AND** it SHALL NOT defer to a rerun

#### Scenario: A first attempt delayed past midnight UTC reports itself
- **WHEN** a scheduled run created at 03:00 UTC on one day has a red first attempt whose report runs at 00:30 UTC on the next day
- **THEN** that first attempt SHALL NOT defer, because the deadline of the run's creation date has passed
- **AND** it SHALL open or update the `nightly-tests` issue

#### Scenario: A rerun that never happened is still reported
- **WHEN** a scheduled run's first attempt deferred and no rerun attempt ran, because the `workflow_run` trigger did not fire, the rerun workflow could not read the first attempt's record, or `gh run rerun` was refused
- **THEN** the watchdog SHALL open or update the `nightly-tests` issue naming the run URL and the reason
- **AND** the watchdog run SHALL fail

#### Scenario: A broken rerun workflow leaves the watchdog working
- **WHEN** a scheduled run's first attempt deferred and `nightly-tests-rerun.yml` fails to run because of an error in that file
- **THEN** the watchdog in `nightly-tests-watchdog.yml` SHALL still run and open or update the `nightly-tests` issue

#### Scenario: A workflow file error fails before merge
- **WHEN** a change makes `nightly-tests-rerun.yml` or `nightly-tests-watchdog.yml` unparsable, or alters its trigger, job condition, permissions or command
- **THEN** the nightly-tests contract test SHALL fail

#### Scenario: An unreadable first-attempt record is red
- **WHEN** the rerun attempt of a scheduled night whose first attempt failed cannot read the first attempt's record, and every rerun job succeeds
- **THEN** the report SHALL be red, and the issue SHALL be opened or updated stating that the first-attempt record was unavailable

#### Scenario: The watchdog stays quiet when the night is reported
- **WHEN** the latest scheduled run ended green, or an open `nightly-tests` issue already names its run URL
- **THEN** the watchdog SHALL NOT create, update or close an issue

#### Scenario: No second rerun
- **WHEN** the rerun attempt of a scheduled run fails
- **THEN** no further rerun SHALL be requested

#### Scenario: No prior green run
- **WHEN** a scheduled nightly-tests run fails twice and no earlier scheduled run on `develop` succeeded
- **THEN** the issue SHALL state that no green anchor exists and SHALL still name the failing tests and run URL

#### Scenario: Dispatch runs do not anchor
- **WHEN** the most recent green nightly-tests run was a `workflow_dispatch` on a feature branch
- **THEN** it SHALL NOT be used as `A`

#### Scenario: Repeat failure updates, not duplicates
- **WHEN** the next scheduled run also fails twice while that issue is open
- **THEN** the existing issue SHALL be updated and no second open `nightly-tests` issue SHALL be created

#### Scenario: Recovery closes the issue
- **WHEN** a scheduled nightly-tests run passes, on its first attempt or on its rerun, while a `nightly-tests` issue is open
- **THEN** the issue SHALL receive a comment naming the green commit and SHALL be closed

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
