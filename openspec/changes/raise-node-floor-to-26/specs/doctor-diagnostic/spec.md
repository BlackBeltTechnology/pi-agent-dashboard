## REMOVED Requirements

### Requirement: System Node detection matches the server accept-set
**Reason**: The server accept-set narrows to `>=26.0.0 <27`; the 22.19 / 24 LTS / 25 "usable" scenarios and the separate nodejs/node#58515 exclusion no longer apply.
**Migration**: Replaced by "System Node detection matches the Node 26 server accept-set", which keeps the same single shared gate and the same on-disk scan behaviour.

## ADDED Requirements

### Requirement: System Node detection matches the Node 26 server accept-set

`detectSystemNode()` SHALL report a Node binary as found/usable if and only if its `--version` passes the shared `isUsableNodeVersion(version)` gate — i.e. the version is within `package.json#engines.node` (`>=26.0.0 <27`). The same gate SHALL apply to both the PATH/registry-based detection and the on-disk scan fallback (`scanForUsableNodeOnDisk`). The doctor SHALL NOT report a system Node as usable that the dashboard server would refuse to start on.

The on-disk scan SHALL remain Unix-only; on `win32` it SHALL NOT execute.

#### Scenario: Node 26 reported usable

- **WHEN** the resolved system Node reports `v26.0.0` or any later `v26.x.x`
- **THEN** `detectSystemNode()` SHALL return `{ found: true, path: <node path> }`

#### Scenario: Node 24 LTS reported not usable

- **WHEN** the resolved system Node reports any `v24.x.x` AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: Node 25 reported not usable

- **WHEN** the resolved system Node reports any `v25.x.x` AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: Node 22 reported not usable

- **WHEN** the resolved system Node reports any `v22.x.x` AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: Node 27 reported not usable

- **WHEN** the resolved system Node reports `v27.0.0` or newer AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: On-disk scan applies the same gate

- **WHEN** PATH-based detection yields nothing AND `~/.nvm/versions/node/` contains both `v24.15.0` and `v26.0.0`
- **THEN** the scan SHALL skip the below-floor `v24.15.0`
- **AND** SHALL return the `v26.0.0` path
