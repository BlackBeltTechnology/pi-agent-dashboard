## MODIFIED Requirements

### Requirement: Serve a mockup directory over static HTTP

The `serve_mockup` tool SHALL serve the files of a directory over HTTP bound to `127.0.0.1`, or to `0.0.0.0` only when called with `lan: true`. `dir` SHALL resolve, through its real path, to the session working directory or below. Every returned URL SHALL carry a random per-server path token. Its result text SHALL tell the agent to pass the localhost URL, not the LAN URL, to the dashboard `canvas` tool. The capability Purpose's LAN reachability holds only with `lan: true`.

#### Scenario: Start a server on an ephemeral port

- **WHEN** `serve_mockup` is called with `dir` and no `port`
- **THEN** it resolves the directory, binds an HTTP server on host `127.0.0.1` on a free ephemeral port
- **AND** it returns `local: http://localhost:<port>/<token>/` using the actual bound port and no LAN URL
- **AND** it registers the running server keyed by that port so it can be stopped later

#### Scenario: Start a server on a fixed port

- **WHEN** `serve_mockup` is called with `dir` and a `port`
- **THEN** it binds the HTTP server on host `127.0.0.1` on that port and returns the localhost URL for it

#### Scenario: Result steers canvas to the localhost URL

- **WHEN** `serve_mockup` starts a server
- **THEN** its result text states that the local URL is the one to pass to `canvas()`

#### Scenario: No LAN IPv4 address is available

- **WHEN** `serve_mockup` is called with `lan: true` and no non-internal IPv4 network interface is found
- **THEN** the LAN URL is reported as `(no LAN IPv4 detected)` while the localhost URL is still returned

#### Scenario: Start requested without a directory

- **WHEN** `serve_mockup` is called without `stop` and without `dir`
- **THEN** it returns an error stating a directory is required to start a server

#### Scenario: Directory does not exist or is not a directory

- **WHEN** `serve_mockup` is called with a `dir` that does not exist or is not a directory
- **THEN** it returns an error naming the resolved path and does not start a server

#### Scenario: LAN exposure is an explicit opt-in

- **WHEN** `serve_mockup` is called with `dir` and `lan: true`
- **THEN** it binds `0.0.0.0` and returns both the localhost URL and a LAN URL, each carrying the token

#### Scenario: Directory outside the session working directory

- **WHEN** `serve_mockup` is called with a `dir` whose real path is outside the session working directory, including through a symlink
- **THEN** it returns an error naming the working directory and does not start a server

### Requirement: Static file resolution and safety

The static server SHALL serve only requests whose path begins with its token segment, resolve request paths within the served root, serve `index.html` for directories, set content types by extension, disable caching, and reject traversal escapes, dotfile segments and symlinks whose real target is outside the real root. After the token check, a loopback-bound server SHALL answer `421` to any `Host` other than `localhost`, `127.0.0.1` or `[::1]` (host part case-insensitive) with its own port. A malformed request path SHALL be `400`.

#### Scenario: Request resolves to a directory

- **WHEN** a request path resolves to a directory inside the root
- **THEN** the server serves `index.html` from that directory

#### Scenario: Requested file is missing

- **WHEN** a request resolves to a path that does not exist
- **THEN** the server responds `404` with a not-found message for the requested path

#### Scenario: Path traversal escape attempt

- **WHEN** a request path resolves outside the served root
- **THEN** the server responds `403 Forbidden` and does not serve the file

#### Scenario: Serve a known file type

- **WHEN** a request resolves to an existing file
- **THEN** the server responds `200` with a `content-type` chosen by the file extension (defaulting to `application/octet-stream` for unknown types) and a `cache-control: no-store` header, then streams the file body

#### Scenario: Missing or wrong token

- **WHEN** a request path does not begin with `/<token>/`
- **THEN** the server responds `404` and serves nothing
- **AND** a root-relative asset reference such as `/style.css` is such a request, so mockups SHALL use relative links

#### Scenario: Dotfile segment

- **WHEN** a request path has a segment starting with `.`
- **THEN** the server responds `404` and does not serve the file

#### Scenario: Symlink escaping the root

- **GIVEN** a symlink inside the root whose real target is outside the real root
- **WHEN** it is requested
- **THEN** the server responds `403 Forbidden` and does not serve the target

#### Scenario: Dot-dot segment

- **WHEN** a request path contains a `..` segment that escapes the served root
- **THEN** the server responds `403 Forbidden`
- **AND** a `..` that stays inside the root, like any other segment starting with `.`, is answered `404`

#### Scenario: Malformed request path

- **WHEN** a request path decodes to a NUL byte or contains an invalid percent escape (`%zz`, a lone `%`)
- **THEN** the server responds `400` with no internal error text and serves nothing

#### Scenario: Unresolvable symlink target

- **WHEN** a request resolves through a symlink loop or a dangling link
- **THEN** the server responds `404`
- **AND** when the real path cannot be read (for example `EACCES`) it responds `403 Forbidden`

#### Scenario: Host spellings on a loopback server

- **WHEN** a loopback-bound server receives a valid-token request with `Host: LOCALHOST:<port>`
- **THEN** it serves the file
- **AND** a missing `Host`, `localhost` without a port, `localhost.:<port>` or `127.0.0.2:<port>` is answered `421`

#### Scenario: Wrong token and wrong Host

- **WHEN** a loopback-bound server receives a request with a wrong token and `Host: evil.example:<port>`
- **THEN** the server responds `404`, not `421`

#### Scenario: Rebound Host header on a loopback server

- **WHEN** a loopback-bound server receives a request with `Host: evil.example:<port>`
- **THEN** the server responds `421` and serves nothing
