## ADDED Requirements

### Requirement: RPC probe channels are kept out of the core forwarding map

An RPC probe channel is one whose emitter passes a mutable object for handlers to fill with a result. Such a channel SHALL NOT be added to the core EventBus rename mapping, to the bridge's merged `EVENT_BUS_MAP`, or to any extra map the bridge passes to its forwarding wiring. Plugin declarations stay governed by `plugin-event-forwarding`.

#### Scenario: A probe channel is never a mapping entry
- **WHEN** a channel is added to the core mapping
- **THEN** it SHALL NOT be an RPC probe channel, because "A channel added to the mapping is forwarded without further wiring" would forward it

#### Scenario: Known probe channels are absent from the core forwarded set
- **WHEN** the core forwarded channel set is computed
- **THEN** it SHALL contain none of `flow:list-flows`, `flow:get-agents`, `flow:get-available-models`, `model:resolve`, `role:resolve-model`, `roles:get-all`, `roles:set`, `roles:remove`, `roles:preset-load`, `roles:preset-save`, `roles:preset-delete`, `ui:list-modules`

#### Scenario: Probe emitted by the bridge itself is not forwarded
- **GIVEN** the forwarding wiring is registered, the session is ready, the bridge is active and connected, and a synchronous handler fills the probe (e.g. sets `probe.flows`)
- **WHEN** `flow:list-flows` is emitted with a probe object through the bridge's facade
- **THEN** no `event_forward` SHALL be sent for it
- **AND** the probe SHALL carry the handler's result
- **AND** a mapped channel such as `flow:complete` emitted on the same wiring SHALL still be forwarded

#### Scenario: Probe emitted by a foreign extension is not forwarded
- **GIVEN** the forwarding wiring is registered, the session is ready, the bridge is active and connected, and a synchronous handler fills the probe
- **WHEN** another extension emits `roles:get-all` with a probe object through its own facade
- **THEN** no `event_forward` SHALL be sent for it
- **AND** the probe SHALL carry the handler's result
