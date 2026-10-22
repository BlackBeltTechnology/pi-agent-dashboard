## MODIFIED Requirements

### Requirement: Knock route creates a pending device without a pairing code
The server SHALL expose `POST /api/pair/request` as a public, unauthenticated route that is exempt from the network guard and the auth hook in the same way as `/api/pair/challenge`, `/api/pair/redeem` and `/api/pair/poll`. The body MAY carry `name` (the requester's self-chosen device name), a `deviceKey` and a `companion` as specified by `device-key-mutual-check`; an absent, invalid or ignored `deviceKey` or `companion` SHALL NOT change the admission decision or the response. When every admission gate passes, the server SHALL create a pending device with provenance `knock` and SHALL respond `200` with `{ pendingId, confirmCode, expiresAt, fingerprint }`, where `confirmCode` is an 8-digit code generated exactly as for a QR redemption, `expiresAt` is the epoch-millisecond instant the request expires (~300 s after the knock), and `fingerprint` is the server identity fingerprint. From that point the pending device SHALL follow the same lifecycle as a QR-redeemed one: app-wide approval dialog, typed compare-code approval, the per-request lockout budget shared by every approval entry point, deny, pushed expiry, and `POST /api/pair/poll` returning `pending` / `approved` (with the bearer and the server's `routes`, as the server-identity-routes capability states) / `rejected` / `unknown`. A knock SHALL NOT consume or reveal any QR pairing code, and SHALL NOT mint a pairing payload; any internal code backing the knock SHALL never be returned to a client.

#### Scenario: Admitted knock returns the compare code
- **GIVEN** `pairing.acceptLanRequests` is `true`
- **WHEN** a client at `192.168.16.31` posts `{ "name": "Roberts-MacBook-Pro" }` to `/api/pair/request` with no forwarding header
- **THEN** the response SHALL be `200` with a `pendingId`, an 8-digit `confirmCode`, an `expiresAt` about 300 s in the future and the server `fingerprint`
- **AND** connected operator browsers SHALL receive the pending-change notification

#### Scenario: Knock completes through the existing approval path
- **GIVEN** an admitted knock whose `confirmCode` is `48217730`
- **WHEN** an operator approves that pending device with confirmation code `48217730`
- **THEN** the requester's next `POST /api/pair/poll` with its `pendingId` SHALL return `approved` with a bearer token that authenticates later requests

#### Scenario: Denied knock reports rejected
- **WHEN** an operator denies a knock's pending device
- **THEN** the requester's next poll SHALL return `rejected` and no token SHALL ever be issued for it

#### Scenario: Knock is reachable without credentials on a network-denied server
- **GIVEN** the requester's address is not in `trustedNetworks` and it holds no credential
- **WHEN** it posts to `/api/pair/request`
- **THEN** the network guard SHALL NOT answer `network_not_allowed`; the knock admission gates SHALL decide the response

#### Scenario: Approved poll carries the server routes once
- **GIVEN** an approved knock and a server with an active `https` tunnel
- **WHEN** the requester polls
- **THEN** the `approved` answer SHALL carry the bearer and `routes` listing the tunnel URL
- **AND** a later poll for the same request SHALL return neither

#### Scenario: Pending poll carries no routes
- **WHEN** the requester polls before the operator decides, or after a denial
- **THEN** the answer SHALL contain no `routes`

#### Scenario: Knock with a device key is admitted unchanged
- **GIVEN** `pairing.acceptLanRequests` is `true`
- **WHEN** a client posts `{ "name": "Roberts-MacBook-Pro", "deviceKey": { "deviceNonce": "…", "pub": "…", "sig": "…" } }` to `/api/pair/request`
- **THEN** the response SHALL carry the same fields as for a knock without a key, and the pending device SHALL hold the verified key until it is approved or discarded

#### Scenario: Knock with an invalid key or companion is admitted unchanged
- **WHEN** a client posts a knock whose `deviceKey` has a bad signature or whose `companion` is malformed
- **THEN** the knock SHALL be admitted exactly as one without them, and no key or companion SHALL be held for it

### Requirement: Browser "Request access" landing
The `/pair` landing SHALL offer a request mode when opened as `/pair?request` without a payload fragment; a `#companion=` fragment (below) keeps request mode, and any other fragment is a QR payload. Request mode SHALL show the address of the dashboard it is asking (the page's own host, so nothing is disclosed before access), an optional "Device name" field, a statement that the request travels unencrypted when the page origin is `http:`, and a "Request access" action. On request it SHALL knock same-origin (no fingerprint pin is required, because the page and the routes share one origin), show the 8-digit confirmation code grouped as `4821 7730` with the instruction to type it on the dashboard machine, show the time left until `expiresAt`, and poll. While waiting it SHALL NOT offer a Cancel action, because the request cannot be withdrawn from the server. On expiry it SHALL say the request expired and offer "Request again". A poll result of `unknown` before `expiresAt` (the outcome was missed, e.g. while the page was in the background) SHALL say the request may have been decided while the page was away and offer "Request again"; the server's cooldown still applies. The landing SHALL poll immediately when the page becomes visible again. The landing SHALL keep `pendingId`, `confirmCode` and `expiresAt` in session storage until the request resolves, so reloading the page during a live request resumes the waiting state with the same code instead of losing it. On `approved` it SHALL store the bearer the same way a QR-paired browser does (exchanging it for the httpOnly device cookie), SHALL then load the dashboard. On `rejected` it SHALL state that the dashboard declined and SHALL NOT offer an immediate retry. Each refusal code SHALL map to a plain-language explanation: `knock_disabled` → the dashboard is not accepting requests from this network and its owner can turn this on in Gateway; `knock_not_lan` → requests are accepted only from the same local network; `knock_pending` → a request from this device is already waiting (if this page was closed, it expires within 5 minutes); `knock_rate_limited` → try again after the stated time; `knock_busy` → too many requests are waiting, try again shortly; `host_not_admitted`, `untrusted origin` or any other refusal → a generic "this dashboard refused the request" message. Request mode SHALL work in a non-secure browser context (plain `http` on a LAN address). Where Ed25519 WebCrypto is available the landing SHALL, when the user chooses "Request access", run the identity challenge, create the page origin's device key for this dashboard, and send `deviceKey: { deviceNonce, pub, sig }` with the knock (`device-key-mutual-check`); where it is not, it SHALL knock without a key and without the extra challenge. When opened as `/pair?request#companion=<pub>.<ts>.<sig>&from=<origin>` the landing SHALL forward the companion (key, timestamp, signature and origin) in the knock body, SHALL NOT send the fragment in any request line, SHALL remove it from the address bar after reading it, and SHALL ignore a fragment longer than 512 characters or without three dot-separated companion parts.

#### Scenario: Browser requests access and gets paired
- **GIVEN** `pairing.acceptLanRequests` is `true`
- **WHEN** a browser at `192.168.16.31` opens `http://192.168.16.204:8000/pair?request`, clicks "Request access", and the operator types the shown code on the dashboard machine
- **THEN** the landing SHALL show the code grouped as two blocks of 4 digits while waiting
- **AND** after approval the browser SHALL load the dashboard authenticated by its paired-device cookie

#### Scenario: Disabled server explains the remedy
- **WHEN** the knock is refused with `knock_disabled`
- **THEN** the landing SHALL say the dashboard is not accepting requests from this network and that its owner can enable this in Gateway

#### Scenario: Unencrypted origin is labelled
- **WHEN** request mode is opened on an `http:` origin
- **THEN** the landing SHALL state that the request and the resulting access travel unencrypted on this network

#### Scenario: QR landing unchanged
- **WHEN** `/pair` is opened with a payload fragment
- **THEN** the landing SHALL run the existing QR challenge → redeem → poll flow

#### Scenario: Landing forwards a companion
- **WHEN** a browser opens `/pair?request#companion=<pub>.<ts>.<sig>&from=http%3A%2F%2F192.168.16.31%3A8000` and clicks "Request access"
- **THEN** the knock body SHALL carry the companion and the address bar SHALL no longer show the fragment

#### Scenario: Other fragments stay the QR flow
- **WHEN** `/pair?request#something-else` is opened and the fragment does not start with `companion=`
- **THEN** the landing SHALL treat the fragment as a QR payload and run the QR flow, not request mode

#### Scenario: Landing on an insecure origin knocks without a key
- **GIVEN** the page origin is plain `http` where Ed25519 WebCrypto is unavailable
- **WHEN** the user clicks "Request access"
- **THEN** the knock SHALL be sent without a device key and the request SHALL work as before
