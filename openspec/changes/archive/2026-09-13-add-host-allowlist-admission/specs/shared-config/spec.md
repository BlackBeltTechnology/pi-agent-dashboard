## ADDED Requirements

### Requirement: `allowedHosts` config field
The config loader SHALL support an optional top-level `allowedHosts: string[]`, filtered to string entries, defaulting to an empty list. Each entry is a bare hostname (no scheme, no port); entries are compared case-insensitively. The field is for hostnames the dashboard answers on that are not already implied by `publicBaseUrls`, `cors.allowedOrigins`, a live tunnel, an IP literal, loopback, or `.local` — an operator SHALL NOT need to duplicate a public base URL's host here.

#### Scenario: Absent field defaults to empty
- **WHEN** `config.json` has no `allowedHosts` key
- **THEN** the loaded config SHALL expose `allowedHosts` as `[]`

#### Scenario: Non-string entries are dropped
- **WHEN** `allowedHosts` is `["dash.home.arpa", 42, null]`
- **THEN** the loaded value SHALL be `["dash.home.arpa"]`

#### Scenario: Partial config writes preserve the field
- **WHEN** any runtime writer updates an unrelated key (e.g. `auth`) while `allowedHosts` is set
- **THEN** `allowedHosts` SHALL be unchanged in the written file

### Requirement: `hostGate.mode` config field
The config loader SHALL support an optional `hostGate: { mode: "report" | "enforce" }`. An absent object or an unrecognised `mode` SHALL load as `{ mode: "report" }`. The key SHALL NOT be seeded by `ensureConfig()`. `writeConfigPartial` SHALL accept `hostGate` and write the object whole (it has one key; no deep-merge).

#### Scenario: Absent defaults to report
- **WHEN** `config.json` has no `hostGate` key
- **THEN** the loaded config SHALL expose `hostGate.mode` as `"report"`

#### Scenario: Unrecognised mode falls back
- **WHEN** `hostGate.mode` is `"yes"`
- **THEN** the loaded value SHALL be `"report"`

#### Scenario: Write persists enforce
- **WHEN** `PUT /api/config` carries `{ hostGate: { mode: "enforce" } }`
- **THEN** the written file SHALL hold `hostGate.mode: "enforce"` and every other key SHALL be unchanged

## MODIFIED Requirements

### Requirement: Live config reads for CORS and the network guard
The CORS origin decision, the network guard's trusted-network check, and the host-admission decision SHALL read current configuration at request time, not a boot snapshot, so an origin, CIDR, public base URL, allowed host, or host-gate mode written at runtime applies with no restart.

The read SHALL be an mtime-gated snapshot: the config file's stat is checked on each call and the file reparsed only when it changed. The cache SHALL NOT be converted into a boot-time snapshot, and SHALL NOT rely solely on invalidate-on-write, because a hand-edited `config.json` never passes through the writer.

The runtime auth reload SHALL merge the top-level `trustedNetworks` exactly as boot does, so an auth-carrying config write cannot silently drop them until restart.

#### Scenario: Origin added at runtime
- **WHEN** an origin is added to `cors.allowedOrigins` while the server is running
- **THEN** the next preflight from that origin SHALL be allowed with no restart

#### Scenario: Trusted network added at runtime
- **WHEN** a CIDR is added to `trustedNetworks` while the server is running
- **THEN** the next request from that range SHALL be admitted with no restart

#### Scenario: Allowed host added at runtime
- **WHEN** a hostname is added to `allowedHosts` or a URL is added to `publicBaseUrls` while the server is running
- **THEN** the next request with that `Host` SHALL be admitted by the host gate with no restart

#### Scenario: Unchanged config is parsed once
- **WHEN** many requests are served with the config file unchanged
- **THEN** exactly one read-and-parse SHALL occur

#### Scenario: Mid-run rewrite is observed
- **WHEN** the config file is rewritten by any writer, including a hand edit
- **THEN** subsequent reads SHALL observe the new value without an explicit invalidation

#### Scenario: Auth reload preserves top-level trusted networks
- **WHEN** the server booted with a top-level `trustedNetworks` entry and any auth reload runs
- **THEN** an address in that range SHALL still bypass the auth gate
