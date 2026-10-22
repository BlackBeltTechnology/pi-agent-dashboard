## MODIFIED Requirements

### Requirement: Server mDNS advertisement
The dashboard server SHALL advertise itself via mDNS as `_pi-dashboard._tcp` on startup and unpublish on shutdown. The TXT record SHALL carry `{ version, pid, piPort, fp, name }`, where `version` is the dashboard server's own package version, `fp` is the server identity fingerprint (the same value the identity challenge proves), and `name` is the operator-configured dashboard name when set, otherwise the machine's hostname — for display only. The TXT record SHALL NOT carry any URL, tunnel address or other route of the server; the fingerprint is the only identity data. The `fp` key SHALL be present only when the server has an identity.

#### Scenario: Server advertises on startup
- **WHEN** the dashboard server starts successfully
- **THEN** it SHALL publish a `_pi-dashboard._tcp` service with the HTTP port and TXT record containing `{ version, pid, piPort, fp, name }`

#### Scenario: Advertised version is the real version
- **WHEN** a peer reads the TXT record of a running server
- **THEN** `version` SHALL equal the `version` field of the dashboard server package that is running
- **AND** it SHALL NOT be the placeholder `0.0.0`

#### Scenario: Advertised fingerprint matches the identity challenge
- **WHEN** a peer reads `fp` from the TXT record and then challenges the server's identity
- **THEN** the fingerprint proven by the challenge SHALL equal the advertised `fp`

#### Scenario: Server unpublishes on shutdown
- **WHEN** the dashboard server shuts down
- **THEN** it SHALL unpublish the mDNS service before closing

#### Scenario: Advertisement carries no routes
- **GIVEN** the server has an active tunnel and a public base URL
- **WHEN** a peer reads the TXT record
- **THEN** the keys SHALL be no others than `version`, `pid`, `piPort`, `name` and, when an identity exists, `fp`, and no value SHALL contain a tunnel or public URL
