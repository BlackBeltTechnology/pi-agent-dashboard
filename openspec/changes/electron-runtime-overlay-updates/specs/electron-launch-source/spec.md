## ADDED Requirements

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
- **THEN** the resolver SHALL fall through to `bundled` AND SHALL record the failure reason

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
