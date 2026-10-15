## MODIFIED Requirements

### Requirement: CORS enabled on dashboard server
The server SHALL register `@fastify/cors` to handle cross-origin requests from separately-hosted clients.

Requests under an enabled plugin public namespace (`/api/plugins/<id>/public/`, see `plugin-public-routes`) are excluded from this registration's origin decision; the host answers CORS for them from that plugin's own `allowedOrigins` only, ahead of this registration, so none of this capability's origin rules (localhost, `cors.allowedOrigins`, neutral shell origin, trusted-network origins, live tunnel origins, prompt-granted origins) applies there, and a namespace origin gains no CORS grant anywhere else.

#### Scenario: Same-origin requests pass through
- **WHEN** a request has no `Origin` header (same-origin)
- **THEN** the server SHALL process it normally without CORS headers

#### Scenario: Localhost origins allowed by default
- **WHEN** a request comes from `http://localhost:3000` or `http://127.0.0.1:5173` or any localhost port
- **THEN** the server SHALL respond with `Access-Control-Allow-Origin` matching the request origin

#### Scenario: Configured origins allowed
- **WHEN** `cors.allowedOrigins` in config contains `https://dashboard.example.com`
- **AND** a request comes from `https://dashboard.example.com`
- **THEN** the server SHALL respond with matching `Access-Control-Allow-Origin`

#### Scenario: Unknown origins rejected
- **WHEN** a request comes from `https://evil.example.com` not in config
- **THEN** the server SHALL reject the CORS preflight

#### Scenario: Localhost origin gets no grant on a public namespace
- **WHEN** a request from `http://localhost:3000` targets an enabled public namespace whose `allowedOrigins` does not list it
- **THEN** no `Access-Control-Allow-Origin` header SHALL be sent

#### Scenario: Namespace origin gets no grant on core routes
- **WHEN** a request from `https://shop.example` (listed only in a plugin's public `allowedOrigins`) targets `/api/sessions`
- **THEN** the server SHALL reject the CORS preflight exactly as for any unknown origin

### Requirement: CORS credentials support
The server SHALL set `Access-Control-Allow-Credentials: true` to support cross-origin auth cookies.

Responses under an enabled plugin public namespace (see `plugin-public-routes`) SHALL NOT carry `Access-Control-Allow-Credentials`; the namespace is answered by its own CORS handling, which is excluded from every origin, credential and preflight rule of this capability.

#### Scenario: Cross-origin auth cookies forwarded
- **WHEN** a cross-origin request includes credentials (cookies)
- **THEN** the server SHALL accept and process the cookies

#### Scenario: No credentials on a public namespace
- **WHEN** a listed origin calls an enabled plugin public route
- **THEN** the response SHALL NOT carry `Access-Control-Allow-Credentials`

### Requirement: CORS preflight allows mutating methods
The server SHALL advertise `GET, HEAD, POST, PUT, PATCH, DELETE` in `Access-Control-Allow-Methods` (`CORS_ALLOWED_METHODS` in `auth/cors-origin.ts`, passed as `@fastify/cors` `methods`). The `@fastify/cors` v11 default (`GET,HEAD,POST`) SHALL NOT be relied on. The method list SHALL NOT widen which origins are allowed; auth still gates every mutation.

Preflights under an enabled plugin public namespace (`/api/plugins/<id>/public/`, see `plugin-public-routes`) are answered by the namespace's own CORS handling with only the registered route's methods; this requirement's method list does not apply there.

#### Scenario: Cross-origin PUT preflight from an allowed origin
- **WHEN** an allowed cross-origin client (e.g. the Electron renderer) sends `OPTIONS /api/openspec/groups/assignments` with `Access-Control-Request-Method: PUT`
- **THEN** `Access-Control-Allow-Methods` SHALL include `PUT`
- **AND** the follow-up `PUT` SHALL NOT be blocked by the browser

#### Scenario: PATCH and DELETE preflight
- **WHEN** an allowed origin preflights `PATCH` or `DELETE`
- **THEN** `Access-Control-Allow-Methods` SHALL include the requested method

#### Scenario: Public namespace preflight advertises only the route's methods
- **WHEN** a listed origin preflights `POST` on an enabled plugin public route registered for `POST` only
- **THEN** `Access-Control-Allow-Methods` SHALL be `POST`
