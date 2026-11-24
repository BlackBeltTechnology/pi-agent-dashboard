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

### Requirement: Site runs under a base path
The mock site SHALL run correctly when served under a URL base path that starts and ends
with `/`. A supplied base SHALL override any `base` inherited from the build shape and
SHALL be passed per launch on the command line, never written into a config file shared by
other sites of the project. Every URL the site creates or requests SHALL honour the base.
With a base set, the site SHALL NOT serve its entry at root `/`. Without a base it SHALL serve at `/`, dropping any inherited `base`.

#### Scenario: Entry under the base
- **WHEN** the site is started with base `/some/prefix/` and `GET /some/prefix/` is requested
- **THEN** the response is 200 and serves the mock site's HTML, with script and asset URLs prefixed by `/some/prefix/`

#### Scenario: Root without the base not served
- **WHEN** the site is started with base `/some/prefix/` and `GET /` is requested
- **THEN** the response is not the site's HTML (404 or a redirect to the base), never a blank page that claims success

#### Scenario: Plugin does not answer the root
- **WHEN** the site is started with base `/some/prefix/` and `GET /` reaches the dev server
- **THEN** the build tool's own base handling answers (redirect or 404) and the site's plugin middleware does not serve the entry or any `/__mock/*` endpoint

#### Scenario: Base passed per launch
- **WHEN** two sites of one project are started at the same time with bases `/one/` and `/two/`
- **THEN** each serves under its own base, and neither launch writes its base into a config file the other reads

#### Scenario: Every URL kind honours the base
- **WHEN** the site runs under base `/some/prefix/`
- **THEN** the HTML entry, the `/__mock/*` endpoints, the pane iframe addresses, the decisions fetch, the readiness probe, the headless and CLI URLs and the fixture layer's passthrough of `@vite`, `@fs`, `@id`, `@react-refresh`, `node_modules` and `__mock` requests are all prefixed by `/some/prefix/`

#### Scenario: Decisions endpoint under the base
- **WHEN** the site is started with base `/some/prefix/` and `GET /some/prefix/__mock/decisions` is requested
- **THEN** the response is 200 with `mockSite: true`, and the site's own decisions fetch uses that base-prefixed URL

#### Scenario: Readiness probe under the base
- **WHEN** the launcher waits for a site started with base `/some/prefix/`
- **THEN** it probes `/some/prefix/__mock/decisions` and reports ready only on `mockSite: true`

#### Scenario: Pane iframes under the base
- **WHEN** a page is opened at `/some/prefix/` and a frame renders its Current and Proposed panes
- **THEN** each pane iframe loads from `/some/prefix/?pane=…` and renders its component

#### Scenario: Nested panes load in the opaque tier
- **WHEN** the site runs under a base in an opaque, sandboxed frame and renders its pane iframes
- **THEN** each pane loads and renders; the host's cross-browser (Chromium and Firefox) end-to-end gate for nested panes in that frame covers this

#### Scenario: Fixtures pass dev requests through under the base
- **WHEN** a pane's fixture layer sees a request for `/some/prefix/@fs/Users/dev/app/src/main.tsx` or `/some/prefix/__mock/decisions` on the site's own origin
- **THEN** the request passes through to the network and is not reported as a missing fixture

#### Scenario: Fixture still intercepts app requests under the base
- **WHEN** a mock's component under base `/some/prefix/` requests an app API route the mock declares a fixture for
- **THEN** the fixture answers it as before

#### Scenario: Base is stripped only to test dev passthrough
- **GIVEN** the site runs under base `/api/` and a mock declares a fixture for `/api/roles`
- **WHEN** a pane requests `/api/roles`, and separately `/api/@fs/Users/dev/app/src/main.tsx`
- **THEN** the base is stripped only to test passthrough: `/api/roles` is not stripped to `/roles`, matches the fixture on its raw path and is answered by it, and `/api/@fs/...` passes through to the network
- **AND** a missing-fixture report for `/api/other` names `/other` (base stripped, because it lies under the base) and one for `/health` names `/health` unchanged

#### Scenario: Headless and CLI URLs under the base
- **WHEN** the check, video and decisions CLIs are given the URL `http://localhost:5299/some/prefix/`
- **THEN** they build `…/some/prefix/__mock/decisions` and `…/some/prefix/?pane=…` with exactly one `/` between base and path

#### Scenario: Inherited base overridden
- **WHEN** the project's build config sets `base: "/app/"` and the site is started with base `/some/prefix/`
- **THEN** the site is served under `/some/prefix/`, not `/app/`

#### Scenario: No base
- **WHEN** the site is started without a base
- **THEN** `GET /` serves the site and `GET /__mock/decisions` returns 200 as before

#### Scenario: No base ignores an inherited base
- **WHEN** the project's build config sets `base: "/app/"` and the site is started without a base
- **THEN** `GET /` serves the site, not `/app/`

### Requirement: Site degrades visibly in an opaque frame
In a frame without a same-origin allowance (opaque origin: `location.origin` is `"null"`, storage blocked) the site SHALL NOT render blank or fail silently. It SHALL show a visible notice naming the unavailable capabilities, including "storage unavailable in this preview", and keep the mocks rendering.

#### Scenario: Storage unavailable notice
- **WHEN** the site loads in a sandboxed frame without `allow-same-origin` and reading `localStorage` throws
- **THEN** the page renders its mock list and frames, and shows a notice containing "storage unavailable in this preview" that lists which features need a same-origin frame

#### Scenario: Preference falls back to memory
- **WHEN** storage is unavailable and the user toggles a persisted preference such as Highlights
- **THEN** the toggle takes effect for the current page view and does not throw

#### Scenario: Same-origin frame unchanged
- **WHEN** the site runs in a frame with a real origin
- **THEN** no notice is shown and all features work

### Requirement: Opaque frame never throws from storage or messaging
The site SHALL guard `localStorage`, `sessionStorage` and storage-event sync, and SHALL build copied links from `location.href` without its hash. Messages SHALL go only to `parent` (pane to shell) or the pane's window (shell to pane), with target origin `"*"` solely when the origin is opaque, and be accepted only from the expected window (`event.source`). Payloads SHALL carry no decisions, fixtures or URLs, except a missing-fixture report's method and base-relative path.

#### Scenario: No messaging errors
- **WHEN** the site runs in an opaque frame
- **THEN** no uncaught exception is raised from `postMessage` target-origin or storage access, and the features that cannot work (such as remembered pane height, find-in-frame and storage-event highlight sync) are listed in the notice

#### Scenario: Session storage guarded
- **WHEN** the site runs in an opaque frame and a pane reads or writes its remembered height in `sessionStorage`
- **THEN** no exception is raised and the pane falls back to its default height

#### Scenario: Copied link without an origin
- **WHEN** a link to a ring is copied from an opaque frame
- **THEN** the link is built from `location.href` minus the hash and does not start with `null`

#### Scenario: Message from another window ignored
- **WHEN** a pane message, including a missing-fixture report, arrives whose `event.source` is not the expected frame window
- **THEN** the shell ignores it

#### Scenario: Shell message accepted only from the parent
- **WHEN** a pause, hidden or find message reaches a pane from a window other than its `parent`
- **THEN** the pane ignores it

#### Scenario: Missing fixtures still listed in an opaque frame
- **WHEN** the site runs under base `/some/prefix/` in an opaque frame and a mock's component calls `GET /api/roles` with no fixture
- **THEN** the page lists `GET /api/roles` as a missing fixture, and the report carries no base, `<pid>` or other URL
