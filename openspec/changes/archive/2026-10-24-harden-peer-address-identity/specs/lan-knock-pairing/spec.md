## MODIFIED Requirements

### Requirement: Native knocking clients verify the discovered identity first
A client that knocks a server on a different origin than its own (for example a native shell connecting to a server found by mDNS) SHALL first complete `POST /api/pair/challenge` and SHALL knock only when the proven fingerprint equals the fingerprint the server advertised in discovery (without an advert, only as stated below for trust on first use); a proven fingerprint equal to the client's own local dashboard fingerprint (proven against its local server) SHALL mark that address as a wrong address and the client SHALL try the server's other addresses; any other mismatch SHALL NOT be knocked and SHALL be reported as an identity mismatch. After approval it SHALL verify that the `fingerprint` in the knock response equals the proven one before storing the bearer. When the client already holds a pin for the server, the proven fingerprint SHALL also equal the pin (and the advertised fingerprint, when one is advertised). When there is no advertised fingerprint and no pin (a manually entered address, or an advert without `fp`), the client SHALL show the proven fingerprint to the user and SHALL knock only after the user explicitly confirms; it SHALL then pin that fingerprint only when the knock is approved (trust on first use), with the operator's typed compare-code approval as the second factor. This check defeats an impostor answering at the discovered address; over plain http it does not defeat an on-path relay that forwards the challenge to the genuine server. Routes delivered with the approval SHALL be stored only as the server-identity-routes capability states: validated, and only after the challenge at each proves the pinned fingerprint.

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

#### Scenario: Delivered route is stored only after it proves the pin
- **GIVEN** an approved knock delivered `https://k3x9p2.share.zrok.io` for pinned fingerprint F
- **WHEN** the challenge at that URL proves F
- **THEN** the client SHALL store it as a route of F; if it proves another fingerprint the client SHALL NOT store it

#### Scenario: Address that reaches the client itself is skipped
- **GIVEN** discovery advertised fingerprint F with addresses A and B
- **WHEN** A proves the client's own local fingerprint and B proves F
- **THEN** the client SHALL NOT report an identity mismatch and SHALL knock at B only
