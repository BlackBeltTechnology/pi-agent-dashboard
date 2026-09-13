## MODIFIED Requirements

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
