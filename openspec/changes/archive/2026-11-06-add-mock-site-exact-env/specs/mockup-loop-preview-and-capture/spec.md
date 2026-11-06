## MODIFIED Requirements

### Requirement: Serve a mockup directory over static HTTP

The `serve_mockup` tool SHALL serve the files of a directory over HTTP bound to `0.0.0.0` and return both a localhost URL and a LAN URL for the bound port. Its result text SHALL tell the agent to show the localhost URL to the user, and the LAN URL only for a phone check. It SHALL NOT name any host-specific display tool.

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
- **THEN** its result text says to show the local URL to the user, and names no host-specific tool

#### Scenario: No LAN IPv4 address is available

- **WHEN** a server starts and no non-internal IPv4 network interface is found
- **THEN** the LAN URL is reported as `(no LAN IPv4 detected)` while the localhost URL is still returned

#### Scenario: Start requested without a directory

- **WHEN** `serve_mockup` is called without `stop` and without `dir`
- **THEN** it returns an error stating a directory is required to start a server

#### Scenario: Directory does not exist or is not a directory

- **WHEN** `serve_mockup` is called with a `dir` that does not exist or is not a directory
- **THEN** it returns an error naming the resolved path and does not start a server

### Requirement: Graceful fallback when Playwright is absent

When the headless browser library cannot be loaded, `score_mockup` SHALL return install guidance and manual-capture instructions instead of failing, including the rubric and the widths to capture. When the library loads but its pinned browser build is not installed, `score_mockup` (and scripted-frame video export) SHALL try the browser builds present in the library's browser cache, newest first, until one launches. It SHALL report which build it used, and return install guidance only when no cached build launches.

#### Scenario: Playwright not installed

- **WHEN** `score_mockup` runs and the headless browser library (or its browser entry) cannot be imported
- **THEN** it returns text instructing the user to install the library and its browser, suggests capturing manually at the requested widths, and includes the scoring rubric
- **AND** it does not attempt to launch a browser

#### Scenario: Pinned browser build missing, another build installed

- **WHEN** the library loads, its pinned browser build is absent, and another build in the browser cache launches
- **THEN** `score_mockup` captures the screenshots with that build and names it in its result

#### Scenario: No cached build launches

- **WHEN** the library loads and every cached browser build fails to launch, or none exists
- **THEN** it returns the install guidance and rubric, naming the builds it tried
