# pi-changelog-display Specification

## Purpose
TBD - created by archiving change pi-update-whats-new-panel. Update Purpose after archive.

## Requirements

### Requirement: CHANGELOG parser
The dashboard server SHALL provide a pure parser that converts a Keep-a-Changelog-style markdown file into a structured list of release entries with typed sub-sections.

#### Scenario: H2 release headers extracted
- **WHEN** the parser is given markdown text containing one or more lines matching `^## \[<version>\] - <date>$`
- **THEN** the parser SHALL emit one `ChangelogRelease` per matched H2
- **AND** populate `version` from the bracketed token
- **AND** populate `date` from the date token, or `null` when the token is not a parseable ISO-like date

#### Scenario: Breaking Changes section extracted
- **WHEN** a release section contains an `### Breaking Changes` H3 sub-heading
- **THEN** the parser SHALL collect every top-level `- ` bullet under that sub-heading into the release's `breaking` array
- **AND** stop collecting when the next H2 or H3 boundary is reached
- **AND** preserve each bullet's original prose verbatim, including inline markdown links

#### Scenario: New features merged from two section names
- **WHEN** a release section contains `### New Features` AND/OR `### Added`
- **THEN** the parser SHALL append bullets from both sub-headings into the release's `features` array in source order

#### Scenario: Other typed sub-sections preserved
- **WHEN** a release section contains `### Changed` or `### Fixed`
- **THEN** the parser SHALL populate `changed` or `fixed` arrays respectively

#### Scenario: Issue links extracted per bullet
- **WHEN** a bullet's prose contains substrings matching `\(\[#(\d+)\]\((https?://[^)]+)\)\)`
- **THEN** the parser SHALL append `{ num, url }` entries to that bullet's `issues` array
- **AND** still preserve the original prose unchanged

#### Scenario: Raw H2 section retained
- **WHEN** any release is parsed
- **THEN** the parser SHALL set the release's `raw` field to the full markdown text from that release's H2 line through (but not including) the next H2 line

#### Scenario: Unrecognized sub-headings ignored
- **WHEN** a release section contains H3 sub-headings other than the four recognized names
- **THEN** the parser SHALL NOT throw
- **AND** the typed arrays SHALL remain empty for those bullets
- **AND** `raw` SHALL still contain the full section text

#### Scenario: Malformed markdown handled gracefully
- **WHEN** the parser is given markdown that does not contain any matching H2 release headers
- **THEN** the parser SHALL return an empty release list
- **AND** SHALL NOT throw

### Requirement: Changelog REST endpoint
The server SHALL expose `GET /api/pi-core/changelog` returning structured release entries between two versions for any installed package whose `pkg` query param is a syntactically valid npm package name.

#### Scenario: Successful range query
- **WHEN** the client sends `GET /api/pi-core/changelog?pkg=@earendil-works/pi-coding-agent&from=0.62.0&to=0.70.0`
- **AND** the package is installed AND its `CHANGELOG.md` is readable
- **THEN** the server SHALL respond `200` with a JSON body containing `pkg`, `from`, `to`, `releases[]` (latest first), `hasBreaking`, `changelogUrl`, and `parsedAt`
- **AND** `releases[]` SHALL contain only entries whose version falls in the half-open interval `(from, to]`

#### Scenario: hasBreaking derived from releases
- **WHEN** any release in the filtered list has a non-empty `breaking[]`
- **THEN** `hasBreaking` SHALL be `true`
- **AND** otherwise `false`

#### Scenario: Malformed package name rejected
- **WHEN** the client sends a `pkg` query param that is not a valid npm package name (empty, contains path separators `/` beyond a single scope slash, contains `..`, or otherwise fails the npm name grammar)
- **THEN** the server SHALL respond `400` with a JSON error
- **AND** SHALL NOT read any filesystem path derived from the user input

#### Scenario: Any valid non-core package accepted
- **WHEN** the client sends a `pkg` that is a valid npm name but not a pi core package (e.g. `pi-web-access`)
- **THEN** the server SHALL NOT reject on the basis of the name being absent from any core-package list
- **AND** SHALL attempt to locate that package's `CHANGELOG.md` via the standard node_modules resolution

#### Scenario: Package not installed or no CHANGELOG returns empty
- **WHEN** the requested package is a valid npm name BUT its `CHANGELOG.md` cannot be located (not installed, or installed without a root CHANGELOG)
- **THEN** the server SHALL respond `200` with `releases: []`, `hasBreaking: false`, `changelogUrl: null`
- **AND** SHALL NOT respond `404`

#### Scenario: Missing or invalid version range
- **WHEN** the client omits `from` or `to`, or provides versions that are not parseable semver
- **THEN** the server SHALL respond `400` with a JSON error

#### Scenario: Endpoint gated by bootstrap status
- **WHEN** `bootstrapState.status !== "ready"`
- **THEN** the server SHALL respond `503` (mirroring the gate that protects other `/api/pi-core/*` routes)

#### Scenario: Cache hit on identical request
- **WHEN** the same request is made twice within 60 seconds
- **AND** the underlying `CHANGELOG.md` mtime has not changed
- **THEN** the second request SHALL be served from cache without re-parsing

#### Scenario: Cache invalidated by core update
- **WHEN** a `pi-core` update completes successfully via `POST /api/pi-core/update`
- **THEN** the changelog cache for the updated package SHALL be cleared
- **AND** the next `GET /api/pi-core/changelog` request for that package SHALL re-parse from disk

### Requirement: Changelog URL derivation
The server SHALL derive a public `changelogUrl` for the GitHub-hosted CHANGELOG when the installed package's `package.json` declares a `repository` field with a parseable GitHub URL.

#### Scenario: GitHub repository URL parsed
- **WHEN** the package's `package.json` declares `repository` as either a string `"github:org/repo"` or `"https://github.com/org/repo.git"`, or an object `{ "url": "git+https://github.com/org/repo.git" }`
- **THEN** the server SHALL set `changelogUrl` to `https://github.com/org/repo/blob/main/CHANGELOG.md`

#### Scenario: Non-GitHub repository
- **WHEN** the `repository` field is missing OR points at a non-GitHub host
- **THEN** the server SHALL set `changelogUrl` to `null`

#### Scenario: Monorepo subdir respected
- **WHEN** the `repository` field includes a `directory` sub-field (e.g. `"directory": "packages/foo"`)
- **THEN** the server SHALL include the subdir in the URL: `https://github.com/org/repo/blob/main/packages/foo/CHANGELOG.md`

### Requirement: WhatsNewDialog modal
The client SHALL provide a `WhatsNewDialog` React component that renders parsed changelog entries between two versions of a package as a modal dialog. The dialog SHALL render whether or not the changelog contains breaking changes; only the auto-expansion behaviour of the Breaking section is conditional on `hasBreaking`.

#### Scenario: Dialog mounts via DialogPortal
- **WHEN** the dialog is opened
- **THEN** it SHALL render through the existing `DialogPortal` component
- **AND** SHALL trap focus while open
- **AND** SHALL close on Esc, click-outside, and the explicit `[×]` button

#### Scenario: Breaking section auto-expanded only when hasBreaking is true
- **WHEN** the dialog opens with `hasBreaking: true`
- **THEN** the "Breaking Changes" section SHALL be the first content block beneath the title
- **AND** SHALL be expanded by default
- **AND** SHALL list every breaking-change bullet across every release in the response, grouped by version
- **WHEN** the dialog opens with `hasBreaking: false`
- **THEN** the "Breaking Changes" section SHALL NOT be rendered
- **AND** the dialog content SHALL begin with the New features and Other changes sections

#### Scenario: Other sections collapsed
- **WHEN** the dialog renders the "New features" and "Other changes" sections (the latter aggregating `changed` + `fixed`)
- **THEN** both SHALL be collapsed by default with an expand toggle
- **AND** clicking the toggle SHALL expand the section in place

#### Scenario: Bullet links preserved
- **WHEN** any bullet contains a markdown link (issue/PR or otherwise)
- **THEN** the dialog SHALL render that link as a clickable anchor opening in a new tab
- **AND** the rendered HTML SHALL pass through the existing `MarkdownContent` component's link sanitization

#### Scenario: GitHub link rendered when available
- **WHEN** `changelogUrl` is non-null
- **THEN** the dialog SHALL render a footer link "Open full changelog on GitHub" pointing at that URL
- **AND** open it in a new tab

#### Scenario: Empty release list shown
- **WHEN** `releases: []` is returned (e.g. from === to, or bridge of two non-adjacent published versions)
- **THEN** the dialog SHALL render a one-line message "No release notes available for this version range"
- **AND** still render the "Open full changelog" link if available

#### Scenario: Update CTA invokes existing handler
- **WHEN** the user clicks `[Update to <latest>]` in the dialog footer
- **THEN** the dialog SHALL close
- **AND** the handler SHALL invoke the same `onUpdate` callback the row's `[Update]` button uses, with the same package name argument

### Requirement: Remote CHANGELOG fetch
The server SHALL fetch the CHANGELOG markdown for `@earendil-works/pi-coding-agent` from the package's upstream GitHub repository at `raw.githubusercontent.com` instead of reading the locally-installed copy. The locally-installed copy SHALL be used as a fallback only when the remote fetch fails or is skipped.

#### Scenario: Remote URL derived from repository field
- **WHEN** the package's `package.json#repository` declares a GitHub URL with optional `directory` subfield
- **THEN** the server SHALL derive a raw URL of the form `https://raw.githubusercontent.com/<org>/<repo>/main/<directory>/CHANGELOG.md`
- **AND** the `<directory>/` segment SHALL be omitted when no directory subfield is present

#### Scenario: Remote fetch succeeds and supersedes local
- **WHEN** the changelog route serves `GET /api/pi-core/changelog?pkg=...&from=...&to=...`
- **AND** the package has a derivable raw URL
- **AND** the remote fetch returns 2xx with valid markdown text
- **THEN** the server SHALL parse the remote text
- **AND** the response's `releases` field SHALL be populated from the remote parse result
- **AND** the locally-installed CHANGELOG SHALL NOT be read

#### Scenario: Remote fetch failure falls back to local
- **WHEN** the remote fetch fails (network error, non-2xx status, malformed response, timeout)
- **THEN** the server SHALL read and parse the locally-installed CHANGELOG
- **AND** the response SHALL still return a valid `ChangelogResponse` shape
- **AND** the response's `releases` SHALL be populated from the local parse (potentially empty)

#### Scenario: PI_OFFLINE skips remote fetch
- **WHEN** the `PI_OFFLINE` environment variable is set
- **THEN** the server SHALL NOT issue any remote request
- **AND** SHALL read the local CHANGELOG directly

#### Scenario: 10-second timeout on remote fetch
- **WHEN** the remote fetch takes longer than 10 seconds
- **THEN** the request SHALL be aborted via `AbortSignal.timeout(10000)`
- **AND** the server SHALL fall back to the local CHANGELOG

#### Scenario: Cache key separates remote from local
- **WHEN** a remote fetch fails and the route falls back to local
- **THEN** the cache entry SHALL be keyed by `(pkg, "local")` for that response
- **AND** the next request that succeeds against remote SHALL produce a separate `(pkg, "remote")` cache entry — neither poisons the other

#### Scenario: ETag-based conditional refresh
- **WHEN** the remote response includes an `ETag` header
- **THEN** the server SHALL store the ETag alongside the cached body
- **AND** the next fetch (after the 5-minute TTL elapses) SHALL send `If-None-Match: <etag>`
- **AND** a `304 Not Modified` response SHALL extend the cache TTL without re-downloading the body

#### Scenario: changelogUrl in response remains the human-readable URL
- **WHEN** the response is returned to the client
- **THEN** `changelogUrl` SHALL still point at the `/blob/main/...` form (used for the "Open full changelog on GitHub" link in `WhatsNewDialog`)
- **AND** the raw URL used internally for fetching SHALL NOT be exposed to the client

#### Scenario: Non-GitHub repository falls through to local
- **WHEN** the package's `repository` field points at a non-GitHub host (e.g. GitLab, BitBucket)
- **OR** the repository field is missing or unparseable
- **THEN** the server SHALL skip the remote fetch
- **AND** read the local CHANGELOG directly

### Requirement: CHANGELOG file resolution robustness

The server SHALL locate an installed core package's `CHANGELOG.md` even when the
package's `package.json#exports` field blocks module-resolution access to its
subpaths. Resolution SHALL try, in order: (1) the managed install directory,
(2) bare-import via `require.resolve`, (3) a filesystem walk up `node_modules`
from the server module's own location. The "package not installed returns empty"
response SHALL be produced only when all three strategies fail.

#### Scenario: Exports field blocks require.resolve but file present

- **WHEN** the requested package is in the core whitelist
- **AND** the managed install directory does not contain the package
- **AND** the package's `exports` field omits `"./package.json"` and declares no
  `require`/`default` condition, so `require.resolve("<pkg>/package.json")` throws
- **AND** `CHANGELOG.md` exists at `node_modules/<pkg>/CHANGELOG.md` reachable by
  walking up from the server module location
- **THEN** the server SHALL locate that `CHANGELOG.md` via the filesystem walk
- **AND** SHALL NOT return the empty "package not installed" response
- **AND** the route SHALL proceed to derive `changelogUrl` and run the
  remote-first / local-fallback fetch flow

#### Scenario: Strategy precedence preserved

- **WHEN** the managed install directory contains the package's `CHANGELOG.md`
- **THEN** the server SHALL use the managed copy
- **AND** SHALL NOT perform the filesystem walk

#### Scenario: All strategies fail returns empty

- **WHEN** the package is not in the managed directory
- **AND** bare-import resolution fails
- **AND** no `node_modules/<pkg>/CHANGELOG.md` is found by walking up from the
  server module location
- **THEN** the server SHALL respond `200` with `releases: []`, `hasBreaking: false`,
  `changelogUrl: null` per the existing "Package not installed returns empty"
  scenario

### Requirement: What's-New icon for all updatable packages
The client SHALL render the What's-New affordance for every installed package
row that has an update available, not only the pi core package.

#### Scenario: Updatable package with a CHANGELOG shows the icon
- **WHEN** a package row reports `updateAvailable` true with distinct current/latest versions
- **AND** the changelog query for that package returns at least one release
- **THEN** the row SHALL render the What's-New icon wired to open `WhatsNewDialog` for that package

#### Scenario: Updatable package without a CHANGELOG shows no icon
- **WHEN** a package row reports an available update
- **AND** the changelog query returns `releases: []` (no locatable CHANGELOG)
- **THEN** the row SHALL render no What's-New icon
- **AND** SHALL surface no warning, error, or toast

#### Scenario: Non-updatable package shows no icon
- **WHEN** a package row has no available update
- **THEN** the client SHALL NOT issue a changelog query for that package
- **AND** SHALL render no What's-New icon
