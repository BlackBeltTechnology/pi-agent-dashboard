# Spec Delta

## MODIFIED Requirements

### Requirement: EventBus forwarding via per-channel subscription

The bridge extension SHALL forward EventBus traffic by SUBSCRIBING to each declared channel through the host's event-subscription API, one subscription per channel, and sending an `event_forward` message from the subscription handler. The bridge SHALL NOT wrap, replace, or otherwise mutate the host's event-emit function: the host gives each extension its own event surface, so an emit-level mutation only ever observes the bridge's own emissions and never those of another extension.

Forwarding SHALL apply a core rename mapping that contains only the subagent channels:
- `subagents:created` → `subagent_created`
- `subagents:started` → `subagent_started`
- `subagents:completed` → `subagent_completed`
- `subagents:failed` → `subagent_failed`

The core mapping SHALL NOT contain any `flow:*` channel. Flow channels SHALL reach the bridge only through the flows plugin bridge's `dashboard:register-event-forward` declaration (see `flow-event-bridge`), which carries their `flow_*` event types.

A subscribed channel that has no mapping entry SHALL be forwarded using the channel name directly as the `eventType`. The former blanket rule — that ANY unknown channel emitted by ANY extension is forwarded under its own name — SHALL NOT apply: the host's event bus offers no wildcard subscription, so only declared channels are observable. That blanket rule was in any case never satisfied for a channel emitted by another extension, so no working behavior is withdrawn. A plugin needing its own channel forwarded SHALL declare it at runtime through `dashboard:register-event-forward` (see `plugin-event-forwarding`); the core mapping above is not extended for plugin channels. An emission made by the bridge ITSELF SHALL be treated exactly like any other emitter's: forwarded exactly once when its channel is declared, and NOT forwarded when it is not. There SHALL be no separate self-emit path. Consequence of retiring the wildcard: bridge-emitted control channels that are absent from the mapping (for example `flow:run`, `flow:list-flows`, `roles:*`, `ui:*`) are no longer forwarded as `event_forward`; any consumer that needs one SHALL declare that channel in the mapping.

NOTE: the scenario titles `Unknown custom extension event forwarded with channel name` and `Original emit always called` are retained verbatim because a MODIFIED requirement cannot retire a scenario name; their bodies below are normative and supersede the titles' wording. The scenario title `Known flow event forwarded with mapped name` is retained for the same reason; its body now describes the plugin-declared path.

#### Scenario: Known flow event forwarded with mapped name

- **GIVEN** the flows plugin bridge has declared `flow:flow-started` as `flow_started`
- **WHEN** any extension emits `flow:flow-started`
- **THEN** the bridge SHALL forward an `event_forward` with `eventType: "flow_started"` through the plugin declaration
- **AND** the core rename mapping SHALL NOT contain `flow:flow-started`

#### Scenario: Flow channel not forwarded without the plugin declaration

- **GIVEN** the flows plugin is disabled, so no flow channel is declared
- **WHEN** any extension emits `flow:flow-started`
- **THEN** the bridge SHALL NOT forward it

#### Scenario: Known subagent event forwarded with mapped name

- **WHEN** any extension emits `subagents:created`
- **THEN** the bridge SHALL forward an `event_forward` with `eventType: "subagent_created"`

#### Scenario: Unknown custom extension event forwarded with channel name

- **WHEN** a DECLARED channel that has no rename entry is emitted (e.g. a plugin's own `my-extension:custom-event`)
- **THEN** the bridge SHALL forward an `event_forward` whose `eventType` is the channel name
- **AND WHEN** a channel is NOT declared at all
- **THEN** the bridge SHALL NOT forward it and SHALL NOT error — an undeclared channel is unobservable, because the host bus offers no wildcard subscription

#### Scenario: Events not forwarded before session is ready

- **WHEN** a NON-subagent EventBus emission occurs before the session is ready on a core-mapped channel or a plugin channel declared with delivery `live`
- **THEN** the bridge SHALL NOT forward it and SHALL NOT retain it, and the emission SHALL still reach every other subscriber unaffected
- **AND WHEN** the emission is on a plugin channel declared with delivery `latest` or `stream`
- **THEN** it SHALL be retained per that delivery mode and flushed once the session is ready
- **AND WHEN** the emission is on a subagent channel
- **THEN** it SHALL NOT be forwarded live but SHALL be retained latest-wins per agent and flushed once the session is ready (reconcilable state, not a drop)

#### Scenario: Original emit always called

- **WHEN** any extension emits a declared channel, including when forwarding that emission fails
- **THEN** the host's emit path SHALL be unaffected — the bridge never replaces it — so every other subscriber of that channel SHALL still receive the emission and the emitting extension SHALL observe no error

#### Scenario: The bridge's own emissions are forwarded once

- **WHEN** the bridge itself emits a declared channel
- **THEN** exactly one `event_forward` SHALL be sent for it

### Requirement: Forwarded EventBus channels are an explicit declared set

The set of EventBus channels the bridge forwards SHALL be an explicit declared list: the core channel rename mapping plus channels declared at runtime by plugin bridges through `dashboard:register-event-forward`. The core mapping SHALL contain only the subagent channels; `flow:*` channels SHALL enter the set only through the flows plugin declaration. Every channel present in the core mapping SHALL be subscribed, and every accepted plugin declaration SHALL be subscribed, so no declared channel can be silently unforwarded. A channel that is not declared SHALL NOT be forwarded.

#### Scenario: Every mapped channel is subscribed

- **WHEN** the bridge finishes wiring EventBus forwarding for a ready session
- **THEN** for every channel in the rename mapping there SHALL be an active subscription that forwards that channel.

#### Scenario: A channel added to the mapping is forwarded without further wiring

- **WHEN** a new channel/event-type pair is added to the rename mapping
- **THEN** that channel SHALL be forwarded with the mapped event type, with no additional per-channel wiring required.

#### Scenario: A plugin-declared channel is forwarded without core edits

- **WHEN** a plugin bridge declares a channel that is not in the core mapping
- **THEN** that channel SHALL be forwarded with its declared event type, and no core source file SHALL name the channel.

#### Scenario: An undeclared channel is not forwarded

- **WHEN** an extension emits a channel that is neither in the core mapping nor declared by a plugin
- **THEN** the bridge SHALL NOT forward it and SHALL NOT error.

#### Scenario: Core mapping holds only subagent channels

- **WHEN** the core rename mapping is inspected
- **THEN** every channel in it SHALL start with `subagents:`
- **AND** no channel in it SHALL start with `flow:`

### Requirement: RPC probe channels are kept out of the core forwarding map

An RPC probe channel is one whose emitter passes a mutable object for handlers to fill with a result. Such a channel SHALL NOT be added to the core EventBus rename mapping, to the bridge's merged `EVENT_BUS_MAP`, or to any extra map the bridge passes to its forwarding wiring. Plugin declarations stay governed by `plugin-event-forwarding`.

#### Scenario: A probe channel is never a mapping entry
- **WHEN** a channel is added to the core mapping
- **THEN** it SHALL NOT be an RPC probe channel, because "A channel added to the mapping is forwarded without further wiring" would forward it

#### Scenario: Known probe channels are absent from the core forwarded set
- **WHEN** the core forwarded channel set is computed
- **THEN** it SHALL contain none of `flow:list-flows`, `flow:get-agents`, `models:get-available`, `model:resolve`, `role:resolve-model`, `roles:get-all`, `roles:set`, `roles:remove`, `roles:preset-load`, `roles:preset-save`, `roles:preset-delete`, `ui:list-modules`

#### Scenario: Probe emitted by the bridge itself is not forwarded
- **GIVEN** the forwarding wiring is registered, the session is ready, the bridge is active and connected, and a synchronous handler fills the probe (e.g. sets `probe.flows`)
- **WHEN** `flow:list-flows` is emitted with a probe object through the bridge's facade
- **THEN** no `event_forward` SHALL be sent for it
- **AND** the probe SHALL carry the handler's result
- **AND** a mapped channel such as `subagents:created` emitted on the same wiring SHALL still be forwarded

#### Scenario: Probe emitted by a foreign extension is not forwarded
- **GIVEN** the forwarding wiring is registered, the session is ready, the bridge is active and connected, and a synchronous handler fills the probe
- **WHEN** another extension emits `roles:get-all` with a probe object through its own facade
- **THEN** no `event_forward` SHALL be sent for it
- **AND** the probe SHALL carry the handler's result
