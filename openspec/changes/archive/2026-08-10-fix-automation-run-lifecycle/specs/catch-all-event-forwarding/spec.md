## RENAMED Requirements

- FROM: `### Requirement: EventBus catch-all via emit intercept`
- TO: `### Requirement: EventBus forwarding via per-channel subscription`
- FROM: `### Requirement: EventBus intercept installed once at extension init`
- TO: `### Requirement: EventBus subscriptions established once at extension init`

## ADDED Requirements

### Requirement: Foreign-extension EventBus events are forwarded live

An EventBus event emitted by an extension OTHER than the bridge extension SHALL be forwarded to the dashboard server as an `event_forward` message while the emitting work is still in progress, without depending on session replay or on any persisted transcript record. This SHALL hold for every subscribed channel, in particular the flow channels emitted by the flows engine and the subagent channels emitted by the subagents extension.

Forwarding SHALL NOT depend on the bridge being the emitter, and SHALL NOT depend on mutating any function the host exposes to the bridge, because the host gives every extension its own event surface: a mutation applied to the bridge's surface is invisible to other extensions.

#### Scenario: Flow completion emitted by the flows extension is forwarded live

- **GIVEN** a live session in which the flows extension runs a flow to completion
- **WHEN** the flows extension emits its flow-complete channel
- **THEN** the bridge SHALL send an `event_forward` with `eventType: "flow_complete"` for that session before the session ends
- **AND** a server-side subscriber SHALL observe that event without any session replay or cold hydration having occurred.

#### Scenario: Subagent lifecycle emitted by the subagents extension is forwarded live

- **GIVEN** a live session in which the subagents extension starts and completes a subagent
- **WHEN** the subagents extension emits its subagent channels
- **THEN** the bridge SHALL forward each as an `event_forward` with the mapped `subagent_*` event type, subject to the existing not-ready buffering behavior.

#### Scenario: Persisted-transcript replay is not the delivery path

- **GIVEN** a headless session that never reconnects and is never cold-hydrated
- **WHEN** a flow completes in that session
- **THEN** the forwarded `flow_complete` SHALL still have been delivered live
- **AND** correctness SHALL NOT rely on the flows engine's persisted transcript records.

### Requirement: Forwarded EventBus channels are an explicit declared set

The set of EventBus channels the bridge forwards SHALL be an explicit declared list. Every channel present in the bridge's channel rename mapping SHALL be subscribed, so no mapped channel can be silently unforwarded. A channel that is not declared SHALL NOT be forwarded.

#### Scenario: Every mapped channel is subscribed

- **WHEN** the bridge finishes wiring EventBus forwarding for a ready session
- **THEN** for every channel in the rename mapping there SHALL be an active subscription that forwards that channel.

#### Scenario: A channel added to the mapping is forwarded without further wiring

- **WHEN** a new channel/event-type pair is added to the rename mapping
- **THEN** that channel SHALL be forwarded with the mapped event type, with no additional per-channel wiring required.

#### Scenario: An undeclared channel is not forwarded

- **WHEN** an extension emits a channel that is not in the declared set
- **THEN** the bridge SHALL NOT forward it and SHALL NOT error.

## MODIFIED Requirements

### Requirement: EventBus forwarding via per-channel subscription

The bridge extension SHALL forward EventBus traffic by SUBSCRIBING to each declared channel through the host's event-subscription API, one subscription per channel, and sending an `event_forward` message from the subscription handler. The bridge SHALL NOT wrap, replace, or otherwise mutate the host's event-emit function: the host gives each extension its own event surface, so an emit-level mutation only ever observes the bridge's own emissions and never those of another extension.

Forwarding SHALL apply a rename mapping for known channels:
- `flow:flow-started` → `flow_started`
- `flow:agent-started` → `flow_agent_started`
- `flow:agent-complete` → `flow_agent_complete`
- `flow:subagent-tool-call` → `flow_tool_call`
- `flow:subagent-tool-result` → `flow_tool_result`
- `flow:assistant-text` → `flow_assistant_text`
- `flow:thinking-text` → `flow_thinking_text`
- `flow:loop-iteration` → `flow_loop_iteration`
- `flow:auto-decision` → `flow_auto_decision`
- `flow:complete` → `flow_complete`
- `subagents:created` → `subagent_created`
- `subagents:started` → `subagent_started`
- `subagents:completed` → `subagent_completed`
- `subagents:failed` → `subagent_failed`

A subscribed channel that has no mapping entry SHALL be forwarded using the channel name directly as the `eventType`. The former blanket rule — that ANY unknown channel emitted by ANY extension is forwarded under its own name — SHALL NOT apply: the host's event bus offers no wildcard subscription, so only declared channels are observable. That blanket rule was in any case never satisfied for a channel emitted by another extension, so no working behavior is withdrawn. A plugin needing its own channel forwarded SHALL declare it in the channel mapping (identity entry when no rename is wanted). Emissions made by the bridge itself SHALL be forwarded exactly once, on the same subscription path as any other emitter's — no separate self-emit path.

NOTE: the scenario titles `Unknown custom extension event forwarded with channel name` and `Original emit always called` are retained verbatim because a MODIFIED requirement cannot retire a scenario name; their bodies below are normative and supersede the titles' wording.

#### Scenario: Known flow event forwarded with mapped name

- **WHEN** any extension emits `flow:flow-started`
- **THEN** the bridge SHALL forward an `event_forward` with `eventType: "flow_started"`

#### Scenario: Known subagent event forwarded with mapped name

- **WHEN** any extension emits `subagents:created`
- **THEN** the bridge SHALL forward an `event_forward` with `eventType: "subagent_created"`

#### Scenario: Unknown custom extension event forwarded with channel name

- **WHEN** a DECLARED channel that has no rename entry is emitted (e.g. a plugin's own `my-extension:custom-event`)
- **THEN** the bridge SHALL forward an `event_forward` whose `eventType` is the channel name
- **AND WHEN** a channel is NOT declared at all
- **THEN** the bridge SHALL NOT forward it and SHALL NOT error — an undeclared channel is unobservable, because the host bus offers no wildcard subscription

#### Scenario: Events not forwarded before session is ready

- **WHEN** an EventBus emission occurs before the session is ready
- **THEN** the bridge SHALL NOT forward it, and the emission SHALL still reach every other subscriber unaffected

#### Scenario: Original emit always called

- **WHEN** any extension emits a declared channel, including when forwarding that emission fails
- **THEN** the host's emit path SHALL be unaffected — the bridge never replaces it — so every other subscriber of that channel SHALL still receive the emission and the emitting extension SHALL observe no error

#### Scenario: The bridge's own emissions are forwarded once

- **WHEN** the bridge itself emits a declared channel
- **THEN** exactly one `event_forward` SHALL be sent for it

### Requirement: EventBus subscriptions established once at extension init

EventBus forwarding subscriptions SHALL be established once per bridge instance and SHALL survive until that bridge instance is superseded or torn down. The not-ready guard SHALL prevent premature forwarding, so subscriptions MAY be established before the session is ready.

On teardown or reload the bridge SHALL release its own subscriptions, and SHALL NOT restore or otherwise write back any host emit function — it never replaced one.

NOTE: the scenario titles `Intercept installed at init` and `Cleanup restores original emit` are retained verbatim because a MODIFIED requirement cannot retire a scenario name; their bodies below are normative and describe subscriptions, not an intercept.

#### Scenario: Intercept installed at init

- **WHEN** the bridge extension loads
- **THEN** it SHALL subscribe to each declared channel exactly once, and a second wiring pass SHALL NOT produce duplicate `event_forward` messages for a single emission

#### Scenario: Cleanup restores original emit

- **WHEN** the bridge extension reloads or shuts down
- **THEN** its EventBus subscriptions SHALL be released
- **AND** no host emit function SHALL be reassigned as part of cleanup — there is nothing to restore, because nothing was replaced
