## MODIFIED Requirements

### Requirement: Host pressure SHALL be rendered from data already on the wire

The pressure VERDICT SHALL be derived server-side and carried on the session row
as `hostPressure`, pushed to browsers on a STATE TRANSITION only.

The client SHALL NOT derive the verdict from `processMetrics.updatedAt`. That
field is written on the server on every bridge heartbeat but is carried to the
browser ONLY in the connect `sessions_snapshot` — nothing broadcasts it
afterwards — so a client deriving elapsed silence from it counts time since page
load and reads every live session as unresponsive.

This capability SHALL NOT add an endpoint or a polling loop, and a HEALTHY
session SHALL cost zero additional frames.

Because a transition frame is pushed at most once and the browser transport MAY
SHED it under backpressure, the verdict SHALL be recoverable: the shed-frame
reconcile path SHALL rebuild `hostPressure` from the live session row alongside
the other reconciled fields. A dropped recovery frame SHALL NOT be able to strand
a badge permanently.

Thresholds SHALL have a single source of truth shared by server and client; the
client SHALL NOT carry an independent copy that can drift.

#### Scenario: A pressured session renders an indicator from its existing row

- **GIVEN** a session row carrying a `hostPressure` verdict
- **WHEN** the card renders
- **THEN** a health indicator SHALL be shown derived from that verdict
- **AND** no additional network request SHALL be issued to obtain it

#### Scenario: A healthy session renders nothing

- **GIVEN** a session whose bridge is sending frames normally
- **WHEN** the card renders
- **THEN** NO indicator SHALL be rendered — a healthy card gains zero pixels, so a
  pressured card remains the sole focal point in its group (Nielsen #8; the
  Von Restorff isolation the signal depends on)
- **AND** no host-pressure frame SHALL be emitted for it

#### Scenario: Silence from the server renders nothing

- **GIVEN** a session row with no `hostPressure` (the server has said nothing yet)
- **WHEN** the card renders
- **THEN** NO indicator SHALL be rendered — the server speaks only on a
  transition, so the absence of a verdict is the healthy signal and is not
  distinguishable from it on the wire

#### Scenario: A shed verdict frame is reconciled, not lost

- **GIVEN** a browser socket saturated enough that its `session_updated` frames
  are shed
- **WHEN** a host-pressure transition (raise or recovery) occurs for a session
- **THEN** the reconcile that repays the shed frame SHALL carry the session's
  current `hostPressure`
- **AND** the browser SHALL converge on the server's verdict without a reconnect

#### Scenario: A stale metrics timestamp alone never raises a badge

- **GIVEN** a session row whose `processMetrics.updatedAt` is an hour old but
  which carries no `hostPressure` verdict
- **WHEN** the card renders
- **THEN** NO indicator SHALL be rendered

### Requirement: Freeze SHALL be signalled out-of-band, not self-reported

A blocked event loop cannot fire its own 15-second heartbeat. A session's
self-reported `eventLoopMaxMs` can therefore only describe a stall it has already
recovered from — it can never report the stall currently in progress. Treating it
as the primary freeze signal would leave the worst case invisible, which is the
failure mode that motivated this capability.

The primary freeze signal SHALL be server-side elapsed silence since the last
frame received from the bridge, measured where that fact lives — on the server.
Any frame a bridge sends SHALL count as proof of life, not heartbeats alone.
`eventLoopMaxMs` SHALL be used only as retroactive corroboration, and the two
SHALL be presented distinguishably.

#### Scenario: An ongoing stall is visible without any heartbeat

- **GIVEN** a session whose bridge has sent no frame for materially longer than
  the heartbeat interval
- **WHEN** the card renders
- **THEN** the indicator SHALL show the session as unresponsive
- **AND** SHALL NOT require a `processMetrics` update to do so

#### Scenario: Recovery clears the badge explicitly

- **GIVEN** a session that has been signalled as degraded or unresponsive
- **WHEN** any frame is received from its bridge
- **THEN** the server SHALL push an explicit cleared verdict
- **AND** the card SHALL stop rendering the indicator

#### Scenario: Carrier loss is not reported as host pressure

- **GIVEN** a session whose bridge SOCKET closes (network blip, host sleep,
  dashboard restart) while the session process itself is alive
- **WHEN** the reconnect grace window elapses without any frame
- **THEN** NO host-pressure verdict SHALL be raised for it — a wedged event loop
  keeps its socket OPEN and merely stops writing, so an OPEN socket is a
  precondition of the signal
- **AND** carrier loss SHALL remain the concern of the existing heartbeat/status
  machinery, which already models its own grace periods

#### Scenario: A session that goes away leaves no tracking state

- **GIVEN** a tracked session that unregisters, times out its heartbeat, is
  replaced by a reload, or ends
- **WHEN** it leaves the gateway by ANY of those paths
- **THEN** its pressure-tracking state and pending timers SHALL be released
- **AND** its row SHALL NOT retain a stale verdict for a later
  `sessions_snapshot` to serve

#### Scenario: The card escalates between transitions without falling below the verdict

- **GIVEN** a card showing a degraded verdict stamped with the server's receipt
  time of the last frame
- **WHEN** wall-clock time advances past the unresponsive threshold with no new
  verdict
- **THEN** the card SHALL escalate to unresponsive on its own
- **AND** a browser clock behind the server's SHALL NOT drop the card below the
  state the server signalled

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
