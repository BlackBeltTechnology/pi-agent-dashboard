## MODIFIED Requirements

### Requirement: Serve a mockup directory over static HTTP

The `serve_mockup` tool SHALL serve the files of a directory over HTTP bound to `0.0.0.0` and return both a localhost URL and a LAN URL for the bound port. Its result text SHALL tell the agent to pass the localhost URL, not the LAN URL, to the dashboard `canvas` tool.

#### Scenario: Start a server on an ephemeral port

- **WHEN** `serve_mockup` is called with `dir` and no `port`
- **THEN** it resolves the directory, binds an HTTP server on host `0.0.0.0` on a free ephemeral port
- **AND** it returns `local: http://localhost:<port>` and `LAN: http://<lan-ipv4>:<port>` using the actual bound port
- **AND** it registers the running server keyed by that port so it can be stopped later

#### Scenario: Start a server on a fixed port

- **WHEN** `serve_mockup` is called with `dir` and a `port`
- **THEN** it binds the HTTP server on host `0.0.0.0` on that port and returns the localhost and LAN URLs for it

#### Scenario: Result steers canvas to the localhost URL

- **WHEN** `serve_mockup` starts a server
- **THEN** its result text states that the local URL is the one to pass to `canvas()`

#### Scenario: No LAN IPv4 address is available

- **WHEN** a server starts and no non-internal IPv4 network interface is found
- **THEN** the LAN URL is reported as `(no LAN IPv4 detected)` while the localhost URL is still returned

#### Scenario: Start requested without a directory

- **WHEN** `serve_mockup` is called without `stop` and without `dir`
- **THEN** it returns an error stating a directory is required to start a server

#### Scenario: Directory does not exist or is not a directory

- **WHEN** `serve_mockup` is called with a `dir` that does not exist or is not a directory
- **THEN** it returns an error naming the resolved path and does not start a server
