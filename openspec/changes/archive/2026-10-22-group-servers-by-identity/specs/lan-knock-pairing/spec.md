## MODIFIED Requirements

### Requirement: Knock route creates a pending device without a pairing code
The server SHALL expose `POST /api/pair/request` as a public, unauthenticated route that is exempt from the network guard and the auth hook in the same way as `/api/pair/challenge`, `/api/pair/redeem` and `/api/pair/poll`. The body MAY carry `name` (the requester's self-chosen device name). When every admission gate passes, the server SHALL create a pending device with provenance `knock` and SHALL respond `200` with `{ pendingId, confirmCode, expiresAt, fingerprint }`, where `confirmCode` is an 8-digit code generated exactly as for a QR redemption, `expiresAt` is the epoch-millisecond instant the request expires (~300 s after the knock), and `fingerprint` is the server identity fingerprint. From that point the pending device SHALL follow the same lifecycle as a QR-redeemed one: app-wide approval dialog, typed compare-code approval, the per-request lockout budget shared by every approval entry point, deny, pushed expiry, and `POST /api/pair/poll` returning `pending` / `approved` (with the bearer and the server's `routes`, as the server-identity-routes capability states) / `rejected` / `unknown`. A knock SHALL NOT consume or reveal any QR pairing code, and SHALL NOT mint a pairing payload; any internal code backing the knock SHALL never be returned to a client.

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

### Requirement: Native knocking clients verify the discovered identity first
A client that knocks a server on a different origin than its own (for example a native shell connecting to a server found by mDNS) SHALL first complete `POST /api/pair/challenge` and SHALL knock only when the proven fingerprint equals the fingerprint the server advertised in discovery (without an advert, only as stated below for trust on first use); on mismatch it SHALL NOT knock and SHALL report an identity mismatch. After approval it SHALL verify that the `fingerprint` in the knock response equals the proven one before storing the bearer. When the client already holds a pin for the server, the proven fingerprint SHALL also equal the pin (and the advertised fingerprint, when one is advertised). When there is no advertised fingerprint and no pin (a manually entered address, or an advert without `fp`), the client SHALL show the proven fingerprint to the user and SHALL knock only after the user explicitly confirms; it SHALL then pin that fingerprint only when the knock is approved (trust on first use), with the operator's typed compare-code approval as the second factor. This check defeats an impostor answering at the discovered address; over plain http it does not defeat an on-path relay that forwards the challenge to the genuine server. Routes delivered with the approval SHALL be stored only as the server-identity-routes capability states: validated, and only after the challenge at each proves the pinned fingerprint.

#### Scenario: Impostor on a discovered address is not knocked
- **GIVEN** discovery advertised fingerprint F for `192.168.16.204:8000`
- **WHEN** the challenge at that address proves fingerprint G ≠ F
- **THEN** the client SHALL NOT post to `/api/pair/request` and SHALL show an identity-mismatch error

#### Scenario: Manual address knocks only after user confirmation
- **GIVEN** a native client has no pin and no advert for `http://10.0.0.5:8000`
- **WHEN** the challenge proves fingerprint H
- **THEN** the client SHALL show H and SHALL NOT post to `/api/pair/request` until the user confirms
- **AND** WHEN the knock is approved the client SHALL pin H

#### Scenario: Pin and advert disagree
- **GIVEN** a native client holds pin F for a server whose current advert carries fingerprint G ≠ F
- **WHEN** the user asks to pair that server again
- **THEN** the client SHALL NOT knock and SHALL report an identity mismatch

#### Scenario: Delivered route is stored only after it proves the pin
- **GIVEN** an approved knock delivered `https://k3x9p2.share.zrok.io` for pinned fingerprint F
- **WHEN** the challenge at that URL proves F
- **THEN** the client SHALL store it as a route of F; if it proves another fingerprint the client SHALL NOT store it
