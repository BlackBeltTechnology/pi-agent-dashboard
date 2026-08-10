## ADDED Requirements

### Requirement: The owned enforcers gate where a gate actually runs

The repo-convention, byte-cap, and i18n enforcers SHALL be invoked by `ship-it`
step 4.4, not by `quality:changed`. `quality:changed` has no automated caller —
it is absent from `.github/workflows/`, from `ship-it`, and from `ship-change`,
and is invoked only by the `code-quality` skill's interactive dev loop — so
wiring gating checks there would produce a gate that gates nothing. The existing
`quality:changed` definition SHALL remain unchanged by this change.

#### Scenario: Enforcers run on the ship path

- **WHEN** `ship-it` reaches step 4.4
- **THEN** `check-conventions.mjs --base origin/develop`, the `kb dox lint` byte-arm gate, `i18n:lint --strict`, and `i18n:parity` all run
- **AND** a non-zero exit from any of them stops the ship before the review checkpoint

#### Scenario: quality:changed is not silently redefined

- **WHEN** the change's diff is inspected
- **THEN** the `quality:changed` script definition is unmodified
- **AND** no claim is made that it gates the new enforcers

#### Scenario: Enforcers stay independently runnable

- **WHEN** a developer runs any enforcer directly from the command line
- **THEN** it behaves the same as when `ship-it` invokes it

### Requirement: An enforcer is repaired before it is wired

A check SHALL NOT be wired into a gate while it is broken. Every enforcer this
change wires SHALL be verified to run correctly against the current tree first,
and its violation count re-derived rather than quoted from a proposal.

#### Scenario: Broken enforcer repaired first

- **WHEN** `i18n-parity.mjs` exits non-zero because it reads a path removed by the client reorganisation
- **THEN** its path is repaired and the script verified to exit 0
- **AND** only then is it wired into step 4.4

#### Scenario: Advisory enforcer is made gating explicitly

- **WHEN** `i18n-lint.mjs` is wired
- **THEN** it is invoked with `--strict`, because it exits 0 regardless of findings without that flag

#### Scenario: An over-broad enforcer is narrowed, not adopted wholesale

- **WHEN** an enforcer's default exit code covers more failure kinds than the change intends to gate
- **THEN** the gate consumes its machine-readable output and fails only on the intended kind
- **AND** the enforcer's unrelated pre-existing findings are not adopted as blocking

#### Scenario: Counts are re-derived, not quoted

- **WHEN** a violation count is used to size the work
- **THEN** it is measured against the current tree at implementation time

### Requirement: The oracle grows beyond static analysis with a semantic reviewer

The quality oracle SHALL be understood as syntactic (Biome), type-level (`tsc`),
behavioural (`vitest`), convention-level (the step-4.4 enforcers), and semantic
(the `local-review-gate` checkpoint). The semantic layer SHALL NOT be part of any
deterministic npm script, because it requires the change's intent and a green
integrated tree.

#### Scenario: Semantic layer stays out of the deterministic scripts

- **WHEN** `quality:changed` runs
- **THEN** no model-backed reviewer is invoked
- **AND** the script remains deterministic and offline-runnable

#### Scenario: Documentation names all five layers

- **WHEN** `docs/code-quality.md` is read
- **THEN** it describes the syntactic, type-level, behavioural, convention-level, and semantic layers
- **AND** it states where each layer is invoked
