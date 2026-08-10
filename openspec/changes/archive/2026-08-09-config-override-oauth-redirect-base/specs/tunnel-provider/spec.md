## MODIFIED Requirements

### Requirement: Accessible-endpoint enumeration
The server SHALL enumerate every address the dashboard answers on as tagged endpoints `{ kind, url, tls }` where `kind ∈ { public, mesh, magicdns, lan, local }`. Which kinds are present SHALL be provider- and mode-driven.

The manual operator endpoints in that enumeration SHALL be sourced from the top-level `publicBaseUrls` when present, and from the legacy `pairing.publicBaseUrls` when it is absent. The `tls` tag SHALL remain advisory; the authoritative pairing-payload filter stays at read time in `PairingManager.reachableUrls()`.

#### Scenario: private mesh emits mesh + magicdns
- **WHEN** the active provider is tailscale in private mode
- **THEN** the endpoint list SHALL include a `mesh` (100.x) endpoint and a `magicdns` name endpoint, each with `tls: false`, plus LAN and local

#### Scenario: Promoted key feeds "Accessible at"
- **WHEN** the config holds top-level `publicBaseUrls: ["https://pi.example.com"]`
- **THEN** `GET /api/tunnel/endpoints` SHALL include that URL tagged `public`

#### Scenario: Legacy key still feeds "Accessible at"
- **WHEN** the config holds only `pairing.publicBaseUrls`
- **THEN** the enumerated endpoints SHALL be identical to the behaviour before the promotion
