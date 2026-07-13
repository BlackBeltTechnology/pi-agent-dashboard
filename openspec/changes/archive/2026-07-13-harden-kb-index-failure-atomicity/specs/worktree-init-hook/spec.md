## MODIFIED Requirements

### Requirement: Gate evaluation determines init need

The server SHALL evaluate `worktreeInit.gate` as a bash command in the target checkout's cwd via `evaluateGate(cwd, hook)`. The result SHALL be `{ needsInit: true }` if and only if the gate process exits with code `0`. Any non-zero exit SHALL yield `{ needsInit: false }`. A spawn error or timeout SHALL fail closed (`{ needsInit: false }`) and be logged.

The same evaluation SHALL be used for a freshly created worktree and for the primary checkout (main / develop); the gate is unaware of which kind of checkout it runs in.

Because the gate is repo-declared bash, the server SHALL NOT evaluate it until the hook is trusted (TOFU). Init-status for an untrusted hook SHALL report hook presence without running the gate, and `needsInit` SHALL be unknown until trust is recorded. This closes a trust-boundary hole where merely viewing a directory would execute repo-declared code.

A gate sentinel that guards a generated asset which can exist while empty — notably the kb index database, whose file is written the instant the store opens (`CREATE TABLE IF NOT EXISTS`) — SHALL be coherent. Coherence is achieved at the *producer*: when `kb index` guarantees no committed file at `dbPath` on failure (see `markdown-knowledge-base` › "kb index is atomic on failure"), a file at `dbPath` reflects a successful run and `test ! -f <index.db>` is a coherent sentinel. The gate SHALL NOT probe non-emptiness as a coherence mechanism: a *legitimately* empty index (0 chunks from a source set with no markdown) is a valid, fully-initialized index and is indistinguishable from — and MUST NOT be conflated with — a failure husk. The husk is eliminated at the source (atomicity), so a present index — empty or populated — SHALL NOT be treated as needing init.

#### Scenario: Untrusted hook does not run the gate

- **WHEN** init-status is requested for a checkout whose hook is not yet trusted
- **THEN** the server SHALL NOT spawn the gate
- **AND** SHALL report `{ hasHook: true, trusted: false }` without a `needsInit` value

#### Scenario: Gate exits 0 means needs init

- **WHEN** the gate `test ! -d node_modules` runs in a checkout with no `node_modules/`
- **THEN** the gate exits `0`
- **AND** `evaluateGate` SHALL return `{ needsInit: true }`

#### Scenario: Gate exits non-zero means no init

- **WHEN** the gate `test ! -d node_modules` runs in a checkout that has `node_modules/`
- **THEN** the gate exits non-zero
- **AND** `evaluateGate` SHALL return `{ needsInit: false }`

#### Scenario: Gate spawn failure fails closed

- **WHEN** the gate command cannot be spawned
- **THEN** `evaluateGate` SHALL return `{ needsInit: false }`
- **AND** SHALL log the failure

#### Scenario: Interrupted init leaves no index and re-fires

- **GIVEN** a `run` that produces a kb index and a gate `test ! -f index.db` meant to detect its absence
- **WHEN** init was interrupted before the index committed, and the producer's atomicity guarantee left no file at `dbPath`
- **THEN** the gate SHALL exit `0` (needs init) so the run re-fires and builds the index

#### Scenario: Legitimately empty index does not re-fire

- **GIVEN** a checkout whose configured sources contain no markdown
- **WHEN** a successful `kb index` leaves a present, valid 0-chunk `index.db`
- **THEN** the gate `test ! -f index.db` SHALL exit non-zero (no init) — the empty index is a valid successful result, not a husk, and SHALL NOT re-fire the run
