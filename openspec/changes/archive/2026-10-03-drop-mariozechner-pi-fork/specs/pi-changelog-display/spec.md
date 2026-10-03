## MODIFIED Requirements

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
