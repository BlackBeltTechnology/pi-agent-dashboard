## ADDED Requirements

### Requirement: Server pages run the server's own client in a bridge-free WebView
The Android app SHALL show a paired dashboard by loading that server's own origin in an Android `WebView`. It SHALL NOT bundle, inject or replace the web client. The server WebView SHALL have no JavaScript interface of any kind (no `addJavascriptInterface`, `addWebMessageListener`, `addDocumentStartJavaScript`, Capacitor or other hybrid bridge). File and content URL access SHALL be disabled, and mixed content SHALL never be allowed.

#### Scenario: Server client loads authenticated on its own origin
- **GIVEN** a paired `operate`-tier server reachable at `http://192.168.16.203:8123` with a valid stored bearer
- **WHEN** the user opens that server
- **THEN** the WebView SHALL load `http://192.168.16.203:8123/`
- **AND** the page's REST and WebSocket traffic SHALL be authenticated by the `pi_dash_device` cookie obtained in the bootstrap
- **AND** `GET /api/plugins/runtime-clients` SHALL be requested by the page

#### Scenario: Remote page cannot reach native code
- **WHEN** script on the server page inspects `window.androidBridge`, `window.Capacitor` and any other injected global
- **THEN** none SHALL exist, and no message the page can send SHALL reach native code

### Requirement: Cookie bootstrap exchanges the bearer natively
Before loading a server, the app SHALL `POST <origin>/api/device-session` from native code with `Authorization: Bearer <bearer>`, `Content-Type: application/json`, a body of `{}`, and redirects disabled. On `200` it SHALL copy each `Set-Cookie` into the WebView `CookieManager` for that origin and flush it before loading. The bearer SHALL never be placed in a URL, in the page, or in a log line.

#### Scenario: Successful exchange
- **WHEN** the exchange answers `200` with `Set-Cookie: pi_dash_device=…; Path=/api/; HttpOnly; SameSite=Strict`
- **THEN** the page's first request under `/api/` SHALL be served as an authenticated device request, from a network the server does not trust

#### Scenario: Exchange re-runs on every open
- **GIVEN** server A at `http://h:8000` and server B at `http://h:8001` are both paired
- **WHEN** the user opens A, then opens B
- **THEN** the exchange SHALL run for B before B is loaded, so B's cookie replaces A's for host `h`

### Requirement: The device cookie is kept only for the life of the server screen
Because the device cookie's value is the bearer, the app SHALL copy it into the WebView cookie jar as a session cookie, with `Max-Age` and `Expires` removed. It SHALL remove session cookies when the app starts and whenever the server screen closes.

#### Scenario: Closed server screen leaves no device cookie
- **GIVEN** a server screen was open for `http://192.168.16.203:8123`
- **WHEN** the screen closes, or the app process is killed and restarted
- **THEN** a WebView request to `http://192.168.16.203:8123/api/sessions`, made before any new exchange, SHALL carry no `pi_dash_device` cookie

### Requirement: The server screen requires operate access
After the exchange at open, the app SHALL probe `POST /api/ws-ticket` with the bearer before loading. A `403` with `insufficient_scope` SHALL mark the server "Needs full access — ask the operator to re-pair this device", and the page SHALL NOT be loaded; the device stays paired. Where the server exempts the bearer from tier refusal (legacy trust mode, trusted network), the probe passes and the page loads.

#### Scenario: Control-tier device
- **GIVEN** a device paired at `control` tier, on a server in `pair` trust mode
- **WHEN** the user opens the server
- **THEN** the app SHALL show "Needs full access" and SHALL NOT load the page

### Requirement: Exchange outcomes are classified
The app SHALL classify the exchange result as follows. `200` is ok. A `401` carrying the dashboard's JSON error body, or a `403` whose JSON `error` is `network_not_allowed`, is refused. Anything else is unreachable: timeouts, a `401` without a dashboard body, and other `403` errors.

#### Scenario: Other 403 is not a credential refusal
- **WHEN** the exchange answers `403` with an `error` other than `network_not_allowed`
- **THEN** it SHALL be classified unreachable and the bearer SHALL be kept

#### Scenario: Proxy authentication page
- **WHEN** a tunnel or proxy in front of the server answers `401` with an HTML page
- **THEN** it SHALL be classified unreachable and the bearer SHALL be kept

### Requirement: A refused credential offers re-pairing
On a refused exchange, the app SHALL mark the server "needs pairing", clear its bearer, cookie and push token id, unregister its push instance locally, load nothing, and offer "Pair again" and "Forget". On an unreachable result, it SHALL change nothing and load nothing.

#### Scenario: Revoked device is not shown as "server offline"
- **GIVEN** the operator revoked this device on the server
- **WHEN** the user opens the server
- **THEN** the app SHALL show "Access to this server was revoked — pair again or forget" and SHALL NOT load the page
- **AND** the app SHALL no longer show notifications from that server

#### Scenario: Server down is not treated as revocation
- **WHEN** the exchange times out or answers `502`
- **THEN** the bearer SHALL be kept and the app SHALL report the server as unreachable

### Requirement: An open server re-checks its credential
While a server screen is open, the app SHALL re-run the exchange on resume and every 5 minutes in the foreground (at most once per 5 minutes). It SHALL also re-run it when the platform reports a `401` or `403` for a request under `origin + "/api/"` (at most once per 60 seconds). A refused re-exchange SHALL stop the page and show the refused flow; an ok one SHALL change nothing.

#### Scenario: Revoked while open
- **GIVEN** an open server screen whose device is revoked on the server
- **WHEN** the screen stays in the foreground for 5 minutes, or the user leaves the app and returns more than 5 minutes after the last check
- **THEN** the page SHALL be stopped and the revoked dialog SHALL be shown

#### Scenario: Re-check is rate-limited
- **GIVEN** an open server whose `/api/*` requests answer `403` for a non-credential reason
- **WHEN** ten such responses arrive within a minute
- **THEN** at most one re-exchange SHALL run, and an ok result SHALL NOT reload the page

### Requirement: An open server's identity is re-proven
While a server screen is in the foreground, the app SHALL re-prove the pinned fingerprint at the open origin every 60 seconds and on resume. On a proven mismatch it SHALL navigate to `about:blank`, remove the device cookie and report the mismatch. When the challenge cannot complete, it SHALL keep the page loaded, mark the server "not reachable", and retry at the next trigger.

#### Scenario: Another machine takes over the address
- **GIVEN** an open server pinned to fingerprint F
- **WHEN** a re-proof at its origin proves G ≠ F
- **THEN** the page SHALL be replaced by a blank page, the cookie removed, and an identity-mismatch error shown

#### Scenario: Transient network loss
- **WHEN** a re-proof times out
- **THEN** the page SHALL stay loaded and the server SHALL be marked "not reachable" until a later re-proof succeeds

### Requirement: Navigation is confined to the server origin
In the server WebView, a main-frame navigation, including a redirect, SHALL be allowed only when its canonical origin equals the server origin. Canonical means lowercase scheme and host, one trailing host dot stripped, default port elided, IPv6 bracketed. Any other `http`/`https` target SHALL open in a Custom Tab, `mailto:` SHALL open via the system intent, and every other scheme SHALL be dropped. New-window requests SHALL be denied.

#### Scenario: External link leaves the WebView
- **WHEN** the page navigates the main frame to `https://github.com/x`
- **THEN** the WebView SHALL NOT navigate, and the URL SHALL open in a Custom Tab

#### Scenario: Off-origin redirect is cancelled
- **WHEN** a same-origin request answers with a redirect to `http://203.0.113.9/`
- **THEN** the WebView SHALL NOT follow it, and the target SHALL be handled as an external link

#### Scenario: Unknown scheme is dropped
- **WHEN** the page navigates to `intent://…` or `file:///…`
- **THEN** nothing SHALL open

#### Scenario: Canonical origin match
- **GIVEN** server origin `https://Host.Example:443`
- **WHEN** the page navigates to `https://host.example./x`
- **THEN** the navigation SHALL be allowed

### Requirement: Deep-link paths are confined to the server
A path used to open a server at a specific page (from a notification or the app) SHALL be accepted only when it is `/` or `/session/<id>`, where `<id>` is 1 to 128 characters from `A-Z a-z 0-9 _ -`. Any other value SHALL be replaced by `/`.

#### Scenario: Absolute URL in a payload
- **WHEN** a notification carries `url: "//evil.example/x"` or `url: "https://evil.example/"`
- **THEN** tapping it SHALL open the sending server at `/`

#### Scenario: API path in a payload
- **WHEN** a notification carries `url: "/api/restart"`
- **THEN** tapping it SHALL open the sending server at `/`

### Requirement: Opening another server switches the screen
When a server is opened, from the list or from a notification, while another server's screen is shown, the app SHALL close the current screen, removing its session cookies, before running the new server's open sequence.

#### Scenario: Notification for B while A is open
- **GIVEN** server A's screen is shown
- **WHEN** a notification from server B is tapped
- **THEN** A's screen SHALL close and B SHALL be opened after B's cookie bootstrap

### Requirement: Outdated system WebView is reported before loading
Before loading any server, the app SHALL read the system WebView's major version. Below 113 (the lowest measured working version), it SHALL show a blocking "Update Android System WebView" screen with a link to the store listing and a "Continue anyway" option.

#### Scenario: Old WebView
- **GIVEN** the system WebView major version is 99
- **WHEN** the user opens a server
- **THEN** the update screen SHALL be shown before any page loads

### Requirement: Server pages get no device permissions
WebView permission requests (camera, microphone, protected media, MIDI) and geolocation prompts from the server page SHALL be denied.

#### Scenario: Camera request denied
- **WHEN** the page requests camera or microphone access
- **THEN** the request SHALL be denied

### Requirement: File picking and downloads are handled natively
File chooser requests from the server page SHALL use the system document picker. Downloads SHALL be fetched by the app itself and saved through the system document picker. The bearer SHALL be attached only when the download URL's canonical origin equals the server origin. No credential SHALL be handed to the system download manager.

#### Scenario: Cross-origin download gets no cookie
- **WHEN** the page starts a download from `https://other.example/file.zip`
- **THEN** the download request SHALL NOT carry the server's credential

#### Scenario: Same host, other port gets no cookie
- **GIVEN** server origin `http://192.168.16.203:8123`
- **WHEN** a download starts from `http://192.168.16.203:9000/f`
- **THEN** the download request SHALL NOT carry the server's credential

### Requirement: App-initiated cleartext only to private-network IP literals
Cleartext SHALL be permitted at base level, because the platform does not support address ranges; a native policy SHALL gate the app's own connections. An `http` route SHALL be accepted only when its normalised host is an IP literal in loopback, RFC 1918, link-local (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`) or unique-local (`fc00::/7`). Hostnames SHALL require `https`. Traffic started by the server page is not governed.

#### Scenario: LAN http server allowed
- **WHEN** the user adds `http://192.168.16.203:8123`
- **THEN** the challenge, knock and exchange SHALL proceed over http

#### Scenario: Public http server refused
- **WHEN** the user adds `http://203.0.113.9:8000`
- **THEN** no request SHALL be sent, and the app SHALL say "Use https or a tunnel for servers outside your network"

#### Scenario: Hostname over http refused
- **WHEN** the user adds `http://myhost.local:8000`
- **THEN** no request SHALL be sent, and the app SHALL ask for https or the server's IP address

### Requirement: Unencrypted servers are labelled
A server whose selected route is `http` SHALL carry an "Unencrypted connection" badge in the server list and on the server screen.

#### Scenario: LAN http server shows the badge
- **WHEN** a server is opened over `http://192.168.16.203:8123`
- **THEN** the server screen SHALL show "Unencrypted connection"

### Requirement: Native LAN discovery
The app SHALL browse `_pi-dashboard._tcp` while the server list is visible, and for up to 2 seconds while selecting a route to open a server. Each result SHALL show its advertised name, address and short fingerprint. A result whose advertised fingerprint equals a stored pin SHALL be shown as that paired server. "Add by address" and "Scan pairing QR" SHALL always be available.

#### Scenario: Server on the same Wi-Fi appears
- **GIVEN** a dashboard advertising on the phone's Wi-Fi network, and multicast delivered between them
- **WHEN** the user opens the server list
- **THEN** the server SHALL appear within 5 seconds with its advertised name

#### Scenario: Discovery finds nothing
- **WHEN** no advert is received
- **THEN** the list SHALL offer "Add by address" and "Scan pairing QR"

### Requirement: Identity is proven before any pairing request or credential use
Before knocking, redeeming, exchanging a bearer or loading a page, the app SHALL complete `POST /api/pair/challenge` at the target, with a 2-second bound, and verify the Ed25519 signature over its own fresh nonce. The proven fingerprint SHALL equal the expected one: the stored pin, or else the payload or advertised fingerprint. If a pin disagrees with an advert or a payload, the app SHALL refuse before sending any request.

#### Scenario: Impostor at a discovered address
- **GIVEN** an advert with fingerprint F at `192.168.16.204:8000`
- **WHEN** the challenge there proves G ≠ F
- **THEN** the app SHALL NOT knock and SHALL show an identity-mismatch error

#### Scenario: Pinned server answers with another identity
- **GIVEN** a stored pin F
- **WHEN** every candidate route proves a fingerprint other than F
- **THEN** the app SHALL load nothing and SHALL send no bearer

#### Scenario: Pairing payload for another identity
- **GIVEN** a stored pin F for a server
- **WHEN** the user scans a pairing payload whose `id` is G ≠ F for that server
- **THEN** the app SHALL refuse without sending any request

### Requirement: Route selection proves the pin within bounds
To open a server, the app SHALL challenge its stored routes plus at most 3 currently discovered addresses advertising the pin. At most 6 challenges SHALL be in flight; each SHALL be bounded at 2 seconds and the whole selection at 5 seconds. The most preferred route that proves the pin SHALL win: stored `https`, then stored `http`, then discovered.

#### Scenario: Tunnel preferred over LAN
- **GIVEN** stored routes `https://k3x9.share.zrok.io` and `http://192.168.16.203:8123`, both proving the pin
- **WHEN** the user opens the server
- **THEN** the `https` route SHALL be loaded

#### Scenario: No route proves the pin
- **WHEN** no candidate proves the pin within 5 seconds
- **THEN** the app SHALL load nothing and report the server unreachable

### Requirement: An unknown identity is trusted only on user confirmation
With no pin and no advertised fingerprint (a typed address, or an advert without `fp`), the app SHALL show the proven fingerprint and proceed only after the user confirms. It SHALL pin that fingerprint only when pairing is approved.

#### Scenario: Manual address
- **GIVEN** no pin and no advert for `http://10.0.0.5:8000`
- **WHEN** the challenge proves fingerprint H
- **THEN** the app SHALL show H and SHALL NOT knock until the user confirms

#### Scenario: Discovered without fingerprint
- **GIVEN** an advert for `192.168.16.210:8000` without `fp`
- **WHEN** the user taps it
- **THEN** the app SHALL follow the same confirm-before-knock flow as a typed address

### Requirement: Delivered routes are validated before contact
Routes delivered with an approval SHALL be validated before any request to them: `https` scheme, origin only, a DNS host name that is not an IP literal, `localhost` or `.local`, and a host of at most 253 characters. The first 8 valid routes SHALL be kept. A kept route SHALL be stored, with source `pairing`, only after a challenge at it proves the pin.

#### Scenario: Hostile route is not contacted
- **WHEN** an approval delivers `https://10.0.0.5` and `https://user@x.example/path`
- **THEN** neither SHALL be stored and no request SHALL be sent to either

#### Scenario: Delivered route proves another identity
- **GIVEN** an approval delivered `https://x.share.zrok.io` for pin F
- **WHEN** the challenge there proves G ≠ F
- **THEN** the route SHALL NOT be stored

### Requirement: Knock pairing reuses the LAN request flow
The app SHALL pair by knock through `/api/pair/challenge`, `/api/pair/request` and `/api/pair/poll`. It SHALL compare the knock response's `fingerprint` with the proven one before polling, aborting on a mismatch. It SHALL poll every 2 seconds until `approved`, `rejected` or `unknown` (shown as expired). Knock refusals SHALL be shown as user guidance.

#### Scenario: Knock pairing from discovery
- **WHEN** the user taps an unpaired discovered server and confirms "Send request"
- **THEN** the app SHALL knock, show the confirm code, poll until a terminal state, and on approval store the bearer and pin

#### Scenario: LAN requests switched off
- **WHEN** the knock answers `knock_disabled`
- **THEN** the app SHALL say "Ask the operator to turn on LAN requests, or scan the pairing QR"

#### Scenario: Off-link network
- **WHEN** the knock answers `knock_not_lan`
- **THEN** the app SHALL say "Pair from the same network, or scan the pairing QR"

### Requirement: The knock is confirmed before it is sent
Before sending a knock, the app SHALL show the server label, the short fingerprint and an editable device name. For an `http` target it SHALL also state that the request and the resulting access travel unencrypted.

#### Scenario: Plain-http target is disclosed
- **WHEN** the user is about to knock `http://192.168.16.203:8123`
- **THEN** the confirm screen SHALL state that the request and the resulting access travel unencrypted

### Requirement: A pending pairing survives the app and stores the bearer once
Before showing a confirm code, the app SHALL persist the pending request (id, expiry, fingerprint, route) and SHALL resume polling after a relaunch until expiry. On `approved` it SHALL write the keyring entry with the encrypted bearer before showing success. "Stop waiting" SHALL discard the pending request, store nothing, and say the request stays visible to the operator until it expires.

#### Scenario: App killed while waiting
- **GIVEN** a knock is pending and the app process is killed
- **WHEN** the app is relaunched before the request expires and the operator approves
- **THEN** the app SHALL resume polling and store the bearer

#### Scenario: Stop waiting
- **WHEN** the user chooses "Stop waiting" during a pending pairing
- **THEN** no keyring entry SHALL be created and polling SHALL stop

#### Scenario: Approved but not saved
- **WHEN** the keyring write fails after an `approved` poll
- **THEN** the app SHALL ask the user to have the operator remove the device and pair again

### Requirement: QR pairing reuses the pairing-payload flow
The app SHALL pair from a scanned or pasted payload in the forms the neutral shell accepts. It SHALL prove `id` at a `urls` entry, redeem `code` at that same proven URL, show the 8-digit confirm code, poll every 2 seconds, and store the bearer on approval. A payload missing `id`, `code` or `urls` SHALL be rejected without contacting any server.

#### Scenario: QR payload pairing
- **WHEN** the user scans a dashboard pairing QR encoding `https://…/pair#<payload>`
- **THEN** the app SHALL prove `id`, redeem `code` at the proven URL, show the confirm code, and store the bearer on approval

#### Scenario: Malformed payload
- **WHEN** the scanned text decodes to an object missing `id`, `code` or `urls`
- **THEN** the app SHALL show "malformed pairing payload" and contact no server

### Requirement: Keyring stores the bearer encrypted
The app SHALL keep one keyring entry per server fingerprint: pin, label, verified routes with their source (`saved`, `mdns` or `pairing`), encrypted bearer, last-opened time, optional push token ids, and needs-pairing flag. The bearer SHALL be encrypted with a key held in the Android Keystore.

#### Scenario: Bearer not stored in plaintext
- **WHEN** the keyring file is read raw after pairing
- **THEN** the bearer SHALL NOT appear in it

### Requirement: Keyring and WebView data are excluded from backup
The keyring and the WebView data directory SHALL be excluded from cloud backup and from device-to-device transfer.

#### Scenario: Cloud backup
- **WHEN** the system performs a cloud backup of the app
- **THEN** neither the keyring file nor WebView data SHALL be included

### Requirement: Unreadable credentials degrade to needs-pairing
A bearer that cannot be decrypted SHALL be discarded and its entry marked "needs pairing", keeping pin, label and routes. An unreadable keyring file SHALL be set aside under a `corrupt-<timestamp>` name, and the app SHALL start with an empty keyring.

#### Scenario: Keystore key lost
- **GIVEN** the Keystore key was invalidated
- **WHEN** the app starts
- **THEN** affected servers SHALL show "needs pairing", with pins and labels intact

### Requirement: Forgetting a server removes local state
"Forget" SHALL, while the bearer is still usable:
- delete the server's push token;
- call `DELETE /api/device-session` (both best-effort);
- then remove session cookies and the origin's web storage and cache;
- unregister the push instance;
- remove the keyring entry.

Forgetting SHALL NOT revoke the device on the server.

#### Scenario: Forget then rediscover
- **WHEN** the user forgets a paired server and it is still advertising
- **THEN** it SHALL reappear as an unpaired discovered server, with no cookie or web storage left for its origin

### Requirement: Push registration through UnifiedPush per server
When the user enables notifications for a server, the app SHALL request the OS notification permission where required. It SHALL register a UnifiedPush instance named by the server fingerprint, then register the endpoint and key set via `POST /api/push/register` as a `web-push` subscription with the bearer. It SHALL store the token id and confirm delivery with `POST /api/push/test`. FCM and vendor secrets SHALL NOT be used.

#### Scenario: Enable notifications
- **GIVEN** a paired `operate` server with `push.webPush.contactEmail` set, and a UnifiedPush distributor with an https endpoint
- **WHEN** the user enables notifications for it
- **THEN** the server SHALL list one new `web-push` token for this phone

#### Scenario: Server cannot deliver
- **GIVEN** a server with push enabled but no web-push contact email configured
- **WHEN** registration answers `200` and the follow-up test delivery reports `ok: false` for the new token
- **THEN** the toggle SHALL stay off with "The server cannot deliver notifications — check its push settings"

#### Scenario: Push disabled on the server
- **WHEN** registration answers `404`
- **THEN** the toggle SHALL turn off with "Notifications are not enabled on this server"

#### Scenario: Distributor endpoint not accepted
- **WHEN** registration answers `400`
- **THEN** the toggle SHALL turn off and show the server's error text

#### Scenario: No distributor installed
- **WHEN** the user enables notifications and no distributor is available
- **THEN** the app SHALL explain that a UnifiedPush distributor (e.g. ntfy) is required, and SHALL register nothing

#### Scenario: Endpoint rotates
- **WHEN** the distributor issues a new endpoint for an instance
- **THEN** the app SHALL register the new endpoint first and delete the old token id only after that succeeds

#### Scenario: Endpoint rotates while the server list is full
- **WHEN** registering the new endpoint answers `409`
- **THEN** the app SHALL delete the old token id and retry the registration once

### Requirement: Only authentic push messages are shown
A push message that fails decryption, or does not parse as a session-attention payload, SHALL be dropped before any server mapping or notification.

#### Scenario: Forged message to the endpoint
- **WHEN** a third party posts an unencrypted body to the distributor endpoint
- **THEN** no notification SHALL be shown

### Requirement: A notification opens the server that sent it
A message received for an instance SHALL be shown as a notification. Tapping it SHALL open that instance's server at the message's `url`, after it passes the deep-link path rule, following the normal open sequence.

#### Scenario: Tap opens the right server and session
- **GIVEN** servers A and B both have notifications enabled
- **WHEN** a notification from B's instance with `url: "/session/abc"` is tapped
- **THEN** the app SHALL open B and load `<B origin>/session/abc` after the cookie bootstrap

### Requirement: Launch reopens the last server
On launch, the app SHALL reopen the most recently used server when it is paired, not marked needs-pairing, and a route proves its pin within 5 seconds. Otherwise it SHALL show the server list.

#### Scenario: Fresh install
- **WHEN** the app starts with an empty keyring
- **THEN** the server list SHALL show discovery results, "Add by address" and "Scan pairing QR"

#### Scenario: Last server unreachable
- **GIVEN** the last-used server is offline
- **WHEN** the app starts
- **THEN** the server list SHALL be shown, with that server marked unreachable

### Requirement: Host events are observable without secrets
The app SHALL log discovery, challenge, knock, redeem, poll, exchange, re-proof, navigation-drop, cleartext-refusal and push-registration outcomes with the short fingerprint (`sha256:` plus its first 16 characters), host and outcome only. It SHALL never log a bearer, pairing code, confirm code, cookie value or push endpoint.

#### Scenario: Exchange refused is logged without the bearer
- **WHEN** an exchange is classified refused
- **THEN** the log line SHALL contain the short fingerprint, host and `refused`, and SHALL NOT contain the bearer

### Requirement: Signed APK on final releases
Every final `vX.Y.Z` release SHALL build an APK and AAB signed with the project upload key after the GitHub Release exists, and SHALL upload the APK to that release. The AAB SHALL be kept as a workflow artifact. The release job SHALL NOT depend on the Android job. `versionName` SHALL be `X.Y.Z`, and `versionCode` SHALL be `X*1000000 + Y*1000 + Z`; the build SHALL fail when `Y` or `Z` is 1000 or more.

#### Scenario: Release attaches the APK
- **WHEN** tag `v0.11.0` is pushed
- **THEN** the release SHALL carry `pi-dashboard-0.11.0.apk` signed with the upload key

#### Scenario: Missing signing secret isolates the failure
- **WHEN** the keystore secret is absent
- **THEN** the Android job SHALL fail with a message naming the secret, and the GitHub Release SHALL still be published

#### Scenario: Prerelease tag
- **WHEN** tag `v0.11.0-rc.1` is pushed
- **THEN** no Android job SHALL run

#### Scenario: Upgrade installs in place
- **GIVEN** `0.10.0` is installed from a release APK
- **WHEN** the user installs the `0.11.0` APK
- **THEN** Android SHALL upgrade in place, keeping the keyring

### Requirement: Android sources are built and tested in CI
Pull requests touching `packages/android/**` SHALL run the JVM unit tests and a debug build without secrets. The pure policy units SHALL have unit tests: payload decoding, expected identity, cleartext policy, navigation decision, deep-link path, exchange classification, keyring model, route selection, version code, log redaction.

#### Scenario: Policy regression fails CI
- **WHEN** a change makes the cleartext policy admit a public address
- **THEN** the Android unit tests SHALL fail the pull request
