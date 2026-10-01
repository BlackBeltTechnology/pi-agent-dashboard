## ADDED Requirements

### Requirement: A scheduled nightly SHALL run the full unit suite
The project SHALL provide a `nightly-tests.yml` workflow, triggered on an active daily `cron` and on `workflow_dispatch`, that runs on `develop`. Its jobs are:
- the full sharded vitest suite in `full` selection mode, with chromium installed, the built client asserted present before tests run, and every slow-tier test included;
- the real-process phase;
- `pnpm run test:ci-scenarios`.

Every vitest job SHALL upload its JSON report. The cron SHALL be active when the workflow lands. It SHALL NOT follow a land-dark rollout, because pull requests and `develop` pushes run affected-only tests and this workflow is the only full-suite run. The workflow SHALL NOT depend on `nightly.yml` or its Electron/Verdaccio legs.

#### Scenario: Nightly runs everything
- **WHEN** the nightly-tests cron fires
- **THEN** every test file collected by the root vitest config and the real-process config SHALL execute, including every slow-tier file
- **AND** `test:ci-scenarios` SHALL execute

#### Scenario: Cron is active
- **WHEN** the nightly-tests contract test inspects `nightly-tests.yml`
- **THEN** the workflow SHALL declare an uncommented `schedule` `cron` trigger and a `workflow_dispatch` trigger

#### Scenario: Independent of the release round-trip
- **WHEN** `nightly.yml` is disabled or failing
- **THEN** `nightly-tests.yml` SHALL still run on schedule

### Requirement: A red test nightly SHALL name the failing tests and the commit range
When a scheduled nightly-tests run fails, a report job holding `issues: write` permission SHALL open or update one GitHub issue labelled `nightly-tests`. The issue SHALL list:
- the failing test files parsed from the uploaded reports;
- every job that was expected to run tests but uploaded no report, named as having no report;
- the run URL;
- the `develop` commit range `A..B`.

`A` is the head commit of the most recent successful **scheduled** nightly-tests run on `develop` whose head is an ancestor of `B`. `B` is the failing run's head. Runs started by `workflow_dispatch` SHALL NOT serve as the anchor. When no such anchor exists, the issue SHALL say so instead of naming a range. When `A` equals `B`, the issue SHALL state that no commits landed since the last green run.

A later successful scheduled run SHALL comment on the open issue, recording the green commit, and SHALL close the issue.

#### Scenario: Failure opens an issue with the range
- **WHEN** a scheduled nightly-tests run fails at commit `B`, and the last green scheduled run was at `A`, an ancestor of `B`
- **THEN** an issue labelled `nightly-tests` SHALL exist naming the failing test files, the run URL, and the range `A..B`

#### Scenario: No prior green run
- **WHEN** a scheduled nightly-tests run fails and no earlier scheduled run on `develop` succeeded
- **THEN** the issue SHALL state that no green anchor exists and SHALL still name the failing tests and run URL

#### Scenario: Dispatch runs do not anchor
- **WHEN** the most recent green nightly-tests run was a `workflow_dispatch` on a feature branch
- **THEN** it SHALL NOT be used as `A`

#### Scenario: Repeat failure updates, not duplicates
- **WHEN** the next scheduled run also fails while that issue is open
- **THEN** the existing issue SHALL be updated and no second open `nightly-tests` issue SHALL be created

#### Scenario: Recovery closes the issue
- **WHEN** a scheduled nightly-tests run passes while a `nightly-tests` issue is open
- **THEN** the issue SHALL receive a comment naming the green commit and SHALL be closed
