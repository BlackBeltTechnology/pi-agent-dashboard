## MODIFIED Requirements

### Requirement: pi-gateway TCP upgrades reject any Origin
The pi-gateway TCP WebSocket listener SHALL refuse any upgrade that carries an `Origin` header, whatever its value, because no browser is a legitimate bridge peer. The refusal SHALL take precedence over ticket and local-credential-proof admission. Unix-socket peers are unaffected.

#### Scenario: Browser dial to the pi port is refused
- **WHEN** a WebSocket upgrade arrives on the pi-gateway TCP port from a loopback peer with `Origin: http://attacker.example` and no ticket
- **THEN** the gateway SHALL refuse the upgrade with `401` and SHALL NOT register a session

#### Scenario: Loopback Origin on the pi port is still refused
- **WHEN** a WebSocket upgrade arrives on the pi-gateway TCP port with `Origin: http://localhost:8000`
- **THEN** the gateway SHALL refuse the upgrade

#### Scenario: Header-less bridge is admitted as before
- **WHEN** a WebSocket upgrade arrives on the pi-gateway TCP port from a loopback peer with no `Origin` header
- **THEN** admission SHALL follow the bridge-ticket and local-credential-proof rules of `pi-gateway-auth`
- **AND** an upgrade with neither SHALL be refused, with no deprecation grace
