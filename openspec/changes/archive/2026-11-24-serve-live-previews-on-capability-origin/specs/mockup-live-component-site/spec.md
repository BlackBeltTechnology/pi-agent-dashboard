## MODIFIED Requirements

### Requirement: Serve tool
The extension SHALL register `serve_mock_site` taking optional `dir` (project root,
default cwd), `port` (default 5299), `base`, `lan`, and `stop`. It SHALL start the mock site
through the project's own launcher with the inherited build shape (see
`mockup-site-environment`), applying the project's mock options when present. It
SHALL refuse port 8000. It SHALL fail with an
actionable message when the build tool or framework has no adapter, the build tool is
missing, or the port is busy. `base` is an optional URL path prefix (for example
`/some/prefix/`) under which the site is served. It SHALL match the allowlist `^/([A-Za-z0-9._~-]+/)+$`,
be at most 256 characters and contain no `.` or `..` segment (so `?`, `#`, `\`, `%`, `//`,
control characters and non-ASCII are all refused). An explicit `base` of `/` means "no base":
the site starts at the root and no reservation event is emitted. The tool SHALL refuse any other value with an actionable
message that shows the expected shape and starts nothing. When the project's launcher cannot apply a
base, the tool SHALL refuse an explicit `base` with an actionable message and start nothing, and
without `base` SHALL NOT emit the reservation event. When `base` is given, the tool SHALL start the site
under it (see `mockup-site-environment`, "Site runs under a base path") and the URL it
returns SHALL include the base. When `base` is not given, the tool SHALL emit the package event
`mock-site:base-reservation` with `{port, pending, signal}` (`pending` is a promise slot
that a listener may resolve to `{base}` or `null`; `signal` is an `AbortSignal`), and SHALL
wait a bounded 2 seconds for it. On timeout or a malformed answer the tool SHALL abort `signal`. The host
decides whether a reservation is offered; when the host answers with a valid base the tool
SHALL use it as if it had been passed. The same base check applies to a host-answered base. When several listeners answer, the first to set `pending` wins: a later listener SHALL NOT overwrite it (it checks `pending === undefined`), and a losing listener that already reserved a base releases its own reservation. The tool SHALL check that the port is free before emitting the event, and on any later failure (spawn error, crash, readiness timeout) SHALL abort `signal` so the host releases the reservation. A `null` answer, no listener, a timeout
or a malformed answer (one failing that check) SHALL leave the site at the root. The base SHALL appear
in the result only inside the returned URL. The tool SHALL
NOT name or depend on any specific host. It SHALL return the local URL (and the LAN URL only when
`lan` is true) and stop the server it started when called with `stop: true` and its
port. Its description and result text SHALL tell the agent to show the URL to the user
and to record decisions with the decide CLI.

#### Scenario: Start
- **WHEN** `serve_mock_site{}` runs in a project with a supported build tool
- **THEN** the result contains `http://localhost:5299` and the URL serves the site

#### Scenario: Missing config
- **WHEN** the project has no mock options file
- **THEN** the site starts with the inherited build shape and default themes

#### Scenario: Port busy
- **WHEN** port 5299 is already in use by another HTTP server
- **THEN** the tool returns an error naming the port, does not report the other server as the mock site, and leaves it alone

#### Scenario: Installed from a tarball
- **WHEN** the package is installed from its packed tarball into a fresh project with a supported build tool and framework and one mock
- **THEN** `serve_mock_site` starts and the mock renders with its rings

#### Scenario: Forbidden port
- **WHEN** `port: 8000` is passed
- **THEN** the tool refuses and starts nothing

#### Scenario: Stop
- **WHEN** `serve_mock_site{stop:true, port:5299}` runs after a start
- **THEN** the server child exits and the port is free

#### Scenario: Session ends
- **WHEN** the pi session shuts down with a mock site running
- **THEN** the server child is terminated

#### Scenario: Explicit base
- **WHEN** `serve_mock_site{base:"/some/prefix/"}` runs
- **THEN** the site is served under `/some/prefix/` and the result URL ends with `/some/prefix/`

#### Scenario: Invalid base refused
- **WHEN** `serve_mock_site{base:"some/prefix"}` runs (no leading or trailing `/`)
- **THEN** the tool returns an error that states `base` must start and end with `/`, gives an example such as `/some/prefix/`, and starts nothing

#### Scenario: Protocol-relative base refused
- **WHEN** `serve_mock_site{base:"//evil.example/"}` runs
- **THEN** the tool returns an error showing the expected shape and starts nothing

#### Scenario: Unsafe base refused
- **WHEN** `serve_mock_site{base:"/a/../b/"}` runs, or a base contains `?`, `#`, `\`, `%2f` or `%2E`, or is longer than 256 characters
- **THEN** the tool returns an error and starts nothing

#### Scenario: Launcher without base support refuses base
- **WHEN** `serve_mock_site{base:"/some/prefix/"}` runs in a project whose launcher cannot apply a base
- **THEN** the tool returns an error that names the missing base support and how to proceed, and starts nothing
- **AND** `serve_mock_site{}` in that project emits no `mock-site:base-reservation` event and starts at the root

#### Scenario: Host-provided reservation used
- **WHEN** `serve_mock_site{}` runs without `base` and a listener of `mock-site:base-reservation` resolves `{base:"/some/prefix/"}` for the port
- **THEN** the site is served under `/some/prefix/` and the result URL includes it

#### Scenario: Explicit base wins over reservation
- **WHEN** `serve_mock_site{base:"/some/prefix/"}` runs and a listener would also offer a base
- **THEN** the site is served under `/some/prefix/` and no reservation event is emitted

#### Scenario: No reservation offered
- **WHEN** `serve_mock_site{}` runs without `base` and no listener answers, or a listener answers `null`
- **THEN** the site is served at the root and the result contains `http://localhost:5299`

#### Scenario: Reservation times out
- **WHEN** a listener of `mock-site:base-reservation` does not settle within the bounded wait
- **THEN** the tool aborts the probe signal, starts the site at the root and the result says the base reservation was unavailable

#### Scenario: Late reservation after timeout is released, never adopted
- **WHEN** the wait times out, the tool aborts the signal, and the listener's reservation resolves afterwards
- **THEN** the site stays at the root and the tool does not use the late base

#### Scenario: Malformed reservation ignored
- **WHEN** a listener resolves a base that does not start and end with `/`, or rejects
- **THEN** the tool aborts the probe signal, starts the site at the root, and the result says the base reservation was unavailable and why

#### Scenario: Host-answered base is validated
- **WHEN** a listener resolves `{base:"//evil.example/"}`
- **THEN** the tool starts the site at the root and does not use that base

#### Scenario: Allowlist refuses odd bases
- **WHEN** `serve_mock_site` runs with `base` `/a//b/`, `/a%5Cb/`, `/a%252F/`, `/café/`, `/a\nb/` (control character) or a 257-character base
- **THEN** the tool returns an error showing the expected shape and starts nothing
- **AND** `/a.b/`, `/a_b~c-d/` and `/a/b/` are accepted

#### Scenario: Explicit slash means no base
- **WHEN** `serve_mock_site{base:"/"}` runs
- **THEN** the site is served at the root, the result URL has no base segment, and no `mock-site:base-reservation` event is emitted

#### Scenario: First answering listener wins
- **GIVEN** two listeners of `mock-site:base-reservation`, A first and B second, both reserving
- **WHEN** A sets `pending` to `{base:"/a/"}` and B then finds `pending !== undefined`
- **THEN** the site is served under `/a/`, B does not overwrite `pending`, and B releases its own reservation

#### Scenario: Port busy is detected before the probe
- **WHEN** `serve_mock_site{}` runs without `base` and port 5299 is busy
- **THEN** the tool returns the port-busy error and emits no `mock-site:base-reservation` event

#### Scenario: Start failure after a reservation aborts the signal
- **GIVEN** a host-answered base `/some/prefix/` was accepted
- **WHEN** the server child fails to spawn, crashes, or does not become ready before the readiness timeout
- **THEN** the tool aborts `signal` so the host releases the reservation, and returns the failure

#### Scenario: Reserved base appears only inside the returned URL
- **WHEN** the site starts under a host-provided base
- **THEN** the result text contains the base only as part of the returned URL, never separately
