## MODIFIED Requirements

### Requirement: Accepting a pending request grants through the existing write path

**Only when the effective network trust mode (`network.trustMode`, see the `trusted-networks` capability) is `"legacy"`**, a trusted client SHALL be able to accept a pending access request. Acceptance SHALL add the peer to trusted networks through the existing configuration write path. In `"pair"` mode no accept action SHALL be offered for a pending network access request: a list entry would not admit the peer, so the device is directed to pairing instead. The ledger itself SHALL remain advisory and SHALL NOT mutate trust policy in either mode.

#### Scenario: Acceptance writes trusted networks

- **WHEN** the effective trust mode is `"legacy"` and a trusted client accepts a pending access request
- **THEN** the peer SHALL be added to trusted networks via the existing config write path

#### Scenario: No accept action in pair mode

- **WHEN** the effective trust mode is `"pair"` and pending network access requests are presented
- **THEN** no accept action SHALL be offered for any entry
- **AND** a direct call to the accept endpoint SHALL be refused with 403 and SHALL write nothing

#### Scenario: Ledger never mutates policy directly

- **WHEN** denials are recorded or listed
- **THEN** trusted-network configuration SHALL be unchanged

#### Scenario: Non-trustable entries cannot be accepted

- **GIVEN** a ledger entry marked `trustable: false` because the peer is loopback or proxy-terminated
- **WHEN** the pending access requests are presented
- **THEN** the accept action SHALL be suppressed for that entry

### Requirement: A pending access request may actively raise a prompt

A recorded pending access request SHALL be able to raise a dialog on the
operator's screen rather than only waiting to be noticed in a review surface. The
denied request itself SHALL be answered immediately with its existing denial: it
SHALL NOT be suspended, because the requester on these planes is untrusted by
definition and may hold no channel to wait on.

On the **network** plane this SHALL apply only when the effective network trust
mode is `"legacy"`. In `"pair"` mode a network denial SHALL be recorded but SHALL
NOT raise a prompt; the operator is prompted when the denied device requests
access through pairing. Other planes are unaffected.

An operator verdict SHALL apply to the requester's subsequent attempt. The
requester SHALL NOT be told that a prompt was raised, and SHALL learn nothing
beyond the outcome of its own retry.

#### Scenario: The denied caller is not held

- **WHEN** a denial on an untrusted plane raises a prompt
- **THEN** the denied request SHALL receive its existing denial immediately

#### Scenario: The verdict applies to the retry

- **GIVEN** an operator answered allow-always for a recorded denial
- **WHEN** the requester retries
- **THEN** the retry SHALL succeed

#### Scenario: A denied verdict changes nothing for the requester

- **WHEN** an operator denies
- **THEN** a retry SHALL be denied exactly as before

#### Scenario: Prompting adds no inbound surface

- **WHEN** prompting is enabled
- **THEN** the requester SHALL have no way to send anything it could not send with prompting disabled

#### Scenario: Network plane is silent in pair mode

- **GIVEN** grant prompting is enabled and the effective network trust mode is `"pair"`
- **WHEN** a network denial is recorded
- **THEN** no prompt SHALL be raised for it
- **AND** a CORS-plane denial SHALL still raise its prompt as before

### Requirement: The denial is the access request

A denied client SHALL NOT need to send any additional message to request access **on the network-grant plane**. The recorded denial SHALL itself constitute the pending access request, so no unauthenticated inbound write creates an entry in the denial ledger. Device-initiated pairing requests (the `lan-knock-pairing` capability) are a separate mechanism: they create a pending *device* that the operator approves with a typed code, never a ledger entry or a trusted-network grant, and this requirement SHALL NOT be read to forbid them.

#### Scenario: No inbound request endpoint exists

- **WHEN** a client is denied
- **THEN** in `"legacy"` mode access SHALL be requestable on the network-grant plane without that client posting to any endpoint
- **AND** no unauthenticated endpoint SHALL exist for creating a pending entry in the denial ledger

#### Scenario: Denied client retry succeeds after acceptance

- **GIVEN** the effective network trust mode is `"legacy"` and a denied client's entry has been accepted by a trusted client
- **WHEN** the denied client retries its request
- **THEN** the request SHALL be admitted by the normal pass conditions

#### Scenario: A knock creates no ledger entry

- **WHEN** a device sends a pairing request
- **THEN** no denial-ledger entry SHALL be created and trusted-network configuration SHALL be unchanged
