## ADDED Requirements

### Requirement: Event-dispatch actions declare their completion signal

An event-dispatch action contribution (one providing `buildEvent`) MAY declare,
in its `buildEvent` return, a `completion` object naming the forwarded event type
that signals a run of that action has finished, plus an optional summarizer that
derives the run result from that event's payload. The completion declaration
travels across the action publish/collect bus with the rest of the contribution;
the automation plugin SHALL NOT hardcode any action-specific completion event.

#### Scenario: Action declares completion alongside its start event

- **WHEN** an action's `buildEvent` returns `{ eventType, data, completion: { eventType, summarize } }`
- **THEN** the collected registry carries the `completion` declaration for that run's dispatch.

### Requirement: Event-dispatched runs finalize on their declared completion event

An event-dispatched run produces no agent turn in the host session and therefore
emits no `agent_end`. When such a run declared a `completion` event, the engine
SHALL finalize the run the first time it observes that declared event for the
run's session: it captures the run result (buffered assistant text if any, else
the declared summarizer applied to the event payload) and calls `onSessionEnded`,
which terminates the now-idle spawned session and frees the concurrency slot.
Finalization SHALL occur exactly once; a later `agent_end` is a no-op. A run that
did not declare a completion event (including every prompt-dispatch run) SHALL
continue to finalize on `agent_end`.

#### Scenario: Event-dispatched run finalizes on its declared completion event

- **WHEN** a tracked run that declared `completion.eventType` observes that event
- **THEN** the run finalizes once with the summarized result and its spawned
  session is terminated so the next scheduled fire can start.

#### Scenario: Prompt-dispatched run is unaffected by the completion event

- **WHEN** a prompt-dispatch run (no declared completion) observes an unrelated
  forwarded event
- **THEN** it is not finalized by it and still finalizes on `agent_end`.

#### Scenario: agent_end after completion is a no-op

- **WHEN** an event-dispatched run already finalized on its declared completion
  event later observes an `agent_end`
- **THEN** no second finalization occurs.
