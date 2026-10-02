## MODIFIED Requirements

### Requirement: Peer dependencies
The package SHALL declare `@earendil-works/pi-coding-agent` as an optional peer dependency so that the bridge extension resolves core packages from the host runtime's installation.

#### Scenario: Installed under pi
- **WHEN** the package is installed as a pi package via `pi install`
- **THEN** `@earendil-works/pi-coding-agent` satisfies the peer dependency

#### Scenario: No legacy fork peers
- **WHEN** the root `package.json` or any `packages/*/package.json` is inspected
- **THEN** neither `peerDependencies` nor `peerDependenciesMeta` SHALL contain `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai` or `@mariozechner/pi-tui`
