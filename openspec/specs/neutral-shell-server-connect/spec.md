# neutral-shell-server-connect Specification

## Purpose

Reconnect the neutral static shell to a previously paired dashboard server without trusting the URL. The shell races the candidate URLs recorded in a keyring entry, cryptographically re-verifies each responding server against the pinned Ed25519 identity, proves its durable bearer on an authenticated REST endpoint, and opens the realtime socket with a fresh single-use ticket — refusing any URL that answers but proves a different identity.

## Requirements

### Requirement: Identity-first URL resolution

The shell SHALL select an active URL by racing every candidate URL in the keyring entry and accepting only the first URL that both responds and proves the pinned Ed25519 identity.

#### Scenario: First verifying URL wins the race

- **WHEN** a keyring entry lists multiple candidate URLs and one responds with a proof matching the pinned identity
- **THEN** the shell resolves that URL as the active URL and records `identity verified: <url>`
- **AND** the remaining candidate URLs are abandoned once a verified URL is found

#### Scenario: No candidate URL proves the pinned identity

- **WHEN** every candidate URL is unreachable or fails identity verification
- **THEN** connection fails with an error and no active URL is established

### Requirement: Signed-nonce identity verification against the pin

The shell SHALL verify a server's identity by sending a fresh random nonce to `/api/pair/challenge`, verifying the returned Ed25519 signature over that nonce against the returned public key, and requiring the returned fingerprint AND public key to equal the pinned values.

#### Scenario: Server proves the pinned identity

- **WHEN** the shell POSTs a freshly generated 32-byte random nonce (base64url) to `/api/pair/challenge`
- **THEN** the server returns `{ fingerprint, publicKey, signature }` and the shell verifies the signature over the nonce with the returned public key
- **AND** the URL is accepted only when the signature verifies AND `fingerprint` equals the pinned fingerprint AND `publicKey` equals the pinned public key

#### Scenario: Impostor URL is refused with a surfaced warning

- **WHEN** a URL responds but its proof fails verification or its fingerprint/public key differ from the pinned values
- **THEN** the shell refuses that URL and records the reason (`identity mismatch` when the signature verified but the identity differs, `signature invalid` when the signature did not verify)
- **AND** when the overall connect fails on such a reason, the returned log exposes it as an identity mismatch

### Requirement: Bearer proof on an authenticated REST endpoint

The shell SHALL prove its durable bearer token works by calling the authenticated REST endpoint `/api/paired-devices` on the verified URL with an `Authorization: Bearer <token>` header before opening the socket.

#### Scenario: Bearer accepted

- **WHEN** the shell GETs `/api/paired-devices` on the verified URL with the entry's bearer token
- **THEN** the server returns the paired-device list and the shell records that the authenticated REST call succeeded with the device count

#### Scenario: Bearer rejected

- **WHEN** the authenticated REST call returns an unsuccessful envelope or fails
- **THEN** connection fails with the surfaced error and the socket is never opened

### Requirement: Fresh single-use ticket for the socket

The shell SHALL mint a fresh single-use WebSocket ticket per connect by POSTing `{ scope: "browser" }` to `/api/ws-ticket` with the bearer, then open the `/ws` socket using only that ticket as a query parameter — never placing the durable bearer in the socket URL.

#### Scenario: Ticket minted and socket opened

- **WHEN** the bearer proof has succeeded on the verified URL
- **THEN** the shell POSTs to `/api/ws-ticket` with the bearer and scope `browser`, receives a `ticket`, and opens `<verified-origin as ws/wss>/ws?ticket=<ticket>`
- **AND** the socket URL carries only the short-lived ticket, not the bearer token
- **AND** on socket open the connect succeeds and reports the active URL

#### Scenario: Socket fails or times out

- **WHEN** the socket errors, or does not open within 10 seconds
- **THEN** connection fails with a socket error (`ws connect failed` or `ws connect timed out`) and the connect is reported as unsuccessful
