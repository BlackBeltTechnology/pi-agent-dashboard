## MODIFIED Requirements

### Requirement: The `tool_call` `terminate` result field SHALL be recorded as having no dashboard consumer

pi 0.84.1 added `ToolCallEventResult.terminate?: boolean` (`dist/core/extensions/types.d.ts`), which lets an extension stop an all-terminating tool batch without another model call. It takes effect ONLY for a handler that blocks the call.

The dashboard bridge forwards `tool_call` as a pass-through event. It ALSO registers a blocking `tool_call` handler — **subagent fan-out admission** (change: `bound-subagent-fanout-under-host-pressure`) — which answers `{ block: true, reason }` for an over-cap `Agent` call so the call ends with a real errored tool result rather than an unanswered card that spins forever. That handler deliberately does NOT set `terminate`: a refusal is "not now", not a task failure, so the batch is not terminated and the model may re-issue after the running children finish. The dashboard SHALL keep recording `terminate` as audited-with-no-consumer and SHALL NOT set it.

#### Scenario: The pass-through forwarder does not block tool calls

- **WHEN** the bridge's pass-through `tool_call` forwarder is inspected
- **THEN** `tool_call` SHALL appear in the pass-through event list
- **AND** that handler SHALL return no `block` and no `terminate` result

#### Scenario: The admission handler blocks but never terminates

- **GIVEN** an `Agent` call refused by subagent fan-out admission
- **WHEN** the blocking handler's result is inspected
- **THEN** it SHALL carry `block: true` and a reason
- **AND** it SHALL NOT set `terminate`
- **AND** the blocked call SHALL still yield a terminal errored tool result

#### Scenario: A future blocking handler makes the field live

- **WHEN** a later change makes a blocking `tool_call` handler set `terminate: true`
- **THEN** this requirement SHALL be revisited, because `terminate` then governs whether the blocked batch triggers a follow-up model call
