## ADDED Requirements

### Requirement: Session registration reports the pi process's pid namespace

`session_register` SHALL carry an optional `pidNamespace` built by one shared builder at every register site. It holds:
- `platform`;
- `kind`, `"wsl"` with `distro` when `WSL_DISTRO_NAME` is set, else `"host"`;
- `nsId`, the Linux `/proc/self/ns/pid` link;
- `hostId`, the Linux `boot_id`, else the hostname.

Unreadable fields SHALL be omitted. The server SHALL store it atomically with `pid`, including on the provisional path. A register without `pid` SHALL clear both.

#### Scenario: Bridge inside WSL reports its distribution and namespace
- **WHEN** the bridge runs with `WSL_DISTRO_NAME=Ubuntu-24.04` and registers with `pid: 1083`
- **THEN** `pidNamespace` SHALL carry `platform: "linux"`, `kind: "wsl"`, `distro: "Ubuntu-24.04"`, `nsId` and `hostId`

#### Scenario: A provisional register keeps its namespace
- **WHEN** a session registers provisionally and is later committed
- **THEN** the stored namespace SHALL be the one the provisional register carried

#### Scenario: Reattach registers carry the field
- **WHEN** the bridge sends a reattach `session_register` with a `pid`
- **THEN** it SHALL include the same `pidNamespace` as the first register

#### Scenario: Legacy bridge omits the field
- **WHEN** a `session_register` without `pidNamespace` is received
- **THEN** the server SHALL record the namespace as unreported

#### Scenario: The namespace is persisted with the pid
- **WHEN** the server persists a session that has a `pid`
- **THEN** it SHALL persist the session's `pidNamespace` with it
- **AND** a session restored after a server restart SHALL resolve its pid target from that stored namespace

#### Scenario: The namespace is not sent to browsers or peers
- **WHEN** the server serializes a session for a browser (session list, session update, REST) or for a paired peer
- **THEN** the payload SHALL NOT contain `pidNamespace`

#### Scenario: A malformed namespace is an unusable report
- **WHEN** a `session_register` carries a `pidNamespace` with a wrong field type, `kind: "wsl"` without `distro`, a non-object value, a `distro` over 64 characters, or a `hostId` or `nsId` over 128 characters
- **THEN** the register SHALL still succeed
- **AND** the session's pid target SHALL resolve to `unknown`, neither `host` nor `foreign`
