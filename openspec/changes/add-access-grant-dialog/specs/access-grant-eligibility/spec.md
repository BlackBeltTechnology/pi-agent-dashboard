## Purpose

Decides which access denials may raise a dialog on the operator's screen, and
which may additionally suspend the denied request while the operator decides. It
exists because a dialog is an action performed on the operator: without a
positive, unforgeable proof of provenance, any web page the operator visits could
provoke one and habituate a click that persists a grant.

## ADDED Requirements

### Requirement: Prompt eligibility requires a live operator channel

A denial SHALL be prompt-eligible only when the server can attribute it to an
already-authenticated operator channel. The server SHALL issue each connected
browser socket a **prompt capability**: a high-entropy value, generated per
connection, held in memory only, never persisted, and delivered over the
authenticated browser WebSocket. A request SHALL prove eligibility by echoing
that value; the server SHALL resolve it to the issuing socket and SHALL raise any
resulting dialog on that socket's operator.

Eligibility SHALL NOT be derived from any of these **on their own**: the presence
or absence of an authentication credential, the CORS origin decision,
`Sec-Fetch-*` headers, or a comparison of `Origin` against the request's own
`Host`. A request that merely carries the capability **header** without the
correct value SHALL be treated exactly as one that carries none.

The capability SHALL confer no access on its own: it permits a prompt to be
raised and nothing else.


#### Scenario: A request from the dashboard app is eligible

- **GIVEN** a browser with a live authenticated dashboard WebSocket
- **WHEN** that browser's request is denied by a guard and the request carries the capability issued to its socket
- **THEN** the denial SHALL be prompt-eligible

#### Scenario: A drive-by request is not eligible

- **GIVEN** any page that has not been issued a prompt capability
- **WHEN** a request it emits is denied by a guard
- **THEN** the denial SHALL NOT be prompt-eligible, regardless of its origin, cookies, headers, or source address

#### Scenario: A capability-bearing denial is attributed to its issuing operator

- **WHEN** a denial carries a valid capability
- **THEN** the server SHALL resolve it to the issuing socket's operator

#### Scenario: A guessed or stale capability value is rejected

- **WHEN** a request carries a capability value that does not resolve to a live browser socket
- **THEN** the denial SHALL NOT be prompt-eligible
- **AND** the request SHALL receive the same denial as one carrying no capability at all

#### Scenario: The capability does not survive its connection

- **WHEN** the browser socket that was issued a capability closes
- **THEN** that value SHALL no longer resolve to any socket
- **AND** it SHALL never be written to persistent storage

#### Scenario: Auth configuration does not decide eligibility

- **GIVEN** a deployment with authentication disabled and a browser on loopback
- **WHEN** that browser's denied request carries its issued capability
- **THEN** the denial SHALL be prompt-eligible

### Requirement: A prompt capability is issued only to browser-shaped connections

Because an admitted origin is not by itself evidence of a browser — a connection
with **no** `Origin` header is admitted precisely so that non-browser local
clients keep working — the server SHALL NOT issue a prompt capability to every
admitted socket.

A capability SHALL be issued only when the connection's upgrade request carries
all of:

1. a **non-absent** `Origin` that is admitted (an absent `Origin` SHALL NOT
   qualify);
2. a `Sec-Fetch-Site` value consistent with a page served by this server; and
3. whatever credential tier the dashboard UI itself requires of that connection.

A connection failing any of these SHALL still function normally for every other
purpose; it SHALL simply never be issued a capability, and every denial
attributable to it SHALL be ineligible.

These signals SHALL be treated as **provenance signals, not as an
authentication boundary**. The specification does not claim that a process on the
same machine able to forge request headers can be excluded by them.

#### Scenario: A connection with no Origin is issued no capability

- **GIVEN** a local non-browser client that opens the browser WebSocket without an `Origin` header
- **WHEN** the connection is established
- **THEN** it SHALL NOT be issued a prompt capability
- **AND** any denial attributable to it SHALL NOT be prompt-eligible

#### Scenario: Capability issuance is not widened by the admission decision alone

- **WHEN** a connection is admitted by the origin rules but does not satisfy every issuance signal
- **THEN** it SHALL NOT be issued a prompt capability
### Requirement: What the capability authorises differs by settlement mode

The capability answers *"may this request be suspended and resumed?"* It is not
the only thing that may authorise a prompt, and the two settlement modes SHALL
require different proofs:

- **A held plane** SHALL require the **request itself** to carry a valid
  capability. Nothing is suspended for a requester that cannot prove it is the
  operator's own client, because suspension spends server resources on the
  requester's behalf and returns real data to it.
- **A deferred plane** SHALL NOT require the request to carry anything — its
  requester is untrusted by definition and will never hold a capability. A
  deferred denial MAY raise a prompt when **a live operator channel exists**, on
  that channel. The authority to prompt comes from the operator's own connection,
  never from the requester's request.

A deferred prompt SHALL give its requester no inbound surface and no
information beyond what a retry would have told it: the request stays denied, no
inbound surface is created, and the requester learns only what a later retry
would have told it anyway.

Because a deferred prompt is raised on behalf of a requester that did not earn
it, deferred planes SHALL be subject to the prompt-volume controls without
exception, and a plane SHALL be able to declare that a class of denial never
prompts at all.

#### Scenario: A held plane refuses to suspend for an unproven requester

- **GIVEN** a denial on a held plane whose request carries no valid capability
- **WHEN** the denial is evaluated
- **THEN** the request SHALL NOT be suspended

#### Scenario: A network denial prompts on the operator's channel

- **GIVEN** a live operator channel and a recorded denial on a deferred plane
- **WHEN** the denial is evaluated
- **THEN** a prompt MAY be raised on that operator channel
- **AND** the denied request SHALL remain denied and SHALL NOT be suspended

#### Scenario: No operator channel means no prompt

- **GIVEN** a deferred-plane denial and no live operator channel
- **WHEN** the denial is evaluated
- **THEN** no prompt SHALL be raised
- **AND** the denial SHALL still be recorded for later review

#### Scenario: A remote peer cannot prompt without limit

- **GIVEN** a remote peer emitting repeated denials on a deferred plane
- **WHEN** the prompt-volume controls are applied
- **THEN** prompting SHALL be suppressed while the denials continue to be recorded

### Requirement: Prompting at all requires enforced Host admission

A denial SHALL raise a dialog only when the server's Host-admission gate is in
enforcing mode. When Host admission is in reporting mode, every plane — held and
deferred alike — SHALL be record-only: the denial is recorded and answerable from
the Access surface, and no dialog is raised on any operator channel.

This requirement exists because Host admission is the only control that
distinguishes a genuine local origin from a rebound attacker domain; a rebound
page can obtain a prompt capability by the same means as a legitimate one. The
prize for such a page is not the suspension but the persisted grant an
allow-always verdict writes, together with the same-origin read of the retry that
grant enables — so the precondition SHALL gate prompting, not merely suspension.

Suspension requires enforcing mode as well, as a consequence: a request that
cannot be prompted for cannot be held.

#### Scenario: Reporting mode never prompts

- **GIVEN** the Host-admission gate is in reporting mode
- **WHEN** a denial occurs on any plane, whether or not it is otherwise prompt-eligible
- **THEN** no dialog SHALL be raised on any operator channel
- **AND** the request SHALL be answered immediately with its existing denial
- **AND** the recorded reason SHALL name the Host-admission mode

#### Scenario: Enforcing mode permits prompting and suspension

- **GIVEN** the Host-admission gate is in enforcing mode
- **WHEN** a prompt-eligible denial occurs on a plane declared suspendable
- **THEN** the request MAY be suspended pending the operator's verdict

#### Scenario: A deferred plane is equally gated

- **GIVEN** the Host-admission gate is in reporting mode and a live operator channel
- **WHEN** a denial occurs on a deferred plane
- **THEN** no dialog SHALL be raised
- **AND** the denial SHALL still be recorded and reviewable on the Access surface

#### Scenario: Host-admission mode is never changed by this capability

- **WHEN** any denial is evaluated for eligibility
- **THEN** the Host-admission mode SHALL NOT be modified

### Requirement: Eligibility is evaluated at the denial site

Eligibility SHALL be computed at the point of denial, from the live request.
Neither the decision to prompt nor the decision to suspend SHALL be re-derived
later from stored fields.

#### Scenario: A stored record cannot confer eligibility

- **GIVEN** a denial recorded earlier as prompt-eligible
- **WHEN** any later processing consults that record
- **THEN** it SHALL NOT use the record to make a fresh request eligible

### Requirement: Every degradation fails closed

Ineligibility, reporting-mode Host admission, prompting disabled, no connected
operator, registry capacity exhaustion, and rate limiting SHALL each reduce what
happens — from suspend, to prompt-without-suspend, to record-only. No condition
SHALL cause a denial to be allowed, and every rung SHALL still return the
denial the guard would have returned today.

#### Scenario: No connected operator

- **WHEN** a denial is prompt-eligible but no browser is connected
- **THEN** no dialog SHALL be raised
- **AND** the request SHALL receive its existing denial

#### Scenario: Degradation never produces an allow

- **WHEN** any eligibility or capacity condition fails
- **THEN** the outcome SHALL be at most a recorded denial, never an access grant
