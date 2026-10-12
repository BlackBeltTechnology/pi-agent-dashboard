## Purpose

Enable the web client to reach a dashboard server on a different origin — resolving the HTTP API base from the WebSocket URL, prefixing REST calls, and authenticating cross-origin with a bearer token independent of the origin-bound cookie.

## Requirements

### Requirement: API base URL context
The client SHALL provide a React context (`ApiContext`) and hook (`useApiBase()`) that returns the HTTP base URL of the connected dashboard server.

#### Scenario: Same-origin deployment returns empty string
- **WHEN** the WebSocket URL matches the page origin (same host and port)
- **THEN** `useApiBase()` SHALL return `""` (empty string)

#### Scenario: Cross-origin deployment returns full base URL
- **WHEN** the WebSocket URL is `ws://remote-host:8000/ws`
- **THEN** `useApiBase()` SHALL return `http://remote-host:8000`

#### Scenario: Secure WebSocket derives HTTPS base
- **WHEN** the WebSocket URL is `wss://remote-host:8000/ws`
- **THEN** `useApiBase()` SHALL return `https://remote-host:8000`

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

### Requirement: Build-time API URL override
The client SHALL support a `VITE_API_URL` environment variable to set a default API base URL at build time, used when no server is selected via `ServerSelector`.

#### Scenario: Static build with fixed server
- **WHEN** `VITE_API_URL=https://dashboard.example.com` is set during `npm run build`
- **THEN** the client SHALL default to `https://dashboard.example.com` as the API base

#### Scenario: No env var uses page origin
- **WHEN** `VITE_API_URL` is not set
- **THEN** the client SHALL default to the page origin (same-origin behavior)

### Requirement: Bearer auth mode independent of origin-bound cookie
The client SHALL support authenticating to a cross-origin server with a bearer
token via `Authorization: Bearer` for REST — as an alternative to the
origin-bound auth cookie — so a neutral-origin shell can reach a server on a
different origin. For WebSocket the client SHALL mint a short-lived single-use
ticket from an authenticated REST call and present that ticket on the upgrade;
the durable bearer token SHALL NOT be placed on the socket.

#### Scenario: Cross-origin REST with bearer
- **WHEN** the shell issues a REST call to a paired server on a different origin
- **THEN** it attaches the server's bearer token in the `Authorization` header

#### Scenario: Cross-origin WebSocket with ticket
- **WHEN** the shell opens a WebSocket to a paired server on a different origin
- **THEN** it first mints a single-use ticket via an authenticated REST call and opens the socket with that ticket, never placing the durable bearer on the socket or relying on a cookie

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
