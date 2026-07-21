## ADDED Requirements

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
