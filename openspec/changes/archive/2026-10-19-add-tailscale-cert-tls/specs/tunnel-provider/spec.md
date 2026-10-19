## MODIFIED Requirements

### Requirement: Accessible-endpoint enumeration
The server SHALL enumerate every address the dashboard answers on as tagged endpoints `{ kind, url, tls }` where `kind ∈ { public, mesh, magicdns, domain, lan, local }`. Which kinds are present SHALL be provider- and mode-driven.

The manual operator endpoints in that enumeration SHALL be sourced from the top-level `publicBaseUrls` when present, and from the legacy `pairing.publicBaseUrls` when it is absent. The `tls` tag SHALL remain advisory; the authoritative pairing-payload filter stays at read time in `PairingManager.reachableUrls()`.

When the native TLS listener is running on a non-loopback bind host, each name it holds a valid, advertisable, non-wildcard certificate for SHALL additionally be enumerated as an `https://<name>[:<port>]` endpoint with `tls: true` (port omitted when it is `443`), tagged with the kind its certificate source declares (`magicdns` for tailscale, `domain` for an operator-owned domain name). The same URLs SHALL be supplied to the pairing payload's reachable-URL source, where the read-time https/wss gate still applies.

#### Scenario: private mesh emits mesh + magicdns
- **WHEN** the active provider is tailscale in private mode
- **THEN** the endpoint list SHALL include a `mesh` (100.x) endpoint and a `magicdns` name endpoint, each with `tls: false`, plus LAN and local

#### Scenario: Promoted key feeds "Accessible at"
- **WHEN** the config holds top-level `publicBaseUrls: ["https://pi.example.com"]`
- **THEN** `GET /api/tunnel/endpoints` SHALL include that URL tagged `public`

#### Scenario: Legacy key still feeds "Accessible at"
- **WHEN** the config holds only `pairing.publicBaseUrls`
- **THEN** the enumerated endpoints SHALL be identical to the behaviour before the promotion

#### Scenario: TLS listener name is enumerated and paired
- **WHEN** the TLS listener on port `8443`, bound to a non-loopback host, holds a valid tailscale certificate for `host.example.ts.net`
- **THEN** `GET /api/tunnel/endpoints` SHALL include `https://host.example.ts.net:8443` tagged `magicdns` with `tls: true`
- **AND** a freshly minted pairing payload's `urls[]` SHALL include that URL

#### Scenario: Non-advertisable certificate not enumerated
- **WHEN** the only certificate held for a name is marked not advertisable by its source
- **THEN** no endpoint for that name SHALL be enumerated or placed in the pairing payload

#### Scenario: No certificate, no secure endpoint
- **WHEN** the TLS listener is enabled but holds no valid certificate
- **THEN** no TLS-listener endpoint SHALL be enumerated

#### Scenario: Every connected provider is enumerated, not only the primary
- **GIVEN** zrok is primary and tailscale is also `connected`
- **WHEN** `GET /api/tunnel/endpoints` is requested
- **THEN** the list SHALL include the zrok `public` URL AND the tailscale `magicdns` and `mesh` URLs
- **AND** url-less liveness markers SHALL NOT appear as endpoints
- **AND** a readiness failure SHALL degrade the list to primary + manual + LAN/local rather than fail the request

#### Scenario: A daemon brought up outside the dashboard still names its addresses
- **GIVEN** tailscale is running at OS level with no `tailscale serve` config and this server never connected it
- **WHEN** its liveness is probed
- **THEN** the MagicDNS and 100.x mesh endpoints SHALL be derived on the dashboard's own listen port
- **AND** only when no port can be determined SHALL it report a url-less liveness marker
