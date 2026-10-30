## MODIFIED Requirements

### Requirement: A device bearer's tier gates REST routes and WS-ticket minting
Every `/api/*` route SHALL have a tier from a single route→tier map in
`packages/shared`; a route absent from the map SHALL require `operate`. A
request admitted via a paired-device bearer SHALL be refused with HTTP 403,
`WWW-Authenticate: Bearer error="insufficient_scope" scope="<tier>"` and a
logged refusal when the route's tier exceeds the row's tier. `POST /api/ws-ticket`
SHALL be listed at `control`, and its handler SHALL then require a per-scope minimum
tier from every tiered caller (device bearer, login session, identity principal):
`browser` and `live` `control`; `terminal` and `bridge` `operate`. `POST /api/paired-devices/rotate` SHALL be entered in that map at tier `observe`, so any valid browser-held bearer, of any tier, may rotate itself; the route SHALL authenticate by that bearer and SHALL rotate only the device that bearer belongs to. Principals admitted by other means (browser cookie
session, local token) SHALL see no change. A bearer presented from a genuinely
local address SHALL NOT be tier-refused. A bearer presented from a
trusted-network address SHALL NOT be tier-refused **only when the effective
trust mode is `"legacy"`**; in `"pair"` mode a network match grants no tier
exemption. The gate SHALL only refuse; it SHALL NOT admit a request that
existing admission rules reject.

The identity and device-key routes a paired device uses to ask a server about
itself — `POST /api/pair/challenge`, `POST /api/pair/device-status` and
`POST /api/pair/device-key` — SHALL each be listed at `observe`. These routes
answer anonymous callers (or, for the key binding, any paired device), so a
credential the browser or app sends along automatically (the device cookie, or
a bearer) SHALL NOT make a lower-tier device worse off than an anonymous
caller: a device of every tier SHALL be able to run the identity challenge, the
device check and the key binding against its own server. The other public
pairing routes keep their existing tier.

Routes under an enabled plugin public namespace (`/api/plugins/<id>/public/*`, see `plugin-public-routes`) SHALL be exempted from the device-bearer tier gate by an explicit namespace predicate evaluated before the map lookup; the map itself SHALL remain an exact lookup, and no new tier value SHALL be introduced. These routes never carry a device admission (the device branch does not run for them).

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: Observe bearer cannot restart
- **WHEN** a request bearing an `observe` device token calls `POST /api/restart`
- **THEN** the server SHALL respond 403 with `WWW-Authenticate` containing `error="insufficient_scope"` and `scope="operate"`
- **AND** the restart handler SHALL NOT run

#### Scenario: Control bearer cannot mint a WS ticket
- **WHEN** a request bearing a `control` device token calls `POST /api/ws-ticket` with scope `terminal` or `bridge`
- **THEN** the server SHALL respond 403 with `scope="operate"` and mint nothing

#### Scenario: Control bearer mints a browser ticket
- **WHEN** a request bearing a `control` device token calls `POST /api/ws-ticket` with scope `browser`
- **THEN** a ticket SHALL be minted and the `/ws` socket it admits SHALL carry tier `control`

#### Scenario: Observe bearer cannot mint any ticket
- **WHEN** a request bearing an `observe` device token calls `POST /api/ws-ticket` with any scope
- **THEN** the server SHALL respond 403 with `scope="control"` or `scope="operate"` for that scope

#### Scenario: Per-scope minimum applies to every caller kind
- **WHEN** a `control` login session or a `control`-capped principal requests a `terminal` ticket
- **THEN** the server SHALL respond 403 `insufficient_scope` with `scope="operate"`

#### Scenario: Observe bearer reads within tier
- **WHEN** a request bearing an `observe` device token calls `GET /api/sessions`
- **THEN** the request SHALL be served

#### Scenario: Browser principal unchanged
- **WHEN** a request is admitted by a browser cookie session or the local token
- **THEN** no route SHALL be refused on tier grounds

#### Scenario: Loopback bearer is not tier-refused
- **WHEN** `requireLocalProof` is disabled and a request from a genuinely local address bears an `observe` device token and calls `POST /api/restart`
- **THEN** the request SHALL NOT be refused on tier grounds

#### Scenario: Trusted-network bearer exempt only in legacy mode
- **GIVEN** `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a request from `192.168.16.20` bears an `observe` device token and calls `POST /api/restart`
- **THEN** it SHALL NOT be tier-refused when the effective trust mode is `"legacy"`
- **AND** it SHALL be refused with 403 `scope="operate"` when the effective trust mode is `"pair"`

#### Scenario: Observe bearer may rotate itself
- **WHEN** a request bearing an unexpired `observe` browser bearer calls `POST /api/paired-devices/rotate`
- **THEN** the request SHALL NOT be refused on tier grounds
- **AND** the rotated bearer SHALL belong to the same device and carry tier `observe`

#### Scenario: Rotation never touches another device
- **WHEN** a bearer for device A calls `POST /api/paired-devices/rotate`, whatever its body
- **THEN** only device A's row SHALL be rotated and no other device's bearer SHALL change

#### Scenario: Unlisted route fails closed
- **WHEN** a route with no entry in the route→tier map is called with a `control` bearer
- **THEN** the server SHALL respond 403 with `scope="operate"`

#### Scenario: Refusal is logged
- **WHEN** a tier refusal occurs
- **THEN** a log line SHALL record the device id, method, route pattern, principal tier and required tier

#### Scenario: Observe-tier device runs the device check off-host
- **GIVEN** a device paired at tier `observe`, reaching the server from a non-loopback address that is not a trusted network, with its device cookie or bearer attached to every request
- **WHEN** it calls `POST /api/pair/challenge`, then `POST /api/pair/device-status`, then `POST /api/pair/device-key`
- **THEN** none of the three SHALL be refused with `insufficient_scope`, and each SHALL be answered as for any other caller

#### Scenario: Public namespace skips the tier gate; other plugin routes do not
- **WHEN** the tier gate evaluates `POST /api/plugins/web-chat/public/messages` and `GET /api/plugins/web-chat/config`
- **THEN** the first SHALL be skipped by the namespace predicate and the second SHALL resolve through the exact map (default `operate`) as before


## ADDED Requirements

### Requirement: A WS ticket carries the tier of the caller that minted it
A ticket minted by a tiered caller (device bearer, login session, capped principal) that is not exempt from tier refusal SHALL record that caller's tier, and the socket it admits SHALL be gated at that tier exactly as a cookie-session socket is. A ticket minted from a session cookie SHALL also record that token's digest and `iat`, so logout and revoke-all can close the socket. A ticket from an exempt caller (genuinely local, trusted-network `legacy`) carries no tier.

#### Scenario: Control device's socket drops operate messages
- **GIVEN** a ticket minted by a `control` device bearer
- **WHEN** the `/ws` socket it admits sends an `operate`-tier message
- **THEN** the message SHALL be dropped and one `auth.tier_refused` line logged

#### Scenario: Operate device's socket is unchanged
- **WHEN** an `operate` device bearer mints a browser ticket and sends operate-tier messages
- **THEN** they SHALL be processed as before

#### Scenario: Exempt caller's ticket carries no tier
- **WHEN** a genuinely-local caller mints a browser ticket
- **THEN** the socket SHALL carry no tier cap

#### Scenario: Ticket cannot be upgraded by the holder
- **WHEN** a `control` ticket is presented on `/ws/terminal/:id`
- **THEN** the upgrade SHALL be refused, because the ticket's scope is `browser`
