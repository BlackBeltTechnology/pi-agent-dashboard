## ADDED Requirements

### Requirement: Session list carries UI links
Each session object in the `GET /api/sessions` response `data` SHALL include `uiUrl` = `<base>/session/<encodeURIComponent(id)>` and `diffUrl` = `uiUrl` + `/diff`, computed per response (never persisted) and free of credentials and query parameters.

#### Scenario: Local caller gets a localhost link
- **WHEN** `GET /api/sessions` is requested with `Host: localhost:8000` and no forwarding headers
- **THEN** each row's `uiUrl` SHALL be `http://localhost:8000/session/<id>` and `diffUrl` SHALL be `http://localhost:8000/session/<id>/diff`

#### Scenario: Id is URL-encoded
- **WHEN** a session id contains a character outside the URL-path-safe set
- **THEN** `uiUrl` SHALL contain `encodeURIComponent(id)`

#### Scenario: Owner filter unchanged
- **WHEN** the caller may see only some sessions
- **THEN** `uiUrl`/`diffUrl` SHALL appear only on the rows already returned by the owner filter

### Requirement: UI link base resolution
`<base>` SHALL be, in order: the configured origin (public base URLs, any live tunnel, `auth.redirectBaseUrl`) whose hostname equals the normalized first `X-Forwarded-Host` value or, failing that, `Host`; otherwise `<request protocol>://<normalized Host>` when `Host` is admitted; otherwise `<request protocol>://localhost:<port>`. A forwarded header SHALL never mint an origin. No trailing slash.

#### Scenario: Configured public base selected by host
- **WHEN** `publicBaseUrls` contains `https://pi.example.com` and the request `Host` is `pi.example.com:443`
- **THEN** `uiUrl` SHALL start with `https://pi.example.com/session/`

#### Scenario: Host compared case-insensitively
- **WHEN** the live tunnel URL is `https://abc.share.zrok.io` and the request `Host` is `ABC.share.zrok.io`
- **THEN** `uiUrl` SHALL start with `https://abc.share.zrok.io/session/`

#### Scenario: Tunnel caller gets the tunnel link
- **WHEN** a live tunnel URL is `https://abc.share.zrok.io` and the request's first `X-Forwarded-Host` value (or `Host`) is `abc.share.zrok.io`
- **THEN** each row's `uiUrl` SHALL start with `https://abc.share.zrok.io/session/`

#### Scenario: Secondary tunnel caller
- **WHEN** two tunnels are live and the request host matches the non-primary one
- **THEN** `uiUrl` SHALL start with that tunnel's origin

#### Scenario: Spoofed forwarded host is ignored
- **WHEN** the request has `Host: localhost:8000` and `X-Forwarded-Host: evil.example, abc.share.zrok.io`
- **THEN** each row's `uiUrl` SHALL start with `http://localhost:8000/session/`

#### Scenario: Unadmitted host in report mode
- **WHEN** the host gate runs in `report` mode, a tunnel is live, and the request `Host` is `evil.example` (not admitted, not configured)
- **THEN** `uiUrl` SHALL start with `http://localhost:<port>/session/` and SHALL NOT contain the tunnel origin

#### Scenario: Non-matching forwarded host does not mask a matching Host
- **WHEN** `publicBaseUrls` contains `https://pi.example.com`, the request `Host` is `pi.example.com` and `X-Forwarded-Host` is `other.example`
- **THEN** `uiUrl` SHALL start with `https://pi.example.com/session/`

#### Scenario: Matching forwarded host selects a configured origin
- **WHEN** the request has `Host: localhost:8000` and `X-Forwarded-Host: abc.share.zrok.io` and that tunnel is live
- **THEN** `uiUrl` SHALL start with `https://abc.share.zrok.io/session/`

#### Scenario: Emitted host is normalized
- **WHEN** the request `Host` is `LOCALHOST:8000` and is admitted
- **THEN** `uiUrl` SHALL start with `http://localhost:8000/session/`

#### Scenario: IPv6 host
- **WHEN** the request `Host` is `[::1]:8000` and is admitted
- **THEN** `uiUrl` SHALL start with `http://[::1]:8000/session/`

#### Scenario: No Host header
- **WHEN** the request carries no `Host` header
- **THEN** `uiUrl` SHALL start with `http://localhost:<port>/session/`

### Requirement: Session list id filter
`GET /api/sessions` SHALL accept an optional single-valued `id` query parameter (a repeated parameter SHALL be rejected with 400). When present it SHALL be lowercased, and the response SHALL contain only the owner-visible rows whose lowercased id equals it or, when it is at least 8 characters long, starts with it. Without the parameter the response SHALL be unchanged.

#### Scenario: Exact id filter
- **WHEN** `GET /api/sessions?id=<full id>` is requested for a visible ended session
- **THEN** `data` SHALL contain exactly that session with `uiUrl` and `diffUrl`

#### Scenario: Prefix filter
- **WHEN** `GET /api/sessions?id=01A16086` is requested and two visible sessions start with `01a16086`
- **THEN** `data` SHALL contain both

#### Scenario: Short value is exact-only
- **WHEN** `GET /api/sessions?id=01a160` is requested and no session id equals `01a160`
- **THEN** `data` SHALL be empty

#### Scenario: Repeated id parameter
- **WHEN** `GET /api/sessions?id=a&id=b` is requested
- **THEN** the response SHALL be 400

#### Scenario: Filter respects the owner filter
- **WHEN** the matching session is not visible to the caller
- **THEN** `data` SHALL be empty


