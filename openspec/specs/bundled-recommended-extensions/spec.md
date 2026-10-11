## Purpose

Define the curated recommended-extensions manifest (`RECOMMENDED_EXTENSIONS`) and the subset bundled inside the Electron installer (`BUNDLED_EXTENSION_IDS`): membership rules (the bundled manifest is currently empty), and the entry `source`/`requires` contract with live probing.

## Requirements

### Requirement: Bundled extension manifest
The system SHALL declare the set of pi extensions pre-bundled with the Electron installer via a single exported constant `BUNDLED_EXTENSION_IDS` in `packages/shared/src/recommended-extensions.ts`. Every id in this list MUST also appear in `RECOMMENDED_EXTENSIONS`. The list SHALL be empty: the installer ships no pre-bundled extension trees, and every recommended extension installs through the recommended-extensions UI.

#### Scenario: Manifest is the single source of truth
- **WHEN** runtime code needs to know whether an extension is pre-bundled
- **THEN** it SHALL import `BUNDLED_EXTENSION_IDS` from `packages/shared/src/recommended-extensions.ts` and not hard-code the list anywhere else

#### Scenario: Bundled id must be a recommended id
- **WHEN** `BUNDLED_EXTENSION_IDS` contains an id not present in `RECOMMENDED_EXTENSIONS`
- **THEN** a test in `packages/shared/src/__tests__/` SHALL fail at build time

#### Scenario: Initial bundled set
- **WHEN** the manifest is evaluated at release time
- **THEN** it SHALL be the empty list `[]`
- **AND** an installed recommended extension SHALL NOT be reported as bundled

### Requirement: Recommended manifest membership reflects first-party defaults
The `RECOMMENDED_EXTENSIONS` constant in `packages/shared/src/recommended-extensions.ts` SHALL enumerate the pi extensions the dashboard team promotes as defaults, and each entry's `source` SHALL match the published/installable artifact that satisfies it. The manifest SHALL NOT recommend `@blackbelt-technology/pi-model-proxy`; the dashboard's built-in model proxy supersedes it.

#### Scenario: Curated additions present
- **WHEN** the manifest is evaluated at release time
- **THEN** it SHALL contain entries for `context-mode` (status `strongly-suggested`), `pi-hermes-memory`, `@ricoyudog/pi-goal-hermes`, and `pi-simplify`, in addition to the pre-existing required/strongly-suggested entries
- **AND** it SHALL NOT contain an entry whose `id` or `source` names `@blackbelt-technology/pi-model-proxy`

#### Scenario: Source field matches the satisfying artifact
- **WHEN** an entry declares a `source`
- **THEN** that `source` SHALL resolve to the artifact that `sourcesMatch()` recognizes as satisfying the entry — specifically image-fit SHALL use `npm:@blackbelt-technology/pi-image-fit-extension` and pi-flows SHALL use `npm:@blackbelt-technology/pi-flows`

#### Scenario: pi-flows stays out of the bundled set
- **WHEN** pi-flows `source` is switched to the npm spec
- **THEN** `pi-flows` SHALL NOT be added to `BUNDLED_EXTENSION_IDS` until upstream declares an SPDX-conformant license

#### Scenario: Manifest-shape test updated
- **WHEN** entries are added, removed, or their `source` changes
- **THEN** the manifest-shape test(s) in `packages/shared/src/__tests__/` SHALL assert the new membership and pass

### Requirement: Recommended-extension external requirements are declared and probed
`RecommendedExtension` SHALL support an optional `requires` declaration (`piExtensions` / `binaries` / `services`), and the recommended route SHALL surface a live probe result per requirement.

#### Scenario: requires declared and probed
- **WHEN** a recommended entry declares `requires` (e.g. `pi-agent-browser` binary `agent-browser`)
- **THEN** `GET /api/packages/recommended` SHALL return a structured probe (`{ name, satisfied }` per category) computed with the same probe used for dashboard-plugin `requires`, and `RecommendedExtensions.tsx` SHALL render satisfied/missing state

#### Scenario: native npm deps are NOT declared as requires
- **WHEN** an extension's only external dependency is a native npm module it bundles (e.g. hermes → `better-sqlite3`)
- **THEN** it SHALL NOT declare that module under `requires.binaries` — a bundled native dep is not a user-provided system requirement

#### Scenario: unknown service names are not declared
- **WHEN** an extension's external requirement is a service absent from the closed probe registry (e.g. a self-hosted analytics server)
- **THEN** it SHALL NOT declare that name under `requires.services` (it would always report unsatisfied); the need is surfaced via the companion dashboard plugin instead
