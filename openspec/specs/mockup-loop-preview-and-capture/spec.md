# mockup-loop-preview-and-capture Specification

## Purpose

Provide a zero-dependency static-HTTP preview of a mockup directory reachable from both localhost and the LAN (for phone-based responsive review), and a Playwright-backed multi-width screenshot capture that returns file paths plus a scoring rubric, degrading gracefully to install guidance when Playwright is absent.

## Requirements

### Requirement: Serve a mockup directory over static HTTP

The `serve_mockup` tool SHALL serve the files of a directory over HTTP bound to `0.0.0.0` and return both a localhost URL and a LAN URL for the bound port.

#### Scenario: Start a server on an ephemeral port

- **WHEN** `serve_mockup` is called with `dir` and no `port`
- **THEN** it resolves the directory, binds an HTTP server on host `0.0.0.0` on a free ephemeral port
- **AND** it returns `local: http://localhost:<port>` and `LAN: http://<lan-ipv4>:<port>` using the actual bound port
- **AND** it registers the running server keyed by that port so it can be stopped later

#### Scenario: Start a server on a fixed port

- **WHEN** `serve_mockup` is called with `dir` and a `port`
- **THEN** it binds the HTTP server on host `0.0.0.0` on that port and returns the localhost and LAN URLs for it

#### Scenario: No LAN IPv4 address is available

- **WHEN** a server starts and no non-internal IPv4 network interface is found
- **THEN** the LAN URL is reported as `(no LAN IPv4 detected)` while the localhost URL is still returned

#### Scenario: Start requested without a directory

- **WHEN** `serve_mockup` is called without `stop` and without `dir`
- **THEN** it returns an error stating a directory is required to start a server

#### Scenario: Directory does not exist or is not a directory

- **WHEN** `serve_mockup` is called with a `dir` that does not exist or is not a directory
- **THEN** it returns an error naming the resolved path and does not start a server

### Requirement: Static file resolution and safety

The static server SHALL resolve request paths within the served root, serve `index.html` for directory requests, set content types by extension, disable caching, and reject path-traversal escapes.

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

### Requirement: Stop a running preview server

The `serve_mockup` tool SHALL stop a previously started server identified by its port when called with `stop: true`.

#### Scenario: Stop an existing server

- **WHEN** `serve_mockup` is called with `stop: true` and a `port` that maps to a running server
- **THEN** it closes that server, removes it from the registry, and reports it was stopped on that port

#### Scenario: Stop without a port

- **WHEN** `serve_mockup` is called with `stop: true` and no `port`
- **THEN** it returns an error stating a port is required to stop a server

#### Scenario: Stop a port with no running server

- **WHEN** `serve_mockup` is called with `stop: true` and a `port` that has no registered server
- **THEN** it reports that no mockup server is running on that port

### Requirement: Capture multi-width screenshots with a scoring rubric

The `score_mockup` tool SHALL capture full-page screenshots of a running mockup URL at multiple viewport widths using Playwright and return the file paths together with a scoring rubric.

#### Scenario: Capture at default widths

- **WHEN** `score_mockup` is called with a `url` and no `widths`
- **THEN** it captures screenshots at the default widths `375`, `768`, and `1440`

#### Scenario: Capture at custom widths

- **WHEN** `score_mockup` is called with a non-empty `widths` array
- **THEN** it captures screenshots at exactly those widths instead of the defaults

#### Scenario: Screenshots are written and paths returned

- **WHEN** Playwright is available and capture runs
- **THEN** it launches Chromium, and for each width opens a context with that viewport width and height `900`, navigates to the URL, and writes a full-page PNG named `mockup-<width>.png`
- **AND** the PNGs are written to the provided `outDir` or to a freshly created temp directory when none is given
- **AND** it returns the list of written file paths appended with the scoring rubric

#### Scenario: Generic vs design-system rubric

- **WHEN** `score_mockup` is called without a `system`
- **THEN** the returned rubric is the generic checklist (contrast, responsive, hierarchy, spacing, token fidelity, anti-slop, console)
- **AND WHEN** a valid `system` preset id is supplied, the returned rubric is that preset's PASS/FAIL boolean checklist instead

#### Scenario: Capture failure during screenshotting

- **WHEN** Playwright is available but the capture throws an error
- **THEN** it returns the capture error message together with the scoring rubric

### Requirement: Graceful fallback when Playwright is absent

When Playwright cannot be loaded, `score_mockup` SHALL return install guidance and manual-capture instructions instead of failing, including the rubric and the widths to capture.

#### Scenario: Playwright not installed

- **WHEN** `score_mockup` runs and the Playwright module (or its Chromium entry) cannot be imported
- **THEN** it returns text instructing the user to install Playwright and its Chromium browser, suggests capturing manually at the requested widths, and includes the scoring rubric
- **AND** it does not attempt to launch a browser
