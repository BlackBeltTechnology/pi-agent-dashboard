# mockup-site-environment Specification

## Purpose
Make a mock render in the same build environment, with the same data shapes and the
same surroundings as the running app, without any hand-mirrored configuration, for any
project whose build tool and component framework have adapters.

## Requirements

### Requirement: Mock site inherits the project's build shape
The mock site SHALL load the project's own build configuration. From it, it SHALL take
module resolution, plugins, stylesheet processing, compile-time defines, dependency
pre-bundling and the static asset directory, which it serves read-only. It SHALL NOT
take the dev-server runtime settings (port, hot-reload endpoint, proxies), the source
root, or the build output. Inherited settings expressed relative to the app's source
root SHALL be resolved against that root before it is dropped. The project's mock options SHALL need no aliases copied
from the app.

#### Scenario: No hand-mirrored aliases
- **WHEN** the project's mock options declare no aliases and a mock imports an app module through an alias defined only in the app's build config
- **THEN** the mock renders that module

#### Scenario: App runtime settings are not inherited
- **WHEN** the app's build config sets a dev-server port, a hot-reload client port and proxies
- **THEN** the mock site serves on its own port, its hot-reload connects to the mock site, and no request is proxied to the app's backend

#### Scenario: App static asset resolves
- **WHEN** a mocked component references an asset from the app's static asset directory
- **THEN** the asset loads in the pane

#### Scenario: Root-relative static directory
- **WHEN** the app config sets a source root and a static directory relative to it
- **THEN** the mock site serves the same directory the app serves

### Requirement: Start through the project's launcher via a build-tool adapter
The mock site SHALL start through the project's own launcher and load the app's build
configuration. Both SHALL come, in order, from:
1. an explicit declaration in the project manifest, naming the launcher and the app
   config
2. detection by the build-tool adapter

One build-tool adapter SHALL ship. Startup SHALL fail, without starting anything, for
an unsupported build tool or a missing app config. The message SHALL name the reason,
the supported adapters, and the next step (declare the launcher and config, or add an
adapter).

#### Scenario: Declared launcher is used
- **WHEN** the project manifest declares a launcher that registers a module loader before starting the build tool, and an app config in a workspace package
- **THEN** the mock site starts through that launcher, the app config loads without module-resolution errors, and the log names both

#### Scenario: Unsupported build tool
- **WHEN** the project's build tool has no adapter
- **THEN** the serve tool returns an error naming the build tool, the supported adapters and how to declare a launcher, and starts nothing

### Requirement: Launcher safety
A launcher or app-config path whose real path (after following symlinks) is outside
the project root SHALL be refused, and nothing SHALL start. The resolved launcher and config SHALL be logged on every start. The site
SHALL bind to the loopback interface unless LAN access is requested.

#### Scenario: Launcher outside the project
- **WHEN** the declared launcher resolves to a path outside the project root
- **THEN** the serve tool refuses, names the path, and starts nothing

#### Scenario: Symlink escape
- **WHEN** the declared launcher is a symlink inside the project pointing outside it
- **THEN** the serve tool refuses and starts nothing

#### Scenario: No app config found
- **WHEN** no declaration exists and the adapter finds no app config
- **THEN** the serve tool returns an error naming where it looked and how to declare one

### Requirement: Panes mount content through a framework adapter
Pane content, rings and kit parts SHALL mount through a component-framework adapter.
The framework runtime de-duplication SHALL come from that adapter, not from the mock
site. One framework adapter SHALL ship. A mock written for a framework with no adapter
SHALL fail its page with a message naming the framework and the missing adapter, while
other mocks keep working. Fixtures, scripts and the cursor overlay SHALL NOT depend on
the framework.

#### Scenario: Unsupported framework mock
- **WHEN** a mock declares a framework with no adapter
- **THEN** its page shows an error naming the framework and the supported adapters, and other mocks still render

### Requirement: Mock options are not a build config
A project MAY provide a mock options file holding title, themes, an app setup module,
extra aliases, and the launcher and app-config declaration. The options file SHALL NOT
carry build plugins. The project root SHALL be found without the options file (the
manifest declaration, then the mock roots, then the repository top level). The
generated build config SHALL be regenerated on every start inside the project's build
cache directory.

#### Scenario: Missing options file
- **WHEN** the project has no mock options file
- **THEN** the site starts with the inherited build shape and default themes, and the decide CLI still finds the project root

#### Scenario: Extra alias from options
- **WHEN** the options file adds an alias the app config lacks
- **THEN** mocks resolve it, and the app's own aliases still resolve

### Requirement: Network fixtures for HTTP and WebSocket
A mock MAY declare fixtures for the app's HTTP requests and WebSocket connections as a
factory. Each pane instance and each script loop SHALL get a fresh fixture instance,
so state never leaks between panes or loops. Fixture-backed components SHALL run their
real data-loading code unchanged. Fixtures SHALL work for loopback and LAN viewers
alike. A fixture MAY list request patterns allowed to pass through to the network.

#### Scenario: Real component loads fixture data
- **WHEN** a mock renders an app component that fetches its list over HTTP and the mock declares a fixture for that route
- **THEN** the component renders the fixture's items through its own loading code

#### Scenario: Stateful fixture
- **WHEN** a scripted step triggers a POST that the fixture records, and the component then refetches
- **THEN** the refetched data reflects the recorded change

#### Scenario: Panes are isolated
- **WHEN** the Current and Proposed panes of one frame both render a fixture-backed component and one pane's script creates a record
- **THEN** the other pane's data is unchanged

#### Scenario: WebSocket fixture
- **WHEN** the app opens a WebSocket to a URL the mock declares a fixture for
- **THEN** the fixture's messages reach the app and no connection leaves the browser

#### Scenario: LAN viewer
- **WHEN** the site runs with LAN access and a phone opens a fixture-backed mock over plain HTTP
- **THEN** the component renders the fixture data

### Requirement: Capture real HTTP traffic as fixtures
The package SHALL provide a capture command that records a running app's HTTP traffic
for a URL and converts it into fixtures the mock can load. WebSocket fixtures SHALL be
written by hand; capture SHALL NOT claim to record them.

#### Scenario: Recorded traffic replays
- **WHEN** traffic captured from a running app is converted and loaded by a mock
- **THEN** the mock's component receives the recorded responses for those routes

### Requirement: Capture redacts and refuses secrets
Before writing, capture SHALL redact credential-bearing headers, cookies, query
parameters and JSON body keys named in a redaction list. The list has a built-in
default (authorization, cookie, set-cookie, password, secret, token and api-key-like
keys). Additions SHALL come from a capture option and from the project's mock options. Capture SHALL refuse to write when any remaining value
matches a built-in secret pattern (bearer tokens, JWTs, common provider key prefixes),
and SHALL name the matched location.

#### Scenario: Header and query secrets are redacted
- **WHEN** a captured request carries an `Authorization` header and a `token` query parameter
- **THEN** the written fixtures contain neither value

#### Scenario: Body secret is refused
- **WHEN** a captured response body holds a JWT under a key not in the redaction list
- **THEN** capture writes nothing and names the response and JSON path

### Requirement: Unhandled requests are reported as missing fixtures
The site SHALL list, for each mock page, every request the page made that no fixture
answered (method and path, deduplicated), labelled as missing fixtures. Such a request
SHALL NOT reach the network unless a fixture's pass-through list allows it.

#### Scenario: Missing host API
- **WHEN** a mock's component calls `GET /api/roles` and no fixture covers it
- **THEN** the page shows `GET /api/roles` under missing fixtures and the request does not reach the network

### Requirement: Shared surroundings frame
A frame MAY render its panes inside a surroundings wrapper: an app-shell part or app
route, built from real app components with the same fixtures in both panes. When a
frame uses surroundings, both panes SHALL render the identical wrapper, and only the
frame's content SHALL differ between Current and Proposed. Surroundings SHALL be
present in both panes or absent in both.

#### Scenario: Identical surroundings
- **WHEN** a frame declares surroundings and different Current and Proposed content
- **THEN** both panes render the same shell parts, and the DOM outside the content slot is identical between the panes

### Requirement: Startup budget
On this repository, `serve_mock_site` SHALL return a ready URL within 10 s at the 95th
percentile over 5 cold starts.

#### Scenario: Cold starts within budget
- **WHEN** `serve_mock_site` is started and stopped 5 times on this repository
- **THEN** the 95th-percentile time from call to a URL serving the site is under 10 s
