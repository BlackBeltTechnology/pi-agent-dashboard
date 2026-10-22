## MODIFIED Requirements

### Requirement: JWT session token
The auth module SHALL issue a JWT signed with `auth.secret` from config. The JWT payload SHALL contain `sub` (email), `name` (display name), `username`, `provider` (provider key), and `exp` (expiry timestamp). The default expiry SHALL be 7 days. The cookie SHALL be named `pi_dash_token`, set as `HttpOnly`, `SameSite=Lax`, with the `Secure` attribute governed by "Session cookie `Secure` flag derives from the resolved base". JWT verification SHALL accept only tokens signed with HS256, the algorithm the server itself signs with; a token declaring any other algorithm (including `none`) SHALL be rejected as invalid regardless of its signature.

#### Scenario: JWT issued on successful login
- **WHEN** OAuth callback succeeds
- **THEN** a JWT with `{ sub, name, username, provider, exp }` SHALL be signed with `auth.secret` and set as cookie `pi_dash_token`

#### Scenario: Valid JWT on subsequent request
- **WHEN** an external request includes a valid, non-expired `pi_dash_token` cookie
- **THEN** the request SHALL proceed with user info available on the request

#### Scenario: Expired JWT
- **WHEN** an external request includes an expired `pi_dash_token` cookie
- **THEN** the server SHALL clear the cookie and redirect to `/auth/login`

#### Scenario: Tampered JWT
- **WHEN** an external request includes a JWT with an invalid signature
- **THEN** the server SHALL clear the cookie and return 401

#### Scenario: Token with a non-HS256 algorithm is rejected
- **WHEN** an external request includes a `pi_dash_token` cookie whose JWT header declares `alg` `none`, `HS384` or `HS512`
- **THEN** the server SHALL treat it as invalid, clear the cookie and return 401

#### Scenario: Tokens issued before the algorithm pin keep working
- **WHEN** an external request includes an unexpired HS256 `pi_dash_token` issued before this requirement took effect
- **THEN** the request SHALL proceed with user info available on the request

### Requirement: Auth secret management
The auth module SHALL use `auth.secret` from config to sign JWTs. If `auth` is configured but `auth.secret` is missing, the module SHALL auto-generate a random secret of 32 random bytes encoded as a 64-character hex string, write it back to the config file, and use it. Any existing non-empty `auth.secret`, a whitespace-only value included, SHALL be kept and used unchanged; the server SHALL NOT rotate it automatically, so existing login sessions SHALL survive an upgrade. An existing secret shorter than 32 characters, or consisting only of whitespace, SHALL additionally cause a startup warning recommending rotation, emitted at most once per process lifetime; the warning SHALL NOT contain the secret.

#### Scenario: Secret provided in config
- **WHEN** `auth.secret` is set in config
- **THEN** the module SHALL use it as the JWT signing key

#### Scenario: Secret missing — auto-generate
- **WHEN** `auth` is configured but `auth.secret` is missing
- **THEN** the module SHALL generate a random 64-character hex string (32 random bytes), persist it to `~/.pi/dashboard/config.json`, and use it

#### Scenario: Existing 32-character secret is kept
- **WHEN** `auth.secret` is an existing 32-character hex string from an earlier version
- **THEN** the module SHALL use it unchanged, SHALL NOT replace it in the config file, SHALL NOT log a warning, and previously issued session tokens SHALL still verify

#### Scenario: Whitespace-only secret is kept with a warning
- **WHEN** `auth.secret` is a non-empty value consisting only of whitespace
- **THEN** the module SHALL use it unchanged, SHALL NOT replace it, and existing sessions SHALL stay valid (no forced logout)
- **AND** the server SHALL log the rotation warning, without printing the secret

#### Scenario: Warning is emitted once per process
- **WHEN** a short existing `auth.secret` is in use and many tokens are signed and verified during one process lifetime
- **THEN** the rotation warning SHALL be logged once, not per request, and again only after a process restart

#### Scenario: Short or non-hex existing secret is kept with a warning
- **WHEN** `auth.secret` is a non-empty value shorter than 32 characters (for example a hand-set passphrase)
- **THEN** the module SHALL use it unchanged and keep existing sessions valid
- **AND** the server SHALL log one startup warning recommending rotation, without printing the secret

### Requirement: Session cookie `Secure` flag derives from the resolved base
The session cookie and the OAuth state cookie SHALL be marked `Secure` when ANY of these holds: the RESOLVED redirect base is `https:`; the request's own socket is TLS; or the request's socket peer is a loopback address AND its `Host` header names a live `https` tunnel origin. The decision SHALL be evaluated per request, on the socket peer address and never on a forwarding header, so header-injecting tunnels qualify exactly as header-free ones do. A tunnel origin qualifies only when its scheme is `https`, and the `Host` matches it on BOTH host and port, compared in the canonical form of the shared canonical-origin helper (case-insensitive host, default port `:443` equal to no port, trailing dot ignored). A live tunnel origin with a non-`https` scheme, or a `Host` whose port differs, SHALL NOT qualify. The cookie SHALL NOT be marked `Secure` otherwise. A forged `Host` header can only make the cookie stricter, never grant access. Both cookies SHALL be set by code that receives the request, so this evaluation is available at the point each cookie is issued.

The flag SHALL NOT be derived from `request.protocol` or from any forwarding header (`X-Forwarded-Proto`, `Forwarded`), and Fastify's `trustProxy` SHALL NOT be enabled to make that work. `request.ip` is what both authorization bypasses read (the auth-gate bypass and the network guard), so trusting `X-Forwarded-For` would make both gates header-forgeable and would split REST from the WebSocket upgrade path, which authorizes on the socket peer.

#### Scenario: Behind a TLS reverse proxy
- **WHEN** the resolved redirect base is `https://pi.example.com` and the request arrives over plain http on the loopback hop
- **THEN** the session cookie SHALL be marked `Secure`

#### Scenario: Plain-http deployment
- **WHEN** the resolved base is a plain `http:` origin, the request socket is not TLS, and the request is not a loopback hop for a live https tunnel origin
- **THEN** the cookie SHALL NOT be marked `Secure`

#### Scenario: Https tunnel with an http redirect base
- **WHEN** an https tunnel is live, the resolved base is a plain `http:` origin, and a loopback-peer request arrives whose `Host` is the tunnel's public host
- **THEN** the session cookie SHALL be marked `Secure`

#### Scenario: Tunnel URL not yet resolved into the base
- **WHEN** a tunnel is live but the resolved base was computed before its URL was known, and a loopback-peer request arrives with that tunnel's host in `Host`
- **THEN** the cookie SHALL be marked `Secure`

#### Scenario: Header-injecting tunnel still qualifies by socket peer
- **WHEN** a live https tunnel (such as zrok or cloudflared) forwards a request to the loopback listener with forwarding headers present, the socket peer is loopback and `Host` names the tunnel's public host
- **THEN** the cookie SHALL be marked `Secure`
- **AND** the decision SHALL rest on the socket peer being a loopback address, not on whether the request is otherwise genuinely local

#### Scenario: Tunnel host from a non-loopback peer
- **WHEN** a request from a non-loopback peer carries a `Host` naming a live tunnel origin over plain http and the resolved base is `http:`
- **THEN** the cookie SHALL NOT be marked `Secure` by the tunnel rule

#### Scenario: Non-https tunnel origin never qualifies
- **WHEN** a live tunnel origin has scheme `http:` and a loopback-peer request arrives with that tunnel's host in `Host` while the resolved base is `http:`
- **THEN** the cookie SHALL NOT be marked `Secure` by the tunnel rule

#### Scenario: Host port mismatch does not qualify
- **WHEN** the live https tunnel origin is `https://pi.share.example` and a loopback-peer request carries `Host: pi.share.example:8443`
- **THEN** the cookie SHALL NOT be marked `Secure` by the tunnel rule

#### Scenario: Case and trailing-dot variants of the tunnel host qualify
- **WHEN** a loopback-peer request carries `Host: PI.share.example.` for the live https tunnel origin `https://pi.share.example`
- **THEN** the cookie SHALL be marked `Secure`

#### Scenario: Forwarded protocol header never sets Secure
- **WHEN** a plain-http request on the resolved `http:` base carries `X-Forwarded-Proto: https` and no live tunnel origin matches
- **THEN** the cookie SHALL NOT be marked `Secure`

#### Scenario: Forwarding headers never grant trust
- **WHEN** a request from an untrusted peer carries `X-Forwarded-For` naming a trusted-network address
- **THEN** authorization SHALL still evaluate the socket peer and the request SHALL be refused

## ADDED Requirements

### Requirement: CSP report sink is public to the OAuth gate
The OAuth `onRequest` gate SHALL treat `POST /__pi/csp-report/:policy` as a public path, so violation reports from signed-out pages (the login and passkey pages) are neither redirected to `/auth/login` nor refused. The exemption SHALL cover only that method and path pattern; it SHALL NOT widen any other route. See the `baseline-content-security-policy` capability for the sink's own limits.

#### Scenario: Signed-out report is not redirected
- **WHEN** OAuth is configured and a request with no cookie posts a report to `/__pi/csp-report/strict`
- **THEN** the OAuth gate SHALL NOT redirect or refuse it

#### Scenario: Exemption is narrow
- **WHEN** OAuth is configured and a request with no cookie sends `GET /__pi/csp-report/strict` or posts to another `/__pi/` path
- **THEN** the OAuth gate SHALL apply as for any non-public path
