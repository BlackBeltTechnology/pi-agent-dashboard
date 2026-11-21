## MODIFIED Requirements

### Requirement: Pair action on a server with no credential on this device
A server entry that is not the current dashboard and for which this device holds no credential SHALL offer exactly one pair action, chosen in this order.

In a browser: when the entry has an on-link route (discovered or saved) the action SHALL be "Request access…", which SHALL be a navigation of a new browsing context with no opener reference to that route's own `/pair?request` page (`http://<host>:<port>/pair?request`, IPv6 literals bracketed, the URL built only from the route's host and port and refused when the part before any URL fragment does not round-trip to exactly them); the request line SHALL carry only that path and query, because a URL fragment is never sent to a server, and the opening page SHALL send nothing and SHALL NOT prove anything first, because the request landing runs on the server's own origin and the knock is never made cross-origin. When the entry holds a fingerprint (pinned, or advertised for that route) and this browser supports Ed25519 WebCrypto, the navigation MAY append the companion fragment `#companion=<pub>.<ts>.<sig>&from=<origin of this dashboard>` defined by `device-key-mutual-check`, signed over that fingerprint, so this dashboard can later ask the server whether this device is paired; an entry with no fingerprint, or a browser without Ed25519 support, SHALL get no companion fragment, and neither SHALL an entry whose fragment would exceed 512 characters (a long own origin), which gets the plain `/pair?request` link. The opened page keeps request mode and the new browsing context still has no opener reference. This applies equally to an entry with no advertised fingerprint; a browser SHALL NOT offer a fingerprint comparison. Otherwise, when the entry has a fingerprint, the action SHALL be "Pair with code…"; an entry with no fingerprint and no on-link route offers no pair action.

In the Electron app: when the entry has no advertised or pinned fingerprint and an on-link route that is currently discovered, the action SHALL be "Verify and request access…": the main process proves the route's identity and the full fingerprint is shown for the user to compare before any request is sent. Otherwise, when the entry has an on-link route that is currently discovered or in the keyring, the action SHALL be "Request access…": the existing main-process knock and Connecting window, which prove the route's identity (against the advertised or pinned fingerprint) before sending anything. Otherwise (only tunnel or public routes, or on-link routes the app cannot currently see) the action SHALL be "Pair with code…" when the entry has a fingerprint, and no pair action otherwise: the row shows its state text only and no trust-on-first-use pairing by pasted code is offered, because the code-refusal rule needs a fingerprint to compare against.

"Pair with code…" SHALL be offered only for an entry with a fingerprint and SHALL accept the pairing text (the deep link or the `pi:pair:v1.…` string). It SHALL refuse text whose fingerprint is not the entry's fingerprint. In a browser it SHALL then navigate a new browsing context with no opener reference to `<origin>/pair#<payload>`, where `<origin>` is the first `https` origin named by the payload itself that passes the delivered-route origin validation (https scheme, origin only, DNS host name that is not an IP literal, `localhost` or `.local`); a payload with no such origin SHALL be refused and nothing opened; the existing pairing landing on that origin proves the payload's fingerprint before redeeming, so nothing needs proving before the navigation. In the Electron app the text SHALL be pasted into the app-owned Connecting window, never into the dashboard page: the main process decodes it, refuses a payload whose fingerprint is not the entry's pinned fingerprint, proves the identity at the first of the payload's `https` URLs that proves it, redeems the code there, waits for the operator's approval, and stores the resulting credential in the keyring under the same storage rules as a knock-paired credential; routes named by the payload and delivered with the approval SHALL be recorded as stated in "Routes reach a device only with a pairing result".

Knock refusals SHALL use the existing meanings: `knock_disabled` explains the remedy, `knock_not_lan` offers "Pair with code instead", `knock_pending` and `knock_busy` as on the request landing. The neutral mobile shell is unchanged by this requirement.

#### Scenario: Unpaired LAN server offers Request access in Electron
- **GIVEN** `studio-mbp` is discovered on the local network and this device holds no credential for it
- **WHEN** the entry is shown in the Electron app
- **THEN** it SHALL offer "Request access…", and activating it SHALL start the main-process knock, which proves the route's identity before sending anything

#### Scenario: Browser opens the peer's request page without proof
- **WHEN** the user activates "Request access" on `studio-mbp` in a browser
- **THEN** a new browsing context SHALL open `http://192.168.16.77:8000/pair?request`, followed by a companion fragment only in the case stated for an entry with a fingerprint, without an opener reference
- **AND** no request SHALL be sent from the current page and no identity challenge SHALL be required first

#### Scenario: Browser appends a companion for an entry with a fingerprint
- **GIVEN** the entry for `studio-mbp` holds a pinned or advertised fingerprint F and this browser supports Ed25519 WebCrypto
- **WHEN** the user activates "Request access"
- **THEN** the opened address SHALL be `http://192.168.16.77:8000/pair?request#companion=<pub>.<ts>.<sig>&from=<this dashboard's origin>` with `sig` made over F
- **AND** the part of the address before the `#` SHALL equal `http://192.168.16.77:8000/pair?request` and the request line sent to that server SHALL contain no fragment

#### Scenario: No companion without a fingerprint or without Ed25519
- **WHEN** the entry has no pinned or advertised fingerprint, or this browser has no Ed25519 WebCrypto
- **THEN** the opened address SHALL be exactly `http://<host>:<port>/pair?request` with no fragment

#### Scenario: Browser offers Request access for a saved LAN route
- **GIVEN** an entry with only a saved route `http://192.168.16.77:8000` that is not currently discovered
- **WHEN** the entry is shown in a browser
- **THEN** it SHALL offer "Request access…"

#### Scenario: Over-long companion fragment is omitted
- **GIVEN** an entry with a fingerprint whose companion fragment, built with this dashboard's own origin, would exceed 512 characters
- **WHEN** the user activates "Request access"
- **THEN** the opened address SHALL be exactly `http://<host>:<port>/pair?request` with no fragment

#### Scenario: Browser has no fingerprint comparison
- **WHEN** a browser lists a discovered server that advertises no fingerprint
- **THEN** its action SHALL be "Request access…" navigating to that server's own request page with no companion fragment, and no fingerprint comparison SHALL be shown

#### Scenario: Request page URL must round-trip
- **WHEN** a discovered host is advertised as `evil.example/x?`
- **THEN** no "Request access…" navigation SHALL be offered for it, with or without a companion fragment

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
For each entry the list SHALL show whether this device is paired. The current dashboard SHALL read "This dashboard". Every other entry SHALL read one of the states of `device-key-mutual-check` ("Server rows show the state the device check reports"): "Paired · <tier>", "Paired · status only", "Access removed", "Access expired", "Not paired", "Paired · key pending" or "Status unknown"; the Electron app SHALL also show "Needs pairing" for an entry that has lost its credential (a keyring mark, not a server answer). In the Electron app the base state SHALL come from the keyring: a usable entry reads "Paired" (refined by the device check to "Paired · <tier>", "Access expired" or "Paired · key pending" once that check has answered), an entry that lost its credential reads "Needs pairing", and a server with no keyring entry reads "Not paired". In a browser tab, an entry other than the current dashboard SHALL read "Status unknown" unless the tab holds a companion key for that server's fingerprint and the device check answers; "Status unknown" replaces the earlier wording "Unknown in this tab" and means the same thing: a credential held for another origin cannot be read from this one. A browser tab SHALL NOT read "Not paired" for another origin. In the Electron app the dashboard page SHALL read this state through the app's read-only servers bridge, which SHALL return no bearer and no device private key.

#### Scenario: Electron shows keyring state
- **GIVEN** the keyring holds `home-imac` and not `studio-mbp`, and no device check has answered yet
- **WHEN** the Electron list is shown
- **THEN** `home-imac` SHALL show "Paired" and `studio-mbp` SHALL show "Not paired"

#### Scenario: Electron refines the keyring state with the device check
- **GIVEN** the keyring holds `home-imac` with a device key and the check answers `paired` with tier `operate`
- **WHEN** the Electron list is shown
- **THEN** `home-imac` SHALL show "Paired · Operate"

#### Scenario: Electron shows a lost credential
- **GIVEN** the keyring entry for `home-imac` has lost its credential
- **WHEN** the Electron list is shown
- **THEN** `home-imac` SHALL show "Needs pairing"

#### Scenario: Browser cannot tell
- **WHEN** a browser tab on one dashboard lists `home-imac` and holds no device key or companion for it
- **THEN** `home-imac` SHALL show "Status unknown" and SHALL NOT show "Not paired"

#### Scenario: Browser with a companion can ask
- **GIVEN** an operator ticked "Allow this status check" for this dashboard's origin when pairing a device with `home-imac`
- **WHEN** that browser tab lists `home-imac` and the device check at a proven route answers `paired` with scope `status-only`
- **THEN** `home-imac` SHALL show "Paired · status only"
