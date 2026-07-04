## ADDED Requirements

### Requirement: Package tsconfigs declare no project references
Package `tsconfig.json` files SHALL NOT declare a TypeScript `references` array unless the repository adopts composite project build mode (every referenced project sets `"composite": true` and builds run via `tsc -b`). The canonical type-check is the root flat program (`tsc --noEmit` over `packages/*/src`), which does not use project references.

#### Scenario: No package tsconfig declares references
- **WHEN** reading `packages/*/tsconfig.json`
- **THEN** no file SHALL contain a `references` array

#### Scenario: Isolated single-project type-check does not error
- **WHEN** running `tsc --noEmit -p packages/extension`
- **THEN** TypeScript SHALL NOT raise `TS6306` (referenced project must have "composite": true)

#### Scenario: Canonical root type-check stays green
- **WHEN** running `tsc --noEmit` from the repo root
- **THEN** the command SHALL exit 0
