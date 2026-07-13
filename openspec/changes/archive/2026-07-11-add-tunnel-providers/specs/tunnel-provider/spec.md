# tunnel-provider

## ADDED Requirements

### Requirement: Provider abstraction
The tunnel core SHALL expose a `TunnelProvider` interface so a tunnel can be created by any of several providers (zrok, ngrok, tailscale, zerotier) through one seam. Provider-neutral lifecycle (PID files, spawn timeout/retry, health watchdog, orphan scavenge) SHALL live in the core; provider-specific behaviour (binary name, spawn args, URL parsing, enrollment check, teardown) SHALL live in each implementation.

#### Scenario: zrok behind the seam is behaviour-identical
- **WHEN** the server creates a zrok tunnel through the new `TunnelProvider` implementation
- **THEN** `/api/tunnel-status` SHALL return output byte-identical to the pre-abstraction behaviour
- **AND** existing zrok reserved-share, PID-file, and scavenge behaviour SHALL be unchanged

#### Scenario: child vs daemon lifecycle
- **WHEN** a provider declares `kind: "daemon"` (tailscale, zerotier)
- **THEN** the core SHALL treat connect/disconnect as idempotent commands against a long-lived daemon, derive the URL from the provider's `status` output, and SKIP the child-PID-file and child-watchdog paths
- **WHEN** a provider declares `kind: "child"` (zrok, ngrok)
- **THEN** the core SHALL own the child process, write its PID, and run the health watchdog as today

### Requirement: Provider and mode selection
`config.tunnel` SHALL carry `provider` and `mode`, both required when `enabled`. The server SHALL refuse to connect when `mode` is unset or when the selected provider does not support the selected mode. Config keys SHALL remain named `tunnel` (no rename of persisted keys).

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

### Requirement: Accessible-endpoint enumeration
The server SHALL enumerate every address the dashboard answers on as tagged endpoints `{ kind, url, tls }` where `kind ∈ { public, mesh, magicdns, lan, local }`. Which kinds are present SHALL be provider- and mode-driven.

#### Scenario: private mesh emits mesh + magicdns
- **WHEN** the active provider is tailscale in private mode
- **THEN** the endpoint list SHALL include a `mesh` (100.x) endpoint and a `magicdns` name endpoint, each with `tls: false`, plus LAN and local

### Requirement: Server-side enroll via whitelisted recipe
Setup steps that require no elevation (auth-token, activate) SHALL run server-side through a fixed recipe keyed by `(provider, step)`, with the token/network-id supplied as a validated parameter — never as a free-form command. The secret SHALL be written to the provider's own config and SHALL NOT be logged. Install steps SHALL remain copy-paste with live detection, never auto-run.

#### Scenario: arbitrary command rejected
- **WHEN** a request to the enroll endpoint carries a command string outside the `(provider, step)` whitelist
- **THEN** the server SHALL reject it without executing anything

#### Scenario: secret not logged
- **WHEN** an auth-token recipe runs (e.g. `ngrok config add-authtoken`)
- **THEN** the token SHALL be redacted in any server log output

### Requirement: Pairing-QR transport gate and link QR
The device-pairing payload `{ v, id, code, urls[] }` SHALL contain ONLY TLS endpoints (`https://` / `wss://`), including MagicDNS names that carry a provisioned `tailscale cert`. No-TLS (`http://`) endpoints — mesh `100.x`/`10.x` IPs and LAN — SHALL NOT enter the pairing payload. For such no-TLS endpoints the UI SHALL instead offer a separate **link QR** that encodes the bare URL string only, which opens the dashboard directly WITHOUT invoking the pairing handshake. This keeps `qr-device-pairing` D14 intact.

#### Scenario: no-TLS endpoint excluded from pairing payload
- **WHEN** an active endpoint has `tls: false` (e.g. `http://100.101.22.7:8000`)
- **THEN** it SHALL NOT appear in the pairing payload `urls[]`
- **AND** the UI MAY offer it as a link QR encoding only the URL string

#### Scenario: TLS MagicDNS name is a pairing endpoint
- **WHEN** a MagicDNS name has a provisioned TLS cert (`https://host.tailnet.ts.net`)
- **THEN** it SHALL be eligible for the pairing payload `urls[]` like any other TLS endpoint

#### Scenario: link QR does not carry a secret
- **WHEN** a link QR is generated for a no-TLS http endpoint
- **THEN** its content SHALL be the URL string only, carrying no one-time code, bearer, or pairing payload

### Requirement: Trusted-network block events
The server SHALL record recent `localhost-guard` denials in a bounded buffer and expose them via an auth-gated endpoint so the UI can offer to add the refused source to `config.trustedNetworks` (exact IP or mesh subnet) and to remove existing entries.

#### Scenario: refused device surfaced and trusted
- **WHEN** a source IP is denied by the network guard
- **THEN** it SHALL appear in the block-event feed
- **AND** a one-click add SHALL append it to `config.trustedNetworks` and take effect on the next request from that IP
