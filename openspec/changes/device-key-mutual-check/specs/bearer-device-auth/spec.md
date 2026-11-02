## MODIFIED Requirements

### Requirement: Long-lived opaque bearer tokens in a revocable registry
A long-lived opaque bearer token SHALL be recorded in a server-side
paired-devices registry (`~/.pi/dashboard/paired-devices.json`, `0600`) with
device label, created-at, last-seen, an issuance `source`, and a `tier` from
`observe | control | operate`. Tokens SHALL be issued by one of two paths:
redeeming a pairing code (`source: "pairing"`) or direct issuance by an
authenticated operator (`source: "manual"`). Both paths SHALL accept a tier;
when omitted, `pairing` SHALL default to `operate` (a paired browser drives
the whole dashboard) and `manual` SHALL default to `observe`. Both paths
SHALL return the
plaintext token exactly once per issuance or rotation and store only a hash. A row issued with a browser-holder declaration SHALL carry an expiry and rotate as stated in "Browser-held device bearers expire and rotate"; every other row SHALL have no expiry. The token SHALL be
revocable per device regardless of source or tier: revoking SHALL move the device into the held revoked state defined by "Revoked devices are held, refused and restorable" and every bearer of the device, including one still in a rotation grace window, SHALL stop verifying at once; the device is deleted for good only after the retention period or an explicit delete-now. The tier SHALL be fixed at issuance; changing a device's tier SHALL
require revoking it and issuing a new token. Registry rows written before
`source` existed SHALL read as `"pairing"`; rows written before `tier` existed
SHALL read as `"operate"` (the access they were issued with). Rewriting the
registry SHALL preserve fields it does not understand.

Revocation SHALL accept only an **operator** credential — the same admission
rule as direct token issuance: an authenticated dashboard login session, a
valid `X-Pi-Local-Token`, or a genuinely local (loopback, non-forwarded)
caller. A request authenticated only by a paired-device bearer SHALL NOT
revoke any registry row, including its own, regardless of the caller's network
position — a device bearer arriving over loopback SHALL be refused on the
strength of the credential alone.

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: Browser-declared row is the only expiring kind
- **WHEN** a pairing code is redeemed with a browser-holder declaration, and another with none
- **THEN** only the first row SHALL carry an expiry
- **AND** the second row's token SHALL NOT expire

#### Scenario: Token issued and recorded
- **WHEN** a device successfully redeems a pairing code
- **THEN** an opaque bearer token is returned and a registry entry with `source: "pairing"` and the chosen tier is created for the device

#### Scenario: Manual issuance defaults to observe
- **WHEN** a token is issued through direct issuance without an explicit tier
- **THEN** the registry entry SHALL carry `tier: "observe"`

#### Scenario: Pairing issuance defaults to operate
- **WHEN** a pairing code is redeemed without an explicit tier from the approver
- **THEN** the registry entry SHALL carry `tier: "operate"`

#### Scenario: Invalid tier rejected
- **WHEN** a token is requested with a tier outside `observe | control | operate`
- **THEN** the request SHALL be rejected and no registry entry SHALL be created

#### Scenario: Device revoked
- **WHEN** a user revokes a device from Settings
- **THEN** the device leaves the active registry and is held as revoked, and subsequent requests bearing that token are rejected

#### Scenario: Legacy row without source
- **WHEN** the registry file contains a row that has no `source` field
- **THEN** the row SHALL be listed with `source: "pairing"`
- **AND** its token SHALL continue to verify

#### Scenario: Legacy row without tier
- **WHEN** the registry file contains a row that has no `tier` field
- **THEN** the row SHALL be listed with `tier: "operate"`
- **AND** its token SHALL continue to verify

#### Scenario: Unknown fields survive a rewrite
- **WHEN** the registry file contains a row with a field the loader does not know
- **AND** another row is added or revoked
- **THEN** the unknown field SHALL still be present in the rewritten file

#### Scenario: Tier visible in the device list
- **WHEN** paired devices are listed
- **THEN** each row SHALL include its `tier`

#### Scenario: Paired device cannot revoke a sibling
- **GIVEN** two paired devices A and B exist in the registry
- **WHEN** a request authenticated only by device A's bearer sends `DELETE /api/paired-devices/<id of B>`
- **THEN** the server SHALL respond `401`
- **AND** device B's registry row SHALL remain and its token SHALL continue to verify

#### Scenario: Paired device cannot revoke itself
- **WHEN** a request authenticated only by device A's bearer sends `DELETE /api/paired-devices/<id of A>`
- **THEN** the server SHALL respond `401` and device A's row SHALL remain

#### Scenario: Loopback device bearer cannot revoke
- **WHEN** a request authenticated only by device A's bearer sends `DELETE /api/paired-devices/<id of B>` from `127.0.0.1` with no forwarding headers
- **THEN** the server SHALL respond `401` and device B's row SHALL remain

#### Scenario: Plaintext returned once per issuance or rotation
- **WHEN** a bearer is issued or rotated
- **THEN** the plaintext SHALL appear only in that response and SHALL NOT be retrievable afterwards from the registry or any list route

#### Scenario: Operator revokes over a tunnel
- **WHEN** a request carrying an authenticated dashboard login session sends `DELETE /api/paired-devices/<id>` from a non-local address
- **THEN** the device SHALL leave the active registry and be held as revoked, and the server SHALL respond `200`

### Requirement: A device bearer's tier gates REST routes and WS-ticket minting
Every `/api/*` route SHALL have a tier from a single route→tier map in
`packages/shared`; a route absent from the map SHALL require `operate`. A
request admitted via a paired-device bearer SHALL be refused with HTTP 403,
`WWW-Authenticate: Bearer error="insufficient_scope" scope="<tier>"` and a
logged refusal when the route's tier exceeds the row's tier. `/api/ws-ticket`
SHALL require `operate`. `POST /api/paired-devices/rotate` SHALL be entered in that map at tier `observe`, so any valid browser-held bearer, of any tier, may rotate itself; the route SHALL authenticate by that bearer and SHALL rotate only the device that bearer belongs to. Principals admitted by other means (browser cookie
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

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: Observe bearer cannot restart
- **WHEN** a request bearing an `observe` device token calls `POST /api/restart`
- **THEN** the server SHALL respond 403 with `WWW-Authenticate` containing `error="insufficient_scope"` and `scope="operate"`
- **AND** the restart handler SHALL NOT run

#### Scenario: Control bearer cannot mint a WS ticket
- **WHEN** a request bearing a `control` device token calls `POST /api/ws-ticket`
- **THEN** the server SHALL respond 403 with `scope="operate"`

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

## ADDED Requirements

### Requirement: Revoked devices are held, refused and restorable
Revoking a device SHALL record who revoked it and when, keep the whole device record (bearer hash, tier, source, label, keys, companions, and its expiry and rotation fields: `expiresAt`, `pairedAt`, and the previous-bearer hash with its `previousExpiresAt` when a rotation grace window exists) in a revoked store separate from the active registry file, and remove it from the active registry in the same operation. From that moment every credential of the device SHALL be refused — every bearer of the device including the previous bearer of a rotation grace window, the device cookie, WebSocket ticket minting, and a bridge reconnect — its live WebSocket connections SHALL be closed, and the device-key check SHALL answer `revoked` for its keys. Listing paired devices SHALL show active devices only. An operator SHALL be able to restore a revoked device, which SHALL return its id, bearer hash, tier, label, source, keys, companions and expiry and rotation fields exactly as held, so its original bearer works again without re-pairing for as long as that bearer is still within its original expiry (its last-seen time and any audit counters then continue from their current values). Restore SHALL NOT extend the 7-day expiry or the 30-day absolute lifetime, SHALL NOT restart a rotation grace window (a previous bearer is valid again only for what remains of its original grace), and a device whose bearer expired while it was held SHALL come back active but expired, its bearer answered `401` with `bearer_expired` and its keys answering `expired` to the device check; restore SHALL accept only an operator credential, by the same admission rule as revocation. Listing revoked devices, restoring and deleting now SHALL each accept only an operator credential and answer `401` to a paired-device bearer. Restoring or deleting an id that is not in the revoked store SHALL be answered `404`, and an id that is currently active `409`, changing nothing. Revoking an id that is unknown or already revoked SHALL be answered `404`, changing nothing. A revoked store that parses as JSON but has the wrong shape SHALL be treated like an unparseable one. A revoked device SHALL be deleted for good once 90 days have passed since its revocation (age of 90 days or more), or at once by an operator's delete-now; afterwards its token and keys are unknown and the check answers `unknown`. Expired records SHALL be purged at server start and whenever the revoked list is read or checked. Revoke, restore, delete-now and purge SHALL each write one audit line in the shape of the existing revoke line (`[pairing] <verb> id=<8-character prefix>`, with `actor=` and `ip=` when a request caused it, values sanitised by the shared audit emitter; verbs `revoked`, `restored`, `deleted`, `purged`), SHALL NOT audit a call that changes nothing (`404`, `409`), and SHALL NEVER write a token, hash, key, nonce or cookie. The revoked store SHALL be a separate `0600` file, so a build that predates it keeps treating a revoked device as deleted. If a device id is found in both files at start, the revoked record SHALL win. If the revoked store cannot be parsed at start, the server SHALL set the file aside under a distinct name, log an error and start with an empty revoked list, and the revoked-devices listing SHALL carry a warning that Settings shows as "Revoked-device list unreadable — revoked devices may be purged early"; because a revoked device's active row was removed when it was revoked, no revoked device is re-admitted.

#### Scenario: Revoked bearer is refused everywhere
- **GIVEN** device A holds bearer `T` and an open WebSocket
- **WHEN** an operator revokes A
- **THEN** a REST request with `T` SHALL be answered `401`, the device cookie SHALL be refused, a WebSocket ticket SHALL NOT be minted for it, and A's open sockets SHALL be closed

#### Scenario: Listing hides revoked devices
- **WHEN** paired devices are listed after A was revoked
- **THEN** A SHALL NOT appear in the active list and SHALL appear in the revoked list with its revoke time and the time it will be deleted

#### Scenario: Undo restores the device
- **WHEN** an operator restores revoked device A within 90 days, and A's bearer is still inside its original expiry
- **THEN** A SHALL be active again with the same id, bearer hash, label, tier, source, keys and companions, and its original bearer SHALL authenticate without re-pairing

#### Scenario: Revoke kills the grace-window bearer while held
- **GIVEN** device A rotated its bearer 10 seconds ago, so the previous bearer is still in its 60-second grace window
- **WHEN** an operator revokes A
- **THEN** neither the new bearer nor the previous bearer SHALL authenticate, and the held record SHALL keep both hashes and the previous bearer's original grace end

#### Scenario: Undo does not restart the grace window
- **GIVEN** A was revoked 10 seconds after a rotation, and restored 5 minutes later
- **WHEN** the previous bearer is presented
- **THEN** it SHALL be refused with a plain `401`, because its original grace window ended; the current bearer SHALL authenticate

#### Scenario: Undo never extends the expiry
- **GIVEN** a browser device whose bearer expires in 2 days and whose 30-day lifetime ends in 20 days
- **WHEN** it is revoked for 1 day and then restored
- **THEN** its `expiresAt` and absolute lifetime SHALL be unchanged and the bearer SHALL authenticate for about 1 more day

#### Scenario: Device that expired while revoked returns expired
- **GIVEN** a browser device revoked 1 day before its bearer's expiry, and restored 3 days later
- **WHEN** its bearer is presented
- **THEN** the response SHALL be `401` with `bearer_expired`, and the device check for its key SHALL answer `expired`

#### Scenario: Restore and delete-now are audited like revoke
- **WHEN** an operator restores a revoked device, deletes one now, or the server purges one at 90 days
- **THEN** one line `[pairing] restored id=<8> actor=<actor> ip=<peer>`, `[pairing] deleted id=<8> actor=<actor> ip=<peer>`, or `[pairing] purged id=<8>` SHALL be written, and no line SHALL contain a token, hash, key, nonce or cookie

#### Scenario: Unchanged calls are not audited
- **WHEN** restore or delete-now is refused with `404` or `409`, or a revoke of an unknown or already-revoked id is refused with `404`
- **THEN** no audit line SHALL be written

#### Scenario: Paired device cannot restore or delete
- **WHEN** a request authenticated only by a paired-device bearer restores or deletes a revoked device
- **THEN** the server SHALL respond `401` and change nothing

#### Scenario: Paired device cannot list revoked devices
- **WHEN** a request authenticated only by a paired-device bearer sends `GET /api/paired-devices/revoked`
- **THEN** the server SHALL respond `401` and return no device

#### Scenario: Restore of an unknown id
- **WHEN** an operator restores or deletes an id that is in neither store
- **THEN** the server SHALL respond `404`

#### Scenario: Revoke of an unknown or already-revoked id
- **WHEN** an operator revokes an id that is not an active device (never known, or already revoked)
- **THEN** the server SHALL respond `404` and change nothing

#### Scenario: Restore or delete-now of an active device
- **WHEN** an operator calls restore or delete-now with the id of a currently active device
- **THEN** the server SHALL respond `409` and change nothing

#### Scenario: Retention expires
- **WHEN** a device has been revoked for 90 days or more and the server starts or the revoked list is read
- **THEN** its record SHALL be deleted for good and its keys SHALL answer `unknown`

#### Scenario: Retention boundary
- **GIVEN** one device revoked 90 days minus one second ago and one revoked 90 days ago
- **WHEN** the server starts or the revoked list is read
- **THEN** the first SHALL be kept and listed and the second SHALL be deleted for good

#### Scenario: Delete now
- **WHEN** an operator chooses delete-now on a revoked device
- **THEN** its record SHALL be deleted at once and it SHALL NOT be restorable

#### Scenario: Older build treats it as deleted
- **WHEN** the active registry file is read by a build that does not know the revoked store
- **THEN** the revoked device SHALL NOT be present and its bearer SHALL be refused

#### Scenario: Crash between the two writes
- **GIVEN** a device id present in both the active file and the revoked store at start
- **THEN** the device SHALL be treated as revoked and removed from the active registry

#### Scenario: Wrong-shape revoked store is set aside
- **GIVEN** the revoked store file is valid JSON of the wrong shape at start
- **THEN** it SHALL be handled exactly as an unparseable file below

#### Scenario: Unreadable revoked store is set aside
- **GIVEN** the revoked store file is not valid JSON at start
- **THEN** the file SHALL be kept under a distinct name, an error SHALL be logged, the active devices SHALL be unaffected, and the revoked listing SHALL carry the unreadable-list warning

### Requirement: Paired devices settings show keys, companions and revoked devices
The Paired Devices settings section SHALL show for each active device a Device key column (its short id, `dk:` followed by 12 characters, or "none yet" when no key is registered) and a "Status checks from" column listing the origins of its companions (or none), each companion removable on its own. Revoke SHALL be an operator action that shows, for 10 seconds, a notice "<name> revoked" with an Undo action. The section SHALL list revoked devices separately with who and when it was revoked, "Deleted for good in N days", an "Undo revoke" action and a "Delete now" action, and SHALL state: "Undo only if you revoked by mistake. If the device was lost or stolen, leave it revoked: undo makes its saved access work again." "N days" SHALL be the remaining retention rounded up to whole days, and under 24 hours remaining SHALL read "Deleted for good in 1 day". Delete now SHALL ask for confirmation in a dialog naming the device before it acts. When Undo revoke finds the record gone or already restored (the server answers `404` or `409`), the section SHALL show an inline "No longer available" and refresh the lists. Revoke, Undo revoke, Delete now and companion removal SHALL be offered only when the viewer holds an operator credential.

#### Scenario: Key and companion columns
- **WHEN** the list shows a device with a key and one companion at `http://192.168.16.31:8000`
- **THEN** its row SHALL show the short key id and that origin under "Status checks from"

#### Scenario: Revoke offers undo
- **WHEN** the operator revokes a device
- **THEN** a notice "<name> revoked" with Undo SHALL show for 10 seconds, and choosing Undo SHALL restore the device

#### Scenario: Revoked list and warning
- **WHEN** a device is revoked
- **THEN** the revoked list SHALL show it with "Deleted for good in 90 days", Undo revoke and Delete now, and the lost-or-stolen warning SHALL be visible

#### Scenario: Remaining days round up
- **WHEN** a revoked device has 89 days 12 hours of retention left, or less than 24 hours
- **THEN** the revoked list SHALL read "Deleted for good in 90 days" and "Deleted for good in 1 day" respectively

#### Scenario: Delete now asks first
- **WHEN** the operator chooses Delete now on a revoked device
- **THEN** a confirmation dialog naming the device SHALL appear, and nothing SHALL be deleted until it is confirmed

#### Scenario: Undo of a record that is gone
- **WHEN** the operator chooses Undo revoke and the server answers `404` or `409`
- **THEN** the section SHALL show "No longer available" inline and refresh the list

#### Scenario: Unreadable revoked list warns
- **WHEN** the server reports the revoked list unreadable
- **THEN** the section SHALL show "Revoked-device list unreadable — revoked devices may be purged early"

#### Scenario: Device with no key
- **WHEN** a device row has no registered key
- **THEN** its Device key cell SHALL read "none yet"
