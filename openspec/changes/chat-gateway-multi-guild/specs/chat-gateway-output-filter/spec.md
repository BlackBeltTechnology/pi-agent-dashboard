## MODIFIED Requirements

### Requirement: Mirroring is independent of authorization to act
Mirroring into a thread SHALL continue while the layer is disarmed, and SHALL be unaffected by any individual principal's tier. Mirroring SHALL occur only into servers that are enabled and in `interactive` mode, and SHALL stop when a server is disabled or switched to `query`.

#### Scenario: Disarmed layer
- **WHEN** the layer is disarmed
- **THEN** session activity continues to appear in bound threads

#### Scenario: Server switched to query
- **WHEN** a server with mirrored threads is switched to `query`
- **THEN** no further session activity is posted in that server
