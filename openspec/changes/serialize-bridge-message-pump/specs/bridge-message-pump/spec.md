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
