## ADDED Requirements

### Requirement: Pi peer-dependency on the earendil package

The package SHALL declare `@earendil-works/pi-coding-agent` as an optional peer dependency (mirroring the bridge extension) and SHALL NOT declare `@mariozechner/pi-coding-agent`. It SHALL function with a pi runtime that exposes the documented `tool_call` event with mutable `event.input`.

#### Scenario: Earendil-org pi runtime

- **WHEN** the package is installed alongside `@earendil-works/pi-coding-agent`
- **THEN** the extension loads and the `tool_call` handler fires

#### Scenario: No legacy fork peer

- **WHEN** the package manifest is inspected
- **THEN** `peerDependencies` SHALL NOT contain `@mariozechner/pi-coding-agent`

## REMOVED Requirements

### Requirement: Pi peer-dependency compatibility
**Reason**: The `@mariozechner/pi-coding-agent` fork is no longer a supported pi; the old block's fork-specific scenarios cannot be dropped through MODIFIED.
**Migration**: Replaced by "Pi peer-dependency on the earendil package". Fork-only machines install `@earendil-works/pi-coding-agent`.
