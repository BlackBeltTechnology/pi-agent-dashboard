## MODIFIED Requirements

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
