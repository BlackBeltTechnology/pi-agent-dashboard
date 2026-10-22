## ADDED Requirements

### Requirement: A remote bridge sends its HTTP credential calls to the dashboard HTTP origin
A remote bridge SHALL send its ticket mint, identity challenge and pi-trust
live query to the dashboard HTTP origin, never the gateway origin. Absent an
in-scope `PI_DASHBOARD_HTTP_URL`, a plaintext `ws` endpoint with an explicit
port SHALL map to that host plus the HTTP port from `PI_DASHBOARD_PORT`,
`DASHBOARD_PORT`, else `8000`; any other endpoint SHALL keep its origin with
`ws`/`wss` mapped to `http`/`https`. The bridge machine's own dashboard config
SHALL NOT be read.

#### Scenario: Default topology mints from the HTTP port
- **WHEN** a remote bridge has `PI_DASHBOARD_URL=ws://dash.example:9999`, a valid `PI_DASHBOARD_TOKEN`, and no port variables set
- **THEN** it SHALL request its bridge ticket from `http://dash.example:8000/api/ws-ticket`
- **AND** it SHALL connect to the gateway with that ticket

#### Scenario: IPv6 gateway endpoint keeps its brackets
- **WHEN** a remote bridge has `PI_DASHBOARD_URL=ws://[fd00::1]:9999` and no port variables set
- **THEN** the HTTP origin SHALL be `http://[fd00::1]:8000`

#### Scenario: TLS or port-less endpoint keeps its origin
- **WHEN** the endpoint is `wss://dash.example:8443`, `wss://dash.example` or `ws://dash.example`
- **THEN** the HTTP origin SHALL be that endpoint's origin with `ws`/`wss` mapped to `http`/`https`

### Requirement: An explicit dashboard HTTP URL is pinned, scoped and fails closed
`PI_DASHBOARD_HTTP_URL`, when set to a non-blank value, SHALL supply the HTTP origin for an endpoint
whose host equals its host or the host of `PI_DASHBOARD_URL`, and only for
those. A set value that is not an `http`/`https` URL, or that carries user
credentials, SHALL stop the HTTP credential calls for every endpoint with a
named cause, before any host-scope check, and SHALL NOT fall back.

#### Scenario: Explicit HTTP URL wins for the pinned host
- **WHEN** `PI_DASHBOARD_HTTP_URL=https://dash.example/base/path` is set and the endpoint is `ws://dash.example:9999`
- **THEN** the ticket mint, identity challenge and live query SHALL all target origin `https://dash.example`

#### Scenario: Explicit HTTP URL does not follow a re-target to another host
- **WHEN** `PI_DASHBOARD_URL=ws://a.example:9999` and `PI_DASHBOARD_HTTP_URL=http://a.example:8000` are set, no port variables are set, and the bridge dials `ws://b.example:9999` after a re-target
- **THEN** the HTTP origin for that endpoint SHALL be `http://b.example:8000`
- **AND** the bearer SHALL NOT be sent to `a.example` for that endpoint

#### Scenario: Invalid explicit HTTP URL fails closed
- **WHEN** a remote bridge has `PI_DASHBOARD_HTTP_URL` set to a non-http(s) value or to a URL carrying user credentials
- **THEN** the bridge SHALL NOT send the bearer anywhere
- **AND** it SHALL report a named bad-http-url cause instead of dialling

### Requirement: A wrong dashboard HTTP origin is reported distinctly
A ticket-mint response other than success, `401` or `403` SHALL be reported as
a wrong-origin failure naming the URL tried, distinct from a refused
credential. The bridge SHALL log the resolved HTTP origin and its source, and
SHALL NOT log the bearer.

#### Scenario: Gateway answering a mint is reported as wrong origin
- **WHEN** the ticket mint receives a non-success status other than `401` or `403`, such as `426`
- **THEN** the bridge SHALL report a wrong-origin cause naming the URL tried and `PI_DASHBOARD_HTTP_URL`
- **AND** it SHALL NOT report the bearer as unpaired or revoked

#### Scenario: Rejected credential is still reported as refused
- **WHEN** the ticket mint at the resolved HTTP origin answers `401` or `403`
- **THEN** the bridge SHALL report the refused cause naming an unpaired or revoked bearer
