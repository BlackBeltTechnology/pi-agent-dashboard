## MODIFIED Requirements

### Requirement: Multi-location pi resolution reporting
The doctor SHALL report pi across all install locations and flag divergence and
floor violations. Because `piCompatibility.minimum` now tracks the pinned
runtime in lockstep, a location behind the pin is a floor violation rather than
a soft upgrade hint, and the doctor SHALL report it as failing.

The floor and pin values the module reports SHALL be derived from
`packages/server/package.json` at regeneration time, never hand-edited into the
module's knowledge tables.

#### Scenario: Report all pi installs
- **WHEN** the `pi-resolution` module runs
- **THEN** it reports the version and resolved path of every discoverable pi
  install (CLI binary, repo `node_modules`, managed install, nvm-global, and the
  per-session-cwd `createRequire` resolution)

#### Scenario: Flag divergence
- **WHEN** two pi locations resolve to different versions
- **THEN** the doctor reports the divergence and identifies which location each
  consumer uses

#### Scenario: Flag floor violation
- **WHEN** any resolved pi version is below the `piCompatibility.minimum` floor
- **THEN** the doctor flags that location as failing with the required version

#### Scenario: Location behind the pin fails rather than hints
- **GIVEN** a resolved pi one or more releases behind the pinned runtime
- **WHEN** the `pi-resolution` module runs
- **THEN** that location SHALL be flagged as failing the floor
- **AND** SHALL NOT be reported merely as an upgrade recommendation

#### Scenario: Version tables are regenerated, not hand-edited
- **WHEN** the pinned version or floor moves
- **THEN** the `pi-resolution` module's derived version tables SHALL be
  regenerated from `packages/server/package.json`
- **AND** its per-module knowledge hash SHALL be updated by the same
  regeneration
