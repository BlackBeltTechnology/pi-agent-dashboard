## ADDED Requirements

### Requirement: session-distiller engine publishes as a public npm package

`@blackbelt-technology/pi-dashboard-session-distiller` SHALL be publishable to npm with public access, carrying a real semver version, an MIT license, a `files[]` allowlist, and `repository.directory`. Its miner behaviour SHALL be unchanged by the packaging edits.

#### Scenario: engine is no longer private

- **WHEN** an auditor reads `packages/session-distiller/package.json`
- **THEN** `private: true` is absent
- **AND** `publishConfig.access` is `public`
- **AND** `version` is a real semver (not `0.0.0`)
- **AND** `license` is `MIT` and `repository.directory` points at `packages/session-distiller`

#### Scenario: engine tests still pass after packaging edits

- **WHEN** `cd packages/session-distiller && npx vitest run`
- **THEN** all 46 unit tests pass
- **AND** no source file under `src/` changed except as required for the published entry points

#### Scenario: engine CLI bin is preserved

- **WHEN** the package is installed and the `distill-session-knowledge` bin is invoked
- **THEN** it runs the offline miner exactly as before
- **AND** the bin name is unchanged

### Requirement: A thin skill package depends on the published engine

A new package (e.g. `packages/distill-session-knowledge/`) SHALL register the skill via `pi.skills[]`, depend on the engine package, and publish publicly. The root `.pi/skills/distill-session-knowledge/` copy SHALL be removed so exactly one source exists.

#### Scenario: skill loads by NL trigger from the package

- **WHEN** a pi session loads the thin skill package
- **THEN** `distill-session-knowledge` appears in the available-skills list
- **AND** its NL triggers ("mine my sessions", "distill session knowledge") load the SKILL.md body

#### Scenario: skill depends on the engine

- **WHEN** an auditor reads the thin package's `package.json`
- **THEN** `dependencies` includes `@blackbelt-technology/pi-dashboard-session-distiller`
- **AND** `pi.skills[]` contains `.pi/skills/distill-session-knowledge`
- **AND** `publishConfig.access` is `public`

#### Scenario: exactly one source of the skill exists

- **WHEN** an auditor greps the repo for `distill-session-knowledge/SKILL.md`
- **THEN** the only match is under the new thin package's `.pi/skills/`
- **AND** no copy remains under the root `.pi/skills/`

#### Scenario: skill invokes the engine via the package, not a repo-relative path

- **WHEN** the skill body's verification/procedure steps reference the miner
- **THEN** they invoke the published `distill-session-knowledge` bin or the package's exported API
- **AND** no step depends on `packages/session-distiller` being present at a repo-relative path

### Requirement: Both packages ship together via release-cut

The engine and the thin skill package SHALL be part of the `release-cut` published workspace set and SHALL be released together to avoid cross-package version skew.

#### Scenario: release-cut publishes both

- **WHEN** a release is cut
- **THEN** both `@blackbelt-technology/pi-dashboard-session-distiller` and the thin skill package are published in the same run
- **AND** the `release-cut` skill's package tally reflects the two additions
