## MODIFIED Requirements

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
