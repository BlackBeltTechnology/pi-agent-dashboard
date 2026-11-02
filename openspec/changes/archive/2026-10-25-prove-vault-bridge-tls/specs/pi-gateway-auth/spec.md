## ADDED Requirements

### Requirement: A remote bridge enforces certificate validation on TLS connections
A bridge SHALL NOT make a TLS connection to a remote dashboard without certificate validation. This covers a `wss` dial and every `https` credential call. The check SHALL run at each call. When validation is disabled in the process, the bridge SHALL NOT send its bearer, SHALL NOT dial, and SHALL report `tls-verify-disabled`. Plain `ws`/`http` endpoints are unaffected. A bridge that enforces this SHALL say so when it registers and in its vault sync request.

#### Scenario: Validation disabled stops a TLS bridge
- **WHEN** a remote bridge with `PI_DASHBOARD_URL=wss://dash.example:8443` runs with `NODE_TLS_REJECT_UNAUTHORIZED=0`
- **THEN** it SHALL NOT request a ticket and SHALL NOT dial
- **AND** it SHALL report the `tls-verify-disabled` cause naming the variable

#### Scenario: Validation disabled at runtime
- **WHEN** `NODE_TLS_REJECT_UNAUTHORIZED` is set to `0` after a TLS bridge has connected, and the bridge reconnects
- **THEN** the reconnect's ticket mint SHALL be refused with `tls-verify-disabled`

#### Scenario: Plain endpoint unaffected
- **WHEN** a remote bridge with `PI_DASHBOARD_URL=ws://dash.example:9999` and a token without the `pi_tls_` prefix runs with `NODE_TLS_REJECT_UNAUTHORIZED=0`
- **THEN** it SHALL mint and connect as before

#### Scenario: Untrusted certificate is refused
- **WHEN** a remote bridge dials `wss://dash.example:8443` and the server presents a certificate that does not chain to a trusted CA
- **THEN** the TLS handshake SHALL fail and the bridge SHALL NOT register

#### Scenario: Private CA keeps working
- **WHEN** the server's certificate chains to a CA supplied through `NODE_EXTRA_CA_CERTS`
- **THEN** the bridge SHALL mint its ticket and connect normally

#### Scenario: Refusal order
- **WHEN** `PI_DASHBOARD_HTTP_URL` is invalid and certificate validation is disabled
- **THEN** the bridge SHALL report `bad-http-url`, not `tls-verify-disabled`

### Requirement: A TLS-only token never leaves the bridge in plaintext
A bridge SHALL NOT send a token with the `pi_tls_` prefix to any origin that is not `https`, under any endpoint or `PI_DASHBOARD_HTTP_URL` configuration. It SHALL report a named `tls-only-token` cause instead.

#### Scenario: TLS-only token with a plaintext endpoint
- **WHEN** a bridge holding a `pi_tls_` token has `PI_DASHBOARD_URL=ws://dash.example:9999`
- **THEN** it SHALL NOT send the token to `http://dash.example:8000`
- **AND** it SHALL report `tls-only-token` naming `wss://` as the fix

#### Scenario: TLS-only token with an HTTPS origin and a plain gateway
- **WHEN** a bridge holding a `pi_tls_` token has `PI_DASHBOARD_URL=ws://dash.example:9999` and `PI_DASHBOARD_HTTP_URL=https://dash.example:8443`
- **THEN** it SHALL mint its ticket from `https://dash.example:8443` and connect to `ws://dash.example:9999`

#### Scenario: TLS-only token refused by a relaying proxy
- **WHEN** a bridge holding a `pi_tls_` token mints at an `https` origin served by a TLS-terminating tunnel, and the dashboard answers 401 `tls_only_token_untrusted_channel`
- **THEN** the bridge SHALL report `tls-only-token-relayed`, not an unpaired or revoked token

#### Scenario: TLS-only token with a plaintext HTTP override
- **WHEN** a bridge holding a `pi_tls_` token has `PI_DASHBOARD_URL=wss://dash.example:8443` and `PI_DASHBOARD_HTTP_URL=http://dash.example:8000`
- **THEN** it SHALL NOT send the token and SHALL report `tls-only-token`

### Requirement: A ticket-admitted TLS bridge is attributed to its device
The native TLS listener SHALL admit a bridge only with a ticket minted for a paired device, consuming the ticket exactly once. It SHALL attribute the connection to that device as remote, whatever its peer address.

#### Scenario: Loopback forwarder in front of the TLS listener
- **WHEN** a paired device reaches the TLS listener bound to `127.0.0.1` through a local forwarder, and registers with its device ticket
- **THEN** the session SHALL be attributed to that device as remote, not to the hub

#### Scenario: Deviceless ticket refused on the TLS listener
- **WHEN** a bridge upgrades the bridge path on the native TLS listener with a ticket minted by a bearer-less local caller
- **THEN** the upgrade SHALL be refused

#### Scenario: TLS refusals are named
- **WHEN** the TLS listener refuses a bridge upgrade because Accept bridges is off, the ticket has no device, or the gateway is not ready
- **THEN** the server log SHALL name `tls-bridges-off`, `tls-deviceless-ticket` or `tls-gateway-not-ready` respectively

#### Scenario: Ticket consumed once
- **WHEN** a bridge with a valid device ticket upgrades on the native TLS listener while the gateway's TCP listener is also enabled
- **THEN** the upgrade SHALL be accepted, and presenting the same ticket again SHALL be refused

### Requirement: A path-less TLS bridge endpoint dials the bridge path
A bridge whose endpoint is `wss://` with an empty or `/` path SHALL dial the bridge path `/ws/bridge`. An endpoint with any other path SHALL be dialled unchanged.

#### Scenario: Built-in HTTPS endpoint
- **WHEN** `PI_DASHBOARD_URL=wss://dash.example.ts.net:8443`
- **THEN** the bridge SHALL dial `wss://dash.example.ts.net:8443/ws/bridge` with its ticket

#### Scenario: Explicit path kept for a proxy
- **WHEN** `PI_DASHBOARD_URL=wss://proxy.example/pi`
- **THEN** the bridge SHALL dial `wss://proxy.example/pi` with its ticket
