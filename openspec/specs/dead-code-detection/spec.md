# dead-code-detection Specification

## Purpose
TBD - created by archiving change add-knip-dead-code-oracle. Update Purpose after archive.
## Requirements
### Requirement: Whole-graph Knip scan

Knip SHALL analyse the whole workspace graph in a single pass and SHALL NOT be
wired into the per-change `quality:changed` loop, because a changed-file scope
cannot answer whether a symbol is used somewhere else in the graph.

#### Scenario: Knip runs whole-graph

- **WHEN** the Knip pass executes
- **THEN** it analyses every workspace package in one invocation
- **AND** it reports unused files, exports, and types

#### Scenario: Knip is absent from the per-change loop

- **WHEN** `npm run quality:changed` executes
- **THEN** no Knip invocation occurs
- **AND** the per-change loop runtime is unchanged by this capability

#### Scenario: Whole-workspace scan stays within budget

- **WHEN** the Knip pass runs on the full workspace
- **THEN** it completes in under 30 seconds

### Requirement: Entry points are derived from project manifests

`knip.json` SHALL declare each workspace's entry points from the project's own
manifest conventions, because Knip cannot infer them and an unrooted graph
reports reachable files as dead. Measured: rooting the graph moved the baseline
from 723 findings to 437 and the unused-file class from 90 to 10.

#### Scenario: Dashboard plugin entries are rooted

- **WHEN** a package declares `pi-dashboard-plugin` with `client`, `server`, or
  `bridge` paths
- **THEN** each declared path is an entry point in `knip.json`
- **AND** no file reachable from it is reported unused

#### Scenario: Pi extension entries are rooted

- **WHEN** a package declares `pi.extensions`
- **THEN** each listed path is an entry point in `knip.json`

#### Scenario: Application entries are rooted

- **WHEN** resolving the workspace
- **THEN** `packages/client/src/main.tsx`, `packages/electron/src/main.ts`,
  `packages/electron/src/preload.ts`, and `packages/server/src/cli.ts` are entry points
- **AND** none of them is reported as an unused file

#### Scenario: A new plugin manifest entry is picked up

- **WHEN** a package adds a `pi-dashboard-plugin.bridge` path not present in `knip.json`
- **THEN** the configuration check fails
- **AND** the failure names the package and the missing entry

#### Scenario: Shell-invoked scripts are entry points

- **WHEN** resolving the workspace
- **THEN** `scripts/**` is treated as entry, because scripts are invoked by shell
  and CI rather than imported
- **AND** the limitation that a dead script cannot be detected is documented

### Requirement: Per-class baseline ratchet

The Knip pass SHALL compare findings against a committed baseline recorded
**per finding class**, not as a single total, so a reduction in one class cannot
mask a regression in another. Exceeding any class's baseline SHALL fail.

#### Scenario: Regression in one class fails

- **WHEN** the `exports` count exceeds its recorded baseline
- **THEN** the pass fails
- **AND** the output names the class, the baseline, and the new count

#### Scenario: Offsetting changes do not mask a regression

- **WHEN** the `files` count falls by one and the `exports` count rises by two
- **THEN** the pass fails on the `exports` class
- **AND** the reduction in `files` does not offset it

#### Scenario: Counts at baseline pass

- **WHEN** every class is at or below its recorded baseline
- **THEN** the pass succeeds

#### Scenario: Baseline increase is rejected

- **WHEN** a change raises any recorded baseline number
- **THEN** the enforcer fails
- **AND** the failure states that dead code must be removed rather than the
  baseline raised

#### Scenario: Missing baseline fails loudly

- **WHEN** the pass runs with no committed baseline file
- **THEN** it fails with a named error
- **AND** it does not silently adopt the current counts as the baseline

### Requirement: Dependency hygiene is not Knip's concern

The dependency classes (`unlisted`, `dependencies`, `devDependencies`,
`binaries`, `optionalPeerDependencies`) SHALL be disabled in `knip.json`, because
`noUndeclaredDependencies` in `biome.json` already owns undeclared-dependency
detection at repo-root scope under the `code-quality-loop` capability. Two tools
SHALL NOT gate one rule, and Knip SHALL NOT re-report findings the Biome
overrides deliberately exempt.

#### Scenario: Dependency classes are disabled

- **WHEN** reading `knip.json`
- **THEN** every dependency class is disabled
- **AND** the config records that Biome's `noUndeclaredDependencies` owns the rule

#### Scenario: Knip reports no dependency findings

- **WHEN** the Knip pass runs
- **THEN** it reports zero findings in any dependency class

#### Scenario: Exempted trees are not re-litigated

- **WHEN** a file under `tests/e2e/`, `qa/scripts/`, `.pi/skills/**/scripts/`,
  `**/__tests__/`, or a `vitest.config.ts` imports a dependency it does not declare
- **THEN** the Knip pass reports nothing for it
- **AND** no manifest declaration is added, per the existing `code-quality-loop`
  scenario "Non-published trees are ignored, not declared"

