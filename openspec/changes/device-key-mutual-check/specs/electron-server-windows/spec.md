## MODIFIED Requirements

### Requirement: Server keyring
The app SHALL persist paired servers in a keyring file in the shell's managed directory (the directory holding the shell's dashboard settings file), keyed by server fingerprint. Each entry SHALL hold a display label, the pinned public key and fingerprint, the last known hosts (most recent first, capped), the bearer and, when one exists, the device key for that server as defined by `device-key-mutual-check` (its public key and its private key). The bearer and the device private key SHALL be stored only in encrypted form using the operating system's credential encryption; on POSIX systems the file SHALL be created with owner-only permissions and an existing file with broader permissions SHALL be tightened on load; on Windows it SHALL live in the user's profile directory, whose access list limits it to that user. When operating-system encryption is unavailable, the bearer and the device private key SHALL be kept in memory for the current app run only, the entry SHALL be marked "not remembered", the server's window storage SHALL NOT persist to disk, and the user SHALL be told the server must be paired again after restart. A stored bearer that can no longer be decrypted SHALL be discarded and its entry marked "needs pairing" (pin, label and hosts kept). A stored device private key that can no longer be decrypted SHALL be discarded on its own (the entry keeps its credential and binds a new key on its next authenticated call). A build that does not know the device key SHALL be able to read the keyring file, ignoring the field. An unreadable or malformed keyring file SHALL NOT crash the app: it SHALL be set aside under a distinct name, the keyring SHALL start empty, and the event SHALL be logged. Each known host SHALL record its scheme. A host learned from discovery (always `http`) for a pinned fingerprint SHALL be added to that entry's last known hosts only after the identity challenge at that host proves the pinned fingerprint, and SHALL never replace or precede an `https` host of that entry. No renderer SHALL ever receive a bearer or a device private key; the main process signs device proofs and returns only the resulting status. A route delivered with a pairing result SHALL be added the same way: only after validation and only after the challenge at it proves the pinned fingerprint. Each known host SHALL also record its source (`saved` for an address the user entered, `mdns` for one learned from discovery, `pairing` for one delivered with a pairing result; the same values a known-servers route uses); a host with no recorded source, written by an earlier version, SHALL be treated as having an unknown source and used exactly as before. At most 3 delivered routes SHALL be stored per pairing result (the first delivered `https` routes that pass validation and proof), after which the existing cap of 5 known hosts, most recent first with `https` hosts ahead of `http` hosts, applies unchanged.

#### Scenario: Bearer is not stored in clear text
- **GIVEN** operating-system encryption is available
- **WHEN** a server is paired and a device key was created for it
- **THEN** the keyring file SHALL NOT contain the bearer or the device private key in clear text
- **AND** on POSIX systems the file mode SHALL be `0600`

#### Scenario: Encryption unavailable keeps the bearer off disk
- **GIVEN** operating-system encryption is unavailable
- **WHEN** a server is paired and its window is opened
- **THEN** neither the keyring file nor the window's cookie or storage SHALL write the bearer or the device private key to disk, the entry SHALL be marked "not remembered", and the server window SHALL still open for this run

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

#### Scenario: Undecryptable device key is dropped alone
- **WHEN** the stored device private key for `home-imac` cannot be decrypted but its bearer can
- **THEN** the entry SHALL keep its credential and show "Paired · key pending", and the app SHALL bind a new key on the next authenticated call

#### Scenario: Device private key never reaches a renderer
- **WHEN** the dashboard page or any window asks the app for the servers list or a server's state
- **THEN** the answer SHALL contain no device private key, and device proofs SHALL be signed in the main process

#### Scenario: Entry with a device key survives an older build
- **WHEN** a build that predates the device key reads a keyring file whose entry has one
- **THEN** it SHALL load the entry's label, hosts and bearer normally, ignoring the device key

### Requirement: Revoked or expired credentials offer re-pairing
The device-cookie exchange is the authority on whether this app's credential is still accepted: it SHALL be treated as refused when it answers `401`, or `403` with `error: "network_not_allowed"`; any other answer (a `403` with another body such as `insufficient_scope` or `host_not_allowed`, a timeout, a transport failure) is not a refusal and SHALL discard nothing. The app SHALL discard a stored credential only when the exchange is refused at a route whose identity challenge proved the entry's pinned fingerprint, never because of a device-check answer alone (including `unknown`). A refused exchange before load SHALL be followed by the device check for that server (when a device key exists), which is sent only to that proven route. When the check answers `revoked`, the entry SHALL be marked "Access removed" with the credential and device key kept, so an operator's undo needs no re-pairing, and the window SHALL NOT load. When the check answers `paired` (the server knows this device yet did not accept the credential: a contradiction that a stale bearer, a wrong route or a proxy can cause), the entry SHALL keep the bearer and device key and the window SHALL NOT load; when the exchange was refused with `403 network_not_allowed` the entry SHALL be marked "network not allowed" (shown in words in the Servers menu like the other states, and not stored in the keyring), and when it was refused with `401` the open SHALL fail like a failed exchange (the user is told the credential could not be confirmed and that nothing was changed) and the entry's stored state SHALL NOT change; the next open SHALL run the exchange and the check again. When the check answers `unknown`, the entry SHALL be marked "needs pairing" without loading the window (a keyed device the server no longer knows is conclusively unpaired). When the entry has no device key, the refusal is conclusive only when the exchange answered `401`: the entry SHALL then be marked "needs pairing"; when it answered `403 network_not_allowed` (a dead credential and a refused network look the same to a keyless device), the entry SHALL keep the bearer, SHALL be marked "network not allowed" (display only, as above), SHALL offer "Pair again" as a user choice, and the window SHALL NOT load. When the check is inconclusive (`unverified`, or no answer) the open SHALL fail in the same way, nothing SHALL be discarded and the entry's stored state SHALL NOT change (the stored "needs pairing" mark is what discards the bearer, so it SHALL NOT be set), and the next open SHALL run the exchange and the check again. When an open server window receives a `401` or `403` from that server's `/api/` routes, the main process SHALL NOT discard anything on that signal alone; it SHALL re-run the device-cookie exchange, at most once per 5 minutes per window, and SHALL mark the entry "needs pairing" (or "Access removed" when the device check answers `revoked`, or, when it answers `paired`, the kept-credential outcome above) only when that exchange is refused. A successful re-check SHALL change nothing (no reload). Marking an entry "needs pairing" after a refused exchange and a conclusive outcome (check answered `unknown`, or no device key and the exchange answered `401`) SHALL discard the stored bearer, the device key and the partition's device cookie and SHALL offer the user, once, to pair again (running the knock flow) or to forget the server. Marking an entry "Access removed" SHALL keep the bearer and device key, SHALL offer the same two choices, and "Pair again" SHALL create a new device key before knocking. A later device check that answers `paired` SHALL return an "Access removed" entry to Paired; one that answers `unknown` SHALL change nothing by itself, and the next refused exchange at a proven route SHALL then mark the entry "needs pairing" and discard the dead credential. A server that admits the requester's network without a credential does not reveal a revoked credential to an open window; detection then happens at the next open.

#### Scenario: Operator revoked the device
- **GIVEN** the operator of `home-imac` revoked this app's device
- **WHEN** the user opens `home-imac`
- **THEN** the cookie exchange SHALL be refused (`401`, or `403 network_not_allowed`), the device check SHALL answer `revoked`, the entry SHALL show "Access removed" with its credential kept, and the user SHALL be offered "Pair again" and "Forget"

#### Scenario: Revocation while the window is open
- **WHEN** an open `home-imac` window receives a `403` from `home-imac`'s `/api/` and the re-run exchange answers `403 network_not_allowed`
- **THEN** the entry SHALL be marked "Access removed" when the device check answers `revoked`, otherwise "needs pairing", and the re-pair offer SHALL be shown once

#### Scenario: Tier refusal does not unpair
- **GIVEN** this app's device has tier `observe` on `home-imac`
- **WHEN** the `home-imac` window receives `403 insufficient_scope` from an operate-tier route and the re-run exchange succeeds
- **THEN** the bearer and cookie SHALL be kept, the entry SHALL stay "Paired", and the window SHALL NOT reload

#### Scenario: Re-check is rate-limited
- **WHEN** the `home-imac` window receives ten `401` responses within one minute
- **THEN** at most one device-cookie exchange SHALL be run for them

#### Scenario: Undo of a revoke needs no re-pairing
- **GIVEN** the entry for `home-imac` shows "Access removed" with its credential kept
- **WHEN** the operator of `home-imac` undoes the revoke and the app next checks the server
- **THEN** the check SHALL answer `paired`, the entry SHALL return to Paired, and no pairing SHALL be needed

#### Scenario: Unknown answer alone discards nothing
- **GIVEN** the entry shows "Access removed" and the revoked device was deleted for good
- **WHEN** a device check answers `unknown` and no exchange has been refused since
- **THEN** the bearer and device key SHALL still be kept

#### Scenario: Server knows the device but refuses the network
- **GIVEN** the cookie exchange at a proven route answers `403 network_not_allowed` and the device check at that route answers `paired`
- **WHEN** the user opens `home-imac`
- **THEN** the window SHALL NOT load, the entry SHALL show "network not allowed", and the bearer, the device key and the partition's device cookie SHALL be kept
- **AND** the next open SHALL run the exchange and the check again

#### Scenario: Other refusals are not credential refusals
- **WHEN** the cookie exchange answers `403` with `error: "insufficient_scope"` or `"host_not_allowed"`, or does not answer
- **THEN** nothing SHALL be discarded and the entry SHALL be reported unreachable

#### Scenario: Keyless device refused by the network keeps its credential
- **GIVEN** the entry for `home-imac` has a bearer and no device key (paired before device keys)
- **WHEN** the cookie exchange at a proven route answers `403 network_not_allowed`
- **THEN** the bearer SHALL be kept, the entry SHALL show "network not allowed" with a "Pair again" choice, and the window SHALL NOT load
- **AND** WHEN the exchange instead answers `401`, the entry SHALL be marked "needs pairing" and the bearer discarded

#### Scenario: Purged device needs pairing
- **GIVEN** the entry shows "Access removed" and the revoked device was deleted for good
- **WHEN** the user opens the server, the cookie exchange is refused at the proven route (`401`, or `403 network_not_allowed`) and the device check answers `unknown`
- **THEN** the entry SHALL show "needs pairing" and the stored bearer and device key SHALL be discarded

#### Scenario: Inconclusive check keeps the credential
- **WHEN** the cookie exchange is refused and the device check answers `unverified` or does not answer
- **THEN** the open SHALL fail with a message that the credential could not be confirmed and nothing was changed, the entry SHALL NOT be marked "needs pairing", the bearer and device key SHALL be kept, and the next open SHALL run the exchange and check again

### Requirement: Main-process LAN knock pairing
Connecting to a server that has no usable keyring credential SHALL run the LAN knock pairing flow from the main process and SHALL show its progress in an app-owned "Connecting to ‹name›" window that loads only bundled content. Before the request is sent, the window SHALL show the target's label, address and short proven fingerprint and an editable "Device name" field prefilled with the computer's name; the request SHALL be sent only when the user chooses "Send request", carrying the field's value as the requester name (empty ⇒ no name) and the device key for that server (`device-key-mutual-check`), which SHALL be generated in memory at that moment after a fresh identity challenge that proved the server, and SHALL be written to the keyring only when the request is approved. While waiting, the window SHALL show the 8-digit confirmation code grouped as two blocks of 4 digits, the instruction to type it on the dashboard machine, the time left until expiry, and, for an `http:` target, that the request and resulting access travel unencrypted on this network. A "Stop waiting" action SHALL stop polling locally and SHALL state that the request stays visible on that dashboard until it expires. On approval the bearer and the device key SHALL be stored in the keyring (the key's private part encrypted as the bearer is) and the server window SHALL open. Knock pairing works only for a dashboard on the same local network segment (the knock admission gates). A rejected, expired or refused request SHALL show a plain-language reason (the same refusal-code meanings as the browser request landing, including the remedy for `knock_disabled`, `knock_not_lan`, `knock_pending` and `knock_busy`) and SHALL store nothing (the in-memory device key created for that request SHALL be discarded, as it SHALL be on "Stop waiting", on expiry and when the app quits or crashes). The confirmation code and the bearer and device private key SHALL never reach any renderer other than the connecting window (the code only) and SHALL never be logged.

#### Scenario: Successful pairing opens the server window
- **GIVEN** `home-imac` accepts LAN requests
- **WHEN** the user chooses Connect on `home-imac`, chooses "Send request", and the operator types the shown code on `home-imac`
- **THEN** the connecting window SHALL show the code as `4821 7730` while waiting
- **AND** after approval a keyring entry for `home-imac` SHALL exist and its server window SHALL open

#### Scenario: Disabled server explains the remedy
- **WHEN** the knock is refused with `knock_disabled`
- **THEN** the connecting window SHALL say the dashboard is not accepting requests from this network and that its owner can enable this in Gateway
- **AND** no keyring entry SHALL be created

#### Scenario: Approval stores the device key
- **WHEN** the operator approves a request that carried a device key
- **THEN** the keyring entry SHALL hold the bearer and that device key, the private part encrypted

#### Scenario: Rejected or expired request leaves no key
- **WHEN** the operator denies the request or it expires
- **THEN** no device key SHALL exist in the keyring or on disk, and the in-memory key SHALL be discarded

#### Scenario: Stopping the wait stores nothing
- **WHEN** the user chooses "Stop waiting" before the operator decides
- **THEN** polling SHALL stop, no keyring entry or device key SHALL be stored, and the window SHALL say the request remains on that dashboard until it expires

#### Scenario: Off-link dashboard explains the limit
- **WHEN** the knock is refused with `knock_not_lan` (for example a dashboard reached through a tunnel or VPN)
- **THEN** the connecting window SHALL say requests are accepted only from the same local network and SHALL store nothing

#### Scenario: User clears the device name
- **WHEN** the user empties the "Device name" field and sends the request
- **THEN** the request SHALL carry no requester name
