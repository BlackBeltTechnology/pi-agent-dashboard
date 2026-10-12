## MODIFIED Requirements

### Requirement: All REST calls use API base prefix
Every `fetch()` call to `/api/...` endpoints in the client SHALL prefix the URL with the value from `useApiBase()`. Root-relative `/api/...` string requests that omit the prefix — including those issued by dashboard plugin client code, which receives no API base — SHALL be rewritten by a host-installed fetch wrapper to `<apiBase>/api/...` whenever the API base is non-empty. Absolute URLs, `URL` objects, `Request` objects and non-`/api/` paths SHALL pass through unchanged.

#### Scenario: Relative fetch becomes absolute for cross-origin
- **WHEN** a component fetches `/api/sessions` and `useApiBase()` returns `http://remote:8000`
- **THEN** the actual fetch URL SHALL be `http://remote:8000/api/sessions`

#### Scenario: Same-origin fetch remains relative
- **WHEN** a component fetches `/api/sessions` and `useApiBase()` returns `""`
- **THEN** the actual fetch URL SHALL be `/api/sessions`

#### Scenario: Un-prefixed plugin fetch follows the selected server
- **WHEN** plugin client code calls `fetch("/api/quota")` while the API base is `http://remote:8000`
- **THEN** the request SHALL be sent to `http://remote:8000/api/quota`

#### Scenario: Server switch is honoured without reinstall
- **WHEN** the API base changes from `""` to `http://remote:8000` after the wrapper is installed
- **THEN** the next `fetch("/api/health")` SHALL be sent to `http://remote:8000/api/health`

#### Scenario: Explicit URLs are not rewritten
- **WHEN** the API base is `http://remote:8000` and code fetches `http://localhost:8000/api/health`, a `URL` object, a `Request` object, or `/assets/x.js`
- **THEN** the request URL SHALL be unchanged

#### Scenario: Query and hash preserved
- **WHEN** the API base is `http://remote:8000` and code fetches `/api/files?path=a%20b#x`
- **THEN** the request URL SHALL be `http://remote:8000/api/files?path=a%20b#x`

## ADDED Requirements

### Requirement: Local credentials never sent to a rewritten remote request
The API-base fetch rewrite SHALL run before the same-origin credential wrappers (paired-device bearer, grant-channel capability), so a request rewritten to a different origin SHALL NOT carry the local device bearer or the grant-channel header.

#### Scenario: Rewritten request carries no local bearer
- **WHEN** a device bearer is stored, the API base is `http://remote:8000`, and code fetches `/api/quota`
- **THEN** the request to `http://remote:8000/api/quota` SHALL NOT include the local `Authorization: Bearer` set by the device-auth wrapper

#### Scenario: Rewritten request carries no grant capability
- **WHEN** a grant capability is set, the API base is `http://remote:8000`, and code fetches `/api/quota`
- **THEN** the request SHALL NOT include the grant-channel header

#### Scenario: Same-origin credentials unchanged
- **WHEN** the API base is `""`, a device bearer is stored, and code fetches `/api/quota`
- **THEN** the request SHALL be `/api/quota` carrying the device bearer as before
