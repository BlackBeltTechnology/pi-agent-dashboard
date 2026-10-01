# nightly-verification Specification

## Purpose
TBD - created by archiving change add-nightly-verdaccio-build. Update Purpose after archive.

## Requirements

### Requirement: A scheduled nightly build SHALL verify the full release round-trip with zero public npm writes

The project SHALL provide a `nightly.yml` workflow triggered on a daily `cron` and on `workflow_dispatch`. It SHALL publish every non-private workspace to an ephemeral private registry (Verdaccio) and build the full Electron installer matrix against that registry, so the publish→install→bundle→run path is exercised without writing to npmjs.com.

#### Scenario: Nightly runs on schedule and on demand

- **GIVEN** the `nightly.yml` workflow
- **WHEN** the daily `cron` fires **OR** a maintainer triggers `workflow_dispatch`
- **THEN** the workflow SHALL resolve a throwaway version `<base>-nightly.<YYYYMMDD>.<sha7>` and proceed to build against Verdaccio

#### Scenario: Zero public npm writes

- **GIVEN** a full nightly run (all 6 legs) completes
- **WHEN** the org's published npm package versions are compared before and after the run
- **THEN** no new version SHALL appear on npmjs.com for any `@blackbelt-technology/*` package

#### Scenario: No Release, tag, or version commit

- **GIVEN** the nightly workflow definition
- **WHEN** the safety contract test inspects it
- **THEN** it SHALL contain no `softprops/action-gh-release`, no tag `git push`, no version-bump `git commit`, and no `npm publish` targeting a non-loopback registry

### Requirement: The nightly SHALL resolve bundled scoped dependencies from the ephemeral registry, not the public one

The Electron bundle's `npm install` SHALL resolve `@blackbelt-technology/*` production dependencies (e.g. `pi-dashboard-bus-client`, `pi-dashboard-document-converter`) from the local Verdaccio, serving the working-tree source, so unreleased code is what gets verified.

#### Scenario: Working-tree source shadows the public version

- **GIVEN** a scoped package whose working-tree source is ahead of its last public npm version
- **WHEN** the nightly publishes it to Verdaccio and builds the bundle
- **THEN** the bundle's `npm install` SHALL resolve the Verdaccio (working-tree) copy, and the built server SHALL run

#### Scenario: Registry override requires no change to `bundle-server.mjs`

- **GIVEN** `bundle-server.mjs` spawns npm with the process environment
- **WHEN** the workflow exports `npm_config_registry=http://localhost:4873`
- **THEN** the bundled `npm install` SHALL target Verdaccio with no edit to `bundle-server.mjs`

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

On failure, the workflow SHALL open or update a single tracking GitHub issue labelled `nightly` identifying the failing leg and linking the run.

#### Scenario: Failure opens a tracking issue

- **GIVEN** at least one electron leg fails during a nightly run
- **WHEN** the `report` job runs
- **THEN** a GitHub issue labelled `nightly` SHALL exist (created or updated) naming the failing leg with the run URL

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
