## MODIFIED Requirements

### Requirement: Identity is verified before any pairing request or credential use
Before knocking a server, and before sending a stored credential to it, the main process SHALL challenge the target address for its identity and SHALL compare the proven fingerprint with the expected one. The expected fingerprint SHALL be the keyring pin when a keyring entry exists, else the fingerprint advertised in discovery; when both exist they SHALL be equal, otherwise the target SHALL be refused as an identity mismatch. When neither exists (manual URL, or an advert without a fingerprint), the full proven fingerprint SHALL be shown to the user in the connecting window with a prompt to compare it with the fingerprint shown on that dashboard, the request SHALL be sent only after the user confirms, and the fingerprint SHALL be pinned only when pairing is approved (trust on first use). A proven fingerprint equal to this machine's own dashboard fingerprint, itself proven against the local server and never taken from an advert, SHALL mark that address as a wrong address: the next alternative address of the same server SHALL be tried, and when none remains the target SHALL be reported unreachable, not as a mismatch. Any other non-expected fingerprint is a mismatch. On mismatch the main process SHALL NOT knock, SHALL NOT send any credential, SHALL NOT replace the pin, and SHALL report an identity mismatch naming the server's label and both short fingerprints. The knock response fingerprint SHALL equal the proven fingerprint before a bearer is stored. A target that cannot answer the identity challenge (unreachable, or a dashboard too old to have one) SHALL be reported as "cannot verify this dashboard's identity", distinct from a mismatch, and SHALL NOT be knocked.

#### Scenario: Impostor at a discovered address is not knocked
- **GIVEN** discovery advertised fingerprint F for `192.168.16.204:8000`
- **WHEN** the challenge at that address proves fingerprint G ≠ F, and G is not this machine's own fingerprint
- **THEN** no pairing request SHALL be sent and the connecting window SHALL show an identity-mismatch error

#### Scenario: Pinned server answers with a different identity
- **GIVEN** a keyring entry pinned to fingerprint F
- **WHEN** the user opens that server and the address proves fingerprint G ≠ F
- **THEN** no credential SHALL be sent to that address, no window SHALL load it, and the pin SHALL remain F

#### Scenario: Manual URL pins on approval after user confirmation
- **GIVEN** no keyring entry and no advert for `http://10.0.0.5:8000`
- **WHEN** the user connects and the challenge proves fingerprint H
- **THEN** the connecting window SHALL show the short form of H and SHALL NOT send the request until the user chooses "Send request"
- **AND** WHEN the user sends it and the operator approves, the keyring entry SHALL be created pinned to H

#### Scenario: Dashboard without an identity challenge
- **WHEN** the challenge at the target answers with a non-success status or does not answer
- **THEN** the connecting window SHALL say the dashboard's identity cannot be verified (it may be unreachable or too old) and no pairing request SHALL be sent

#### Scenario: Knock target reaches this machine itself
- **GIVEN** discovery advertised fingerprint F with addresses `192.168.64.1` and `192.168.16.203`
- **WHEN** `192.168.64.1` proves this machine's own fingerprint and `192.168.16.203` proves F
- **THEN** no identity mismatch SHALL be reported and the pairing request SHALL be sent to `192.168.16.203` only

### Requirement: One window per paired server on its own origin
Opening a paired server SHALL focus its existing window when one is open (restoring it if minimized); otherwise it SHALL create a window bound to a storage partition derived from the server's fingerprint (persistent unless the entry is "not remembered"), so each server's cookies and storage are isolated from the local dashboard and from every other server. Before loading, the main process SHALL pick a host from the entry's last known hosts and current discovery whose identity challenge proves the pinned fingerprint, SHALL exchange the bearer for the device cookie inside that partition, and SHALL then load the server's own origin (IPv6 literals bracketed). The window SHALL have no preload script, no Node integration, context isolation and the renderer sandbox enabled. Any top-level navigation, including a redirect of a top-level navigation, whose origin differs from the server's origin SHALL be cancelled; new-window requests SHALL be denied. A cancelled or denied URL SHALL be opened in the system browser only when its scheme is `http`, `https` or `mailto`, and SHALL otherwise be dropped. The window title SHALL be the server's label followed by the page title, the page title sanitised like an advertised name. Window size and position SHALL be remembered per server, outside the keyring. The device cookie authenticates only the server's `/api/` routes, so features served outside `/api/` (live previews, the editor) are available in a server window only where that server's own network rules admit this machine. While a server window is open, the main process SHALL re-verify the identity at its host every 60 seconds, when the window regains focus at least 60 seconds after the last verification, and when the system resumes from sleep. When a re-verification proves any fingerprint other than the pin, it SHALL follow "A failed re-verification re-selects the host"; when the challenge cannot be completed (transport failure) it SHALL leave the window loaded, show "not reachable" in the window title, immediately rerun host selection (replacing the window when another host proves the pin), and otherwise retry at the next trigger. Opening (or the open request for) a server that has no usable credential SHALL start the pairing flow instead of loading. For `http` hosts the window origin, the credential exchange and every re-verification SHALL use the address literal that proved the pin (see "Proof and use are bound to the same address"). Host selection SHALL challenge candidates concurrently in ordered batches of at most 12, SHALL prefer stored `https` hosts, then stored `http` hosts, then discovered hosts, and SHALL finish within 5 seconds. A device-cookie exchange that fails for any reason other than a refusal (see "Revoked or expired credentials offer re-pairing") SHALL load nothing, change nothing, and tell the user the server is unreachable.

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
- **WHEN** the next re-verification proves a fingerprint other than `home-imac`'s pin and other than this machine's own, and no other candidate proves the pin
- **THEN** the window SHALL be navigated to a blank page, every device cookie in the partition SHALL be removed, and the identity mismatch SHALL be reported

#### Scenario: Server briefly unreachable while the window is open
- **WHEN** a re-verification cannot reach `home-imac`
- **THEN** the window SHALL stay loaded and its title SHALL say "not reachable" until a later re-verification succeeds

## ADDED Requirements

### Requirement: Foreign identity proofs are classified
A non-expected proof SHALL be `self` when it equals this machine's own dashboard fingerprint (proven locally, never from an advert), `unverified` while that fingerprint is still unknown, else `foreign` (incl. invalid signature). A `self` or `unverified` address SHALL be skipped without a mismatch report. A `foreign` proof SHALL keep the strict mismatch handling. An mDNS advert SHALL NOT change a proof's class.

#### Scenario: Address reaches this machine itself
- **GIVEN** a keyring entry pinned to F and this machine's proven local fingerprint L
- **WHEN** a candidate address proves L
- **THEN** the address SHALL be skipped, no credential SHALL be sent to it, and no identity mismatch SHALL be reported for it

#### Scenario: Own fingerprint not yet known
- **GIVEN** this machine's local dashboard has not yet proven its fingerprint
- **WHEN** a candidate address proves a fingerprint other than the pin
- **THEN** no identity mismatch SHALL be reported for it and the next trigger SHALL retry

#### Scenario: Advertised impostor is still foreign
- **GIVEN** an mDNS advert carrying fingerprint P ≠ F for some host
- **WHEN** a candidate address for the server pinned to F proves P and no candidate proves F
- **THEN** the identity mismatch SHALL be reported and no credential SHALL be sent

### Requirement: Proof and use are bound to the same address
For an `http` host the main process SHALL resolve a hostname candidate to its address literals (at most 8 per name) and SHALL prove each literal separately. The bearer exchange, the loaded origin and both re-verification paths SHALL use the literal that proved the pin. An `https` host SHALL keep its name. Address takeover between proof and use on plain `http` is not covered.

#### Scenario: mDNS name resolving to several addresses
- **GIVEN** an advert host `pi-dashboard-x-8000.local` resolving to `192.168.64.1` (this machine) and `192.168.16.203` (proves F)
- **WHEN** the user opens the server pinned to F
- **THEN** the bearer exchange and the window SHALL use `http://192.168.16.203:8000/` only

#### Scenario: Re-verification uses the proven literal
- **GIVEN** a server window loaded from the literal `192.168.16.203`
- **WHEN** a scheduled re-verification runs
- **THEN** the identity challenge SHALL be sent to `192.168.16.203`, not to any hostname

### Requirement: A failed re-verification re-selects the host
Both re-verification paths (60 s/focus/resume, and credential refusal) SHALL use one transition. A transport failure SHALL keep the page, show "not reachable" and rerun host selection. A non-pin proof SHALL blank the window and remove every device cookie in the partition (all cookies of the partition), awaited, first. A proving other host SHALL replace the window. Else a `foreign` proof SHALL be reported once; otherwise retry at the next trigger.

#### Scenario: Window moves to the proving address
- **GIVEN** the `home-imac` window is loaded from address A
- **WHEN** a scheduled re-verification at A proves this machine's own fingerprint and address B proves the pin
- **THEN** every device cookie in the partition SHALL be removed before B is loaded, the window SHALL be replaced by one loading B's origin authenticated, and no mismatch SHALL be reported

#### Scenario: Only this machine or nothing answers
- **WHEN** every candidate is unreachable or proves this machine's own fingerprint
- **THEN** the window SHALL be blank with "not reachable" in its title, no mismatch SHALL be reported, and the next trigger SHALL retry host selection

#### Scenario: Credential re-check uses the same transition
- **WHEN** an API 401 triggers the credential re-check and the identity proof at the window's origin is not the pin
- **THEN** the same transition SHALL run and no bearer SHALL be sent to that origin

#### Scenario: Moved server found after a transport failure
- **GIVEN** the `home-imac` window is loaded from address A
- **WHEN** a scheduled re-verification at A cannot connect and address B proves the pin
- **THEN** the window SHALL be replaced by one loading B's origin authenticated

#### Scenario: Cookies of former addresses are removed too
- **GIVEN** the partition holds device cookies for former addresses A and C
- **WHEN** a re-verification at A proves a fingerprint other than the pin
- **THEN** the device cookies for both A and C SHALL be removed before any origin is loaded

#### Scenario: Cookie removal failure loads nothing
- **WHEN** removing the partition's device cookies fails during the transition
- **THEN** no origin SHALL be loaded in that window and the failure SHALL be logged

### Requirement: Candidate addresses are ordered by locality without vetoes
Discovered literals SHALL be ordered with addresses inside a local interface's prefix (from its own netmask) first and this machine's own addresses last; none SHALL be dropped for being local. They SHALL be challenged in ordered batches until one proves the pin or the selection deadline passes. A pinned server's adverts SHALL be considered whatever their locality flag, except adverts carrying this machine's own fingerprint.

#### Scenario: Working address listed last is still probed
- **GIVEN** an advert for F listing four off-link addresses followed by its on-link address
- **WHEN** host selection runs and the first batch proves nothing
- **THEN** the on-link address SHALL be probed before the deadline and the server SHALL open there

#### Scenario: Locality flag never hides the pinned server
- **GIVEN** an advert carrying the pinned fingerprint F is flagged local because of an overlapping address
- **WHEN** host selection runs for F
- **THEN** that advert's addresses SHALL be candidates

#### Scenario: Own address is probed last
- **GIVEN** this machine has interface address `192.168.64.1` and an advert for F lists `192.168.64.1` first
- **WHEN** candidates are built
- **THEN** `192.168.64.1` SHALL be ordered after every other discovered address of that advert

### Requirement: Skipped and moved candidates are observable
Each candidate skipped as `self`, each `foreign` proof and each host move SHALL be logged with the host, the short form of the proven fingerprint and the reason. Log lines SHALL NOT contain a bearer, a cookie value or a pairing code.

#### Scenario: Self-loop is logged with its reason
- **WHEN** a candidate is skipped because it proved this machine's own fingerprint
- **THEN** one log line SHALL name the host and reason `self` and SHALL contain no credential
