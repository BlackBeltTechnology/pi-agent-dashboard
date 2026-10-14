## Purpose

Lets the Electron app pair with other dashboards on the network from its main process and open each paired dashboard in its own window, on that dashboard's own origin, so the remote dashboard's own client runs against its own server with same-origin device auth while the local dashboard keeps running.

## ADDED Requirements

### Requirement: Main-process discovery of other dashboards
The Electron main process SHALL start browsing the local network for dashboard adverts when the app is ready and SHALL keep browsing until the app quits, maintaining a list of discovered servers, each with its display name, advertised fingerprint (when present), host, port and whether a paired keyring entry exists for that fingerprint. The list SHALL exclude adverts discovery marks as local to this machine (the dashboard this app runs). An advert from another machine that carries the local dashboard's fingerprint SHALL still be listed, labelled "same identity as this dashboard". Wherever a fingerprint is shown or logged in short form, the short form SHALL be `sha256:` followed by the first 16 characters of the fingerprint's base64url part. The list SHALL be readable only by the app's trusted windows (see "Server window requests are validated in the main process"); a request from any other frame SHALL be refused and SHALL return no data. A server that advertises no fingerprint SHALL be listed as "identity not advertised" and SHALL be connectable only through the trust-on-first-use path used for a manually entered URL. An advertised display name is untrusted text: wherever the app renders it (lists, menus, window titles, the connecting window) Unicode control and format characters SHALL be removed and the result truncated to at most 64 bytes of UTF-8 on a character boundary; an empty result SHALL fall back to the host.

#### Scenario: Discovered server appears in the list
- **GIVEN** a dashboard named `home-imac` advertises fingerprint F at `192.168.16.204:8000`
- **WHEN** a trusted window requests the discovered servers
- **THEN** the list SHALL contain an entry with name `home-imac`, fingerprint F, host `192.168.16.204`, port `8000` and paired state "not paired"

#### Scenario: Own dashboard is not listed
- **WHEN** the local dashboard's own advert is discovered
- **THEN** it SHALL NOT appear in the discovered list

#### Scenario: Server window cannot read the list
- **WHEN** a frame showing a remote dashboard origin requests the discovered servers
- **THEN** the request SHALL be refused and no server data SHALL be returned

#### Scenario: Bidi override in an advertised name is stripped
- **WHEN** a server advertises a name containing U+202E
- **THEN** no rendered label, menu item or window title SHALL contain U+202E

### Requirement: Identity is verified before any pairing request or credential use
Before knocking a server, and before sending a stored credential to it, the main process SHALL challenge the target address for its identity and SHALL compare the proven fingerprint with the expected one. The expected fingerprint SHALL be the keyring pin when a keyring entry exists, else the fingerprint advertised in discovery; when both exist they SHALL be equal, otherwise the target SHALL be refused as an identity mismatch. When neither exists (manual URL, or an advert without a fingerprint), the full proven fingerprint SHALL be shown to the user in the connecting window with a prompt to compare it with the fingerprint shown on that dashboard, the request SHALL be sent only after the user confirms, and the fingerprint SHALL be pinned only when pairing is approved (trust on first use). On mismatch the main process SHALL NOT knock, SHALL NOT send any credential, SHALL NOT replace the pin, and SHALL report an identity mismatch naming the server's label and both short fingerprints. The knock response fingerprint SHALL equal the proven fingerprint before a bearer is stored. A target that cannot answer the identity challenge (unreachable, or a dashboard too old to have one) SHALL be reported as "cannot verify this dashboard's identity", distinct from a mismatch, and SHALL NOT be knocked.

#### Scenario: Impostor at a discovered address is not knocked
- **GIVEN** discovery advertised fingerprint F for `192.168.16.204:8000`
- **WHEN** the challenge at that address proves fingerprint G ≠ F
- **THEN** no pairing request SHALL be sent and the connecting window SHALL show an identity-mismatch error

#### Scenario: Pinned server answers with a different identity
- **GIVEN** a keyring entry pinned to fingerprint F
- **WHEN** the user opens that server and the address proves fingerprint G ≠ F
- **THEN** no credential SHALL be sent, no window SHALL load the address, and the pin SHALL remain F

#### Scenario: Manual URL pins on approval after user confirmation
- **GIVEN** no keyring entry and no advert for `http://10.0.0.5:8000`
- **WHEN** the user connects and the challenge proves fingerprint H
- **THEN** the connecting window SHALL show the short form of H and SHALL NOT send the request until the user chooses "Send request"
- **AND** WHEN the user sends it and the operator approves, the keyring entry SHALL be created pinned to H

#### Scenario: Dashboard without an identity challenge
- **WHEN** the challenge at the target answers with a non-success status or does not answer
- **THEN** the connecting window SHALL say the dashboard's identity cannot be verified (it may be unreachable or too old) and no pairing request SHALL be sent

### Requirement: Main-process LAN knock pairing
Connecting to a server that has no usable keyring credential SHALL run the LAN knock pairing flow from the main process and SHALL show its progress in an app-owned "Connecting to ‹name›" window that loads only bundled content. Before the request is sent, the window SHALL show the target's label, address and short proven fingerprint and an editable "Device name" field prefilled with the computer's name; the request SHALL be sent only when the user chooses "Send request", carrying the field's value as the requester name (empty ⇒ no name). While waiting, the window SHALL show the 8-digit confirmation code grouped as two blocks of 4 digits, the instruction to type it on the dashboard machine, the time left until expiry, and, for an `http:` target, that the request and resulting access travel unencrypted on this network. A "Stop waiting" action SHALL stop polling locally and SHALL state that the request stays visible on that dashboard until it expires. On approval the bearer SHALL be stored in the keyring and the server window SHALL open. Knock pairing works only for a dashboard on the same local network segment (the knock admission gates). A rejected, expired or refused request SHALL show a plain-language reason (the same refusal-code meanings as the browser request landing, including the remedy for `knock_disabled`, `knock_not_lan`, `knock_pending` and `knock_busy`) and SHALL store nothing. The confirmation code and the bearer SHALL never reach any renderer other than the connecting window (the code only) and SHALL never be logged.

#### Scenario: Successful pairing opens the server window
- **GIVEN** `home-imac` accepts LAN requests
- **WHEN** the user chooses Connect on `home-imac`, chooses "Send request", and the operator types the shown code on `home-imac`
- **THEN** the connecting window SHALL show the code as `4821 7730` while waiting
- **AND** after approval a keyring entry for `home-imac` SHALL exist and its server window SHALL open

#### Scenario: Disabled server explains the remedy
- **WHEN** the knock is refused with `knock_disabled`
- **THEN** the connecting window SHALL say the dashboard is not accepting requests from this network and that its owner can enable this in Gateway
- **AND** no keyring entry SHALL be created

#### Scenario: Stopping the wait stores nothing
- **WHEN** the user chooses "Stop waiting" before the operator decides
- **THEN** polling SHALL stop, no keyring entry SHALL be created, and the window SHALL say the request remains on that dashboard until it expires

#### Scenario: Off-link dashboard explains the limit
- **WHEN** the knock is refused with `knock_not_lan` (for example a dashboard reached through a tunnel or VPN)
- **THEN** the connecting window SHALL say requests are accepted only from the same local network and SHALL store nothing

#### Scenario: User clears the device name
- **WHEN** the user empties the "Device name" field and sends the request
- **THEN** the request SHALL carry no requester name

### Requirement: Server keyring
The app SHALL persist paired servers in a keyring file in the shell's managed directory (the directory holding the shell's dashboard settings file), keyed by server fingerprint. Each entry SHALL hold a display label, the pinned public key and fingerprint, the last known hosts (most recent first, capped) and the bearer. The bearer SHALL be stored only in encrypted form using the operating system's credential encryption; on POSIX systems the file SHALL be created with owner-only permissions and an existing file with broader permissions SHALL be tightened on load; on Windows it SHALL live in the user's profile directory, whose access list limits it to that user. When operating-system encryption is unavailable, the bearer SHALL be kept in memory for the current app run only, the entry SHALL be marked "not remembered", the server's window storage SHALL NOT persist to disk, and the user SHALL be told the server must be paired again after restart. A stored bearer that can no longer be decrypted SHALL be discarded and its entry marked "needs pairing" (pin, label and hosts kept). An unreadable or malformed keyring file SHALL NOT crash the app: it SHALL be set aside under a distinct name, the keyring SHALL start empty, and the event SHALL be logged. Each known host SHALL record its scheme. A host learned from discovery (always `http`) for a pinned fingerprint SHALL be added to that entry's last known hosts only after the identity challenge at that host proves the pinned fingerprint, and SHALL never replace or precede an `https` host of that entry. No renderer SHALL ever receive a bearer.

#### Scenario: Bearer is not stored in clear text
- **GIVEN** operating-system encryption is available
- **WHEN** a server is paired
- **THEN** the keyring file SHALL NOT contain the bearer in clear text
- **AND** on POSIX systems the file mode SHALL be `0600`

#### Scenario: Encryption unavailable keeps the bearer off disk
- **GIVEN** operating-system encryption is unavailable
- **WHEN** a server is paired and its window is opened
- **THEN** neither the keyring file nor the window's cookie or storage SHALL write the bearer to disk, the entry SHALL be marked "not remembered", and the server window SHALL still open for this run

#### Scenario: Undecryptable bearer
- **WHEN** the stored bearer for `home-imac` cannot be decrypted
- **THEN** the entry SHALL keep its pin and be shown "needs pairing", and opening it SHALL offer "Pair again"

#### Scenario: Corrupt keyring is set aside
- **WHEN** the app starts with a keyring file that is not valid
- **THEN** the app SHALL start with an empty keyring, keep the bad file under a distinct name, and log the event

#### Scenario: Moved server heals its address
- **GIVEN** an entry pinned to F with last host `192.168.16.204`
- **WHEN** discovery advertises F at `192.168.16.77` and the challenge there proves F
- **THEN** `192.168.16.77` SHALL become the entry's most recent host

### Requirement: One window per paired server on its own origin
Opening a paired server SHALL focus its existing window when one is open (restoring it if minimized); otherwise it SHALL create a window bound to a storage partition derived from the server's fingerprint (persistent unless the entry is "not remembered"), so each server's cookies and storage are isolated from the local dashboard and from every other server. Before loading, the main process SHALL pick a host from the entry's last known hosts and current discovery whose identity challenge proves the pinned fingerprint, SHALL exchange the bearer for the device cookie inside that partition, and SHALL then load the server's own origin (IPv6 literals bracketed). The window SHALL have no preload script, no Node integration, context isolation and the renderer sandbox enabled. Any top-level navigation, including a redirect of a top-level navigation, whose origin differs from the server's origin SHALL be cancelled; new-window requests SHALL be denied. A cancelled or denied URL SHALL be opened in the system browser only when its scheme is `http`, `https` or `mailto`, and SHALL otherwise be dropped. The window title SHALL be the server's label followed by the page title, the page title sanitised like an advertised name. Window size and position SHALL be remembered per server, outside the keyring. The device cookie authenticates only the server's `/api/` routes, so features served outside `/api/` (live previews, the editor) are available in a server window only where that server's own network rules admit this machine. While a server window is open, the main process SHALL re-verify the identity at its host every 60 seconds, when the window regains focus at least 60 seconds after the last verification, and when the system resumes from sleep. On a proven mismatch it SHALL navigate the window to a blank page, remove the partition's device cookie, and report the mismatch; when the challenge cannot be completed (transport failure) it SHALL leave the window loaded, show "not reachable" in the window title, and retry at the next trigger. Opening (or the open request for) a server that has no usable credential SHALL start the pairing flow instead of loading. Host selection SHALL challenge all candidates concurrently, SHALL prefer stored `https` hosts, then stored `http` hosts, then discovered hosts, and SHALL finish within 5 seconds. A device-cookie exchange that fails for any reason other than a refusal (see "Revoked or expired credentials offer re-pairing") SHALL load nothing, change nothing, and tell the user the server is unreachable.

#### Scenario: Opening a paired server loads its origin authenticated
- **GIVEN** a keyring entry for `home-imac` reachable at `192.168.16.204:8000`
- **WHEN** the user opens `home-imac`
- **THEN** a window titled with `home-imac` SHALL load `http://192.168.16.204:8000/` with the device cookie already set in its partition
- **AND** the dashboard shown SHALL be `home-imac`'s own client, authenticated as the paired device

#### Scenario: Second open focuses the existing window
- **GIVEN** the `home-imac` window is open
- **WHEN** the user opens `home-imac` again
- **THEN** the existing window SHALL be focused and no second window SHALL be created

#### Scenario: Partitions are isolated
- **WHEN** the `home-imac` window and the local dashboard window are both open
- **THEN** cookies and storage set in one SHALL NOT be visible to the other

#### Scenario: Server window has no privileged bridge
- **WHEN** script in a server window inspects its global scope
- **THEN** no app-provided bridge object SHALL be present and any app IPC channel SHALL be unreachable

#### Scenario: Off-origin navigation goes to the system browser
- **WHEN** a link in the `home-imac` window targets `https://example.com`
- **THEN** the window SHALL stay on `home-imac` and the link SHALL open in the system browser

#### Scenario: Off-origin redirect is cancelled
- **WHEN** a top-level navigation in the `home-imac` window to a same-origin URL is redirected to `http://evil.test/`
- **THEN** the window SHALL NOT load `http://evil.test/`

#### Scenario: Dangerous scheme is dropped
- **WHEN** script in the `home-imac` window calls `window.open("file:///Applications/Calculator.app")`
- **THEN** no window SHALL open and the system browser SHALL NOT be invoked

#### Scenario: No host proves the identity
- **WHEN** no known or discovered host for the entry proves the pinned fingerprint
- **THEN** no window SHALL load, no credential SHALL be sent, and the user SHALL be told the server is unreachable or answered with a different identity

#### Scenario: Closing a server window closes only that window
- **WHEN** the user closes the `home-imac` window
- **THEN** that window SHALL be destroyed (not hidden to the tray), its bounds SHALL be remembered, and the local dashboard window and server SHALL be unaffected

#### Scenario: Address taken over while the window is open
- **GIVEN** the `home-imac` window is open and was verified more than 60 seconds ago
- **WHEN** the next re-verification proves a fingerprint other than `home-imac`'s pin at its host
- **THEN** the window SHALL be navigated to a blank page, the partition's device cookie SHALL be removed, and the identity mismatch SHALL be reported

#### Scenario: Server briefly unreachable while the window is open
- **WHEN** a re-verification cannot reach `home-imac`
- **THEN** the window SHALL stay loaded and its title SHALL say "not reachable" until a later re-verification succeeds

### Requirement: Revoked or expired credentials offer re-pairing
The device-cookie exchange is the authority on whether this app's credential is still accepted: it SHALL be treated as refused when it answers `401`, or `403` with `error: "network_not_allowed"`. A refused exchange before load SHALL mark the entry "needs pairing" without loading the window. When an open server window receives a `401` or `403` from that server's `/api/` routes, the main process SHALL NOT discard anything on that signal alone; it SHALL re-run the device-cookie exchange, at most once per 5 minutes per window, and SHALL mark the entry "needs pairing" only when that exchange is refused. A successful re-check SHALL change nothing (no reload). Marking an entry "needs pairing" SHALL discard the stored bearer and the partition's device cookie and SHALL offer the user, once, to pair again (running the knock flow) or to forget the server. A server that admits the requester's network without a credential does not reveal a revoked credential to an open window; detection then happens at the next open.

#### Scenario: Operator revoked the device
- **GIVEN** the operator of `home-imac` revoked this app's device
- **WHEN** the user opens `home-imac`
- **THEN** the cookie exchange SHALL be refused (`401`, or `403 network_not_allowed`), the entry SHALL show "needs pairing", and the user SHALL be offered "Pair again" and "Forget"

#### Scenario: Revocation while the window is open
- **WHEN** an open `home-imac` window receives a `403` from `home-imac`'s `/api/` and the re-run exchange answers `403 network_not_allowed`
- **THEN** the entry SHALL be marked "needs pairing" and the re-pair offer SHALL be shown once

#### Scenario: Tier refusal does not unpair
- **GIVEN** this app's device has tier `observe` on `home-imac`
- **WHEN** the `home-imac` window receives `403 insufficient_scope` from an operate-tier route and the re-run exchange succeeds
- **THEN** the bearer and cookie SHALL be kept, the entry SHALL stay "Paired", and the window SHALL NOT reload

#### Scenario: Re-check is rate-limited
- **WHEN** the `home-imac` window receives ten `401` responses within one minute
- **THEN** at most one device-cookie exchange SHALL be run for them

### Requirement: Servers menu
The app menu and the tray menu SHALL each carry a "Servers" submenu listing every keyring entry by sanitised label with its state in words when not "Paired" (for example "home-imac — needs pairing"), followed by "Connect to another dashboard…" which opens the remote-connect window. Choosing an entry SHALL open (or focus) its server window, or start pairing when it needs pairing. The submenu SHALL be rebuilt when the keyring changes.

#### Scenario: Paired server in the menu
- **GIVEN** a keyring entry `home-imac`
- **WHEN** the user opens the app menu's Servers submenu and chooses `home-imac`
- **THEN** the `home-imac` server window SHALL open or be focused

#### Scenario: Menu follows the keyring
- **WHEN** the user forgets `home-imac`
- **THEN** `home-imac` SHALL no longer appear in either Servers submenu

### Requirement: Forgetting a paired server
The user SHALL be able to forget a paired server. Forgetting SHALL close its window, remove its keyring entry, remove its remembered window state, and clear its partition's cookies and storage. The user SHALL be told the device stays listed on that dashboard until its operator revokes it.

#### Scenario: Forget removes local traces
- **WHEN** the user forgets `home-imac`
- **THEN** its window SHALL close, its keyring entry SHALL be removed, its partition storage SHALL be cleared, and the message SHALL say the operator of `home-imac` can revoke the device there

### Requirement: Server window requests are validated in the main process
Every request to discover, connect, open or forget a server SHALL be handled in the main process and SHALL be accepted only when it comes from the top-level frame of a trusted window: the app's bundled remote-connect window, the app's bundled connecting window, or the main window while its top-level frame shows the local dashboard origin (the origin of the dashboard server this app launched or adopted; never the remote-mode origin). Requests from subframes (including same-origin iframes of the local dashboard) and from any other window SHALL be refused, and change notifications about servers SHALL be sent only to trusted windows. The main window SHALL be given the open-server-window bridge only while its top-level document is on the local dashboard origin; a remote-origin document in the main window (remote mode) SHALL NOT see it. A request SHALL identify the target only by fingerprint, or by host and port (treated as `http`) that match a currently discovered server or a host of a keyring entry, or — from the remote-connect window only — by a manually entered URL of which only scheme, host and port are used and whose host is not a loopback address; a host and port that match nothing known SHALL be refused; the main process SHALL resolve and verify the identity itself and SHALL NOT accept a credential, partition name or URL path from the renderer. These channels form their own family, separate from the loading page's server-control channels.

#### Scenario: Untrusted frame cannot open windows
- **WHEN** a frame on a remote dashboard origin asks to open a server window
- **THEN** the request SHALL be refused and no window SHALL open

#### Scenario: Same-origin iframe is refused
- **WHEN** an iframe on the local dashboard origin inside the main window asks to forget a server
- **THEN** the request SHALL be refused and the keyring SHALL be unchanged

#### Scenario: Remote mode main window has no bridge
- **GIVEN** the app runs in remote mode and the main window shows a remote dashboard origin
- **WHEN** script there reads the open-server-window bridge
- **THEN** it SHALL be undefined

#### Scenario: Renderer cannot choose the partition
- **WHEN** a trusted window asks to open host `192.168.16.204` port `8000`
- **THEN** the main process SHALL derive the partition from the fingerprint proven at that address, not from any renderer-supplied value

#### Scenario: Unknown host from the main window is refused
- **WHEN** the main window asks to open host `10.9.9.9` port `22` that matches no discovered server and no keyring host
- **THEN** the request SHALL be refused and no network request SHALL be sent to `10.9.9.9`

#### Scenario: Manual https URL keeps its scheme
- **WHEN** the remote-connect window opens `https://dash.example.lan:8443/some/path`
- **THEN** the main process SHALL use origin `https://dash.example.lan:8443` and SHALL ignore the path

### Requirement: Pairing and window events are observable without secrets
The Electron log SHALL record one line per pairing outcome (approved, rejected, expired, refused with its code, identity mismatch, identity unverifiable, stopped), per identity mismatch at open or re-verification, per credential refusal, per keyring heal and per keyring set-aside. Each line SHALL carry the short fingerprint and, where relevant, the target host. No line SHALL contain a bearer, a confirmation code, a device cookie or the requester name.

#### Scenario: Identity mismatch is logged
- **WHEN** an open is refused for an identity mismatch
- **THEN** one log line SHALL name the expected and proven short fingerprints and the host, and SHALL contain no bearer
