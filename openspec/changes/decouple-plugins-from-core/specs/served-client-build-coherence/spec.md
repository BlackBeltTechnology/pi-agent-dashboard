## MODIFIED Requirements

### Requirement: Production client build emits a build declaration

A production build of the dashboard web client SHALL write a build declaration file alongside the built assets. The declaration SHALL carry a schema version, the deterministic plugin-registry hash that is also embedded in the built bundle, the fixture policy the build applied (a closed enum), and `bundledPluginIds`: the sorted ids of the plugins embedded in the bundle's plugin registry. `bundledPluginIds` SHALL be additive under the existing schema version; a reader SHALL treat a declaration without it as declaring no bundled set. The declaration SHALL NOT contain timestamps, machine-specific paths, or any other host-dependent value, so that two builds of the same sources and the same plugin set produce byte-identical declarations.

#### Scenario: Production build writes the declaration

- **WHEN** the client is built for production with a given plugin set
- **THEN** a build declaration file is emitted into the build output directory
- **AND** it records a schema version and the same plugin-registry hash that is embedded in the built bundle

#### Scenario: Declaration is reproducible across hosts

- **WHEN** the same sources and the same declared plugin set are built twice on different machines or in different directories
- **THEN** both builds emit byte-identical declaration contents

#### Scenario: Development mode emits no declaration

- **WHEN** the client runs in development / HMR mode
- **THEN** registry generation stays source-only and no build declaration file is written

#### Scenario: Declaration lists the bundled plugin ids

- **WHEN** the client is built for production with plugins `flows` and `goal` bundled
- **THEN** the declaration SHALL contain `bundledPluginIds: ["flows", "goal"]`, matching the ids in `PLUGIN_REGISTRY`

#### Scenario: Older declaration is still readable

- **WHEN** the server reads a declaration with the current schema version and no `bundledPluginIds`
- **THEN** the declaration SHALL still be valid for coherence reporting, and the bundled set SHALL be treated as undeclared
