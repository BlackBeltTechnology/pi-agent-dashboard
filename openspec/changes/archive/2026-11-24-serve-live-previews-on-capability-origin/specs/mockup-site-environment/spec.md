## ADDED Requirements

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
