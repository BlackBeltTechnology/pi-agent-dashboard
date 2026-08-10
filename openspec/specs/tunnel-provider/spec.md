# tunnel-provider Specification

## Purpose
TBD - created by archiving change add-tunnel-providers. Update Purpose after archive.
## Requirements
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

The "Connect a device" view SHALL present **exactly one QR code at a time**, chosen through a **network selector** listing every available endpoint (each tagged by `kind` and by mode — `pairing` for TLS endpoints, `link` for no-TLS endpoints). The selector SHALL default to the public TLS pairing endpoint when one exists; when no TLS endpoint exists, it SHALL default to the first available link endpoint. The view SHALL NOT render multiple QR codes simultaneously. The QR content for the selected endpoint SHALL follow the transport gate above unchanged: a TLS selection encodes the pairing payload, a no-TLS selection encodes the bare URL string only.

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

#### Scenario: exactly one QR shown at a time
- **WHEN** the "Connect a device" view renders with a tunnel plus multiple no-TLS endpoints
- **THEN** exactly one QR code SHALL be visible
- **AND** a selector SHALL list every endpoint so the user can switch which one the QR encodes

#### Scenario: tunnel is the default selection
- **WHEN** the view opens and at least one TLS pairing endpoint exists
- **THEN** the selector SHALL default to the public TLS endpoint and the QR SHALL encode its pairing payload

#### Scenario: default falls back to a link when no TLS endpoint exists
- **WHEN** the view opens and no TLS endpoint exists (tunnel off, no https URL)
- **THEN** the selector SHALL default to the first available no-TLS endpoint and the QR SHALL encode its bare URL

#### Scenario: selecting a link endpoint swaps the pairing controls out
- **WHEN** the user selects a no-TLS `link` endpoint in the selector
- **THEN** the QR SHALL encode that endpoint's bare URL
- **AND** the pairing-only controls (copy-string, confirmation-code input, expiry countdown) SHALL be hidden in favour of a "opens the dashboard directly, no pairing" note

### Requirement: Trusted-network block events
The server SHALL record recent `localhost-guard` denials in a bounded buffer and expose them via an auth-gated endpoint so the UI can offer to add the refused source to `config.trustedNetworks` (exact IP or mesh subnet) and to remove existing entries.

#### Scenario: refused device surfaced and trusted
- **WHEN** a source IP is denied by the network guard
- **THEN** it SHALL appear in the block-event feed
- **AND** a one-click add SHALL append it to `config.trustedNetworks` and take effect on the next request from that IP

