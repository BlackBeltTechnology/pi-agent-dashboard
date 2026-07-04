## ADDED Requirements

### Requirement: Bearer auth mode independent of origin-bound cookie
The client SHALL support authenticating to a cross-origin server with a bearer
token — `Authorization: Bearer` for REST and a token-bearing
`Sec-WebSocket-Protocol` for WebSocket — as an alternative to the origin-bound
auth cookie, so a neutral-origin shell can reach a server on a different origin.

#### Scenario: Cross-origin REST with bearer
- **WHEN** the shell issues a REST call to a paired server on a different origin
- **THEN** it attaches the server's bearer token in the `Authorization` header

#### Scenario: Cross-origin WebSocket with bearer
- **WHEN** the shell opens a WebSocket to a paired server on a different origin
- **THEN** it passes the bearer token via the WebSocket subprotocol rather than relying on a cookie
