# session-host-pressure-indicator Specification

## ADDED Requirements

### Requirement: Host pressure SHALL be rendered from data already on the wire

`processMetrics` is stored on the session record and is already carried to the
browser in `sessions_snapshot` and `session_updated`. The client receives it and
renders nothing (`grep -rn "processMetrics" packages/client/src` → zero hits).

The client SHALL render a per-session health indicator from the
`processMetrics` already present on the session row. This capability SHALL NOT
add an endpoint, a polling loop, or any additional socket traffic — the bytes are
already being sent and discarded.

#### Scenario: Indicator renders from the existing session row

- **GIVEN** a session row carrying `processMetrics`
- **WHEN** the card renders
- **THEN** a health indicator SHALL be shown derived from those metrics
- **AND** no additional network request SHALL be issued to obtain them

#### Scenario: No metrics yields an absent state, not a healthy one

- **GIVEN** a session row with no `processMetrics` (never reported, or a session
  that predates the bridge's heartbeat)
- **WHEN** the card renders
- **THEN** the indicator SHALL present an unknown/absent state
- **AND** SHALL NOT present the session as healthy

### Requirement: Freeze SHALL be signalled out-of-band, not self-reported

A blocked event loop cannot fire its own 15-second heartbeat. A session's
self-reported `eventLoopMaxMs` can therefore only describe a stall it has already
recovered from — it can never report the stall currently in progress. Treating it
as the primary freeze signal would leave the worst case invisible, which is the
failure mode that motivated this capability.

The primary freeze signal SHALL be server-side elapsed silence since the last
received frame. `eventLoopMaxMs` SHALL be used only as retroactive
corroboration, and the two SHALL be presented distinguishably.

#### Scenario: An ongoing stall is visible without any heartbeat

- **GIVEN** a session whose bridge has sent no frame for materially longer than
  the heartbeat interval
- **WHEN** the card renders
- **THEN** the indicator SHALL show the session as unresponsive
- **AND** SHALL NOT require a `processMetrics` update to do so

#### Scenario: Recovered stalls are labelled as past, not present

- **GIVEN** a session reporting a large `eventLoopMaxMs` in a heartbeat that did arrive
- **WHEN** the card renders
- **THEN** the elevated value SHALL be presented as a stall already recovered from
- **AND** SHALL NOT be presented as the session currently being frozen

#### Scenario: eventLoopMaxMs may be unavailable

- **GIVEN** a runtime where `monitorEventLoopDelay` is unavailable and
  `eventLoopMaxMs` is absent from `processMetrics`
- **WHEN** the card renders
- **THEN** the indicator SHALL still function from the out-of-band silence signal
- **AND** SHALL NOT render a corroboration value it does not have

### Requirement: An ended session SHALL present its reason

An ended session's card SHALL present the `closedReason` it carries, so a death
is distinguishable from a clean exit at a glance.

#### Scenario: Ended card shows why

- **GIVEN** an ended session carrying a `closedReason`
- **WHEN** the card renders
- **THEN** the card SHALL present the reason alongside the ended state
- **AND** a session whose reason is `unknown` SHALL say so rather than implying a clean exit

### Requirement: Metrics history is explicitly out of scope

Retaining a per-session metrics ring would require a new endpoint, server-side
storage outliving `listActive()`, and an eviction rule. It is deliberately
excluded.

The consequence SHALL be stated rather than hidden: metrics remain latest-only
and still disappear when a session leaves `listActive()`, so post-mortem
inspection of a dead session's pressure history is NOT improved by this
capability. What it improves is visibility of pressure while it is happening.

#### Scenario: Dead session metrics are not retained

- **GIVEN** a session that has ended
- **WHEN** its card is inspected afterwards
- **THEN** the absence of retained metrics history SHALL be an accepted outcome
- **AND** SHALL NOT be treated as a defect of this capability
