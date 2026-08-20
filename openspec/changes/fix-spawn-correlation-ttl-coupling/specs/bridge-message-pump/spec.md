## ADDED Requirements

### Requirement: A reportable dropped inbound message is recorded server-side
When the bridge discards an accepted inbound message **while its WebSocket to
the dashboard is connected**, it SHALL report the drop over that connection, and
the server SHALL record it in `server.log`.

There are exactly two reportable classes, matching what the drop site can
actually distinguish:

1. **Session-id mismatch** — the message's `sessionId` is not the bridge's own.
   The guard cannot tell "never mine" from "was mine, since replaced", so those
   are one class, not two.
2. **Bounded-queue overflow** — the inbound queue was full.

Drops caused by the connection itself going away are OUT of scope: when the
socket is the thing that was lost there is no channel to report over, and the
server already observes that disconnect directly.

Reporting SHALL be gated on a live connection, not merely attempted: the
bridge's send path buffers silently while the socket is down, so an ungated
report would surface after reconnect and misdescribe when the drop happened.

The record SHALL NOT depend on `keeperLog.capturePiOutput`. A `console.error`
alone SHALL NOT satisfy this requirement, because keeper output capture is
opt-in and defaults to `stdio: "ignore"`.

Each record SHALL identify the session id the message was addressed to, the
message type, and which of the two classes it belongs to.

The addressed session id SHALL travel as payload, never as the report message's
routing field: the server silently drops an inbound message whose routing
session id maps to a different connection, which is precisely the shape of a
mismatch report and would discard exactly the reports this requirement exists to
deliver.

The two classes are raised in different modules with different access to the
connection; the reporting channel SHALL be reachable from both drop sites.

#### Scenario: Session-id mismatch drop is recorded
- **WHEN** the bridge receives a message whose `sessionId` does not match its own and discards it, while connected
- **THEN** the bridge SHALL report the drop
- **AND** the server SHALL write a log line naming the addressed session id, the message type, and the mismatch class

#### Scenario: Queue-overflow drop is recorded
- **WHEN** the bounded inbound queue is full and an accepted message is discarded, while connected
- **THEN** the drop SHALL be reported and logged with the overflow class

#### Scenario: Disconnect-caused discards are not reported
- **WHEN** pending inbound messages are discarded because the socket went away
- **THEN** no drop report SHALL be attempted
- **AND** the absence of a report SHALL NOT be treated as a failure

#### Scenario: A drop while disconnected is not buffered for later
- **WHEN** a reportable drop occurs while the socket is down
- **THEN** no report SHALL be queued for delivery on reconnect
- **AND** a socket that closes between the liveness check and the send SHALL NOT result in a buffered report either

#### Scenario: A mismatch report is not dropped by session routing
- **WHEN** a bridge reports a drop for a session id it does not own
- **THEN** the report SHALL reach the server's handler
- **AND** it SHALL NOT be discarded by the server's session-ownership routing

#### Scenario: Record survives capturePiOutput disabled
- **WHEN** `keeperLog.capturePiOutput` is `false` (the default) and a reportable message is dropped while connected
- **THEN** the drop SHALL appear in `server.log`

#### Scenario: A delivered message produces no drop record
- **WHEN** an inbound message is dispatched to its handler normally
- **THEN** no drop SHALL be reported and no drop line SHALL be written

### Requirement: Drop reporting is bounded and best-effort
Drop reporting SHALL be bounded so that a sustained burst cannot amplify into
one report per dropped message.

It SHALL be best-effort: reports travel the same outbound path whose buffer can
itself overflow, and the burst that triggers suppression is the same condition
most likely to saturate that path. The contract is therefore that a drop is
recorded **when the channel permits** — not that every drop, nor every
suppression, is guaranteed to appear. No requirement SHALL promise a summary
that the same saturation can discard.

Reporting SHALL NOT throw and SHALL NOT stall the pump.

#### Scenario: Burst does not amplify
- **WHEN** a sustained overflow discards many messages in rapid succession
- **THEN** the number of drop reports emitted SHALL be bounded, well below the number of drops

#### Scenario: Saturation is not a failure
- **WHEN** a drop report cannot be sent because the outbound path is saturated
- **THEN** the bridge SHALL NOT throw, SHALL NOT retry indefinitely, and SHALL NOT stall the pump

#### Scenario: Reporting never blocks dispatch
- **WHEN** reports are being emitted
- **THEN** inbound dispatch order and throughput SHALL be unaffected
