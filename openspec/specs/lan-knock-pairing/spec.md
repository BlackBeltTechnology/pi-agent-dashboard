# lan-knock-pairing Specification

## Purpose
Let a device on the same local network segment ask a dashboard for access ("knock") without first being handed a QR or deep link, so LAN pairing works over plain http while the existing operator approval, typed compare-code and revocation still decide trust.

## Requirements

### Requirement: Knock route creates a pending device without a pairing code
The server SHALL expose `POST /api/pair/request` as a public, unauthenticated route that is exempt from the network guard and the auth hook in the same way as `/api/pair/challenge`, `/api/pair/redeem` and `/api/pair/poll`. The body MAY carry `name` (the requester's self-chosen device name). When every admission gate passes, the server SHALL create a pending device with provenance `knock` and SHALL respond `200` with `{ pendingId, confirmCode, expiresAt, fingerprint }`, where `confirmCode` is an 8-digit code generated exactly as for a QR redemption, `expiresAt` is the epoch-millisecond instant the request expires (~300 s after the knock), and `fingerprint` is the server identity fingerprint. From that point the pending device SHALL follow the same lifecycle as a QR-redeemed one: app-wide approval dialog, typed compare-code approval, the per-request lockout budget shared by every approval entry point, deny, pushed expiry, and `POST /api/pair/poll` returning `pending` / `approved` (with the bearer) / `rejected` / `unknown`. A knock SHALL NOT consume or reveal any QR pairing code, and SHALL NOT mint a pairing payload; any internal code backing the knock SHALL never be returned to a client.

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

### Requirement: Knock admission gates
A browser request from a foreign origin SHALL be refused before these gates by the existing mutation-origin gate (`403 { error: "untrusted origin" }`), and a body that is not JSON SHALL be refused by the body parser (`415`). The server SHALL then evaluate the following gates in order and SHALL refuse at the first failing gate with the listed status and a distinct `error` code, creating no pending device and raising no operator prompt:

1. `host_not_admitted` (`403`) — the `Host` header is not admitted by Host admission in enforce semantics, regardless of the global host-gate mode (the same check the operator pairing routes apply against DNS rebinding).
2. `knock_not_lan` (`403`) — the socket peer address is missing, or is not in a private range (IPv4 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `169.254.0.0/16`; IPv6 `fc00::/7`, `fe80::/10`; IPv4-mapped forms of these), or is not on-link (inside the subnet of an address of a network interface the server serves on), or is a loopback address, or the request carries any proxy-forwarding header (the same header list `isGenuinelyLocal` uses), regardless of the peer address. An IPv6 zone identifier (`%en0`) SHALL be ignored when matching.
3. `knock_disabled` (`403`) — `pairing.acceptLanRequests` is not `true`.
4. `knock_rate_limited` (`429`, with `retryAfter` seconds) — 5 knocks from the source were admitted in the last 10 minutes, or a knock from the source was denied or locked out (approval attempts exhausted) within the last 10 minutes.
5. `knock_pending` (`409`) — a live knock from the same source already exists.
6. `knock_busy` (`503`, with `retryAfter` seconds) — 3 live knocks already exist across all sources, or 10 knocks were admitted across all sources in the last 10 minutes.

A knock is **live** from admission until it is approved, denied, locked out or expired; a resolved knock that is still pollable for its outcome is not live. Only admitted knocks count toward the windows in gates 4 and 6; refused attempts do not.

The on-link check SHALL use the addresses and netmasks of the host's non-internal network interfaces that the server's bind address covers. The "source" SHALL be the full peer address (IPv4, or IPv6 without its zone identifier). Admission SHALL depend only on the socket peer address, the `Host` admission above, the forwarding headers named above and server state; the requester `name` and User-Agent SHALL NOT affect admission. The pending device SHALL record that same socket peer address as its remote address. The `name` SHALL be normalised: a non-string is treated as absent; Unicode control and format characters (including bidirectional overrides and zero-width characters) are removed, the result is trimmed and truncated to at most 64 bytes of UTF-8 on a character boundary, and an empty result is treated as absent. A knock SHALL never be refused because of its `name`.

#### Scenario: Disabled by default
- **GIVEN** `pairing.acceptLanRequests` is absent from config
- **WHEN** a client at `192.168.16.31` knocks
- **THEN** the response SHALL be `403` with `error: "knock_disabled"`

#### Scenario: Public address refused
- **GIVEN** `pairing.acceptLanRequests` is `true`
- **WHEN** a client at `203.0.113.9` knocks
- **THEN** the response SHALL be `403` with `error: "knock_not_lan"`

#### Scenario: Tunnel-relayed knock refused
- **GIVEN** `pairing.acceptLanRequests` is `true`
- **WHEN** a knock arrives from peer `127.0.0.1` carrying `X-Forwarded-For: 192.168.16.31`
- **THEN** the response SHALL be `403` with `error: "knock_not_lan"`

#### Scenario: LAN reverse proxy cannot launder an outside knock
- **GIVEN** `pairing.acceptLanRequests` is `true`
- **WHEN** a knock arrives from peer `192.168.16.5` carrying `X-Forwarded-For: 203.0.113.9`
- **THEN** the response SHALL be `403` with `error: "knock_not_lan"`

#### Scenario: Cross-origin browser knock refused
- **GIVEN** `pairing.acceptLanRequests` is `true`
- **WHEN** a browser at `192.168.16.31` showing `https://evil.example` posts a knock to `http://192.168.16.204:8000/api/pair/request` with `Origin: https://evil.example`
- **THEN** the response SHALL be `403` with `error: "untrusted origin"` and no operator prompt SHALL appear

#### Scenario: DNS-rebound host refused
- **GIVEN** `pairing.acceptLanRequests` is `true` and the global host gate is in report mode
- **WHEN** a browser at `192.168.16.31` posts a knock with `Host: evil.test` and `Origin: http://evil.test` after `evil.test` was rebound to `192.168.16.204`
- **THEN** the response SHALL be `403` with `error: "host_not_admitted"` and no operator prompt SHALL appear

#### Scenario: Private but off-link address refused
- **GIVEN** `pairing.acceptLanRequests` is `true` and the server serves only on `192.168.16.204/24`
- **WHEN** a knock arrives from `100.101.102.103` (a VPN peer) with no forwarding header
- **THEN** the response SHALL be `403` with `error: "knock_not_lan"`

#### Scenario: Link-local IPv6 with zone id admitted
- **GIVEN** `pairing.acceptLanRequests` is `true` and the server serves on an interface with link-local `fe80::1%en0`
- **WHEN** a knock arrives from `fe80::a1b2%en0`
- **THEN** the knock SHALL pass `knock_not_lan` and its source SHALL be `fe80::a1b2`

#### Scenario: One live knock per source
- **GIVEN** a live knock from `192.168.16.31`
- **WHEN** `192.168.16.31` knocks again
- **THEN** the response SHALL be `409` with `error: "knock_pending"` and the first knock SHALL be unchanged

#### Scenario: Denial imposes a cooldown
- **GIVEN** an operator denied a knock from `192.168.16.31` 5 seconds ago
- **WHEN** `192.168.16.31` knocks again
- **THEN** the response SHALL be `429` with `error: "knock_rate_limited"` and a positive `retryAfter`

#### Scenario: Lockout imposes a cooldown
- **GIVEN** a knock from `192.168.16.31` was locked out after 5 wrong approval codes
- **WHEN** `192.168.16.31` knocks again within 10 minutes
- **THEN** the response SHALL be `429` with `error: "knock_rate_limited"`

#### Scenario: Address rotation cannot sustain prompts
- **GIVEN** 10 knocks from 10 different sources were admitted in the last 10 minutes and all were denied
- **WHEN** an 11th source knocks
- **THEN** the response SHALL be `503` with `error: "knock_busy"` and a positive `retryAfter`

#### Scenario: Global cap bounds operator prompts
- **GIVEN** live knocks from 3 different sources
- **WHEN** a fourth source knocks
- **THEN** the response SHALL be `503` with `error: "knock_busy"`

#### Scenario: IPv6 neighbours on one /64 do not block each other
- **GIVEN** a live knock from `fd12:3456:789a:1::10`
- **WHEN** `fd12:3456:789a:1::22` knocks
- **THEN** the second knock SHALL NOT be refused with `knock_pending`

#### Scenario: Oversized name is truncated, not refused
- **GIVEN** `pairing.acceptLanRequests` is `true`
- **WHEN** a client at `192.168.16.31` knocks with a 200-character `name`
- **THEN** the knock SHALL be admitted and the requester name SHALL be at most 64 bytes of UTF-8

#### Scenario: Bidi override is stripped from the name
- **WHEN** a knock arrives with `name` containing U+202E followed by `cod.exe`
- **THEN** the stored requester name SHALL contain no U+202E character

### Requirement: Operator toggle for LAN requests
The config SHALL carry `pairing.acceptLanRequests: boolean`, defaulting to `false` when absent. The Gateway "Connect a device" surface SHALL show a "Devices on this network" panel with a labelled switch "Accept requests from devices on this network" bound to it, showing its state as a word (On / Off) as well as visually, with helper text stating that such requests travel unencrypted unless the dashboard is served over TLS. While the switch is on, the panel SHALL list the request-page URL (`<lan-endpoint>/pair?request`) for each LAN endpoint the Gateway already lists (plain-http endpoints on the host's non-internal IPv4 interface addresses; never the tunnel, `localhost` or a public base URL), each with a Copy action. IPv6 knocks remain admitted; their request URL is not listed. When no secure endpoint exists, the Gateway's explanation SHALL NOT state that a LAN browser cannot pair; it SHALL point to this switch. Changing the switch SHALL take effect for the next knock without a server restart. It SHALL be written through the existing config write route, with the same authority that route requires for every other field.

#### Scenario: Turning the switch on admits knocks
- **WHEN** the operator turns the switch on
- **THEN** `pairing.acceptLanRequests` SHALL be `true` and the next knock from a private-range source SHALL pass the `knock_disabled` gate without a restart

#### Scenario: Request page URL is offered while on
- **GIVEN** the Gateway lists LAN endpoint `http://192.168.16.204:8000`
- **WHEN** the operator turns the switch on
- **THEN** the panel SHALL show `http://192.168.16.204:8000/pair?request` with a Copy action

#### Scenario: No-secure-road explanation points to the LAN path
- **GIVEN** no tunnel and no TLS endpoint
- **WHEN** the operator opens Gateway "Connect a device"
- **THEN** the explanation SHALL say a QR pairing link needs a secure road and SHALL point to "Accept requests from devices on this network" for a device on this network

#### Scenario: Turning the switch off leaves live knocks reviewable
- **GIVEN** a live knock is pending
- **WHEN** the operator turns the switch off
- **THEN** new knocks SHALL be refused with `knock_disabled`
- **AND** the existing pending knock SHALL stay approvable and deniable until it expires

### Requirement: Plain-http transport is permitted for knocks only
The server SHALL NOT refuse or redirect a knock, or the `challenge` / `poll` requests that complete it, because it arrived over plain `http`. This SHALL NOT change the pairing payload rule: the QR / deep-link payload SHALL still list only `https` / `wss` endpoints. The server SHALL record, per knock, whether it arrived over an unencrypted connection (no TLS on the socket that received it).

#### Scenario: Knock over plain http is admitted
- **GIVEN** `pairing.acceptLanRequests` is `true` and the dashboard serves only `http://192.168.16.204:8000`
- **WHEN** `192.168.16.31` knocks over that address
- **THEN** the knock SHALL be admitted and its pending device SHALL be marked unencrypted

#### Scenario: Payload remains TLS-only
- **GIVEN** no tunnel and no TLS endpoint
- **WHEN** the operator opens the Gateway "Connect a device" surface
- **THEN** it SHALL still explain that a tunnel or TLS is required for QR pairing

### Requirement: Requester name is untrusted display text
The requester `name` SHALL be bounded as stated in the admission gates, SHALL be rendered only as text attributed to the requester (for example "says it is …"), SHALL NOT be the dialog's primary identifier (the source address is), SHALL NOT affect any authorization decision, and SHALL NOT be written to logs. It MAY prefill the editable device-name field in the approval dialog.

#### Scenario: Name cannot impersonate the server or a known device
- **WHEN** a knock arrives with `name: "home-imac (this computer)"`
- **THEN** the approval dialog SHALL show the source address as the request's identity and the name only inside a requester-attributed phrase
- **AND** approval SHALL still require the typed confirmation code shown on the requesting device

### Requirement: Knock refusals and admissions are observable without secrets
The server SHALL log one `[pairing]` line per admitted knock carrying the short pending id, and one line per refusal reason carrying the error code; refusal lines SHALL be limited to one per reason per 60 seconds; when refusals were suppressed in a window, one line carrying the suppressed count SHALL be logged when that window ends, even if no further refusal arrives. No log line SHALL contain a confirmation code, a bearer, the requester name, the User-Agent or the source address.

#### Scenario: Refusal flood does not flood the log
- **WHEN** 100 knocks are refused with `knock_disabled` within 60 seconds
- **THEN** exactly one `knock_disabled` refusal line SHALL be logged in those 60 seconds
- **AND** when the 60 seconds end a line SHALL report the 99 suppressed refusals, even if no further knock arrives

#### Scenario: Admission log carries no secrets
- **WHEN** a knock is admitted
- **THEN** the log line SHALL contain the first 8 characters of the pending id and SHALL NOT contain the confirmation code, the requester name or the source address

### Requirement: Browser "Request access" landing
The `/pair` landing SHALL offer a request mode when opened as `/pair?request` without a payload fragment. Request mode SHALL show the address of the dashboard it is asking (the page's own host, so nothing is disclosed before access), an optional "Device name" field, a statement that the request travels unencrypted when the page origin is `http:`, and a "Request access" action. On request it SHALL knock same-origin (no fingerprint pin is required, because the page and the routes share one origin), show the 8-digit confirmation code grouped as `4821 7730` with the instruction to type it on the dashboard machine, show the time left until `expiresAt`, and poll. While waiting it SHALL NOT offer a Cancel action, because the request cannot be withdrawn from the server. On expiry it SHALL say the request expired and offer "Request again". A poll result of `unknown` before `expiresAt` (the outcome was missed, e.g. while the page was in the background) SHALL say the request may have been decided while the page was away and offer "Request again"; the server's cooldown still applies. The landing SHALL poll immediately when the page becomes visible again. The landing SHALL keep `pendingId`, `confirmCode` and `expiresAt` in session storage until the request resolves, so reloading the page during a live request resumes the waiting state with the same code instead of losing it. On `approved` it SHALL store the bearer the same way a QR-paired browser does (exchanging it for the httpOnly device cookie), SHALL then load the dashboard. On `rejected` it SHALL state that the dashboard declined and SHALL NOT offer an immediate retry. Each refusal code SHALL map to a plain-language explanation: `knock_disabled` → the dashboard is not accepting requests from this network and its owner can turn this on in Gateway; `knock_not_lan` → requests are accepted only from the same local network; `knock_pending` → a request from this device is already waiting (if this page was closed, it expires within 5 minutes); `knock_rate_limited` → try again after the stated time; `knock_busy` → too many requests are waiting, try again shortly; `host_not_admitted`, `untrusted origin` or any other refusal → a generic "this dashboard refused the request" message. Request mode SHALL work in a non-secure browser context (plain `http` on a LAN address).

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

### Requirement: Waiting list shows request provenance
The Gateway "Waiting devices" list SHALL label each row with its provenance in words ("Network request" for a knock, "Pairing link" for a QR redemption). A knock row SHALL lead with the source address, SHALL show a requester name only as "says …", and SHALL carry an "Unencrypted" label with an icon when the knock arrived unencrypted. Each Review action SHALL have an accessible name identifying its request.

#### Scenario: Knock and QR rows are distinguishable
- **GIVEN** a pending unencrypted knock from `192.168.16.31` named `Roberts-MacBook-Pro` and a pending QR redemption
- **WHEN** the operator opens Gateway "Connect a device"
- **THEN** the knock row SHALL show "Network request", `192.168.16.31`, "says “Roberts-MacBook-Pro”" and "Unencrypted"
- **AND** the QR row SHALL show "Pairing link" and no Unencrypted label

### Requirement: Operator chooses the tier of a knock-paired device
`POST /api/pair/approve-pending` SHALL accept an optional `tier` (`observe` | `control` | `operate`). A supplied value that is not one of these SHALL be rejected with `400` and the pending device SHALL stay pending; an absent `tier` SHALL keep the pairing default (`operate`). The approval dialog for a knock SHALL offer the three tiers as a labelled radio group with the existing tier descriptions, preselect `operate`, state the consequence of the selected tier, and send the selection with the approval. The paired device SHALL carry the chosen tier.

#### Scenario: Operator pairs a knock read-only
- **GIVEN** a pending knock with confirmation code `48217730`
- **WHEN** the operator selects Observe and approves with `48217730`
- **THEN** the paired device SHALL have tier `observe`

#### Scenario: Invalid tier rejected
- **WHEN** an operator posts approve-pending with a valid code and `tier: "admin"`
- **THEN** the server SHALL respond `400` and the pending device SHALL stay pending

### Requirement: Native knocking clients verify the discovered identity first
A client that knocks a server on a different origin than its own (for example a native shell connecting to a server found by mDNS) SHALL first complete `POST /api/pair/challenge` and SHALL knock only when the proven fingerprint equals the fingerprint the server advertised in discovery (without an advert, only as stated below for trust on first use); on mismatch it SHALL NOT knock and SHALL report an identity mismatch. After approval it SHALL verify that the `fingerprint` in the knock response equals the proven one before storing the bearer. When the client already holds a pin for the server, the proven fingerprint SHALL also equal the pin (and the advertised fingerprint, when one is advertised). When there is no advertised fingerprint and no pin (a manually entered address, or an advert without `fp`), the client SHALL show the proven fingerprint to the user and SHALL knock only after the user explicitly confirms; it SHALL then pin that fingerprint only when the knock is approved (trust on first use), with the operator's typed compare-code approval as the second factor. This check defeats an impostor answering at the discovered address; over plain http it does not defeat an on-path relay that forwards the challenge to the genuine server.

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

### Requirement: Dashboard works from a non-secure LAN origin
After a knock pairs a browser on a plain-http LAN origin, the dashboard client SHALL work in that non-secure browser context: no code in the dashboard client (`packages/client`), its shared client utilities (`packages/client-utils`), the plugin runtime's browser surface (`packages/dashboard-plugin-runtime`, excluding its Node-only `server`, `bridge` and `vite-plugin` entries and its `test-support` helpers), or any plugin client bundle loaded into the dashboard SPA (the directory of every plugin manifest's client entry, excluding that plugin's server and bridge entries, and every `packages/*/src/client` tree) SHALL call a secure-context-only API (`crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`, `navigator.mediaDevices`) without a capability check, plus a fallback where one exists (a UUIDv4 built from `crypto.getRandomValues`, which works in non-secure contexts, so request ids stay UUIDv4 as `spawn-correlation` requires; a manual-copy fallback for clipboard that still uses `navigator.clipboard.writeText` when it exists). A plugin Copy action SHALL report the real outcome: it SHALL NOT show a "Copied" confirmation when neither copy path succeeded. Features that inherently require a secure context (DPoP proof keys on the identity plane; camera, microphone, or screen capture via `navigator.mediaDevices`) SHALL check for the API and report themselves unavailable instead of throwing. Bundles that never load into the dashboard SPA (the standalone pairing shell, headless bus clients, standalone deck runtimes) are out of scope for this requirement.

#### Scenario: Resume from Settings on an http LAN origin
- **GIVEN** a browser paired by knock on `http://192.168.16.204:8000`, where `crypto.randomUUID` is undefined
- **WHEN** the user resumes a session from Settings
- **THEN** the request SHALL be sent with a UUIDv4 `requestId` and no error SHALL be thrown

#### Scenario: Copy without the clipboard API
- **GIVEN** `navigator.clipboard` is undefined
- **WHEN** the user activates a Copy action
- **THEN** the client SHALL fall back without throwing and SHALL tell the user the text could not be copied automatically

#### Scenario: Plugin Copy action without the clipboard API
- **GIVEN** `navigator.clipboard` is undefined and the manual-copy fallback fails
- **WHEN** the user activates a Copy action inside a plugin client surface (for example the kb test-search result list or the Gmail settings setup steps)
- **THEN** the plugin SHALL NOT throw and SHALL NOT show a "Copied" confirmation

#### Scenario: Plugin Copy action falls back in a non-secure context
- **GIVEN** `navigator.clipboard` is undefined and the manual-copy fallback succeeds
- **WHEN** the user activates a Copy action inside a plugin client surface
- **THEN** the text SHALL be copied via the fallback and the plugin SHALL report success

#### Scenario: Rapid plugin copies resolve out of order
- **GIVEN** the user activates Copy on item A and then on item B, and A's copy settles after B's
- **WHEN** both copies settle
- **THEN** the plugin's copy indicator SHALL reflect only B's outcome, and A's late result SHALL NOT change it

#### Scenario: Media capture on an http LAN origin
- **GIVEN** a browser on a plain-http LAN origin where `navigator.mediaDevices` is undefined
- **WHEN** the user activates a feature in the dashboard or a plugin client that needs camera, microphone, or screen capture
- **THEN** the feature SHALL report itself unavailable in this context and SHALL NOT throw

#### Scenario: New plugin code calls a secure-context API bare
- **WHEN** a source file in any client root named above (test files excluded) calls `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`, or `navigator.mediaDevices` outside the allowlisted guarded helpers, whether by member access, optional chaining, or quoted bracket access on `navigator` / `crypto` (also when reached through `window`, `globalThis` or `self`), or by destructuring from them
- **THEN** the repository's secure-context source-scan test SHALL fail naming that file

### Requirement: Configured networks extend knock eligibility
The knock admission gate's address rule SHALL admit a peer when it lies in a default private range (as defined by this capability) **or** matches an entry of the resolved trusted list (`trustedNetworks` merged with `auth.bypassHosts`). The list branch SHALL apply only to a request that carries no proxy-forwarding header at all (as strict as the private-range branch), and SHALL ignore the match-all entries `0.0.0.0/0`, `::/0` and `*.*.*.*`. (An operator who lists ranges that together span the internet still opens knocking to them; the Security page shows every listed range as "may request access".) The list branch does not require the peer to be on-link. This extension SHALL apply in both trust modes and SHALL be read live, so an entry added or revoked takes effect on the next knock without a restart.

A list match SHALL widen only **where a knock may come from**. It SHALL NOT bypass any other knock gate (`pairing.acceptLanRequests`, one live knock per address, the pending cap, the per-address rate limit), SHALL NOT pre-approve, shorten or skip the operator's typed confirm-code approval, and SHALL NOT change the tier a knock is issued with. A relayed-loopback peer (loopback-range socket peer carrying a proxy-forwarding header) SHALL be refused even when the list covers loopback.

#### Scenario: Public-range peer listed by the operator may knock
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `198.51.100.0/24`
- **WHEN** a knock arrives from `198.51.100.7`
- **THEN** the address gate SHALL pass and a pending device SHALL be created awaiting operator approval

#### Scenario: Unlisted public-range peer is refused
- **GIVEN** `pairing.acceptLanRequests` is enabled and no list entry covers `198.51.100.7`
- **WHEN** a knock arrives from `198.51.100.7`
- **THEN** it SHALL be refused with the address-gate error code

#### Scenario: Listed peer still needs the setting
- **GIVEN** `pairing.acceptLanRequests` is disabled and `trustedNetworks` contains `192.168.16.0/24`
- **WHEN** a knock arrives from `192.168.16.20`
- **THEN** it SHALL be refused with the setting-disabled error code

#### Scenario: Listed peer still needs operator approval
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `192.168.16.0/24`
- **WHEN** a knock from `192.168.16.20` is admitted
- **THEN** no bearer SHALL be issued until the operator approves with the typed confirm code

#### Scenario: Loopback entry does not admit a relayed knock
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `127.0.0.0/8`
- **WHEN** a knock arrives from `127.0.0.1` carrying `X-Forwarded-For`
- **THEN** it SHALL be refused

#### Scenario: Forwarded knock from a listed peer is refused
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `198.51.100.0/24`
- **WHEN** a knock arrives from `198.51.100.7` carrying `X-Forwarded-For`
- **THEN** it SHALL be refused with the address-gate error code

#### Scenario: Match-all entry does not open knocking
- **GIVEN** `pairing.acceptLanRequests` is enabled and `trustedNetworks` contains `0.0.0.0/0`
- **WHEN** a knock arrives from public address `203.0.113.9`
- **THEN** it SHALL be refused with the address-gate error code
