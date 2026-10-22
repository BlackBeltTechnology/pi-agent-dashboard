## ADDED Requirements

### Requirement: Local dashboard window can read the servers list
The main window, while its top-level document is on the local dashboard origin, SHALL be given a read-only bridge that returns the servers state the main process already holds for trusted windows: the paired entries (fingerprint, label, short fingerprint, state, open, remembered, last host) and the discovered servers. The bridge SHALL be absent in a remote-origin document, SHALL return no bearer, cookie, partition name or confirmation code, and the request SHALL be accepted only from the top-level frame of the trusted main window. The dashboard page SHALL use it to show which listed servers are paired on this device.

#### Scenario: Local dashboard page reads the list
- **GIVEN** the keyring holds `home-imac` and the main window shows the local dashboard origin
- **WHEN** the page asks for the servers list
- **THEN** the answer SHALL contain `home-imac` as paired and the discovered servers, and no credential

#### Scenario: Remote-origin document has no list bridge
- **GIVEN** the app runs in remote mode and the main window shows a remote dashboard origin
- **WHEN** script there reads the servers-list bridge
- **THEN** it SHALL be undefined

#### Scenario: Subframe is refused
- **WHEN** an iframe inside the main window asks for the servers list
- **THEN** the request SHALL be refused and no server data SHALL be returned

### Requirement: Pairing with a pasted pairing code happens inside the app
The main window, on the same local-origin gate as the servers-list bridge, SHALL be given a bridge method that starts "Pair with code" for a server identified by its fingerprint. It SHALL open the app's own Connecting window in a code mode that asks for the pairing text (the deep link or the `pi:pair:v1.…` string). The text SHALL be entered only in that app-owned window and SHALL NOT pass through the dashboard page. The main process SHALL decode the text, refuse a payload whose fingerprint is not the server's pinned fingerprint before any request, prove the identity at the first of the payload's `https` URLs that proves it, redeem the code there, wait for the operator's approval with the same compare-code display as a knock, and store the credential in the keyring under the same rules as a knock-paired credential. Routes named by the payload and delivered with the approval SHALL be recorded only as stated for a delivered route: validated, and only after the challenge at the route proves the pinned fingerprint. The pairing text, the pairing code and the credential SHALL NOT be logged or returned to any renderer.

#### Scenario: Code pairing stores the credential in the keyring
- **GIVEN** the keyring has no credential for `build-box` and the operator shows a pairing code on `build-box`
- **WHEN** the user opens "Pair with code…" for `build-box`, pastes the text into the Connecting window and the operator approves
- **THEN** the keyring SHALL hold an encrypted bearer for `build-box` under the same rules as a knock, and the server window MAY be opened

#### Scenario: Payload for another server is refused before any request
- **WHEN** the pasted payload's fingerprint differs from the server's pinned fingerprint
- **THEN** the main process SHALL refuse it and SHALL contact no address named in the payload

#### Scenario: Payload URL that proves another identity is not redeemed
- **WHEN** none of the payload's `https` URLs proves the pinned fingerprint
- **THEN** the code SHALL NOT be redeemed and the window SHALL report an identity mismatch or unreachable server

#### Scenario: Secrets stay out of renderers and logs
- **WHEN** a code pairing runs
- **THEN** no log line and no message to the dashboard page SHALL contain the pairing text, the pairing code or the credential

#### Scenario: Remote-origin document has no code-pairing bridge
- **GIVEN** the main window shows a remote dashboard origin
- **WHEN** script there reads the code-pairing bridge
- **THEN** it SHALL be undefined

## MODIFIED Requirements

### Requirement: Server keyring
The app SHALL persist paired servers in a keyring file in the shell's managed directory (the directory holding the shell's dashboard settings file), keyed by server fingerprint. Each entry SHALL hold a display label, the pinned public key and fingerprint, the last known hosts (most recent first, capped) and the bearer. The bearer SHALL be stored only in encrypted form using the operating system's credential encryption; on POSIX systems the file SHALL be created with owner-only permissions and an existing file with broader permissions SHALL be tightened on load; on Windows it SHALL live in the user's profile directory, whose access list limits it to that user. When operating-system encryption is unavailable, the bearer SHALL be kept in memory for the current app run only, the entry SHALL be marked "not remembered", the server's window storage SHALL NOT persist to disk, and the user SHALL be told the server must be paired again after restart. A stored bearer that can no longer be decrypted SHALL be discarded and its entry marked "needs pairing" (pin, label and hosts kept). An unreadable or malformed keyring file SHALL NOT crash the app: it SHALL be set aside under a distinct name, the keyring SHALL start empty, and the event SHALL be logged. Each known host SHALL record its scheme. A host learned from discovery (always `http`) for a pinned fingerprint SHALL be added to that entry's last known hosts only after the identity challenge at that host proves the pinned fingerprint, and SHALL never replace or precede an `https` host of that entry. No renderer SHALL ever receive a bearer. A route delivered with a pairing result SHALL be added the same way: only after validation and only after the challenge at it proves the pinned fingerprint. Each known host SHALL also record its source (`saved` for an address the user entered, `mdns` for one learned from discovery, `pairing` for one delivered with a pairing result; the same values a known-servers route uses); a host with no recorded source, written by an earlier version, SHALL be treated as having an unknown source and used exactly as before. At most 3 delivered routes SHALL be stored per pairing result (the first delivered `https` routes that pass validation and proof), after which the existing cap of 5 known hosts, most recent first with `https` hosts ahead of `http` hosts, applies unchanged.

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

#### Scenario: Delivered route is kept after proof
- **GIVEN** an entry pinned to F and an approval that delivered `https://h0me1mac.share.zrok.io`
- **WHEN** the challenge there proves F
- **THEN** the entry's last known hosts SHALL include it with scheme `https` and source `pairing`

#### Scenario: Delivered route proving another identity is dropped
- **WHEN** the challenge at a delivered route proves a fingerprint other than the pin
- **THEN** the route SHALL NOT be stored and an identity mismatch line SHALL be logged

#### Scenario: Only the first delivered routes are kept
- **GIVEN** an approval that delivered five valid `https` routes that all prove the pinned fingerprint
- **WHEN** the routes are recorded
- **THEN** only the first three delivered SHALL be stored, and the entry SHALL still hold at most five known hosts
