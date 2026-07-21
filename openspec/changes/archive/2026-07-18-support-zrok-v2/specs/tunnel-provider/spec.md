## MODIFIED Requirements

### Requirement: Provider abstraction
The tunnel core SHALL expose a `TunnelProvider` interface so a tunnel can be created by any of
several providers (zrok, ngrok, tailscale, zerotier) through one seam. Provider-neutral
lifecycle (PID files, spawn timeout/retry, health watchdog, orphan scavenge, and an optional
`normalizeUrl` post-match hook) SHALL live in the core; provider-specific behaviour (binary
name resolution, spawn args, URL parsing/normalization, enrollment check, teardown) SHALL
live in each implementation.

#### Scenario: zrok behind the seam is behaviour-identical
- **WHEN** the server creates a zrok tunnel through the `TunnelProvider` implementation
- **THEN** `/api/tunnel-status` SHALL return an active tunnel URL through the same status contract
- **AND** the core SHALL own the zrok child PID-file and orphan-scavenge paths as before (provider-specific v2 share verbs are covered by the "zrok v2 behind the seam" scenario)

#### Scenario: zrok v2 behind the seam
- **WHEN** the server creates a zrok tunnel through the `TunnelProvider` implementation on a v2 install
- **THEN** `/api/tunnel-status` SHALL return an active `*.shares.zrok.io` URL
- **AND** reserved persistence SHALL use v2 named shares (`create name` / `share public -n public:<name>` / `delete name`), NOT the removed v1 `reserve`/`share reserved`/`release` verbs

#### Scenario: bare-host URL normalization via the core hook
- **WHEN** a provider's `urlRegex` matches a scheme-less host and the provider defines `normalizeUrl`
- **THEN** the core SHALL apply `normalizeUrl` before storing `activeTunnelUrl`

#### Scenario: child vs daemon lifecycle
- **WHEN** a provider declares `kind: "daemon"` (tailscale, zerotier)
- **THEN** the core SHALL treat connect/disconnect as idempotent commands against a long-lived daemon and SKIP the child-PID-file and child-watchdog paths
- **WHEN** a provider declares `kind: "child"` (zrok, ngrok)
- **THEN** the core SHALL own the child process, write its PID, and run the health watchdog

### Requirement: Provider and mode selection
`config.tunnel` SHALL carry `provider` and `mode`, both required when `enabled`. The server
SHALL refuse to connect when `mode` is unset or when the selected provider does not support
the selected mode. Config keys SHALL remain named `tunnel` (no rename of persisted keys). The
zrok sub-shape SHALL carry `reservedName` (v2 reserved name); a legacy `reservedToken` (v1)
SHALL be preserved on read for downgrade safety but SHALL NOT be used by the v2 provider and
SHALL NOT be promoted to `reservedName`.

#### Scenario: mode must be set explicitly
- **WHEN** `tunnel.enabled` is true and `tunnel.mode` is unset
- **THEN** the server SHALL NOT start a tunnel AND SHALL report a configuration error

#### Scenario: unsupported mode rejected
- **WHEN** `tunnel.provider` is `ngrok` or `zrok` and `tunnel.mode` is `private`
- **THEN** the server SHALL reject the configuration (public-only providers)
- **WHEN** `tunnel.provider` is `zerotier` and `tunnel.mode` is `public`
- **THEN** the server SHALL reject the configuration (private-only provider)

#### Scenario: legacy config back-compat
- **WHEN** an existing `config.json` has a bare `tunnel.reservedToken` and no `tunnel.provider`
- **THEN** the resolver SHALL treat it as `{ provider: "zrok", mode: "public", zrok: { reservedToken } }`

#### Scenario: legacy v1 reserved token is inert under v2
- **WHEN** an existing `config.json` has `tunnel.reservedToken` (or `tunnel.zrok.reservedToken`) and no `tunnel.zrok.reservedName`
- **THEN** the resolver SHALL still yield `{ provider: "zrok", mode: "public" }`, preserve the legacy token field on read, and the connect path SHALL NOT pass the v1 token to the v2 provider, so the provider creates an ephemeral share (never `share public -n public:<v1token>`)

#### Scenario: reservedName is plumbed through connect
- **WHEN** `tunnel.zrok.reservedName` is set and a connect is requested
- **THEN** the connect chain (config → CLI/server → `TunnelConnectOpts.reservedName` → provider) SHALL carry the name and the zrok provider SHALL serve that named share for a stable URL

#### Scenario: reservedName survives a partial config write
- **WHEN** a partial config write updates another `tunnel` field (e.g. `enabled`) while `tunnel.zrok.reservedName` is set
- **THEN** the deep-merge SHALL preserve `reservedName` (it is not dropped)
