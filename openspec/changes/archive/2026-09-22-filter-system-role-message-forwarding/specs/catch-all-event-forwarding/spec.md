# catch-all-event-forwarding — delta

## MODIFIED Requirements

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

## ADDED Requirements

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
