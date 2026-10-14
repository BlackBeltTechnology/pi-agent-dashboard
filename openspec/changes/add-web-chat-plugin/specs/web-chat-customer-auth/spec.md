## ADDED Requirements

### Requirement: Customers authenticate by identity bearer or business token

Every web-chat public request except `GET widget.js` SHALL be authenticated as a customer by one of the enabled modes, and SHALL be answered `401` otherwise:
- **identity mode**: the host-resolved principal (`ctx.identity.principalOf(request)`) is non-null and its issuer exactly equals an entry of `customerIssuers`; the customer id is `(principal.iss, principal.sub)`.
- **token mode**: header `X-Web-Chat-Token` carries `wct1.<payload>.<mac>` where `mac` is HMAC-SHA256 over `wct1.<payload>` with the current or (for 24 hours after rotation) the previous secret from the plugin credential store; the payload JSON has `aud == "web-chat"`, `sub`, integer `iat` and `exp` with `0 < exp − iat ≤ 900`, and `iat − 60 ≤ now ≤ exp + 60`. The customer id is `("web-chat-token", sub)`. MAC comparison SHALL be constant-time. Tokens are replayable until `exp` (no single-use tracking).

In every mode, a request carrying a non-null principal whose issuer is not in `customerIssuers` SHALL be answered `403` (operators never act as customers). In both modes the subject SHALL match `^[A-Za-z0-9._@~-]{1,128}$` and SHALL NOT be `.` or `..`; otherwise `401` (operators whose IdP subjects fall outside this set map them in the IdP or use token mode). The subject is never used raw in a filesystem path (customer directories use a hash) and is percent-encoded wherever it enters a URL. When both modes are enabled and both credentials are present, identity mode SHALL win. No credential SHALL be accepted from the query string. A stream opened in token mode SHALL be closed by the plugin at the token's `exp`; the widget reconnects with a fresh credential.

#### Scenario: Identity customer accepted
- **WHEN** identity mode is enabled with `customerIssuers: ["https://id.shop.example"]` and the resolved principal has that issuer and subject `u1`
- **THEN** the request SHALL be authenticated as customer `("https://id.shop.example", "u1")`

#### Scenario: Operator principal refused
- **WHEN** the resolved principal's issuer is not in `customerIssuers`
- **THEN** the API SHALL answer `403`

#### Scenario: Token boundaries
- **WHEN** tokens arrive with `exp − iat` of 900 and 901 seconds, with `iat` 61 seconds in the future, with `aud` `"other"`, and with one byte of the MAC altered
- **THEN** only the 900-second token SHALL be accepted; the others SHALL be answered `401`

#### Scenario: Unsafe subject refused
- **WHEN** a valid token carries `sub` `..`, `a/b`, an empty string, or a subject containing a newline
- **THEN** the request SHALL be answered `401`

#### Scenario: Rotated secret grace
- **WHEN** the secret was rotated 23 hours ago and a token is signed with the previous secret
- **THEN** it SHALL be accepted; at 25 hours it SHALL be answered `401`

#### Scenario: Token-mode stream closes at expiry
- **WHEN** a stream was opened with a token whose `exp` is T
- **THEN** the plugin SHALL close the stream at T

### Requirement: The public API fails closed per mode

The serving gate SHALL be evaluated for the mode of the presented credential (cached at most 5 seconds and re-evaluated on configuration change) and SHALL answer `503` with a code naming the missing prerequisite unless all hold:
- common: the host provides the prerequisite seams, detected at activation by member presence (`ctx.dataDir`, `registerPublicRoute`, `openEventStream`, `onSessionResolved`, `subscribeSession`, `registerPiRequestHandler`, and in identity mode `ctx.identity` with `hasHostPolicy`) — else `host_unsupported`; `ctx.vault` is present and the model credential binding is readable (`model_credential_missing`); `kbDir`, when configured, is a readable directory outside the operator's `~/.pi` tree (`kb_invalid`);
- identity mode: `ctx.identity` present and identity enforced, and `customerIssuers` non-empty;
- token mode: `ctx.credentials` present and a secret of at least 32 bytes stored (`token_secret_missing`);
- **customer confinement** (required in both modes whenever identity is enforced and `customerIssuers` is non-empty, because customer principals could otherwise reach other roads): `ctx.identity.hasHostPolicy()` returns `true`, and for every entry of `customerIssuers` a probe through `ctx.identity.authorize` with a synthetic principal of that issuer returns `true` for action `public` and `false` for actions `read` and `write` (`customer_confinement_missing`). The probe SHALL run at activation, whenever `hasHostPolicy()` or the configuration changes, and at least every 5 minutes — not per request.

A failing mode SHALL NOT block requests authenticated by the other, healthy mode. When a mode's gate transitions from open to closed, the plugin SHALL end that mode's live conversations.

#### Scenario: Non-confining policy keeps the gate closed
- **WHEN** identity is enforced, `customerIssuers` is non-empty, and the registered policy allows a customer-issuer principal the `read` action
- **THEN** `POST conversations` SHALL answer `503` with code `customer_confinement_missing` in both modes

#### Scenario: Healthy mode unaffected
- **WHEN** identity mode's gate is closed and token mode's is open
- **THEN** token-authenticated requests SHALL be served
