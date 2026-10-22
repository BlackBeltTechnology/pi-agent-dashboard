## MODIFIED Requirements

### Requirement: Overlay and local-link launch sources

The launch-source resolver SHALL support two additional kinds: `localLink` (a user-configured checkout) and `overlay` (a staged runtime release). Precedence SHALL be `attach → devMonorepo → localLink → overlay → bundled`. `localLink` SHALL be considered only when the effective runtime source is `local`, and `overlay` only when it is `npm` or `github`. The effective source SHALL be the most recently chosen of the dashboard source selection and the app-menu local folder. A candidate failing its compatibility gate or probe SHALL fall through to the next kind instead of raising an error.

#### Scenario: Overlay selected

- **WHEN** runtime source is `npm` or `github` AND a compatible current or pending overlay exists AND no server is running
- **THEN** the resolver SHALL return `overlay` with the overlay's server entry and working directory

#### Scenario: Local link selected

- **WHEN** runtime source is `local` AND the checkout passes preflight
- **THEN** the resolver SHALL return `localLink` with the checkout's server entry

#### Scenario: Overlay incompatible

- **WHEN** the overlay fails the compatibility gate
- **THEN** the resolver SHALL fall through to `bundled` AND SHALL record the failure reason (a cold launch only; the read-only expected-runtime resolution SHALL NOT record it, see "Expected-runtime resolution is side-effect free")

#### Scenario: Remote source chosen after local

- **WHEN** a local folder was linked AND the user later chooses `npm`, `github` or `bundled` in Settings
- **THEN** the resolver SHALL NOT return `localLink`

#### Scenario: Local link startup deadline

- **WHEN** the resolver returns `localLink`
- **THEN** the health deadline SHALL be the same as for `devMonorepo`

#### Scenario: Activation never attaches

- **WHEN** the resolver is invoked for a runtime activation
- **THEN** it SHALL NOT return `attach`, even if a server still answers the health probe

#### Scenario: Unpackaged dev run unaffected

- **WHEN** the app is unpackaged AND the working directory is the monorepo
- **THEN** the resolver SHALL return `devMonorepo` regardless of runtime source

## ADDED Requirements

### Requirement: Expected runtime version without spawning

The app SHALL determine, without spawning a server, which runtime it would launch on a cold start and that runtime's version. Resolution SHALL use the cold-launch priority chain with the attach probe skipped, honouring a pinned override and the same compatibility gates. The expected version SHALL be the `version` in the resolved `overlay` or `bundled` runtime's `runtime-manifest.json`; it SHALL be unknown for `devMonorepo`, `localLink`, or an unreadable manifest.

#### Scenario: Bundle is the expected runtime

- **GIVEN** a packaged app with no usable overlay and a bundle whose `runtime-manifest.json` declares `version: "0.10.0"`
- **WHEN** the expected runtime version is resolved
- **THEN** the result SHALL be source `bundled` with version `0.10.0`

#### Scenario: Active overlay is the expected runtime

- **GIVEN** a packaged app whose bundle declares `0.10.0` and a compatible staged overlay declaring `0.10.1`
- **WHEN** the expected runtime version is resolved
- **THEN** the result SHALL be source `overlay` with version `0.10.1`

#### Scenario: Non-release source yields unknown

- **WHEN** the resolved source is `devMonorepo` or `localLink`
- **THEN** the expected version SHALL be unknown

### Requirement: Expected-runtime resolution is side-effect free

Resolving the expected runtime version SHALL NOT write any runtime-overlay file (state or request), SHALL NOT record failures or attempts, and SHALL NOT register or re-point the bridge extension. Decisions a cold launch would persist (consuming an explicit update request, marking an exhausted pending runtime bad) SHALL be applied in memory only, so the result matches the next cold launch.

#### Scenario: Incompatible overlay is skipped without recording a failure

- **GIVEN** a staged overlay that fails the compatibility gate
- **WHEN** the expected runtime version is resolved
- **THEN** the result SHALL fall through to the next source as a cold launch would
- **AND** the runtime state SHALL NOT gain a `lastFailure` or an attempt count for that overlay

#### Scenario: Exhausted pending runtime is resolved but not persisted

- **GIVEN** a pending overlay that has used all its activation attempts without committing
- **WHEN** the expected runtime version is resolved
- **THEN** the result SHALL skip that overlay as a cold launch would
- **AND** the runtime-overlay state and request files SHALL be byte-identical before and after
