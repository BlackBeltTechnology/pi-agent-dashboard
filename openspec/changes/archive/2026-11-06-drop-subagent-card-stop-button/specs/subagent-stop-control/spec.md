# Spec Delta

## MODIFIED Requirements

### Requirement: Each subagent row and card offers its own stop

When a subagent's details carry `stoppable: true`, its chat row SHALL offer a stop control that requests a stop for that subagent only, including when the row is inside a tool burst group. The label SHALL describe removal from the queue for a queued subagent and stopping that subagent for a running one. Activating it SHALL NOT send the session-wide abort. The subagent's card SHALL NOT offer a second stop control of its own.

#### Scenario: Stop a queued subagent
- **WHEN** the user activates C094's row stop while it is queued
- **THEN** a stop for C094 only is requested and no session abort is sent

#### Scenario: Row inside a burst group
- **WHEN** the subagent rows are grouped into a tool burst and the user stops one row
- **THEN** only that subagent's stop is requested, and the burst group's own stop still ends the whole turn

#### Scenario: Producer without per-subagent stop
- **WHEN** the subagent's details do not carry `stoppable: true`
- **THEN** the row stop keeps its previous behaviour (session abort) and its label says it ends the whole turn

#### Scenario: Card has no stop control of its own
- **WHEN** C094 is queued or running with `stoppable: true`
- **THEN** its card shows no stop button, and the row stop is the only stop control for C094

### Requirement: Stop feedback

After a stop is requested from the row, the card SHALL show that stopping is in progress until the subagent's terminal update arrives. If the request is refused, the card SHALL show the reason and the row stop SHALL be usable again. If no terminal update arrives within 10 seconds, the card SHALL show that the stop was not confirmed and the row stop SHALL be usable again. With no stop requested, the card SHALL show no stop feedback. A failed stop SHALL NOT fall back to a session abort.

#### Scenario: Stop from a collapsed row
- **WHEN** the user collapsed C094's row and then activates its row stop
- **THEN** the row expands, and C094's card shows "stopping…"

#### Scenario: No stop requested
- **WHEN** C094 is running and no stop was requested
- **THEN** its card shows no stop feedback line

#### Scenario: Stop request refused
- **WHEN** the stop request for C094 is refused
- **THEN** C094's card shows the reason, the row stop is usable again, and no session abort is sent

#### Scenario: Parent abort wins the race
- **WHEN** the user stops C094 and the parent turn is aborted before the producer handles the stop
- **THEN** C094 renders as aborted, as before this change, not as "stopped by you"

#### Scenario: Terminal frame clears a pending stop
- **WHEN** C092 completes while its card shows "stopping…" or "stop not confirmed"
- **THEN** the card shows C092's terminal state and the pending notice is gone

#### Scenario: Stop not confirmed
- **WHEN** the stop request succeeds but no terminal update for C094 arrives within 10 seconds
- **THEN** the card shows that the stop was not confirmed and the row stop is usable again
