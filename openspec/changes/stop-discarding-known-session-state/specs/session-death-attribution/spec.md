# session-death-attribution Specification

## ADDED Requirements

### Requirement: Involuntary session death SHALL carry a reason

A session that ends without the user asking it to currently presents as a plain
`ended`, indistinguishable from a clean exit. Every terminal transition SHALL
record why it happened, using the existing `closedReason` vocabulary rather than
introducing a third attribution field beside `movedTo` and `closedReason`.

The vocabulary SHALL distinguish at minimum: user-initiated close (the existing
`"manual"`), loss of the session's process carrier, failure to start or restart,
and an explicitly `unknown` reason when the cause cannot be established.

`unknown` SHALL be a real member of the vocabulary, not an absence. A session
that ended for a reason the server could not determine is a different fact from a
session whose ending was never examined.

#### Scenario: A carrier loss is labelled

- **GIVEN** a session whose bridge connection is gone and whose reconnect grace period expires
- **WHEN** the server ends the session
- **THEN** the persisted reason SHALL identify loss of the process carrier
- **AND** the card SHALL present that reason rather than a bare `ended`

#### Scenario: A failed respawn is labelled

- **GIVEN** a session being reloaded or resumed whose spawn fails
- **WHEN** the server transitions the session to `ended`
- **THEN** the persisted reason SHALL identify the spawn failure
- **AND** SHALL NOT be reported as a clean exit

#### Scenario: Manual close is unchanged

- **GIVEN** a session the user closes from the dashboard
- **WHEN** the session ends
- **THEN** the persisted reason SHALL remain `"manual"`
- **AND** existing consumers of `"manual"` SHALL observe no behavioural change

### Requirement: Both terminal seams SHALL stamp the reason

`sessionManager.unregister(id, opts)` is not the only terminal transition:
roughly ten sites set `status: "ended"` through `update()` or object spread,
including reload-spawn failure, session moves, and terminal-manager cleanup.
Several of those are precisely the involuntary deaths this capability exists to
label.

Every code path that transitions a session to `ended` SHALL stamp a reason. A
partially-labelled death is a worse outcome than an unlabelled one, because it
presents an authoritative reason that may be wrong.

#### Scenario: No terminal path leaves the reason unset

- **GIVEN** any code path that sets a session's status to `ended`
- **WHEN** the transition completes
- **THEN** the session SHALL carry a `closedReason` from the defined vocabulary
- **AND** a path with no better information SHALL stamp `unknown` explicitly

#### Scenario: A regression test pins the seam coverage

- **GIVEN** the set of code paths that transition a session to `ended`
- **WHEN** the test suite runs
- **THEN** a test SHALL fail if a terminal path can produce an `ended` session
  with no reason stamped

### Requirement: The reason SHALL persist through the documented overwrite trap

`session-to-meta.ts` is a documented FULL OVERWRITE and does not enumerate
`closedReason`; the field reaches disk only through `metaPersistence.setLiveness`
or `writeNow`'s on-disk carry-forward. Setting `closedReason` on the in-memory
session record and relying on the routine debounced save SHALL NOT be treated as
persisting it.

Terminal paths SHALL route the reason through the liveness-persistence path that
already carries `"manual"`.

#### Scenario: Reason survives a server restart

- **GIVEN** a session that ended with a non-`manual` reason
- **WHEN** the server restarts and rescans sessions from disk
- **THEN** the session's reason SHALL still be present
- **AND** SHALL NOT have been wiped by an intervening metadata write

### Requirement: Process-liveness classification SHALL NOT overclaim

A SIGKILL, an out-of-memory kill, a process crash and a severed network link are
identical from the server's position: silence. Classification SHALL be limited to
what a probe of the session's recorded `pid` can establish, and SHALL NOT name a
specific signal or kill mechanism.

`pid` is self-reported by the bridge and is optional, and operating systems
recycle pids. The classification SHALL therefore admit an `unknown` outcome when
no pid is recorded, and its documentation SHALL state the pid-recycling caveat
rather than presenting the probe as authoritative.

#### Scenario: No recorded pid yields unknown

- **GIVEN** a session ending with no `pid` recorded
- **WHEN** the server classifies the death
- **THEN** the reason SHALL be `unknown`
- **AND** the server SHALL NOT claim the process is gone

#### Scenario: The probe never names a signal

- **GIVEN** any outcome of the pid probe
- **WHEN** the reason is presented in the UI or persisted
- **THEN** it SHALL NOT assert SIGKILL, OOM, or any specific termination cause
