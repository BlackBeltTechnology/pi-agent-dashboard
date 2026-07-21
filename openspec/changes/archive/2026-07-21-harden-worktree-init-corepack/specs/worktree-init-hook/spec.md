## ADDED Requirements

### Requirement: Run SHALL degrade gracefully when the pinned package-manager activator is unavailable

A declared hook's `run` command SHALL NOT hard-depend on a package-manager
*activator* (e.g. `corepack`) that is absent in a runtime the hook is executed
under; the run MAY assume the package manager itself is on PATH. The dashboard runs the hook under whichever
Node the server process resolves — including a bundled, stripped Node whose
`lib/node_modules/corepack` has been removed. When the activator is missing, an
unconditional `corepack enable && …` aborts the entire `&&` chain with
`command not found` before any real init step runs, and (because no assets are
produced) the gate stays open and the run re-fires indefinitely.

This is a coherence property of the project's declared hook, not new engine
behavior: the engine still runs whatever bash the project declares. Projects
whose `run` invokes a package-manager activator MUST make that invocation
best-effort — guard it (`command -v <activator> >/dev/null 2>&1 && <activator>
enable; …`) or otherwise ensure its absence does not abort the chain — so the run
falls through to the package manager already on PATH.

#### Scenario: Missing activator does not abort the run

- **GIVEN** a `run` whose intent is `<activator> enable && pnpm install && …`
- **AND** a runtime whose Node omits `<activator>` (not on PATH)
- **WHEN** the hook runs and `pnpm` IS on PATH at the pinned version
- **THEN** a coherent `run` SHALL NOT abort on the missing activator
- **AND** it SHALL proceed to `pnpm install` and the remaining chain and exit `0`

#### Scenario: Present activator is still used

- **GIVEN** the same guarded `run`
- **AND** a runtime where `<activator>` IS on PATH (e.g. Docker/CI)
- **WHEN** the hook runs
- **THEN** the guard SHALL evaluate true and `<activator> enable` SHALL still run before install

#### Scenario: Unguarded activator dependency re-fires forever (anti-pattern)

- **GIVEN** an unguarded `run` beginning `<activator> enable && …` and a gate that only reports satisfied once the run's assets exist
- **WHEN** the hook runs under a Node that omits `<activator>`
- **THEN** the chain aborts before producing any asset, the gate stays open, and the run re-fires on every trigger
- **AND** this configuration SHALL be treated as incoherent and corrected to guard the activator
