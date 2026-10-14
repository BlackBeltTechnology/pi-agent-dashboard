## ADDED Requirements

### Requirement: Device cookie survives a plain-http LAN exchange
The device-session exchange (`POST /api/device-session`) SHALL NOT set the `Secure` attribute on the device cookie when the exchanging request is a direct plain-http connection from a peer outside the loopback range (socket not encrypted; peer not in `127.0.0.0/8`, `::1` or `::ffff:127.0.0.0/104`, the same range the relayed-loopback rule uses), regardless of any configured public `https` base. In every other case the existing rule SHALL apply unchanged: `Secure` when the resolved base is `https:` (so a TLS reverse proxy or tunnel that forwards plain http on the loopback hop still yields a `Secure` cookie), and `Secure` whenever the request's own socket is TLS. This governs the device cookie only; the session cookie rule of `oauth-authentication` is unchanged.

#### Scenario: http LAN exchange on an https-configured install
- **GIVEN** the dashboard's resolved base is `https://pi-robson.share.zrok.io`
- **WHEN** a browser at `192.168.16.31` exchanges a valid bearer at `http://192.168.16.204:8000/api/device-session`
- **THEN** the `Set-Cookie` for the device cookie SHALL NOT carry `Secure`
- **AND** the browser's next `/api/` request SHALL be authenticated by that cookie

#### Scenario: TLS exchange keeps Secure
- **WHEN** a browser exchanges a valid bearer over an https connection
- **THEN** the device cookie SHALL carry `Secure`

#### Scenario: Tunnel exchange keeps Secure
- **GIVEN** the resolved base is `https://pi-robson.share.zrok.io`
- **WHEN** a browser exchanges a valid bearer through the tunnel, arriving as plain http from peer `127.0.0.1` with `X-Forwarded-Proto: https`
- **THEN** the device cookie SHALL carry `Secure`

### Requirement: Browser keeps its bearer until the cookie is proven
A browser that has just collected a device bearer (QR or knock pairing) SHALL discard its stored copy of the bearer only after an authenticated `/api/` request carried by the device cookie alone succeeds. If that request fails, it SHALL keep the bearer, keep authenticating with it, and tell the user the browser could not keep its access in a cookie.

#### Scenario: Dropped cookie does not lock the device out
- **GIVEN** a browser whose cookie store rejects the device cookie
- **WHEN** pairing completes and the exchange returns 200
- **THEN** the cookie-only check request SHALL fail
- **AND** the browser SHALL still hold the bearer and its next `/api/` request SHALL be authenticated by it
