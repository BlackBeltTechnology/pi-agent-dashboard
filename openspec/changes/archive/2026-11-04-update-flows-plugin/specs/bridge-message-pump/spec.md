# Spec Delta

## MODIFIED Requirements

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

Every other inbound message type, **including `abort` and `shutdown`**, SHALL
use the serialized queue. An unrecognized message type SHALL default to the
serialized queue.

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

#### Scenario: a retired flow_control message has no side effect
- **WHEN** the bridge receives a message of the retired type `flow_control`
- **THEN** it SHALL be handled as an unrecognized type on the serialized queue
- **AND** dispatching it SHALL emit no `pi.events` event, send no outbound message and change no bridge state
