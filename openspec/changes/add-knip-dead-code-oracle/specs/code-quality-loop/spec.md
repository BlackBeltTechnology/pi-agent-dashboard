# Code Quality Loop

## ADDED Requirements

### Requirement: Whole-graph checks stay off the per-change loop

The quality oracle SHALL distinguish per-change checks from whole-graph checks,
and SHALL keep whole-graph checks out of `quality:changed`, because a
changed-file scope cannot decide reachability across the workspace.

#### Scenario: Changed-scope loop excludes whole-graph checks

- **WHEN** the changed-files quality loop runs
- **THEN** only per-change checks execute
- **AND** dead-code detection is not among them

#### Scenario: Whole-graph check has a documented home

- **WHEN** a check is classified as whole-graph
- **THEN** its execution home is the ship gate or nightly, not the per-change loop
- **AND** the classification is recorded in the code-quality documentation

### Requirement: The dead-code ratchet gates at the ship enforcer

The dead-code ratchet SHALL run as a deterministic enforcer in the `ship-it`
enforcer step, because that is the point in this repo where a check can actually
prevent a regression from landing. A nightly job detects after merge; it does
not gate.

#### Scenario: Enforcer blocks a regression before it lands

- **WHEN** the enforcer step runs on a tree whose Knip counts exceed the baseline
- **THEN** the enforcer exits non-zero
- **AND** the change does not proceed to the review step

#### Scenario: Enforcer is offline and deterministic

- **WHEN** the enforcer runs
- **THEN** it requires no network and no model call
- **AND** repeated runs on an unchanged tree produce the same verdict

#### Scenario: Clean tree passes the enforcer

- **WHEN** every class is at or below its baseline
- **THEN** the enforcer exits zero

### Requirement: Undeclared dependencies have exactly one owning engine

`noUndeclaredDependencies` in `biome.json` SHALL remain the sole gate for
undeclared dependencies. Any other engine capable of reporting that class SHALL
disable it, so one rule is never adjudicated twice under conflicting policies.

#### Scenario: Knip defers the dependency classes to Biome

- **WHEN** reading `knip.json`
- **THEN** every dependency class is disabled
- **AND** the config records Biome as the owner

#### Scenario: Biome remains the reporting engine

- **WHEN** an undeclared dependency is introduced in a published file
- **THEN** Biome's `noUndeclaredDependencies` reports it
- **AND** the Knip pass does not report it
