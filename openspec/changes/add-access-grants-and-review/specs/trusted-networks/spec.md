## ADDED Requirements

### Requirement: Trusted networks are reviewable and revocable from Access settings

Every configured trusted network SHALL be listed in `Settings → Access` and SHALL offer a revoke action that removes it through the existing configuration write path.

#### Scenario: Configured entries are listed

- **WHEN** the Access page is opened and trusted networks are configured
- **THEN** each entry SHALL be listed with its CIDR, wildcard, or exact host value

#### Scenario: Revoking removes the entry

- **WHEN** a trusted-network entry is revoked from the Access page
- **THEN** it SHALL be removed from configuration via the existing write path

#### Scenario: Revocation takes effect without restart

- **GIVEN** the guard reads trusted networks through the live configuration snapshot
- **WHEN** an entry is revoked
- **THEN** a subsequent request from that peer SHALL be denied without a server restart

### Requirement: Trust is acquirable by accepting a pending access request

A trusted network entry SHALL be addable by accepting a pending access request derived from a recorded denial, in addition to the existing tunnel banner and settings paths. Acceptance SHALL be available only for entries classified as trustable.

#### Scenario: Accepting a pending request adds trust

- **WHEN** a trusted client accepts a pending access request for a trustable peer
- **THEN** that peer SHALL be added to trusted networks

#### Scenario: Loopback or proxied peer cannot be accepted

- **WHEN** a pending access request is classified non-trustable
- **THEN** no accept action SHALL be offered, so trusting an entire tunnel is not possible through this path
