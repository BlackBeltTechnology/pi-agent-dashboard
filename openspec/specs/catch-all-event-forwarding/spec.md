## Purpose

Catch-all event forwarding from the bridge extension to the dashboard server. The bridge subscribes to all pi core event types and intercepts EventBus emissions, forwarding everything as `event_forward` messages. Unknown event types render as expandable JSON cards in the dashboard client.

## Requirements

### Requirement: Subscribe to all pi core event types

The bridge extension SHALL subscribe to all pi core event types defined in the extension API, with the exception of `context` and `before_provider_request` which are excluded due to payload size.

The full subscription list SHALL include:
- Already handled with enrichment: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `session_compact`, `model_select`
- New pass-through types: `tool_call`, `tool_result`, `user_bash`, `input`, `before_agent_start`, `resources_discover`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_before_tree`, `session_tree`

Forwarding is otherwise 1:1 with subscription, with exactly THREE scoped
exceptions:

1. **Subagent progress-tick coalescing (event-type scoped).** A
   `tool_execution_update` that is a subagent progress tick
   (`toolName === "Agent"` carrying `partialResult.details.agentId`) MAY be
   COALESCED within a configured window, latest-wins. Admissible only because
   such a tick is an idempotent snapshot with a stable key set
   (latest-supersedes), so a superseded tick carries no information its
   successor lacks.
2. **System-role message exclusion (message-role scoped).** A `message_start`
   or `message_end` whose `message.role === "system"` SHALL NOT be forwarded, as
   specified in "pi 0.86 system-role messages are not forwarded" below.
   Admissible only because the payload has no consumer anywhere downstream and
   carries no state the dashboard derives.
3. **Compaction-entry redaction (field scoped).** A `session_compact` event
   SHALL be forwarded without its `compactionEntry` field, as specified in
   "session_compact is forwarded without compactionEntry" below. Admissible only
   because no dashboard code reads that field and the replay path already emits
   the event without it.

No exception SHALL extend to any other event type, tool, message role, or field
beyond those enumerated above. Each admits a payload that provably has no
consumer; none may be read as licence to drop data a consumer derives state from.

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
- **WHEN** subagent progress ticks arrive faster than the configured window
- **THEN** the bridge SHALL forward the latest one per window and MAY drop the superseded ones
- **AND** every other subscribed event type SHALL still be forwarded 1:1, subject only to the system-role message exclusion and the compaction-entry redaction

### Requirement: Control events handled specially and not forwarded as event_forward
The following pi core events have dedicated handlers in the bridge that produce their own protocol messages (e.g., `session_register`, disconnect). They SHALL NOT be forwarded as `event_forward` messages to avoid redundant data:

- `session_start` — triggers session registration (`session_register` protocol message), context caching, model/git info sync, and flow event wiring. Produces its own protocol flow.
- `session_switch` — updates the bridge's `sessionId` and sends a new `session_register`. The old session is implicitly replaced.
- `session_fork` — same as `session_switch`: updates `sessionId`, sends `session_register`.
- `session_shutdown` — triggers WebSocket disconnect and cleanup. No `event_forward` needed; the server detects disconnection via the WebSocket close.

These events are fully handled by their dedicated `pi.on()` callbacks and are excluded from both the enriched and pass-through subscription lists.

#### Scenario: session_start not forwarded as event_forward
- **WHEN** a `session_start` event fires
- **THEN** the bridge SHALL handle it via its dedicated callback (session registration) and SHALL NOT send an `event_forward` message

#### Scenario: session_shutdown not forwarded as event_forward
- **WHEN** a `session_shutdown` event fires
- **THEN** the bridge SHALL handle it via its dedicated callback (disconnect/cleanup) and SHALL NOT send an `event_forward` message

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

A subscribed channel that has no mapping entry SHALL be forwarded using the channel name directly as the `eventType`. The former blanket rule — that ANY unknown channel emitted by ANY extension is forwarded under its own name — SHALL NOT apply: the host's event bus offers no wildcard subscription, so only declared channels are observable. That blanket rule was in any case never satisfied for a channel emitted by another extension, so no working behavior is withdrawn. A plugin needing its own channel forwarded SHALL declare it in the channel mapping (identity entry when no rename is wanted). An emission made by the bridge ITSELF SHALL be treated exactly like any other emitter's: forwarded exactly once when its channel is declared, and NOT forwarded when it is not. There SHALL be no separate self-emit path. Consequence of retiring the wildcard: bridge-emitted control channels that are absent from the mapping (for example `flow:run`, `flow:list-flows`, `roles:*`, `ui:*`) are no longer forwarded as `event_forward`; any consumer that needs one SHALL declare that channel in the mapping.

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

- **WHEN** a NON-subagent EventBus emission occurs before the session is ready
- **THEN** the bridge SHALL NOT forward it and SHALL NOT retain it, and the emission SHALL still reach every other subscriber unaffected
- **AND WHEN** the emission is on a subagent channel
- **THEN** it SHALL NOT be forwarded live but SHALL be retained latest-wins per agent and flushed once the session is ready (reconcilable state, not a drop)

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

### Requirement: pi 0.86 system-role messages are not forwarded

The bridge SHALL NOT forward `message_start` or `message_end` events whose
`message.role === "system"` as `event_forward` messages. pi >= 0.86.0 emits such
messages for the transcript-backed system prompt and tool loadout (first request
of a session, and every later prompt/tool patch); they carry every prompt section
and the full tool declaration list, no assistant content, and the dashboard has
no consumer for them.

The exclusion SHALL NOT be version-gated: pi < 0.86 never emits the role, so the
check is inert there.

The exclusion SHALL apply to the message role only. It SHALL NOT change which
event types are subscribed, and `message_start` / `message_end` for every other
role SHALL remain forwarded.

The exclusion SHALL NOT weaken the bridge's parked-snapshot ordering guarantee:
a parked update snapshot is flushed at handler entry for every non-`message_update`
event, and a dropped system message SHALL be subject to that same entry-level
flush rather than bypassing it.

#### Scenario: System message_start and message_end are dropped
- **WHEN** pi emits `message_start` then `message_end` with
  `message.role === "system"`
- **THEN** the bridge SHALL send no `event_forward` for either

#### Scenario: A parked snapshot is not stranded by a dropped system message
- **GIVEN** an update snapshot for a previous message identity is parked in the
  coalescer
- **WHEN** pi emits `message_start` with `message.role === "system"`
- **THEN** the parked snapshot SHALL still reach the wire, in order, ahead of
  any later forwarded event
- **AND** no `event_forward` SHALL be sent for the system message itself

#### Scenario: Assistant messages after a system message still forward
- **GIVEN** a `role:"system"` pair was just dropped
- **WHEN** pi emits `message_start` / `message_end` with
  `message.role === "assistant"`
- **THEN** both SHALL be forwarded as before

#### Scenario: Custom message handling is unchanged
- **WHEN** pi emits `message_start` with `message.role === "custom"`
- **THEN** the barrier SHALL still run before the custom early-return
  (existing behaviour preserved)

### Requirement: session_compact is forwarded without compactionEntry

The bridge SHALL forward `session_compact` events with the `compactionEntry`
field omitted. That field carries the prompt/tool `systemMessage` checkpoint and
the compaction `summary`, neither of which any dashboard consumer reads.

Every other field on the event SHALL be preserved, so that compaction rendering
and metadata extraction are unaffected: the client derives the compaction
divider from the event's presence and its badge from `reason`, `willRetry` and
`estimatedPostCompactionTokens`; the server uses the event only to clear the
`compacting` status flag.

The redaction SHALL NOT mutate the event object pi supplies. pi delivers the
same event object to every subscribed extension, so the bridge SHALL forward a
copy with the field omitted and leave the original intact.

The redaction SHALL NOT change the existing live-versus-replay parity contract.
Parity for a compaction boundary is defined on event type, position and
timestamp, and replay metadata need not match a live event's metadata; this
requirement removes a live-only payload and leaves that contract unchanged.

#### Scenario: compactionEntry is stripped from the forwarded event
- **WHEN** pi emits `session_compact` carrying a `compactionEntry` with a
  `systemMessage` and a `summary`
- **THEN** the bridge SHALL forward a `session_compact` event
- **AND** the forwarded payload SHALL NOT contain a `compactionEntry` field
- **AND** the forwarded payload SHALL contain no substring of the
  `systemMessage` or the `summary`

#### Scenario: Consumer-visible compaction fields survive redaction
- **WHEN** pi emits `session_compact` with `reason: "threshold"` and
  `willRetry: false`
- **THEN** the forwarded payload SHALL still carry `reason` and `willRetry`
- **AND** the client SHALL still render the compaction divider
- **AND** the server SHALL still clear the `compacting` status flag

#### Scenario: A compaction event with no entry is unaffected
- **WHEN** pi emits `session_compact` with no `compactionEntry` field
- **THEN** the bridge SHALL forward it unchanged apart from the absent field

#### Scenario: pi's event object is not mutated by the redaction
- **GIVEN** another extension is also subscribed to `session_compact`
- **WHEN** the bridge redacts the event for forwarding
- **THEN** the event object pi supplied SHALL still carry its `compactionEntry`
- **AND** the other extension SHALL observe the field unchanged
