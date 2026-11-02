## MODIFIED Requirements

### Requirement: A same-process reconnect is not a contention
When the registering socket reports the same pid the gateway has recorded for the
incumbent, it is the same pi process reconnecting after a lost or in-flight close
frame. The gateway SHALL replace the routing entry rather than refuse. The
reported pid SHALL be used only to avoid a refusal, never to justify one. The
same-pid rule SHALL apply only when the registering session's pid target is
`host`, or `unknown` on a Windows server (`force-kill-handler` *A recorded pid is
used only in its resolved pid target*). Otherwise the register SHALL be decided as
a contention.

#### Scenario: Same pid replaces rather than is refused
- **WHEN** socket B registers for session `S` held by socket A
- **AND** B reports the same pid recorded for the incumbent
- **THEN** socket B SHALL become the routing entry for `S`
- **AND** socket B SHALL NOT be refused or closed

#### Scenario: A differing pid grants no advantage
- **WHEN** socket B registers for session `S` held by a live socket A
- **AND** B reports a pid different from the incumbent's
- **THEN** the contention SHALL be resolved by the probe rule alone

#### Scenario: A placeholder incumbent is never protected
- **WHEN** the routing entry for `S` is held by an auto-created placeholder that
  has never completed a `session_register`
- **AND** a socket sends `session_register` for `S`
- **THEN** the register SHALL be accepted and SHALL become the routing entry
- **AND** it SHALL NOT be refused on contention grounds

#### Scenario: A non-local same pid is not a same-process reconnect
- **WHEN** socket B registers for session `S` held by socket A with the same pid number
- **AND** B's pid target is not local
- **THEN** the register SHALL be decided as a contention, not as a same-process replace

#### Scenario: An incumbent in another namespace is not the same process
- **WHEN** socket B registers for session `S` with the same pid number as the incumbent's recorded pid
- **AND** B's pid target is `host` but the incumbent's recorded pid target is not `host`
- **THEN** the register SHALL be decided as a contention
- **AND** the same-pid replace SHALL apply only when both targets are `host`, or both are `unknown` on a Windows server
