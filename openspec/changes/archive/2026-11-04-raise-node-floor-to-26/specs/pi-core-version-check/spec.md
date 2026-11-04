## REMOVED Requirements

### Requirement: Node engines floor tracks pi minimum supported Node
**Reason**: The dashboard floor no longer tracks pi's minimum; it is a deliberate policy at `26.0.0`, above pi's `22.19.0`. The old scenarios pin `>=22.19.0 <25` / `>=22.19.0`, which are stale (the cap was already `<27`) and now wrong.
**Migration**: Replaced by "Node engines floor is at or above pi minimum supported Node", which keeps the safety invariant (floor never below pi's minimum) as a repo-lint.

## ADDED Requirements

### Requirement: Node engines floor is at or above pi minimum supported Node

The dashboard's declared Node engines floor SHALL be greater than or equal to pi's own minimum Node — the lower bound of `engines.node` in the `@earendil-works/pi-coding-agent` package.json resolved by the dashboard (`piCompatibility.minimum` is a pi semver, not a Node version). It is a deliberate dashboard support-policy choice and MAY sit above pi's minimum; today it is `26.0.0` while pi requires `22.19.0`. A repo-lint test SHALL fail if the dashboard floor ever drops below pi's minimum Node, so users do not encounter pi-side Node errors after the dashboard reports "ready".

The floor applies to two manifests:

- Root `package.json::engines.node` (informational; surfaced by `npm install` warnings).
- `packages/server/package.json::engines.node` (enforced for users installing the server package directly via npm).

`assertNodeVersionSupported()` (`packages/server/src/auth/node-guard.ts`) SHALL refuse to start on any Node version below the declared floor, with a clear stderr message naming the required range.

#### Scenario: Root engines.node declares the dashboard floor
- **WHEN** root `package.json` is read
- **THEN** `engines.node` SHALL be `">=26.0.0 <27"`

#### Scenario: Server engines.node declares the dashboard floor
- **WHEN** `packages/server/package.json` is read
- **THEN** `engines.node` SHALL be `">=26.0.0"` (no upper bound; the server consumes its host's Node)

#### Scenario: Dashboard floor at or above pi floor
- **WHEN** pi's `engines.node` lower bound is `22.19.0`
- **AND** the dashboard floor is `26.0.0`
- **THEN** the repo-lint test SHALL pass

#### Scenario: Lint fires when dashboard floor drops below pi floor
- **WHEN** a hypothetical change sets the dashboard floor below pi's `engines.node` lower bound
- **THEN** the repo-lint test SHALL fail naming both versions

#### Scenario: node-guard refuses below floor
- **WHEN** the server starts on Node `v24.15.0`
- **THEN** `assertNodeVersionSupported()` SHALL print the upgrade message and exit with code 1
- **AND** the upgrade message SHALL name `>=26.0.0 <27` as the required range

#### Scenario: node-guard accepts at floor
- **WHEN** the server starts on Node `v26.0.0` exactly
- **THEN** `assertNodeVersionSupported()` SHALL return without exiting
- **AND** the server proceeds to its normal startup path

## MODIFIED Requirements

### Requirement: Bundled Node version meets pi minimum Node

The Electron-bundled Node version (`packages/electron/scripts/_node-version.sh::BUNDLED_NODE_VERSION`) SHALL meet or exceed both pi's minimum Node (the lower bound of pi's `engines.node`) and the dashboard server floor. This invariant SHALL be enforced by a repo-lint test so that a future bundled-Node downgrade cannot silently cross under either floor.

#### Scenario: Bundled Node satisfies floor
- **WHEN** `BUNDLED_NODE_VERSION` is a `v26.x.y` release
- **AND** pi's `engines.node` lower bound is `22.19.0` and the dashboard floor is `26.0.0`
- **THEN** the lint test SHALL pass

#### Scenario: Lint fires on bundled-Node regression
- **WHEN** a hypothetical change sets `BUNDLED_NODE_VERSION` to `"v24.15.0"`
- **AND** the dashboard floor is `26.0.0`
- **THEN** the lint test SHALL fail with a message naming both versions and pointing to `_node-version.sh` as the file to edit
