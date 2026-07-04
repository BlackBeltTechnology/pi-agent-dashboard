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
Every `fetch()` call to `/api/...` endpoints in the client SHALL prefix the URL with the value from `useApiBase()`.

#### Scenario: Relative fetch becomes absolute for cross-origin
- **WHEN** a component fetches `/api/sessions` and `useApiBase()` returns `http://remote:8000`
- **THEN** the actual fetch URL SHALL be `http://remote:8000/api/sessions`

#### Scenario: Same-origin fetch remains relative
- **WHEN** a component fetches `/api/sessions` and `useApiBase()` returns `""`
- **THEN** the actual fetch URL SHALL be `/api/sessions`

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

