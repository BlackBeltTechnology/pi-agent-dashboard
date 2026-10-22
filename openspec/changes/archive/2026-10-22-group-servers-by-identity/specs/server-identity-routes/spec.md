## ADDED Requirements

### Requirement: A server is its identity and is reached through routes
Wherever the dashboard lets a user choose a server (the header server selector, Settings ▸ Servers, the Electron servers list), it SHALL list one entry per server identity (the identity fingerprint, `sha256:` plus a base64url hash). An address at which that server answers SHALL be a route of the entry, never an entry of its own. A route SHALL record its scheme (`http` or `https`) and how it was learned (`saved`, `mdns` or `pairing`); its kind (this machine, local network, mDNS name, tunnel, public URL) SHALL be derived from its scheme and host as stated in "Route kind is derived from the address" and SHALL NOT be stored. A route SHALL join the entry that holds its proven fingerprint when it is an `https` route, when the entry has no `http` route, or when the entry already has an `http` route on the same port; an `http` route on any other port SHALL start a second entry with the same fingerprint, and both entries SHALL be labelled "same identity as" the other. An `https` route SHALL join the oldest entry holding its fingerprint, where "oldest" means first in the stored list order. A server with no known fingerprint SHALL stay a single-route entry until a challenge proves one.

#### Scenario: Three addresses of one server show as one row
- **GIVEN** the saved list holds `http://192.168.16.204:8000`, discovery lists `home-imac.local:8000`, and a tunnel `https://h0me1mac.share.zrok.io` was learned at pairing, and all three prove fingerprint F
- **WHEN** the user opens the server selector or Settings ▸ Servers
- **THEN** exactly one entry for F SHALL be shown, with three routes

#### Scenario: Two instances sharing one identity stay two rows
- **GIVEN** two dashboards on one machine share fingerprint F and listen on ports 8000 and 9000
- **WHEN** both are listed
- **THEN** two entries SHALL be shown, each labelled "same identity as" the other

#### Scenario: Https route joins the first entry in stored order
- **GIVEN** two stored entries hold fingerprint F on ports 9000 and 8000, in that order
- **WHEN** an `https` route proves F
- **THEN** it SHALL be attached to the entry on port 9000 (first in stored order), not to the other

#### Scenario: Server without a fingerprint stays one route
- **WHEN** a discovered server advertises no fingerprint
- **THEN** its entry SHALL show one route and "identity not advertised"

### Requirement: Route kind is derived from the address
A route's kind SHALL be computed by one pure function of its scheme and host and SHALL NOT be persisted: `loopback` for `127.0.0.0/8`, `::1` and `localhost`; `lan` for an IP literal in the private ranges the knock gate treats as private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, CGNAT `100.64.0.0/10`, link-local `169.254.0.0/16`, IPv6 `fc00::/7` and `fe80::/10`) and for an internal DNS name (a single-label name, or one ending `.lan`, `.home.arpa` or `.internal`); `mdns` for a name ending `.local`; `tunnel` for an `https` DNS name equal to or under `zrok.io`; `public` for every other address, including a public IP literal. Before classifying, and before comparing hosts for grouping, the host SHALL be normalised: lower-cased, one trailing dot removed, brackets removed from an IPv6 literal, an IPv6 zone identifier (`%en0`) removed, and an IPv4-mapped IPv6 literal (`::ffff:192.168.16.5`) classified as its IPv4 address. A route SHALL count as on-link, the precondition for offering a knock, only when its kind is `lan` or `mdns` and its scheme is `http`. The kind is a hint for labels and for choosing the pair action; the server alone decides whether a knock is admitted.

#### Scenario: Kinds of typical addresses
- **WHEN** routes `http://127.0.0.1:8000`, `http://localhost:8000`, `http://192.168.16.204:8000`, `http://100.64.1.5:8000`, `http://[fd12::4]:8000`, `http://home-imac.local:8000`, `https://k3x9.share.zrok.io` and `https://lab.example.org` are classified
- **THEN** the kinds SHALL be `loopback`, `loopback`, `lan`, `lan`, `lan`, `mdns`, `tunnel` and `public`

#### Scenario: Range edges
- **WHEN** `172.15.0.1`, `172.32.0.1`, `100.63.0.1` and `100.128.0.1` are classified
- **THEN** none SHALL be `lan`

#### Scenario: Host spelling is normalised before classifying
- **WHEN** `http://LOCALHOST:8000`, `http://localhost.:8000`, `http://Home-iMac.LOCAL:8000`, `http://[::ffff:192.168.16.5]:8000` and `http://[fe80::1%en0]:8000` are classified
- **THEN** the kinds SHALL be `loopback`, `loopback`, `mdns`, `lan` and `lan`
- **AND** `Home-iMac.LOCAL` and `home-imac.local.` SHALL be treated as the same host when routes are grouped

#### Scenario: Kind is not stored
- **WHEN** a route is persisted
- **THEN** its stored fields SHALL be host, port, scheme and source only

### Requirement: Every route is proven by the identity challenge
The reachability check of a route SHALL be the identity challenge: a fresh nonce posted to `POST /api/pair/challenge` at that route, with the answer's fingerprint recomputed from the presented public key and its signature verified. A reachable `/api/health` answer SHALL NOT count as proof. A route SHALL be shown, and SHALL be eligible for use, in exactly one of these outcomes: proven (the proven fingerprint equals the entry's fingerprint); refused as a different identity (a valid proof of another fingerprint); refused as an invalid proof (bad signature or unparseable key); unable to prove identity (the server answered the route but not the challenge, for example an older dashboard); unreachable. A route in either refused outcome SHALL NOT be used, SHALL receive no credential and no pairing request, and SHALL show the fingerprint it proved when it proved one. A fingerprint read from mDNS alone SHALL decide only which entry a discovered route is listed under; the route SHALL NOT be used until it proves that fingerprint. Access to a proven route (for example `network_not_allowed`) SHALL still be reported separately from identity. A server that advertises no fingerprint SHALL remain listable and pairable through the existing trust-on-first-use confirmation. When the dashboard server itself proves a route (when adding or attaching a route, backfilling a fingerprint, probing, or evaluating a move suggestion) it SHALL challenge the route over the route's own scheme: `https` with the platform's normal certificate verification (no verification override), no redirect followed, a 2 second timeout and a response size cap; a certificate failure SHALL count as unable to prove identity. Only `http` and `https` routes SHALL ever be challenged. A client checking the routes of a list SHALL run at most 6 route checks at once (each check is the challenge plus the access check, each request bounded by the 2 second timeout), so a list of N requests SHALL settle within 2 seconds × ⌈N ÷ 6⌉ even when every request stalls.

#### Scenario: A route proving a different identity is refused
- **GIVEN** the entry for `lab-server` holds fingerprint F and its route `http://192.168.16.50:8000` now proves fingerprint G
- **WHEN** the list is checked
- **THEN** that route SHALL show "different identity" and G, and SHALL NOT be used
- **AND** no credential or pairing request SHALL be sent to it

#### Scenario: Reachable but not provable is not trusted
- **WHEN** a route answers `/api/health` but answers the challenge with a non-success status
- **THEN** it SHALL show "can't prove identity" and SHALL NOT be offered as the route to open

#### Scenario: Advertised fingerprint alone is not proof
- **WHEN** an mDNS advert claims fingerprint F and the challenge at that route proves nothing or proves G
- **THEN** the route SHALL NOT be used as a route of F

#### Scenario: Proven route on a network the server refuses
- **WHEN** a route proves F but `/api/health` answers `403 network_not_allowed`
- **THEN** the route SHALL show as proven and as "Network not allowed"

#### Scenario: Server proves an https route over https
- **WHEN** the dashboard server proves a stored `https` route
- **THEN** it SHALL post the challenge to `https://<host>:<port>/api/pair/challenge`, verify the certificate normally, and follow no redirect
- **AND** an invalid or self-signed certificate SHALL yield "can't prove identity", not a pinned fingerprint

#### Scenario: Route checks are bounded in concurrency and time
- **GIVEN** a list with 12 routes whose 24 requests never answer
- **WHEN** the list is checked
- **THEN** no more than 6 route checks SHALL be in flight at any moment
- **AND** every route SHALL have settled as unreachable within 8 seconds

#### Scenario: Challenge toward an operator-supplied host is bounded
- **WHEN** an operator adds `https://lab.example.org` and that host answers the challenge with a redirect, with a body larger than the response cap, or only after more than 2 seconds
- **THEN** the challenge SHALL be treated as not proven, no redirect SHALL be followed and no fingerprint SHALL be stored
- **AND** a scheme other than `http` or `https` SHALL be refused before any request is made

### Requirement: Best route selection
Among the proven, accessible routes of an entry, a route SHALL be chosen by this rule. Where the app does not send a stored credential by itself (the "used" marker in the browser list and an in-page switch in a browser): an `https` route SHALL win over `http` when its latency is within 50 ms of the fastest `http` route's latency (a difference of exactly 50 ms counts as within, so the rule is `https − http ≤ 50 ms`); otherwise the lowest latency SHALL win. Latency SHALL be the round-trip time of the identity challenge. Where the app sends a stored bearer credential when it opens the server (the Electron server window): routes SHALL be ordered stored `https`, then stored `http` (most recently used first, the keyring's own order), then discovered, and the first route in that order that proves the pinned fingerprint SHALL be used; latency SHALL NOT be compared, so a faster plain-http route can never downgrade a bearer-carrying open to cleartext. The Electron list's "used" marker SHALL follow the same order.

#### Scenario: Fast LAN route beats a slow tunnel in a list
- **GIVEN** proven routes `http://192.168.16.204:8000` at 4 ms and `https://h0me1mac.share.zrok.io` at 118 ms
- **WHEN** the browser list marks the route in use
- **THEN** the LAN route SHALL be marked

#### Scenario: Similar latency prefers https
- **GIVEN** proven routes `http://192.168.16.204:8000` at 40 ms and `https://lab.example.org` at 70 ms
- **WHEN** the browser list marks the route in use
- **THEN** the https route SHALL be marked

#### Scenario: Exactly 50 ms apart prefers https
- **GIVEN** proven routes `http://192.168.16.204:8000` at 4 ms and `https://lab.example.org` at 54 ms
- **WHEN** the browser list marks the route in use
- **THEN** the https route SHALL be marked
- **AND** with the https route at 55 ms the http route SHALL be marked

#### Scenario: Electron never sends its bearer over a faster http route
- **GIVEN** a keyring entry with a proven `https` route at 130 ms and a proven `http` route at 3 ms
- **WHEN** the user opens the server in the Electron app
- **THEN** the `https` route SHALL be used

#### Scenario: Electron prefers stored over discovered
- **GIVEN** a stored `http` route and a discovered `http` route, both proven
- **WHEN** the user opens the server in the Electron app
- **THEN** the stored route SHALL be used regardless of latency

### Requirement: Routes reach a device only with a pairing result
A server's routes other than the one a device already found SHALL be delivered to a device only as part of a successful pairing: the `routes` field of the one `approved` answer of `POST /api/pair/poll` (which also carries the credential) and the `urls` of a pairing payload. They SHALL NOT appear in the mDNS advertisement, in the `POST /api/pair/challenge` answer, or in any `pending`, `rejected` or `unknown` poll answer. The `routes` of the poll answer SHALL be the server's reachable URLs (the list a pairing payload carries) restricted to origins whose scheme is `https`: `wss://` entries and the loopback `http` origin admitted only in the end-to-end test harness SHALL NOT be included. A device SHALL validate every delivered route before storing it: `https` scheme, origin only (no credentials, path, query or fragment), a DNS host name that is not an IP literal, `localhost` or `.local`, at most 8 routes and each host at most 253 characters; invalid routes SHALL be dropped. When more than 8 routes are delivered the device SHALL keep the first 8 valid routes in delivery order and drop the rest. The origin form with only a trailing slash (`https://host.example/`, as the server normalises it) SHALL be accepted and normalised to its origin; any other path, a query or a fragment SHALL be refused. A device SHALL keep a delivered route only after the challenge at that route proves the pinned fingerprint, and SHALL record its source as `pairing`. Only a client that keeps its own store of servers persists delivered routes (the Electron app's keyring); a browser tab SHALL ignore `routes`, because the known-servers list is the dashboard operator's configuration and not the browser's.

#### Scenario: Approved poll carries routes once
- **GIVEN** a server with an active tunnel `https://k3x9p2.share.zrok.io` and an approved knock
- **WHEN** the requester polls and receives the credential
- **THEN** the same answer SHALL carry `routes` containing that URL, and a later poll SHALL NOT repeat the credential or the routes

#### Scenario: Unpaired callers learn no routes
- **WHEN** any caller posts to `/api/pair/challenge`, or polls a request that is pending or rejected
- **THEN** no route SHALL be returned

#### Scenario: Server without TLS routes delivers none
- **GIVEN** a server whose only addresses are plain `http`
- **WHEN** a request is approved
- **THEN** `routes` SHALL be empty

#### Scenario: Only https origins are delivered
- **GIVEN** the server's reachable URLs include `https://k3x9p2.share.zrok.io`, a `wss://` URL, and (in the test harness) `http://127.0.0.1:8000`
- **WHEN** a request is approved
- **THEN** `routes` SHALL contain only `https://k3x9p2.share.zrok.io`

#### Scenario: Hostile route is dropped
- **WHEN** an approved poll lists `https://10.0.0.5`, `https://user:pw@host.example`, or `https://host.example/path`
- **THEN** the device SHALL store none of them and SHALL contact none of them

#### Scenario: Delivered list is capped and the bare-slash origin is accepted
- **WHEN** an approved poll lists 9 valid https origins, the first of them written `https://k3x9p2.share.zrok.io/`
- **THEN** the device SHALL keep the first 8 in delivery order, with the first normalised to `https://k3x9p2.share.zrok.io`
- **AND** `https://host.example?a=1` and `https://host.example#x` SHALL be dropped

#### Scenario: Delivered route that proves another identity is dropped
- **WHEN** the challenge at a delivered route proves a fingerprint other than the pinned one
- **THEN** the route SHALL NOT be stored and an identity mismatch SHALL be logged

#### Scenario: Browser does not store delivered routes
- **WHEN** a browser completes a request on the `/pair?request` landing and the approved answer carries `routes`
- **THEN** the browser SHALL store the credential as before and SHALL NOT store, request or contact any delivered route

### Requirement: Pair action on a server with no credential on this device
A server entry that is not the current dashboard and for which this device holds no credential SHALL offer exactly one pair action, chosen in this order.

In a browser: when the entry has an on-link route (discovered or saved) the action SHALL be "Request access…", which SHALL be a navigation of a new browsing context with no opener reference to that route's own `/pair?request` page (`http://<host>:<port>/pair?request`, IPv6 literals bracketed, the URL built only from the route's host and port and refused when it does not round-trip to exactly them); the page SHALL send nothing and SHALL NOT prove anything first, because the request landing runs on the server's own origin and the knock is never made cross-origin. This applies equally to an entry with no advertised fingerprint; a browser SHALL NOT offer a fingerprint comparison. Otherwise, when the entry has a fingerprint, the action SHALL be "Pair with code…"; an entry with no fingerprint and no on-link route offers no pair action.

In the Electron app: when the entry has no advertised or pinned fingerprint and an on-link route that is currently discovered, the action SHALL be "Verify and request access…": the main process proves the route's identity and the full fingerprint is shown for the user to compare before any request is sent. Otherwise, when the entry has an on-link route that is currently discovered or in the keyring, the action SHALL be "Request access…": the existing main-process knock and Connecting window, which prove the route's identity (against the advertised or pinned fingerprint) before sending anything. Otherwise (only tunnel or public routes, or on-link routes the app cannot currently see) the action SHALL be "Pair with code…" when the entry has a fingerprint, and no pair action otherwise: the row shows its state text only and no trust-on-first-use pairing by pasted code is offered, because the code-refusal rule needs a fingerprint to compare against.

"Pair with code…" SHALL be offered only for an entry with a fingerprint and SHALL accept the pairing text (the deep link or the `pi:pair:v1.…` string). It SHALL refuse text whose fingerprint is not the entry's fingerprint. In a browser it SHALL then navigate a new browsing context with no opener reference to `<origin>/pair#<payload>`, where `<origin>` is the first `https` origin named by the payload itself that passes the delivered-route origin validation (https scheme, origin only, DNS host name that is not an IP literal, `localhost` or `.local`); a payload with no such origin SHALL be refused and nothing opened; the existing pairing landing on that origin proves the payload's fingerprint before redeeming, so nothing needs proving before the navigation. In the Electron app the text SHALL be pasted into the app-owned Connecting window, never into the dashboard page: the main process decodes it, refuses a payload whose fingerprint is not the entry's pinned fingerprint, proves the identity at the first of the payload's `https` URLs that proves it, redeems the code there, waits for the operator's approval, and stores the resulting credential in the keyring under the same storage rules as a knock-paired credential; routes named by the payload and delivered with the approval SHALL be recorded as stated in "Routes reach a device only with a pairing result".

Knock refusals SHALL use the existing meanings: `knock_disabled` explains the remedy, `knock_not_lan` offers "Pair with code instead", `knock_pending` and `knock_busy` as on the request landing. The neutral mobile shell is unchanged by this requirement.

#### Scenario: Unpaired LAN server offers Request access in Electron
- **GIVEN** `studio-mbp` is discovered on the local network and this device holds no credential for it
- **WHEN** the entry is shown in the Electron app
- **THEN** it SHALL offer "Request access…", and activating it SHALL start the main-process knock, which proves the route's identity before sending anything

#### Scenario: Browser opens the peer's request page without proof
- **WHEN** the user activates "Request access" on `studio-mbp` in a browser
- **THEN** a new browsing context SHALL open `http://192.168.16.77:8000/pair?request` without an opener reference
- **AND** no request SHALL be sent from the current page and no identity challenge SHALL be required first

#### Scenario: Browser offers Request access for a saved LAN route
- **GIVEN** an entry with only a saved route `http://192.168.16.77:8000` that is not currently discovered
- **WHEN** the entry is shown in a browser
- **THEN** it SHALL offer "Request access…"

#### Scenario: Browser has no fingerprint comparison
- **WHEN** a browser lists a discovered server that advertises no fingerprint
- **THEN** its action SHALL be "Request access…" navigating to that server's own request page, and no fingerprint comparison SHALL be shown

#### Scenario: Request page URL must round-trip
- **WHEN** a discovered host is advertised as `evil.example/x?`
- **THEN** no "Request access…" navigation SHALL be offered for it

#### Scenario: Tunnel-only server offers a code
- **GIVEN** `build-box` has only the route `https://b0x7.share.zrok.io`
- **WHEN** the entry is shown
- **THEN** it SHALL offer "Pair with code…" and SHALL NOT offer "Request access…"

#### Scenario: Code for another server is refused
- **WHEN** the user pastes pairing text whose fingerprint is not `build-box`'s
- **THEN** the dialog SHALL refuse it, SHALL NOT open any page and SHALL send no request

#### Scenario: Entry without a fingerprint offers no code
- **GIVEN** an entry whose only route is `https://b0x7.share.zrok.io` and which holds no fingerprint, or a saved-only route that is neither discovered nor in the keyring and holds no fingerprint
- **WHEN** the entry is shown
- **THEN** it SHALL offer no pair action and SHALL show its state text only

#### Scenario: Browser refuses a payload with no valid https origin
- **WHEN** the user pastes pairing text for `build-box` whose urls are only `wss://b0x7.share.zrok.io`, or whose https url carries userinfo, a path or an IP literal
- **THEN** the dialog SHALL refuse it, SHALL open no page and SHALL send no request

#### Scenario: Browser code navigates to the payload's own https origin
- **WHEN** the user pastes valid pairing text for `build-box` that names `https://b0x7.share.zrok.io`
- **THEN** a new browsing context SHALL open `https://b0x7.share.zrok.io/pair#<payload>` without an opener reference

#### Scenario: Electron redeems the code in the app
- **GIVEN** `build-box` has no keyring credential and only a tunnel route
- **WHEN** the user pastes valid pairing text for `build-box` into the Connecting window and the operator approves
- **THEN** the main process SHALL have proven the fingerprint at a payload `https` URL before redeeming, and the keyring SHALL hold the credential for `build-box`
- **AND** no browser window SHALL be opened and the dashboard page SHALL NOT receive the text or the credential

#### Scenario: Electron refuses a payload for another identity
- **WHEN** the pasted payload names fingerprint G and the entry's pinned fingerprint is F
- **THEN** the main process SHALL refuse it before any request is sent

#### Scenario: Electron refuses a payload whose URL proves another identity
- **WHEN** the payload names the entry's fingerprint F but the challenge at its `https` URLs proves G or nothing
- **THEN** no code SHALL be redeemed and an identity mismatch or unreachable result SHALL be shown

#### Scenario: Off-link knock offers the code
- **WHEN** a knock is refused with `knock_not_lan`
- **THEN** the dialog SHALL say requests work only on the same local network and offer "Pair with code instead"

#### Scenario: Electron server without a fingerprint requires comparison
- **WHEN** the user chooses "Verify and request access…" on `old-nas` in the Electron app
- **THEN** the proven fingerprint SHALL be shown in full and no request SHALL be sent until the user confirms they match

#### Scenario: Saved-only route does not offer a knock in Electron
- **GIVEN** a saved route that is neither discovered nor in the keyring
- **WHEN** the entry has no other route and is shown in the Electron app
- **THEN** the pair action SHALL be "Pair with code…"

### Requirement: Paired state shown in the server list
For each entry the list SHALL show whether this device is paired: the current dashboard as "This dashboard"; in the Electron app, "Paired" when the keyring holds a usable entry for the fingerprint, "Needs pairing" when the entry has lost its credential, or "Not paired" when no keyring entry exists; in a browser tab, any other origin's pairing as "Unknown in this tab", because a credential held for another origin cannot be read from this one. In the Electron app the dashboard page SHALL read this state through the app's read-only servers bridge, which SHALL return no bearer.

#### Scenario: Electron shows keyring state
- **GIVEN** the keyring holds `home-imac` and not `studio-mbp`
- **WHEN** the Electron list is shown
- **THEN** `home-imac` SHALL show "Paired" and `studio-mbp` SHALL show "Not paired"

#### Scenario: Browser cannot tell
- **WHEN** a browser tab on one dashboard lists `home-imac`
- **THEN** `home-imac` SHALL show "Unknown in this tab"

### Requirement: Route events are observable without secrets
The server and the Electron app SHALL log one line per route attached to an entry, per route refused for proving a different identity, per route proven or dropped after delivery at pairing, per probe that proved a fingerprint, and one line when `knownServers` is first written in the routes shape. Lines SHALL name the short fingerprint (`sha256:` plus the first 16 characters) and the route host and port, and SHALL NOT contain a bearer, a confirmation code, a pairing code or a pairing payload.

#### Scenario: Refused route is logged
- **WHEN** a route is refused for proving a different identity
- **THEN** one log line SHALL name the expected and proven short fingerprints and the route host and port

#### Scenario: Delivered route outcome is logged
- **WHEN** a delivered route is proven and stored, or dropped for failing validation or proof
- **THEN** one log line SHALL state the outcome with the route host and the short fingerprint, on the server or Electron side that made the decision

#### Scenario: Probe proof is logged without secrets
- **WHEN** a probe proves a fingerprint for a stored route
- **THEN** one log line SHALL name the short fingerprint and the route host and port
- **AND** no log line SHALL contain a bearer, a pairing code, a confirmation code or a pairing payload
