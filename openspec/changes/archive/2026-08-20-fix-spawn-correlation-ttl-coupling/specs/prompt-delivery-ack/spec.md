## ADDED Requirements

### Requirement: The prompt response stops asserting an unknowable `delivered`
`POST /api/session/:id/prompt` today returns `delivered: true` on its contended
branch, where the only established fact is that the prompt was written to the
socket the routing table currently holds. That is transmission, not delivery —
and the contended branch is precisely the displaced-bridge case where the claim
is most likely to be false.

No response branch SHALL assert delivery on the strength of a socket write. The
contended branch SHALL stop returning `delivered: true` while continuing to
return its contention warning.

Because the response is not gated on the bridge acknowledgement (see below), the
acknowledged state SHALL NOT appear in the response at all.

#### Scenario: Contended branch stops asserting delivery
- **WHEN** a contention record exists for the session id and the prompt is written to the owning socket
- **THEN** the response SHALL NOT assert `delivered: true`
- **AND** it SHALL still report the contention warning it reports today

#### Scenario: No branch claims delivery from a write
- **WHEN** any prompt is written successfully to an OPEN socket
- **THEN** the response SHALL report transmission only

### Requirement: Transmission is reported explicitly on every branch
The response SHALL report whether the prompt was transmitted — written to the
socket the server currently holds for that session id — on **every** branch,
including the ordinary non-contended success path, which today returns a bare
`{ success: true }` with no such field.

`success` SHALL retain its current meaning so existing callers reading only
`success` are unaffected.

#### Scenario: Ordinary success reports transmitted
- **WHEN** a prompt is written to a live bridge with no contention record
- **THEN** the response SHALL report the prompt as transmitted
- **AND** `success` SHALL be `true` as today

#### Scenario: Contended success reports transmitted
- **WHEN** a prompt is written on the contended branch
- **THEN** the response SHALL report the prompt as transmitted

#### Scenario: No bridge at all
- **WHEN** no OPEN socket exists for the session id
- **THEN** the response SHALL report the prompt as not transmitted
- **AND** `success` SHALL be `false`

### Requirement: Delivery is acknowledged out of band, on a defined channel
The HTTP response SHALL NOT be withheld waiting for the bridge acknowledgement.
Delivery SHALL instead be observable after the response, on a defined channel:
the response SHALL return a per-prompt handle, and the acknowledged state SHALL
be published on the session event stream the client already consumes, keyed by
that handle. A handle with no defined observation channel SHALL NOT satisfy this
requirement.

The acknowledgement SHALL have one narrow meaning: the owning bridge handed the
prompt to pi. Socket receipt SHALL NOT count, and turn completion SHALL NOT be
required.

For the bridge to name the handle, the handle SHALL be carried to it on the
outbound prompt message, which does not carry one today. The acknowledgement is
a new bridge→server message; both additions SHALL be optional so a bridge that
sends neither degrades cleanly.

Unacknowledged pending state SHALL be bounded and evicted — by expiry, and on
the session unregistering — so prompts to bridges that never acknowledge cannot
accumulate without limit.

#### Scenario: Slow bridge does not delay the response
- **WHEN** the bridge is slow to acknowledge
- **THEN** the HTTP response SHALL be returned without waiting

#### Scenario: Delivery is observable on the event stream
- **WHEN** a prompt was transmitted and the owning bridge hands it to pi
- **THEN** an acknowledgement naming that prompt's handle SHALL be published on the session event stream

#### Scenario: Socket receipt alone is not an acknowledgement
- **WHEN** the bridge receives a prompt but has not handed it to pi
- **THEN** no acknowledgement SHALL be published for it

#### Scenario: Concurrent prompts are attributed individually
- **WHEN** several prompts are in flight to the same session
- **THEN** each acknowledgement SHALL name the handle of the prompt it answers
- **AND** an acknowledgement SHALL NOT be attributed to a different in-flight prompt

#### Scenario: Older bridge that never acknowledges
- **WHEN** the bridge predates the acknowledgement protocol
- **THEN** the prompt SHALL remain reported as transmitted and SHALL never be reported as delivered
- **AND** the request SHALL NOT fail on that account

#### Scenario: The handle reaches the bridge
- **WHEN** a prompt is transmitted to a bridge that supports acknowledgement
- **THEN** the outbound prompt message SHALL carry the handle
- **AND** the acknowledgement SHALL echo it

#### Scenario: Unacknowledged state does not accumulate
- **WHEN** prompts are sent to a bridge that never acknowledges
- **THEN** the pending-acknowledgement state SHALL be evicted by expiry
- **AND** it SHALL also be evicted when the session unregisters

### Requirement: A displaced bridge cannot satisfy delivery
Only the connection the server currently holds for a session id SHALL be able to
satisfy the delivery acknowledgement for that session. An acknowledgement
arriving from a connection that has been displaced SHALL NOT mark a prompt
delivered, and the silence of a displaced bridge SHALL NOT be reported as
delivery.

#### Scenario: Acknowledgement from a displaced connection is ignored
- **WHEN** an acknowledgement arrives on a connection that is no longer the owner for that session id
- **THEN** the prompt SHALL NOT be marked delivered

#### Scenario: Displaced bridge silence is never delivery
- **WHEN** a second bridge displaces the first and the first never acknowledges
- **THEN** no prompt SHALL be marked delivered on the strength of that silence
