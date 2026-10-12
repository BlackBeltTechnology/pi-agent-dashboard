## MODIFIED Requirements

### Requirement: Subscribe to all pi core event types

The bridge extension SHALL subscribe to all pi core event types defined in the extension API, with the exception of `context` and `before_provider_request` which are excluded due to payload size.

The full subscription list SHALL include:
- Already handled with enrichment: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `session_compact`, `model_select`
- New pass-through types: `tool_call`, `tool_result`, `user_bash`, `input`, `before_agent_start`, `resources_discover`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_before_tree`, `session_tree`

Forwarding is otherwise 1:1 with subscription, with exactly FOUR scoped
exceptions:

1. **Subagent progress-tick coalescing (event-type scoped).** A
   `tool_execution_update` that is a subagent progress tick
   (`toolName === "Agent"` carrying `partialResult.details.agentId`) MAY be
   COALESCED within a configured window, latest-wins. This is admissible only because
   such a tick is an idempotent snapshot with a stable key set
   (latest-supersedes), so a superseded tick carries no information its
   successor lacks.
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
   the stream's end event. Characters are delayed, never dropped. This is
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
- **WHEN** subagent progress ticks arrive faster than the configured window
- **THEN** the bridge SHALL forward the latest one per window and MAY drop the superseded ones
- **AND** every other subscribed event type SHALL still be forwarded 1:1, subject only to the system-role message exclusion, the compaction-entry redaction and vault value redaction

#### Scenario: Vault redaction delays but never drops streamed text
- **WHEN** a session holds a vault value, and a tool streams output whose last update ends with the first half of that value
- **THEN** that half is not forwarded with that update
- **AND** the tool's end event carries the complete output with the value masked

#### Scenario: No vault values means no change
- **WHEN** a session holds no vault values
- **THEN** every subscribed event is forwarded exactly as it would be without the vault
