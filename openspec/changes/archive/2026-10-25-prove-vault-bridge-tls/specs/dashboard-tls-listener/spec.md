## MODIFIED Requirements

### Requirement: Optional native TLS listener
The server SHALL support an optional TLS listener, disabled by default, configured by a top-level `tls` block (`enabled`, `port` default `8443`, optional `host` defaulting to `127.0.0.1` regardless of the main listener's bind, `sources`, `acceptBridges` default `false`). When enabled, the listener SHALL serve the same HTTP routes and the same WebSocket upgrade paths as the main listener, plus the bridge upgrade path when bridge admission is switched on (see "Bridge admission over the TLS listener"), under the same host-admission, network-guard and authentication rules, with the same keep-alive, connection and request timeouts and the same client-error responses. The main HTTP listener SHALL be unaffected by the presence, absence, or failure of the TLS listener, except that host admission, which matches on the hostname alone, also admits the TLS listener's certificate names on the main listener.

#### Scenario: Disabled by default
- **WHEN** the config has no `tls` block or `tls.enabled` is `false`
- **THEN** no TLS port SHALL be bound and server behaviour SHALL be identical to before this change

#### Scenario: Same routes over TLS
- **WHEN** the TLS listener is running with a valid certificate for `host.example.ts.net`
- **THEN** `GET https://host.example.ts.net:8443/api/health` SHALL return the same response shape as the main listener
- **AND** a WebSocket upgrade to a supported path other than the bridge path over `wss://` SHALL be accepted under the same auth rules as on the main listener

#### Scenario: Same guard over TLS
- **WHEN** a request arrives on the TLS listener from a network the universal network guard blocks
- **THEN** it SHALL be rejected exactly as it would be on the main listener

#### Scenario: Certificate names pass host admission
- **WHEN** host admission runs in `enforce` mode and a request arrives with `Host: host.example.ts.net:8443` for a name the listener holds a certificate for
- **THEN** the request SHALL be admitted

#### Scenario: TLS listener failure is isolated
- **WHEN** the TLS port cannot be bound, or a reconcile after a config change fails
- **THEN** the main listener SHALL keep serving
- **AND** the failure SHALL be reported in TLS status with a human-readable error

#### Scenario: Bind retried until the address exists
- **WHEN** `tls.host` is the tailnet address and the tailscale daemon brings that address up two minutes after the server started
- **THEN** the TLS listener SHALL bind without a restart or config change

#### Scenario: Enabled without usable sources
- **WHEN** `tls.enabled` is `true` and `sources` is empty
- **THEN** the TLS port SHALL NOT be bound and TLS status SHALL report a `no-sources` gate as unmet

#### Scenario: Unknown source type rejected
- **WHEN** a config write contains a `tls.sources` entry with an unknown `type`, or a duplicate source `id`
- **THEN** the write SHALL be rejected with HTTP 400 and a validation error naming the entry

#### Scenario: Partial config write preserves sibling keys
- **WHEN** `PUT /api/config` carries `{ "tls": { "enabled": true } }` over a stored `tls` block with `port: 9443` and one source
- **THEN** the stored block SHALL keep `port: 9443` and its source

#### Scenario: No plaintext on the TLS port
- **WHEN** a client sends a plain-HTTP request to the TLS port
- **THEN** the server SHALL NOT serve application content over that connection

#### Scenario: Shutdown closes the TLS listener
- **WHEN** the server stops or restarts
- **THEN** the TLS listener and its open connections SHALL be closed

#### Scenario: Bridge path is not served by default
- **WHEN** the TLS listener is running and `tls.acceptBridges` is absent or `false`
- **THEN** a WebSocket upgrade to the bridge path on the TLS listener SHALL be refused exactly as on the main listener


## ADDED Requirements

### Requirement: Bridge admission over the TLS listener
When `tls.acceptBridges` is `true`, the TLS listener SHALL accept bridge WebSocket upgrades on the bridge path and hand them to the pi gateway. The same host-admission and cross-site gates SHALL apply, plus the remote bridge authentication of `pi-gateway-auth`, with no loopback or local-credential exemption. The main plaintext listener SHALL keep refusing the bridge path. A write of `acceptBridges` that is not a boolean SHALL be rejected with HTTP 400.

#### Scenario: Paired bridge connects over TLS
- **WHEN** `tls.acceptBridges` is `true` and a bridge presents a valid bridge ticket on `wss://host.example.ts.net:8443/ws/bridge`
- **THEN** the upgrade SHALL be accepted and the bridge SHALL be able to register a session

#### Scenario: Loopback peer still needs a ticket
- **WHEN** `tls.acceptBridges` is `true` and a loopback peer upgrades the bridge path on the TLS listener without a ticket
- **THEN** the upgrade SHALL be refused

#### Scenario: Main listener keeps refusing the bridge path
- **WHEN** `tls.acceptBridges` is `true` and a bridge upgrades `/ws/bridge` on the main plaintext listener
- **THEN** the upgrade SHALL be refused without consuming its ticket

#### Scenario: Turning the switch off closes bridge connections
- **WHEN** `tls.acceptBridges` changes to `false` while bridges are connected over the TLS listener
- **THEN** those bridge connections SHALL be closed, and new bridge upgrades on the TLS listener SHALL be refused

#### Scenario: Invalid switch value rejected
- **WHEN** `PUT /api/config` carries `{ "tls": { "acceptBridges": "yes" } }`
- **THEN** the write SHALL be rejected with HTTP 400 and the stored config SHALL be unchanged

### Requirement: Accept bridges switch in the Built-in HTTPS section
While the listener is enabled, Built-in HTTPS SHALL show an **Accept bridges** switch. The switch writes `tls.acceptBridges` immediately and reverts with an inline error on failure. With a reachable bind, the section SHALL show the copyable `wss://<advertised name>:<port>` bridge endpoint; with a loopback bind, the `bind-reachable` fix. It SHALL say that vault values reach paired devices only over this endpoint, with a TLS-only token.

#### Scenario: Switch writes only its key
- **WHEN** the operator turns Accept bridges on over a stored `tls` block with `port: 9443` and one source
- **THEN** the config write SHALL change only `tls.acceptBridges`
- **AND** the section SHALL show `wss://<advertised name>:9443` with a copy action

#### Scenario: Loopback bind hides the endpoint
- **WHEN** Accept bridges is on and `tls.host` is `127.0.0.1`
- **THEN** the section SHALL NOT show a bridge endpoint and SHALL show the `bind-reachable` fix

#### Scenario: Failed write reverts
- **WHEN** the Accept bridges write fails
- **THEN** the switch SHALL return to its previous state with an inline error
