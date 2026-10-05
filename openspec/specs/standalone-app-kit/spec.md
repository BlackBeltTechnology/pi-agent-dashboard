# standalone-app-kit Specification

## Purpose
Client plumbing (`@blackbelt-technology/pi-dashboard-app-kit`) for a standalone SPA on its own origin that talks to a pi-dashboard host: runtime endpoint config, identity modes from the login descriptor, OIDC PKCE config, origin-bound bearer transport, single-use WebSocket tickets and a reconnecting socket. Created by change extract-standalone-app-kit.

## Requirements

### Requirement: Runtime dashboard endpoint

The kit SHALL resolve every REST and WebSocket URL it builds from a runtime-configured dashboard base URL. `loadAppConfig` SHALL read `{ dashboardUrl }` from a JSON document (default `/config.json`); the document SHALL be a JSON object, and an absent or empty `dashboardUrl` in it SHALL mean the page's own origin. A `404`, a non-JSON body, a network failure or a non-object body SHALL fail with `app_config_unavailable`, unless the caller opted into `allowMissing`, in which case a `404` or non-JSON body SHALL mean the page's own origin. A relative path SHALL resolve against the base; an absolute `http(s)`/`ws(s)` URL SHALL pass through unchanged. A `dashboardUrl` that is not `http:`/`https:` or that carries userinfo credentials SHALL be rejected with the error code `invalid_dashboard_url`. WebSocket URLs SHALL use `wss:` for an `https:` base and `ws:` for an `http:` base.

#### Scenario: Cross-origin base
- **WHEN** the config is `{ "dashboardUrl": "https://dash.example.com" }` and the app requests `/api/sessions`
- **THEN** the request goes to `https://dash.example.com/api/sessions`
- **AND** the WebSocket URL for `/ws` is `wss://dash.example.com/ws`

#### Scenario: Same-origin default
- **WHEN** the config has no `dashboardUrl`
- **THEN** `/api/sessions` resolves against the page origin

#### Scenario: SPA fallback answers with HTML
- **WHEN** `/config.json` returns `200` with an HTML body and `allowMissing` is not set
- **THEN** loading fails with `app_config_unavailable` and no API request is made

#### Scenario: Dev proxy without a config file
- **WHEN** `/config.json` returns `404` and the caller passed `allowMissing`
- **THEN** the kit uses the page origin

#### Scenario: Absolute socket URL passes through
- **WHEN** a caller asks for a socket URL for `wss://other.example.com/ws`
- **THEN** that URL is used unchanged and carries no ticket, because its origin is not the dashboard origin

#### Scenario: Unsafe base rejected
- **WHEN** `dashboardUrl` is `javascript:alert(1)` or `https://user:pw@dash.example.com`
- **THEN** configuration fails with `invalid_dashboard_url` and no request is issued

### Requirement: Identity mode

The kit SHALL track one of four identity modes: `unknown` before the login descriptor is read, `oidc` when the descriptor reports an active provider that carries both `issuer` and `clientId`, `none` when it reports `{active:false}`, and `unavailable` when the read fails, the body is malformed, or an active provider lacks `issuer` or `clientId`. Only `oidc` and `none` SHALL ever send a request; `unavailable` SHALL NOT select `none`. In `none` mode a `401` or `403` SHALL be surfaced to the app as `not_admitted`.

#### Scenario: Nothing sent before the mode is known
- **WHEN** the app calls `authedFetch` before the descriptor has been read
- **THEN** `NoCredentialError` is thrown and no request is made

#### Scenario: Active provider without OIDC fields
- **WHEN** the descriptor is `{active:true, loginUrl:"/login"}` with no `issuer`
- **THEN** the mode is `unavailable` and no request is sent

#### Scenario: Login-less host refuses a foreign origin
- **WHEN** the mode is `none` and the host answers `403`
- **THEN** the app receives `not_admitted` and no sign-in is started

### Requirement: Authenticated transport

`authedFetch` SHALL attach `Authorization: Bearer <token>` in `oidc` mode when a token is held and the caller supplied no explicit `Authorization` header, SHALL send nothing and throw `NoCredentialError` in `oidc` mode without a token and in `unknown` or `unavailable` mode, and SHALL send a plain request with no `Authorization` header in `none` mode. Requests SHALL NOT send ambient cookies. The bearer SHALL be attached only when the request URL's origin equals the dashboard origin. A dashboard-origin `401` to the bearer the kit attached SHALL notify the session-refused listeners while that bearer is still the live credential (same token and credential epoch); a `401` for a caller-supplied `Authorization` header, from a foreign origin, for a since-replaced credential, or in `none` mode SHALL NOT.

#### Scenario: Bearer attached
- **WHEN** identity is active, a token `t1` is held, and `authedFetch("/api/x")` runs
- **THEN** the request carries `Authorization: Bearer t1`

#### Scenario: Bearer never sent to another origin
- **WHEN** a token is held and `authedFetch("https://evil.example/x")` runs
- **THEN** the request carries no `Authorization` header

#### Scenario: No credential, no request
- **WHEN** identity is active and no token is held
- **THEN** `authedFetch` throws `NoCredentialError` and no network request is made

#### Scenario: Login-less host
- **WHEN** the login descriptor reports `{active:false}`
- **THEN** `authedFetch` issues the request without an `Authorization` header

#### Scenario: Refusal signalled
- **WHEN** a request with token `t1` receives `401`
- **THEN** the session-refused listeners are notified

### Requirement: WebSocket ticket and URL

The kit SHALL obtain a single-use `browser`-scope ticket from `POST /api/ws-ticket` and SHALL build socket URLs that carry the ticket as the `ticket` query parameter. The bearer token SHALL NEVER appear in any URL, and a ticket SHALL only be appended to a socket URL whose origin is the dashboard origin. In `unknown` or `unavailable` mode, or in `oidc` mode when no ticket can be minted, the socket URL builder SHALL return `null`. In `none` mode it SHALL return the plain socket URL.

#### Scenario: Ticketed URL
- **WHEN** a ticket `k1` is minted for `/ws`
- **THEN** the URL is `<wsBase>/ws?ticket=k1` and contains no bearer token

#### Scenario: No ticket without credential
- **WHEN** identity is active and no token is held
- **THEN** the socket URL builder returns `null` and no socket is opened

### Requirement: Login descriptor read fails closed

The kit SHALL read `GET /api/identity/login-config` without a bearer. `{active:false}` SHALL put the kit in identity-inactive mode. A transport error, a non-2xx status or a malformed body SHALL yield an `unavailable` result and SHALL NOT switch the kit to identity-inactive mode. The kit SHALL contain no hard-coded issuer, client id or authority.

#### Scenario: Unreachable descriptor does not disable auth
- **WHEN** the descriptor request fails with a network error
- **THEN** the result is `unavailable` and `authedFetch` still refuses to send without a token

#### Scenario: Active descriptor
- **WHEN** the descriptor is `{active:true, issuer:"https://kc/realms/r", clientId:"team-web"}`
- **THEN** the OIDC config uses that authority and client id

### Requirement: OIDC PKCE configuration

`buildOidcConfig` SHALL produce an authorization-code + PKCE public-client configuration with no client secret, the token store scoped to `sessionStorage`, the caller-supplied `redirect_uri`, and automatic silent renew enabled.

#### Scenario: Public client
- **WHEN** a config is built from an active descriptor
- **THEN** `response_type` is `code`, no `client_secret` is present, and the user store uses `sessionStorage`

### Requirement: Identity context exposes the operator

The `./react` entry SHALL provide an OIDC identity bridge that exposes the signed-in operator as `{ iss, sub }` plus display labels and `signIn`/`signOut` actions, keeps the transport token in sync with the OIDC user, and clears it on sign-out or refusal. Product roles SHALL only come from an optional caller-supplied role resolver. In `none` mode it SHALL expose a local operator state without starting a sign-in.

#### Scenario: Token follows the user
- **WHEN** the OIDC user renews to a new access token
- **THEN** subsequent `authedFetch` calls carry the new token

#### Scenario: No-OIDC mode skips sign-in
- **WHEN** the descriptor is `{active:false}`
- **THEN** no OIDC redirect is started and the app renders as the local operator

### Requirement: Reconnecting socket

`connectWithReconnect` SHALL obtain a fresh URL from its URL resolver before every connection attempt, SHALL reconnect with backoff after an unexpected close or error, SHALL schedule only one retry when an error is followed by a close, SHALL treat `maxRetries` as the number of retries after the first attempt and then enter a terminal `disconnected` status, and SHALL NOT reconnect after an intentional `close()`. A resolver returning `null` or rejecting SHALL enter `disconnected` immediately without retrying. Its options SHALL stay compatible with the InvoiceBot call sites (`url`, `resolveUrl`, `createSocket`, `setTimer`, `clearTimer`, `random`).

#### Scenario: Fresh ticket per attempt
- **WHEN** the socket drops and reconnects twice
- **THEN** the URL resolver ran three times and each URL carried a different ticket

#### Scenario: No credential stops reconnecting
- **WHEN** the URL resolver returns `null`
- **THEN** status becomes `disconnected` and no retry is scheduled

#### Scenario: Intentional close
- **WHEN** the app calls `close()`
- **THEN** no reconnect is scheduled

#### Scenario: Retry cap
- **WHEN** every attempt fails and `maxRetries` is 3
- **THEN** four attempts run, status becomes `disconnected`, and no further attempt runs

### Requirement: Product-neutral, publishable package

The kit SHALL be a public workspace package with a README, SHALL NOT import any dashboard plugin, product endpoint, or the workspace-only `chat-embed` subpath, and its framework-free entry SHALL NOT import React or `react-oidc-context`.

#### Scenario: No product coupling
- **WHEN** the kit's source is scanned
- **THEN** it references no `/api/plugins/` path and no `@blackbelt-technology/pi-dashboard-web` import
