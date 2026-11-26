# Spec Delta

## MODIFIED Requirements

### Requirement: EventBus forwarding via per-channel subscription

The bridge extension SHALL forward EventBus traffic by SUBSCRIBING to each declared channel through the host's event-subscription API, one subscription per channel, and sending an `event_forward` message from the subscription handler. The bridge SHALL NOT wrap, replace, or otherwise mutate the host's event-emit function: the host gives each extension its own event surface, so an emit-level mutation only ever observes the bridge's own emissions and never those of another extension.

Forwarding SHALL apply no core rename mapping: core SHALL NOT name any plugin channel. Subagent channels SHALL reach the bridge only through the subagents plugin bridge's `dashboard:register-event-forward` declaration, and flow channels only through the flows plugin bridge's declaration (see `flow-event-bridge`); each declaration carries its event types.

A subscribed channel that has no mapping entry SHALL be forwarded using the channel name directly as the `eventType`. The former blanket rule — that ANY unknown channel emitted by ANY extension is forwarded under its own name — SHALL NOT apply: the host's event bus offers no wildcard subscription, so only declared channels are observable. That blanket rule was in any case never satisfied for a channel emitted by another extension, so no working behavior is withdrawn. A plugin needing its own channel forwarded SHALL declare it at runtime through `dashboard:register-event-forward` (see `plugin-event-forwarding`); the core mapping above is not extended for plugin channels. An emission made by the bridge ITSELF SHALL be treated exactly like any other emitter's: forwarded exactly once when its channel is declared, and NOT forwarded when it is not. There SHALL be no separate self-emit path. Consequence of retiring the wildcard: bridge-emitted control channels that are not declared (for example `flow:run`, `flow:list-flows`, `roles:*`, `ui:*`) are no longer forwarded as `event_forward`; any consumer that needs one SHALL declare that channel through `dashboard:register-event-forward`.

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

- **GIVEN** the subagents plugin bridge has declared `subagents:created` as `subagent_created`
- **WHEN** any extension emits `subagents:created`
- **THEN** the bridge SHALL forward an `event_forward` with `eventType: "subagent_created"` through the plugin declaration
- **AND WHEN** the subagents plugin is absent
- **THEN** the bridge SHALL NOT forward it

#### Scenario: Unknown custom extension event forwarded with channel name

- **WHEN** a DECLARED channel that has no rename entry is emitted (e.g. a plugin's own `my-extension:custom-event`)
- **THEN** the bridge SHALL forward an `event_forward` whose `eventType` is the channel name
- **AND WHEN** a channel is NOT declared at all
- **THEN** the bridge SHALL NOT forward it and SHALL NOT error — an undeclared channel is unobservable, because the host bus offers no wildcard subscription

#### Scenario: Events not forwarded before session is ready

- **WHEN** an EventBus emission occurs before the session is ready on a plugin channel declared with delivery `live`
- **THEN** the bridge SHALL NOT forward it and SHALL NOT retain it, and the emission SHALL still reach every other subscriber unaffected
- **AND WHEN** the emission is on a plugin channel declared with delivery `latest` or `stream`
- **THEN** it SHALL be retained per that delivery mode and flushed once the session is ready
- **AND WHEN** the emission is on a subagent lifecycle channel
- **THEN** it SHALL be retained by the subagents plugin's grouped `latest` declaration, newest per agent, and flushed once the session is ready

#### Scenario: Original emit always called

- **WHEN** any extension emits a declared channel, including when forwarding that emission fails
- **THEN** the host's emit path SHALL be unaffected — the bridge never replaces it — so every other subscriber of that channel SHALL still receive the emission and the emitting extension SHALL observe no error

#### Scenario: The bridge's own emissions are forwarded once

- **WHEN** the bridge itself emits a declared channel
- **THEN** exactly one `event_forward` SHALL be sent for it

### Requirement: Forwarded EventBus channels are an explicit declared set

The set of EventBus channels the bridge forwards SHALL be an explicit declared list: the channels declared at runtime by plugin bridges through `dashboard:register-event-forward`. Core SHALL declare no plugin channel; `subagents:*` and `flow:*` channels SHALL enter the set only through their plugins' declarations. Every accepted plugin declaration SHALL be subscribed, so no declared channel can be silently unforwarded. A channel that is not declared SHALL NOT be forwarded.

#### Scenario: Every mapped channel is subscribed

- **WHEN** the bridge finishes wiring EventBus forwarding for a ready session
- **THEN** for every accepted plugin-declared channel there SHALL be an active subscription that forwards that channel.

#### Scenario: A channel added to the mapping is forwarded without further wiring

- **WHEN** a plugin adds a new channel/event-type pair to its declaration
- **THEN** that channel SHALL be forwarded with the declared event type, with no additional per-channel wiring required.

#### Scenario: A plugin-declared channel is forwarded without core edits

- **WHEN** a plugin bridge declares a channel that is not in the core mapping
- **THEN** that channel SHALL be forwarded with its declared event type, and no core source file SHALL name the channel.

#### Scenario: An undeclared channel is not forwarded

- **WHEN** an extension emits a channel that no plugin declared
- **THEN** the bridge SHALL NOT forward it and SHALL NOT error.

#### Scenario: Core mapping holds only subagent channels

- **WHEN** core bridge sources are inspected
- **THEN** they SHALL contain no channel rename mapping
- **AND** no `subagents:` or `flow:` channel name

### Requirement: Subscribe to all pi core event types

The bridge extension SHALL subscribe to all pi core event types defined in the extension API, with the exception of `context` and `before_provider_request` which are excluded due to payload size.

The full subscription list SHALL include:
- Already handled with enrichment: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `session_compact`, `model_select`
- New pass-through types: `tool_call`, `tool_result`, `user_bash`, `input`, `before_agent_start`, `resources_discover`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_before_tree`, `session_tree`

Forwarding is otherwise 1:1 with subscription, with exactly FOUR scoped
exceptions:

1. **Plugin-declared tool-update filter (tool scoped).** A
   `tool_execution_update` of a tool whose claiming plugin declared a
   tool-update filter (`plugin-tool-update-filter`) SHALL be forwarded with the
   declared paths removed. Core SHALL NOT coalesce or throttle any tool update.
   This is admissible only because the filter drops fields the owning plugin
   rebuilds from its own streams.
2. **System-role message exclusion (message-role scoped).** A `message_start`
   or `message_end` whose `message.role === "system"` SHALL NOT be forwarded, as
   specified in "pi 0.86 system-role messages are not forwarded" below.
   This is admissible only because the payload has no consumer anywhere downstream and
   carries no state the dashboard derives.
3. **Compaction-entry redaction (field scoped).** A `session_compact` event
   SHALL be forwarded without its `compactionEntry` field, as specified in
   "session_compact is forwarded without compactionEntry" below. This is admissible only
   because no dashboard code reads that field and the replay path already emits
   the event without it.
4. **Vault value redaction (value scoped).** While the session holds
   credential-vault values (see `credential-delivery`), every forwarded payload
   SHALL be a copy in which each exact occurrence of such a value is replaced by
   a redaction marker. For streamed tool output (`tool_execution_update`) and
   streamed message text (`message_update`), the bridge MAY delay forwarding the
   trailing characters of the stream, up to one fewer than the longest held
   value. The delayed characters SHALL be sent, masked, with the next update or
   the stream's end event, and in any case before any later event of the
   session is forwarded, so event order is preserved. Characters are delayed,
   never dropped. This is
   admissible only because the replaced text is a secret that no consumer may
   derive state from. While no values are held, this exception SHALL NOT apply.

No exception SHALL extend to any other event type, tool, message role, or field
beyond those enumerated above. Each exception admits a payload that provably has no
consumer. None of them may be read as licence to drop data from which a consumer
derives state.

#### Scenario: Known enriched events retain special handling
- **WHEN** a `model_select` event fires
- **THEN** the bridge SHALL enrich it with `thinkingLevel` and forward as `event_forward` (server extracts model/thinkingLevel via `extractSessionUpdates`)

#### Scenario: New pass-through events are forwarded
- **WHEN** a `tool_call` event fires from the pi extension runner
- **THEN** the bridge SHALL forward it as an `event_forward` message with `eventType: "tool_call"` and the serialized event data

#### Scenario: Excluded events are not subscribed
- **WHEN** the bridge initializes
- **THEN** it SHALL NOT subscribe to `context` or `before_provider_request` events

#### Scenario: Subagent progress ticks may be coalesced, nothing else may
- **WHEN** `Agent` progress ticks arrive at the producer's rate
- **THEN** the bridge SHALL forward every one of them, with only the subagents plugin's declared paths removed, and SHALL NOT coalesce them
- **AND** every other subscribed event type SHALL still be forwarded 1:1, subject only to the system-role message exclusion, the compaction-entry redaction and vault value redaction

#### Scenario: Vault redaction delays but never drops streamed text
- **WHEN** a session holds a vault value, and a tool streams output whose last update ends with the first half of that value
- **THEN** that half is not forwarded with that update
- **AND** the tool's end event carries the complete output with the value masked

#### Scenario: Held characters never cross a later event
- **WHEN** a session holds a vault value, a message stream has delayed characters, and a `tool_execution_start` event follows
- **THEN** the delayed characters are forwarded before the `tool_execution_start` event

#### Scenario: No vault values means no change
- **WHEN** a session holds no vault values
- **THEN** every subscribed event is forwarded exactly as it would be without the vault

### Requirement: Foreign-extension EventBus events are forwarded live

An EventBus event emitted by an extension OTHER than the bridge extension SHALL be forwarded to the dashboard server as an `event_forward` message while the emitting work is still in progress, without depending on session replay or on any persisted transcript record. This SHALL hold for every subscribed channel, in particular the flow channels emitted by the flows engine and the subagent channels emitted by the subagents extension, each once its owning plugin has declared it.

Forwarding SHALL NOT depend on the bridge being the emitter, and SHALL NOT depend on mutating any function the host exposes to the bridge, because the host gives every extension its own event surface: a mutation applied to the bridge's surface is invisible to other extensions.

#### Scenario: Flow completion emitted by the flows extension is forwarded live

- **GIVEN** a live session in which the flows extension runs a flow to completion
- **WHEN** the flows extension emits its flow-complete channel
- **THEN** the bridge SHALL send an `event_forward` with `eventType: "flow_complete"` for that session before the session ends
- **AND** a server-side subscriber SHALL observe that event without any session replay or cold hydration having occurred.

#### Scenario: Subagent lifecycle emitted by the subagents extension is forwarded live

- **GIVEN** a live session in which the subagents extension starts and completes a subagent
- **WHEN** the subagents extension emits its subagent channels
- **THEN** the bridge SHALL forward each as an `event_forward` with the `subagent_*` event type the subagents plugin declared, subject to that declaration's not-ready retention.

#### Scenario: Persisted-transcript replay is not the delivery path

- **GIVEN** a headless session that never reconnects and is never cold-hydrated
- **WHEN** a flow completes in that session
- **THEN** the forwarded `flow_complete` SHALL still have been delivered live
- **AND** correctness SHALL NOT rely on the flows engine's persisted transcript records.
