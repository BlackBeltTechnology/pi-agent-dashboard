## ADDED Requirements

### Requirement: Bridge dispatches inbound messages in wire order
The bridge WebSocket message pump SHALL dispatch inbound message handlers so that
each handler runs to completion before the next inbound message is dispatched,
preserving the order messages arrived on the wire. A state-mutating message (e.g.
`set_model`) followed by a dependent message (e.g. `send_prompt`) SHALL NOT be
processed concurrently.

#### Scenario: set_model is applied before a following prompt
- **WHEN** the bridge receives `set_model` immediately followed by `send_prompt`
- **THEN** the model change SHALL be fully applied before the prompt is submitted
- **AND** the prompt SHALL run on the newly selected model, not the previous one

#### Scenario: ordering holds for a burst of mixed messages
- **WHEN** the bridge receives a burst of interleaved state-mutating and action messages
- **THEN** each SHALL be handled to completion in the order received
- **AND** none SHALL be dropped or reordered

### Requirement: A failed handler does not stall the queue
A handler that throws or rejects SHALL NOT prevent subsequent messages from being
dispatched. The failure SHALL be isolated (logged) and the pump SHALL continue
with the next message in order.

#### Scenario: a rejected handler is isolated
- **WHEN** one message's handler rejects
- **THEN** the error SHALL be caught and logged
- **AND** the next queued message SHALL still be dispatched in order

### Requirement: Inbound back-pressure is bounded
The serialized inbound queue SHALL enforce an explicit bound so a slow handler
cannot grow it without limit. The existing `maxBufferSize` governs OUTGOING
messages and SHALL NOT be conflated with the inbound bound; the inbound policy
SHALL be defined separately (drop-oldest, reject, or a distinct cap).

#### Scenario: a slow handler does not grow the queue unbounded
- **WHEN** a handler blocks while many messages arrive
- **THEN** the inbound queue SHALL apply its bounded policy rather than growing without limit
