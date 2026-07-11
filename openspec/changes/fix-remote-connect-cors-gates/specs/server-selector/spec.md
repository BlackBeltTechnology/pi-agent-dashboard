# server-selector — delta

## ADDED Requirements

### Requirement: Switch sockets carry a WS ticket minted against the target
When switching to a different server, the staging WebSocket AND the committed WebSocket SHALL each carry a single-use WS ticket minted against the **target** server (not the current one), supplied per the server's upgrade contract (`?ticket=<t>` query param or `pi-ticket.<t>` subprotocol). If a ticket cannot be minted for the target, the switch SHALL be aborted with a user-visible error and the live connection preserved — the client SHALL NOT open a ticket-less socket the server will refuse.

#### Scenario: Switch to a trusted-network remote mints and carries a ticket
- **WHEN** the user selects a remote entry whose host is CORS-allowed (a trusted-network LAN server)
- **THEN** the client SHALL mint a `/ws`-scoped ticket against that server and open the staging socket as `ws://<host>:<port>/ws?ticket=<t>`
- **AND** on staging `OPEN`, the committed connection SHALL also carry a freshly-minted ticket for the target

#### Scenario: Ticket mint failure aborts the switch safely
- **WHEN** minting a ticket against the target fails (network, CORS, or auth)
- **THEN** the switch SHALL be aborted, an error surfaced, and the current live connection preserved with no state loss

### Requirement: Cross-origin CORS-blocked probe is distinct from Unreachable
An availability probe that fails as an opaque cross-origin block (the transport `.catch()` path with no readable response) SHALL be rendered distinctly from a genuine transport-unreachable when the entry's host belongs to a known/trusted network — surfacing a hint that the remote must allowlist this origin — rather than a bare "Unreachable". The existing HTTP 403 `network_not_allowed` → "Network not allowed" state and the plain transport-failure → "Unreachable" state are preserved.

#### Scenario: Trusted-network host with a blocked probe shows an allowlist hint
- **WHEN** an entry whose host is in a known/trusted network is probed cross-origin AND the probe throws with no readable response
- **THEN** the entry SHALL render a distinct "CORS-blocked — allowlist this origin on the remote" indicator, NOT "Unreachable"

#### Scenario: Existing states unchanged
- **WHEN** a probe returns HTTP 403 with `error: "network_not_allowed"`
- **THEN** the entry SHALL render "Network not allowed"
- **AND** a non-403 failure or a transport failure for a non-trusted host SHALL still render "Unreachable"
