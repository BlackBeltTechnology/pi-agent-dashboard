## ADDED Requirements

### Requirement: Each client holds one device key per server
A client SHALL hold an Ed25519 device key for each server fingerprint it pairs with, and SHALL NOT use one key for two servers, so two servers cannot link the same device. The private key SHALL never leave the client. A browser SHALL keep it as a non-extractable WebCrypto key in IndexedDB of the page's own origin; the Electron app SHALL keep it in the main process with the private part under operating-system credential encryption (held in memory only for the run when that encryption is unavailable, exactly as the bearer); the mobile shell SHALL keep it in its keyring store. A key SHALL be created only when the user starts pairing with that server, not for servers that are merely listed; the one exception is a device that already holds a working credential for a server and no key, which MAY create and bind a key as stated in "An already-paired device binds its key with its credential". The Electron app SHALL generate the key in memory when the user sends the request (or redeems a code) and SHALL persist it only when the request is approved, discarding it on reject, expiry, "Stop waiting" or crash. A browser SHALL keep the key for a live request so that reloading the request page resumes it, and SHALL delete it when the request is rejected or expires. A client whose environment has no Ed25519 WebCrypto (for example a page on plain `http` to a LAN address) SHALL pair without a device key and SHALL NOT fail the pairing. Forgetting a server SHALL delete its key. When a device pairs again with a server that answered `revoked`, it SHALL create a new key first.

#### Scenario: Keys are per server
- **WHEN** one browser pairs with servers `F1` and `F2`
- **THEN** it SHALL hold two different device keys, one bound to `F1` and one to `F2`

#### Scenario: Listing a server creates no key
- **WHEN** a server appears in the server list and the user has not started pairing with it
- **THEN** no device key SHALL exist for it on this client

#### Scenario: Insecure context pairs without a key
- **GIVEN** a browser page on `http://192.168.16.204:8000` where Ed25519 WebCrypto is unavailable
- **WHEN** the user requests access and the operator approves
- **THEN** the pairing SHALL complete without a device key and the device SHALL be listed with no key

#### Scenario: Pairing again after revoke rotates the key
- **GIVEN** the server answered `revoked` for this device's key
- **WHEN** the user chooses "Pair again"
- **THEN** the client SHALL create a new key for that server before it requests access, and SHALL submit the new key

#### Scenario: Electron key is persisted only on approval
- **WHEN** the Electron app sends a knock with a freshly generated key and the operator denies it, it expires, the user stops waiting, or the app quits
- **THEN** no private key and no key entry SHALL remain in the keyring

### Requirement: The device check proves the server first and answers a signed proof once
The identity challenge reply SHALL carry a `deviceNonce` (see `server-identity-keypair`). A client that holds a device key for a server SHALL send a device proof to a route only after the identity challenge at that route proved the pinned or advertised fingerprint, and SHALL send nothing to a route in any refused, unproven or unreachable outcome. The client SHALL give the identity challenge and the device-status request 2 seconds each; on a timeout it SHALL abort the request, show "Status unknown", discard nothing, and re-run both steps the next time the server list is opened. The proof SHALL be `POST /api/pair/device-status` with `{ deviceNonce, pub, sig }`, where `sig` is the base64url Ed25519 signature, by the device key, over the UTF-8 text `pi-devcheck/v2`, the server fingerprint and `deviceNonce` joined by line feeds. The route SHALL be public, SHALL NOT widen any CORS or origin rule, and SHALL consume the nonce on first presentation, valid or not, so a nonce is accepted once. A valid proof SHALL be answered `{ status, tier?, scope? }` where `status` is `paired` (the key is bound to an active device, or is an active companion), `revoked` (it is bound to a revoked device) or `unknown`; `tier` and `scope: "full"` are present only when a full device key is `paired`, and a companion key answers `scope: "status-only"` with no `tier`. An invalid signature, a malformed field, an unknown, expired or already used nonce, or a peer over the limit SHALL all be answered `{ status: "unverified" }` with the same HTTP status, so nothing reveals whether a key exists. The signed text names the server fingerprint, so a proof made for one server SHALL NOT be accepted by another. Device-status requests SHALL be limited to 60 per minute per peer address, counting valid and invalid requests; the limiter's tracking map SHALL be bounded, and the limit SHALL NOT affect the identity challenge.

#### Scenario: Known key answers paired with its tier
- **GIVEN** a device with tier `operate` whose key is bound
- **WHEN** the client proved the route and posts a valid proof over a fresh `deviceNonce`
- **THEN** the reply SHALL be `{ status: "paired", tier: "operate", scope: "full" }`

#### Scenario: Unknown key answers unknown
- **WHEN** a valid proof is made with a key that no device row holds
- **THEN** the reply SHALL be `{ status: "unknown" }`

#### Scenario: Revoked key answers revoked
- **GIVEN** the device holding the key was revoked and not yet deleted
- **WHEN** it posts a valid proof
- **THEN** the reply SHALL be `{ status: "revoked" }`

#### Scenario: Companion key answers status only
- **GIVEN** a companion key bound to an active device
- **WHEN** it posts a valid proof
- **THEN** the reply SHALL be `{ status: "paired", scope: "status-only" }` and no `tier`

#### Scenario: No proof is sent to an unproven route
- **GIVEN** a client with a device key and a route whose challenge proved a different fingerprint, or could not be answered
- **WHEN** the row is checked
- **THEN** the client SHALL NOT post to `/api/pair/device-status` at that route

#### Scenario: A used nonce cannot be replayed
- **WHEN** the same `{ deviceNonce, pub, sig }` is posted a second time
- **THEN** the reply SHALL be `{ status: "unverified" }`

#### Scenario: Expired nonce is unverified
- **WHEN** a proof is posted 61 seconds after its nonce was issued
- **THEN** the reply SHALL be `{ status: "unverified" }`

#### Scenario: Bad signature is indistinguishable
- **WHEN** a proof has a wrong signature, an unknown nonce or a malformed field
- **THEN** the reply SHALL be `{ status: "unverified" }`, identical in shape and HTTP status to the reply for an expired nonce

#### Scenario: Proof for another server is refused
- **GIVEN** a proof signed for server `F1`
- **WHEN** it is posted to server `F2` with a nonce `F2` issued
- **THEN** the reply from `F2` SHALL be `{ status: "unverified" }`

#### Scenario: Proof flood degrades to unverified only
- **GIVEN** one peer address has sent 60 device-status requests, valid or not, in the last minute
- **WHEN** the same peer sends a 61st, with a valid nonce and signature
- **THEN** the reply SHALL be `{ status: "unverified" }`, and the same peer's `POST /api/pair/challenge` SHALL still return the full identity answer
- **AND** after the window passes the peer SHALL be answered normally

#### Scenario: Peers behind one proxy share the limit
- **GIVEN** a server reached only through a tunnel, so every client has the same peer address
- **WHEN** one client sends more than 60 requests in a minute
- **THEN** other clients behind that tunnel MAY receive `{ status: "unverified" }` until the window passes, which they SHALL show as "Status unknown"

### Requirement: Device-key inputs are bounded and validated
Every untrusted device-key input SHALL be length- and charset-checked before decoding, and an input that fails SHALL be treated as absent or invalid, never as a reason to refuse an otherwise valid request. A public key (`pub`) SHALL be exactly a 32-byte raw Ed25519 public key in unpadded base64url; a signature (`sig`) SHALL be exactly 64 bytes in base64url; a `deviceNonce` SHALL be exactly the issued length; a companion `ts` SHALL be an integer. The companion fragment SHALL be at most 512 characters and the companion value SHALL have exactly three dot-separated parts. A companion `origin` SHALL parse as `http` or `https` scheme and host with an optional port and no path, userinfo, query or fragment, SHALL be at most 255 bytes, and SHALL be stored and displayed as plain text after the same control- and format-character stripping the requester name gets. The companion signature SHALL be verified over the origin exactly as sent, the origin SHALL be parsed for validity as sent, and the stripping SHALL apply only to what is stored and displayed. A device SHALL hold at most 4 companions; a further one SHALL be ignored. A device key or companion that is invalid or over a limit SHALL be ignored: a knock or redemption carrying it SHALL be admitted exactly as one without it, and a device-status request carrying it SHALL be answered `unverified`.

#### Scenario: Wrong-length key is ignored
- **WHEN** a knock carries a `deviceKey` whose `pub` is 31 bytes
- **THEN** the knock SHALL be admitted as one without a key

#### Scenario: Hostile companion origin is ignored
- **WHEN** a knock carries a companion whose origin is `http://user:pw@host`, `http://host/path`, `javascript:alert(1)` or longer than 255 bytes
- **THEN** the companion SHALL be ignored and the knock SHALL be admitted

#### Scenario: Control characters in the origin are removed
- **WHEN** a valid companion's origin contains a control or format character
- **THEN** the dialog and the stored companion SHALL show it without that character

#### Scenario: Signature is checked over the origin as sent
- **GIVEN** a companion whose origin contains a format character and whose signature covers those exact bytes
- **WHEN** it is verified
- **THEN** the signature SHALL be checked over the unstripped origin, and the stored and displayed origin SHALL be the stripped text

#### Scenario: Oversized fragment is ignored
- **WHEN** the request link's companion fragment is longer than 512 characters or does not have three parts
- **THEN** the landing SHALL send no companion

#### Scenario: Fifth companion is ignored
- **GIVEN** a device already holding 4 companions
- **WHEN** a further companion is approved for it
- **THEN** it SHALL NOT be stored

### Requirement: A device public key belongs to one device record
A public key SHALL appear at most once across the primary keys and companion keys of all active and revoked device records. Pairing approval and key binding SHALL refuse a key already held anywhere: at approval the pairing SHALL proceed without that key (or companion) and the response SHALL NOT change; at binding the call SHALL be refused with `409`.

#### Scenario: Companion key equal to another device's primary key
- **GIVEN** device A holds key `K` as its primary key
- **WHEN** a knock for device B carries `K` as its companion and the operator approves
- **THEN** B SHALL be paired without that companion

#### Scenario: Key of a revoked device is not reused
- **GIVEN** a revoked device holds key `K`
- **WHEN** a new request submits `K`
- **THEN** the request SHALL pair without a key

### Requirement: Device key is registered when pairing is approved
A pairing request MAY carry the device key as `deviceKey: { deviceNonce, pub, sig }`, where `deviceNonce` comes from an identity challenge the client verified at most 60 seconds earlier and `sig` is made by that key over the UTF-8 text `pi-devbind/v1`, the server fingerprint and `deviceNonce` joined by line feeds. `POST /api/pair/request` (knock) and `POST /api/pair/redeem` (QR) SHALL accept it. The server SHALL verify the proof and consume the nonce when the request arrives and SHALL ignore a `deviceKey` that fails verification or whose public key is already held; the pairing SHALL proceed without a key in those cases and the refusal SHALL NOT change the response. A verified key SHALL be held with the pending device, shown to the operator as a short key id, and bound to the device row only when the operator approves. A denied, expired or locked-out request SHALL discard it. Each device row SHALL hold at most one primary key.

#### Scenario: Approval binds the submitted key
- **GIVEN** a knock that carried a valid `deviceKey`
- **WHEN** the operator approves it
- **THEN** the new device row SHALL hold that key and a later valid proof with it SHALL answer `paired`

#### Scenario: Denied request leaves no key
- **WHEN** the operator denies a knock that carried a valid `deviceKey`
- **THEN** no device row SHALL exist and a later proof with that key SHALL answer `unknown`

#### Scenario: Invalid key does not block pairing
- **WHEN** a knock carries a `deviceKey` with a bad signature
- **THEN** the knock SHALL be admitted exactly as one without a key and the approved device SHALL have no key

#### Scenario: Replayed bind proof is not accepted
- **WHEN** a second knock carries a `deviceKey` whose `deviceNonce` was already used
- **THEN** that knock SHALL be admitted without a key

### Requirement: An already-paired device binds its key with its credential
`POST /api/pair/device-key` with body `{ deviceNonce, pub, sig }` (same proof as pairing registration, over a nonce from an identity challenge the client has just verified) SHALL bind that key to the calling device, and SHALL be accepted only for a request authenticated by that device's own credential — its bearer, or the device cookie carrying it — at any tier. It SHALL NOT be reachable anonymously, and a credential for one device SHALL NOT bind a key to another. When the device already has a primary key, the call SHALL replace it. A key already held by another record (active or revoked, primary or companion) SHALL be refused with `409`. A bad signature, a malformed field, or a replayed, unknown or expired `deviceNonce` SHALL be refused with `400`, binding nothing. A revoked device SHALL be refused like any other revoked credential. A client SHALL bind once when it holds a credential and no key and its environment can hold a key (a secure-context browser tab on the credential's own origin, the Electron main process, the mobile shell); it SHALL retry on its next app start after a failure; and it SHALL NOT attempt it from a plain-`http` browser origin, where the device stays "Paired · key pending".

#### Scenario: Existing device binds its first key
- **GIVEN** a device paired before device keys existed, holding only its bearer
- **WHEN** it calls `POST /api/pair/device-key` with a valid proof and its bearer
- **THEN** the server SHALL respond `200` and its next valid proof SHALL answer `paired`

#### Scenario: Anonymous call is refused
- **WHEN** `POST /api/pair/device-key` arrives with no device credential
- **THEN** the server SHALL respond `401` and bind nothing

#### Scenario: Observe-tier device may bind
- **GIVEN** a device with tier `observe`
- **WHEN** it binds its key with its bearer
- **THEN** the call SHALL NOT be refused on tier grounds

#### Scenario: Key held elsewhere is refused
- **WHEN** a device submits a key that another record already holds
- **THEN** the server SHALL respond `409` and keep both devices unchanged

#### Scenario: Replacement needs the credential
- **WHEN** a device with a primary key calls the route with a new key and its credential
- **THEN** the new key SHALL replace the old one, and the old key SHALL answer `unknown`

#### Scenario: Replayed bind proof is refused
- **WHEN** a bind request reuses a `deviceNonce` that was already consumed
- **THEN** the server SHALL refuse it and bind nothing

#### Scenario: Invalid bind proof is refused with 400
- **WHEN** an authenticated bind request carries a bad signature, a malformed `pub`, `sig` or `deviceNonce`, or an unknown or expired nonce
- **THEN** the server SHALL respond `400` and bind nothing

#### Scenario: Plain-http browser does not bind
- **GIVEN** a browser page on plain `http` holding a device cookie and no key
- **WHEN** the page runs
- **THEN** it SHALL NOT attempt to bind and its row SHALL read "Paired · key pending"

### Requirement: Companion key gives another dashboard a status-only view, opt-in
A browser opened from another dashboard A SHALL be able to pass a companion key to the dashboard B it opens, so A can later ask B whether this device is paired. The companion SHALL be carried only in the URL fragment of the request link, as `#companion=<pub>.<ts>.<sig>&from=<origin of A, percent-encoded>`, where `sig` is made by the companion key over `pi-companion/v1`, the fingerprint of B, the origin of A and `ts` (within 300 seconds) joined by line feeds; the link SHALL be opened without an opener relationship. Because dashboard A cannot obtain a server nonce from B, this signature is time-bound rather than single-use; a replay inside the window is accepted because it only takes effect inside a knock the operator approves, and the key is status-only. The B request page SHALL keep request mode only for a `#companion=` fragment (any other fragment is a QR payload), SHALL forward the companion with the knock and SHALL remove the fragment from the address bar after reading it. B SHALL verify the signature when the knock arrives and ignore a companion that fails. The operator approval dialog SHALL show a companion only with the text that it also lets the dashboard at that origin see that this device is paired, that it can only see the pairing and cannot sign in or act with it, and an "Allow this status check" checkbox that is unticked by default; the origin SHALL be presented as claimed by the requester. Unticked, the device SHALL be paired without the companion. Ticked, the companion SHALL be stored on the device row with its origin as a status-only key. A companion key SHALL NOT be accepted for the device-session cookie exchange, a WebSocket ticket, or any route other than the device-status check; presenting it anywhere else SHALL have no effect. The operator SHALL be able to remove a companion from the device without revoking the device.

#### Scenario: Companion is offered unticked
- **WHEN** a knock carries a valid companion for origin `http://192.168.16.31:8000`
- **THEN** the dialog SHALL show the companion text and an "Allow this status check" checkbox that is not ticked

#### Scenario: Unticked approval stores no companion
- **WHEN** the operator approves without ticking the checkbox
- **THEN** the device row SHALL hold no companion and the other dashboard's proofs SHALL answer `unknown`

#### Scenario: Ticked approval allows the status check
- **WHEN** the operator ticks the checkbox and approves
- **THEN** a valid proof by the companion key SHALL answer `paired` with `scope: "status-only"`

#### Scenario: Companion cannot sign in
- **WHEN** a request presents a companion key or proof to the device-session exchange, the WebSocket ticket route, or any REST route that needs a credential
- **THEN** the server SHALL treat the request as unauthenticated

#### Scenario: Fragment never reaches a server request
- **WHEN** the request landing reads the companion fragment
- **THEN** the companion SHALL travel only in the knock body, and the fragment SHALL be removed from the address bar

#### Scenario: No companion without the fragment
- **WHEN** the request link has no `#companion=` fragment
- **THEN** the dialog SHALL NOT show the companion text or checkbox

#### Scenario: Other fragments stay the QR flow
- **WHEN** `/pair` is opened with a fragment that does not start with `companion=`
- **THEN** the landing SHALL treat it as a QR payload, not as request mode

#### Scenario: Stale companion is ignored
- **WHEN** a knock's companion has a `ts` more than 300 seconds from the server clock
- **THEN** the companion SHALL be ignored and the knock SHALL be admitted

#### Scenario: Companion removed alone
- **WHEN** the operator removes a companion from a device
- **THEN** the device SHALL stay paired with its full key, and the companion's proofs SHALL answer `unknown`

### Requirement: Server rows show the state the device check reports
A client that holds a device key for a server SHALL run the device check on the grouped server row only after the identity challenge at the route proved the fingerprint, and SHALL show the server row in one of these states: **Paired · tier** (`paired`, scope `full`; the tier shown with the same names as the Paired devices tier choice: Observe, Control, Operate), **Paired · status only** (`paired`, scope `status-only`; the row's Open action goes to that server's own page because access lives there), **Access removed** (`revoked`; primary action "Pair again"), **Not paired** (`unknown` with no credential held, or no key and no credential held on a client that knows its own credentials; primary action is the pair action of the row), **Paired · key pending** (a credential is held and no key is registered yet; the client binds a key as stated in "An already-paired device binds its key with its credential"), **Status unknown** (the challenge reply had no `deviceNonce`, or the check answered `unverified` or not at all: an older server, a rejected or rate-limited proof, a browser with no key for that server). A client with no key SHALL send no proof. A client SHALL NOT discard its credential or key because of a device-status answer, including `unknown`; it SHALL discard them only when the credential itself is refused (a `401`, or a refused device-cookie exchange) at a route that proved the server's identity. When the answer is `revoked`, the client SHALL keep its stored credential and key. When the answer is `unknown` for a client that holds a credential, the client SHALL verify the credential with its next authenticated call: refused → it SHALL discard the credential and key and show Not paired; accepted → it SHALL show "Paired · key pending" and bind a key.

#### Scenario: Paired row
- **WHEN** the check answers `paired` with `tier: "control"` and `scope: "full"`
- **THEN** the row SHALL read Paired with the Control tier

#### Scenario: Revoked row keeps the credential
- **WHEN** the check answers `revoked`
- **THEN** the row SHALL read "Access removed" with "Pair again", and the stored credential and key SHALL remain on the device

#### Scenario: Undo needs no re-pairing
- **GIVEN** the row read "Access removed" and the operator then undid the revoke
- **WHEN** the next check answers `paired`
- **THEN** the row SHALL read Paired again and the original credential SHALL work without pairing

#### Scenario: Purged device becomes Not paired only when its credential is refused
- **GIVEN** the row read "Access removed" and the revoked device was deleted for good, so the next check answers `unknown`
- **WHEN** the client next presents its credential and the proven route refuses it
- **THEN** the client SHALL discard the dead credential and key and the row SHALL read Not paired
- **AND** the `unknown` answer alone SHALL NOT have discarded anything

#### Scenario: Unknown with a held credential reads Status unknown until verified
- **GIVEN** a client holding a credential and a key whose check answered `unknown`
- **WHEN** the verifying authenticated call has not yet returned
- **THEN** the row SHALL read "Status unknown" until the call is accepted ("Paired · key pending") or refused (Not paired)

#### Scenario: Unknown with a working credential means rebind
- **GIVEN** a device holding a credential that the server still accepts, whose key the server does not know
- **WHEN** the check answers `unknown` and the credential is accepted
- **THEN** the row SHALL read "Paired · key pending" and the client SHALL bind a key

#### Scenario: Old pairing without a key
- **GIVEN** a device holding a working credential and no key for the server
- **WHEN** the row is shown
- **THEN** it SHALL read "Paired · key pending" and the client SHALL bind a key where its environment can hold one, after which it reads Paired

#### Scenario: Older server
- **WHEN** the challenge reply has no `deviceNonce`
- **THEN** the client SHALL send no proof and the row SHALL read "Status unknown" and SHALL NOT read Not paired

#### Scenario: Rejected or limited proof
- **WHEN** the check answers `unverified`
- **THEN** the row SHALL read "Status unknown", and nothing SHALL be discarded

### Requirement: Device-key events are observable without secrets
The server SHALL log one line for each device-key binding or replacement, each key registration ignored at pairing, each companion allowed or removed, each revoke, restore and purge, and each change of the `revoked` answer for a key (the first `revoked` answer for a short key id after a different answer, at most once per key id per 10 minutes), naming the device id prefix and a short key id (a prefix of the key's hash). It SHALL log one line per peer when the device-status limit trips. It SHALL NOT log a full public key, a signature, a nonce, a bearer or a cookie, and SHALL NOT log every `revoked` answer. Lines for ignored or rate-limited proofs SHALL be throttled like knock refusals.

#### Scenario: Binding is logged without key material
- **WHEN** a device binds a key
- **THEN** the log SHALL contain the device id prefix and the short key id and SHALL NOT contain the key, a signature or a token

#### Scenario: Repeated revoked answers are not logged each time
- **WHEN** a revoked device's client checks 100 times in a minute
- **THEN** the server SHALL log at most one `revoked` line for that key in that period
