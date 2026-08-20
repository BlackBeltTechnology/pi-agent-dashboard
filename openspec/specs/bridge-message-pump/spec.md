# bridge-message-pump Specification

## Purpose
TBD - created by archiving change serialize-bridge-message-pump. Update Purpose after archive.
## Requirements
### Requirement: Bridge dispatches accepted inbound messages in wire order
The bridge WebSocket message pump SHALL dispatch inbound message handlers so that
each handler runs to completion before the next accepted inbound message is
dispatched, preserving the order messages arrived on the wire. A state-mutating
message (e.g. `set_model`) followed by a dependent message (e.g. `send_prompt`)
SHALL NOT be processed concurrently.

The guarantee applies to messages the pump ACCEPTED onto the serialized queue.
Two classes are outside it: a message refused by the bound in "Inbound
back-pressure is bounded", and a message routed to the immediate lane defined in
"The immediate lane is not blocked by the serialized queue". Immediate-lane
messages are by definition dispatched out of wire order relative to the queue.

#### Scenario: set_model is applied before a following prompt
- **WHEN** the bridge receives `set_model` immediately followed by `send_prompt`
- **THEN** the model change SHALL be fully applied before the prompt is submitted
- **AND** the prompt SHALL run on the newly selected model, not the previous one

#### Scenario: ordering holds for a burst of mixed messages
- **WHEN** the bridge receives a burst of interleaved state-mutating and action messages, all serialized-lane types and all within the inbound bound
- **THEN** each SHALL be handled to completion in the order received
- **AND** none SHALL be dropped or reordered

#### Scenario: cancellation is not reordered ahead of its target
- **WHEN** the bridge receives `send_prompt` immediately followed by `abort`
- **THEN** the `abort` SHALL be dispatched after the `send_prompt` handler completes
- **AND** the abort SHALL NOT be applied before the turn it cancels has started

### Requirement: The immediate lane is not blocked by the serialized queue
Three inbound types SHALL be dispatched immediately, without waiting for the
serialized queue to drain, because none of them can invalidate a message queued
behind it:

- `prompt_response` — a reply correlated by request id, so a handler awaiting a
  prompt response can never be deadlocked by its own reply being queued behind it.
- `server_restarting` — a time-critical lifecycle signal delivered immediately
  before the socket closes; queued, it would be discarded by the disconnect
  clear and its quiesce window would never take effect.
- `kill_process` — keyed to a concrete pgid of an already-running child, and the
  only mechanism able to terminate a long-running child that is itself occupying
  the serialized queue.

Every other inbound message type, **including `abort`, `shutdown` and
`flow_control`**, SHALL use the serialized queue. An unrecognized message type
SHALL default to the serialized queue.

#### Scenario: a prompt response is delivered while the queue is busy
- **WHEN** the serialized queue is occupied by a slow handler
- **AND** a `prompt_response` arrives
- **THEN** it SHALL be dispatched immediately rather than queued behind that handler

#### Scenario: a restart announcement takes effect while the queue is busy
- **WHEN** the serialized queue is occupied by a slow handler
- **AND** a `server_restarting` message arrives
- **THEN** the auto-start quiesce window SHALL be applied immediately
- **AND** it SHALL NOT be discarded by the disconnect that follows

#### Scenario: a kill reaches a child that is occupying the queue
- **WHEN** a handler is awaiting a spawned child process
- **AND** a `kill_process` for that child's pgid arrives
- **THEN** it SHALL be dispatched immediately rather than queued behind that handler

#### Scenario: an unknown message type is serialized
- **WHEN** the bridge receives a message whose type is not recognized as the reply lane
- **THEN** it SHALL be placed on the serialized queue in wire order

### Requirement: A failed handler does not stall the queue
A handler that throws or rejects SHALL NOT prevent subsequent messages from being
dispatched. The failure SHALL be isolated (logged) by the pump itself and the pump
SHALL continue with the next message in order.

#### Scenario: a rejected handler is isolated
- **WHEN** one message's handler rejects
- **THEN** the error SHALL be caught and logged
- **AND** the next queued message SHALL still be dispatched in order

### Requirement: Inbound back-pressure is bounded
The serialized inbound queue SHALL enforce an explicit bound so a slow handler
cannot grow it without limit. The existing `maxBufferSize` governs OUTGOING
messages and SHALL NOT be conflated with the inbound bound; the inbound bound
SHALL be a separate, explicitly named limit.

On overflow the pump SHALL refuse the NEWEST message, so the ordering guarantee
of the already-accepted prefix is never invalidated. A refusal SHALL be
observable beyond a rate-limited log line: a cumulative overflow-refusal count
SHALL be reported through the same diagnostics channel that already carries the
outgoing dropped-frame count, so a refusal suppressed by the log rate-limit is
still visible.

Overflow refusals SHALL be counted SEPARATELY from messages discarded on
disconnect, because disconnect discards are routine and would otherwise mask the
overflow signal.

#### Scenario: a slow handler does not grow the queue unbounded
- **WHEN** a handler blocks while more messages than the inbound bound arrive
- **THEN** the inbound queue SHALL refuse the newest arrivals rather than growing without limit
- **AND** the messages already queued SHALL still be dispatched in wire order

#### Scenario: a refusal is observable
- **WHEN** the inbound bound refuses a message
- **THEN** a rate-limited warning SHALL be logged
- **AND** the cumulative overflow-refusal count SHALL increase

#### Scenario: overflow refusals are distinguishable from disconnect discards
- **WHEN** messages are discarded by a disconnect
- **THEN** the overflow-refusal count SHALL NOT increase
- **AND** the disconnect-discard count SHALL increase

### Requirement: Pending inbound is discarded when the socket goes away
Messages still queued when the WebSocket goes away SHALL be discarded rather
than dispatched against the replacement connection, so a backlog from a dead
socket cannot head-of-line-block the reconnected one. This SHALL apply to both
an unexpected disconnect and a deliberate teardown. The discard SHALL be counted
into the disconnect-discard diagnostics. Exactly one drain loop SHALL be active
at a time, and the pump SHALL remain able to dispatch after any reconnect.

A handler already running when the socket goes away SHALL NOT delay dispatch on
the replacement connection: the replacement SHALL begin dispatching immediately,
and the superseded loop SHALL retire without dispatching any further message.

#### Scenario: a backlog does not survive a reconnect
- **WHEN** messages are queued and the socket disconnects
- **THEN** the queued messages SHALL be discarded
- **AND** messages arriving on the reconnected socket SHALL be dispatched without waiting for them

#### Scenario: a disconnect during an in-flight handler does not deadlock the pump
- **WHEN** the socket disconnects while a handler is still running
- **AND** the bridge then reconnects
- **THEN** the pump SHALL dispatch messages arriving on the new connection WITHOUT waiting for the in-flight handler to finish
- **AND** when that handler finally finishes it SHALL NOT dispatch any further message
- **AND** exactly one drain loop SHALL be active

#### Scenario: a deliberate teardown also clears the queue
- **WHEN** the connection is closed deliberately rather than by a socket failure
- **THEN** the queued messages SHALL be discarded and counted

### Requirement: A queued message for a replaced session is discarded, not misapplied
The bridge's session identity can change in place (`new`/`fork`/`resume`). A
message that was queued before such a switch SHALL NOT be applied to the new
session; it SHALL be discarded by the existing session guard at dispatch time.

#### Scenario: a message queued before a session switch is not applied after it
- **WHEN** a message addressed to the current session is queued
- **AND** the bridge switches session identity before that message is dispatched
- **THEN** the message SHALL be discarded rather than applied to the new session

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

