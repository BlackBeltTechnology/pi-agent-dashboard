# subagent-stop-control Specification

## Purpose
Defines how the dashboard lets a user stop one subagent, queued or running, without aborting the parent turn or its siblings, and how a stopped subagent is shown.

## Requirements

### Requirement: Each subagent row and card offers its own stop

When a subagent's details carry `stoppable: true`, its row and card SHALL each offer a stop control that requests a stop for that subagent only, including when the row is inside a tool burst group. The label SHALL describe removal from the queue for a queued subagent and stopping that subagent for a running one. Activating it SHALL NOT send the session-wide abort.

#### Scenario: Stop a queued subagent
- **WHEN** the user activates C094's row stop while it is queued
- **THEN** a stop for C094 only is requested and no session abort is sent

#### Scenario: Row inside a burst group
- **WHEN** the subagent rows are grouped into a tool burst and the user stops one row
- **THEN** only that subagent's stop is requested, and the burst group's own stop still ends the whole turn

#### Scenario: Producer without per-subagent stop
- **WHEN** the subagent's details do not carry `stoppable: true`
- **THEN** the row stop keeps its previous behaviour (session abort) and its label says it ends the whole turn

### Requirement: Stop request is authenticated, validated and scoped

A stop SHALL be delivered only through a request carrying operate authority and naming a `sessionId` and an `agentId`. Requests without operate authority SHALL be refused. Ids that are empty, longer than 128 characters or contain control characters SHALL be rejected. An unknown session SHALL be rejected. The request SHALL reach only the named session and SHALL emit only the stop event for that one subagent.

#### Scenario: No operate authority
- **WHEN** a stop request arrives without operate authority
- **THEN** it is refused and no session receives a stop

#### Scenario: Malformed agent id
- **WHEN** a stop request carries an empty `agentId`
- **THEN** it is rejected with a client error and no session receives a stop

#### Scenario: Unknown session
- **WHEN** a stop request names a session the dashboard does not know
- **THEN** it is rejected with not-found and nothing is emitted

### Requirement: Stop feedback

After a stop is requested, the card SHALL show that stopping is in progress until the subagent's terminal update arrives. If the request is refused, the card SHALL show the reason and re-enable the control. If no terminal update arrives within 10 seconds, the card SHALL show that the stop was not confirmed and re-enable the control. A failed stop SHALL NOT fall back to a session abort.

#### Scenario: Stop request refused
- **WHEN** the stop request for C094 is refused
- **THEN** C094's card shows the reason, the control is usable again, and no session abort is sent

#### Scenario: Parent abort wins the race
- **WHEN** the user stops C094 and the parent turn is aborted before the producer handles the stop
- **THEN** C094 renders as aborted, as before this change, not as "stopped by you"

#### Scenario: Terminal frame clears a pending stop
- **WHEN** C092 completes while its card shows "stopping…" or "stop not confirmed"
- **THEN** the card shows C092's terminal state and the pending notice is gone

#### Scenario: Stop not confirmed
- **WHEN** the stop request succeeds but no terminal update for C094 arrives within 10 seconds
- **THEN** the card shows that the stop was not confirmed and the control is usable again

### Requirement: Stopped subagent renders as final and neutral

A subagent that ended with status `stopped` SHALL render neutral and final on the card, chat row, dock and detail view: no spinner, no success check, no error colour. With `stopReason: "queued"` it SHALL read "removed from queue · never started", and with `stopReason: "running"` "stopped by you" with its run time. A later progress frame SHALL NOT reopen it, and it SHALL stay stopped whichever arrives first, the subagent's terminal event or the tool's end.

#### Scenario: Removed while queued
- **WHEN** C017 ends `stopped` with `stopReason: "queued"`
- **THEN** its card and row show a neutral stop glyph and "removed from queue · never started"

#### Scenario: Terminal event before tool end
- **WHEN** C091's `subagent_completed` with status `stopped` arrives before its `tool_execution_end`
- **THEN** the row shows the neutral stopped presentation, not a success check

#### Scenario: Heal after stop
- **WHEN** a session-end heal for C091's call arrives after C091 ended `stopped`
- **THEN** C091 stays rendered as stopped

#### Scenario: Late frame after stop
- **WHEN** a progress frame for C091 arrives after its `stopped` result
- **THEN** C091 stays rendered as stopped
