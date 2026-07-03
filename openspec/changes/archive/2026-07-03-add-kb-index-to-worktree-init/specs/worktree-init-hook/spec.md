## ADDED Requirements

### Requirement: Gate SHALL cover every asset the run restores

A declared hook's `gate` SHALL evaluate to needs-init (exit 0) whenever ANY asset that its `run` produces is absent, not merely a single sentinel asset. Because `evaluateGate` reports `{ needsInit: true }` iff the gate exits 0, a gate that under-detects its run's outputs makes the run un-runnable: a checkout missing some-but-not-all restored assets reports `needsInit: false` and the run is silently skipped, leaving those assets permanently missing until the gate's single sentinel also disappears.

This is a coherence property of the project's declared hook, not new engine behavior: the engine still runs whatever bash the project declares. Projects MUST author the `gate` to test every asset the `run` restores.

#### Scenario: Partially-initialized checkout still needs init

- **GIVEN** a `run` that restores multiple assets (e.g. `node_modules`, generated skills, a kb index)
- **WHEN** the gate runs in a checkout where `node_modules` exists but a generated skill directory or the kb index is absent
- **THEN** a coherent gate SHALL exit `0` (needs init)
- **AND** `evaluateGate` SHALL return `{ needsInit: true }` so the run re-fires and restores the missing assets

#### Scenario: Fully-initialized checkout does not need init

- **WHEN** the gate runs in a checkout where every asset the `run` produces is present
- **THEN** the gate SHALL exit non-zero
- **AND** `evaluateGate` SHALL return `{ needsInit: false }`

#### Scenario: Sentinel-only gate under-detects (anti-pattern)

- **GIVEN** a gate that tests only `node_modules` while its `run` also produces generated skills and a kb index
- **WHEN** a checkout has `node_modules` but is missing the generated skills or kb index
- **THEN** the gate exits non-zero and the run is skipped — the missing assets are NOT restored
- **AND** this configuration SHALL be treated as incoherent and corrected to test all restored assets
