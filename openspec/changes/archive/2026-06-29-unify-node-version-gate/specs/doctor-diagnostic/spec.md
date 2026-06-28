## ADDED Requirements

### Requirement: System Node detection matches the server accept-set

`detectSystemNode()` SHALL report a Node binary as found/usable if and only if its `--version` passes the shared `isUsableNodeVersion(version)` gate — i.e. the version is within `package.json#engines.node` (`>=22.19.0 <26`) AND not in the nodejs/node#58515 Fastify-affected range (v22.0–v22.18, v24.1–v24.2). The same gate SHALL apply to both the PATH/registry-based detection and the on-disk scan fallback (`scanForUsableNodeOnDisk`). The doctor SHALL NOT report a system Node as usable that the dashboard server would refuse to start on.

The on-disk scan SHALL remain Unix-only; on `win32` it SHALL NOT execute.

#### Scenario: Node 22.18 reported not usable

- **WHEN** the resolved system Node reports `v22.18.0` AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: Node 22.19 reported usable

- **WHEN** the resolved system Node reports `v22.19.0`
- **THEN** `detectSystemNode()` SHALL return `{ found: true, path: <node path> }`

#### Scenario: Node 24 LTS reported usable

- **WHEN** the resolved system Node reports `v24.3.0` through any later `v24.x.x`
- **THEN** `detectSystemNode()` SHALL return `{ found: true, path: <node path> }`

#### Scenario: Node 24.1 / 24.2 reported not usable

- **WHEN** the resolved system Node reports `v24.1.0` or `v24.2.0` AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: Node 25 reported usable

- **WHEN** the resolved system Node reports any `v25.x.x`
- **THEN** `detectSystemNode()` SHALL return `{ found: true, path: <node path> }`

#### Scenario: Node 26 reported not usable

- **WHEN** the resolved system Node reports `v26.0.0` or newer AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: Node 21 reported not usable

- **WHEN** the resolved system Node reports any `v21.x.x` AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: On-disk scan applies the same gate

- **WHEN** PATH-based detection yields nothing AND `~/.nvm/versions/node/` contains both `v22.18.0` and `v24.15.0`
- **THEN** the scan SHALL skip the affected/below-floor `v22.18.0`
- **AND** SHALL return the `v24.15.0` path
