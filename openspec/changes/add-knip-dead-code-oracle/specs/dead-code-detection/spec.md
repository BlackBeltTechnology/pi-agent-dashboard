# Dead Code Detection

## ADDED Requirements

### Requirement: Whole-graph Knip scan

Knip SHALL analyse the whole workspace graph in a single pass and SHALL NOT be
wired into the per-change `quality:changed` loop, because a changed-file scope
cannot answer whether a symbol is used somewhere else in the graph.

#### Scenario: Knip runs whole-graph

- **WHEN** the Knip pass executes
- **THEN** it analyses every workspace package in one invocation
- **AND** it reports unused files, exports, types, and dependencies

#### Scenario: Knip is absent from the per-change loop

- **WHEN** `npm run quality:changed` executes
- **THEN** no Knip invocation occurs
- **AND** the per-change loop runtime is unchanged by this capability

#### Scenario: Whole-workspace scan stays within budget

- **WHEN** the Knip pass runs on the full workspace
- **THEN** it completes in under 30 seconds

### Requirement: Advisory-until-clean gating

The Knip pass SHALL be non-blocking while baseline findings remain, and SHALL
become blocking once the baseline reaches zero findings, so the gate ratchets
forward without ever blocking on pre-existing debt.

#### Scenario: Advisory while findings remain

- **WHEN** the Knip pass reports one or more findings and the baseline is not clean
- **THEN** the job reports the findings
- **AND** the job does not fail the pipeline

#### Scenario: Blocking once baseline is clean

- **WHEN** the baseline has reached zero findings
- **THEN** the Knip pass is configured as blocking
- **AND** a newly introduced unused export fails the pipeline

### Requirement: Phantom dependencies are fixed, not suppressed

Every dependency imported by a package but undeclared in that package's manifest
SHALL be added to the manifest. Such findings SHALL NOT be silenced via Knip
config, because `nodeLinker: hoisted` masks them at runtime while they still
break on publish or standalone consumption.

#### Scenario: Undeclared import is added to the manifest

- **WHEN** a package imports a dependency absent from its own `package.json`
- **THEN** the dependency is added to that package's manifest
- **AND** no Knip ignore entry is created for it

#### Scenario: Config suppression of an unlisted finding is rejected

- **WHEN** a proposed `knip.json` adds an ignore rule covering an `unlisted` finding
- **THEN** the change is rejected in review
- **AND** the manifest fix is required instead

#### Scenario: Known phantom dependencies are resolved

- **WHEN** the Knip pass runs after this change
- **THEN** it reports zero `unlisted` findings
- **AND** `node-pty`, `@mdi/js`, `@vitejs/plugin-react`, `@testing-library/react`,
  `jszip`, `@pi/anthropic-messages`, and `@electron-forge/shared-types` are each
  declared by every package that imports them

### Requirement: Config encodes graph shape only

`knip.json` SHALL declare entry points and project globs that teach Knip this
workspace's real graph, and SHALL NOT be used to hide true positives.

#### Scenario: Entry-point shapes are declared

- **WHEN** Knip resolves the workspace
- **THEN** plugin client entries, `.pi/skills/**` scripts, `vitest.config.ts`
  files, and `public/sw.js` are treated as entry points
- **AND** none of them is reported as an unused file

#### Scenario: Server-to-client type imports are followed

- **WHEN** a plugin's client module imports a type from its server module
- **THEN** that export is not reported as unused
