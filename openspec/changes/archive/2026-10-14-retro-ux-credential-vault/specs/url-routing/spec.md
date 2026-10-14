## MODIFIED Requirements

### Requirement: SPA fallback on server
The server SHALL return `index.html` for any GET request that does not match a static file, API endpoint, or WebSocket path, except under the API namespace. A request that the network guard admits, whose path in either of the network guard's views (raw, or decoded and dot-segment resolved) is `/api` or starts with `/api/`, and that matches no route SHALL be answered with HTTP 404 and a JSON body `{ "success": false, "error": "not_found", "message": "<text naming the method and path>" }`, for every method, in production mode, in development mode, and when no client build is present. A request path that the static file handler or the network guard refuses before routing (a dot-segment spelling when a client build is served, or an unparseable path) keeps that refusal; it is never answered with `index.html` and never forwarded to Vite. In development mode such a request SHALL NOT be forwarded to the Vite dev server.

#### Scenario: Server serves index.html for client routes
- **WHEN** a GET request is made to `/session/abc-123`
- **THEN** the server responds with `index.html` (HTTP 200)

#### Scenario: Server still serves static files
- **WHEN** a GET request is made to `/assets/main.js`
- **THEN** the server responds with the actual static file

#### Scenario: Unknown API path is a JSON 404
- **WHEN** a GET request the network guard admits is made to `/api/does-not-exist`
- **THEN** the server responds 404 with `content-type: application/json` and `error: "not_found"`
- **AND** the body is not `index.html`

#### Scenario: Encoded API path is a JSON 404
- **WHEN** an admitted GET request is made to `/%61pi/does-not-exist`
- **THEN** the server responds 404 with a JSON body, not `index.html`

#### Scenario: Dotted API path is a JSON 404
- **WHEN** an admitted GET request is made to `/x/../api/does-not-exist`
- **THEN** the server does not answer with `index.html` and does not forward it to Vite
- **AND** the answer is a JSON 404, or the static file handler's 403 refusal when a client build is served

#### Scenario: Unknown API path in development mode
- **WHEN** the server runs with `--dev` and the Vite dev server is up
- **AND** a GET request is made to `/api/does-not-exist`
- **THEN** the server responds 404 with a JSON body
- **AND** the request is not forwarded to Vite

#### Scenario: Registered API routes are unaffected
- **WHEN** a GET request is made to a registered route such as `/api/health` or a plugin route under `/api/plugins/`
- **THEN** that route answers as before
