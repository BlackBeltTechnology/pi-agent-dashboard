# subagent-stop-control Specification

## Purpose
Defines how the dashboard lets a user stop one subagent, queued or running, without aborting the parent turn or its siblings, and how a stopped subagent is shown.

## Requirements

### Requirement: Each subagent row and card offers its own stop

When a subagent's details carry `stoppable: true`, its chat row SHALL offer a stop control that requests a stop for that subagent only, including when the row is inside a tool burst group. Its row in the composer dock's Processes lane SHALL offer the same per-subagent stop, for foreground and background subagents alike. The label (the accessible name) SHALL describe removal from the queue for a queued subagent and stopping that subagent for a running one. Activating either SHALL NOT send the session-wide abort. The subagent's card SHALL NOT offer a stop control of its own.

#### Scenario: Stop a queued subagent
- **WHEN** the user activates C094's row stop while it is queued
- **THEN** a stop for C094 only is requested and no session abort is sent

#### Scenario: Row inside a burst group
- **WHEN** the subagent rows are grouped into a tool burst and the user stops one row
- **THEN** only that subagent's stop is requested, and the burst group's own stop still ends the whole turn

#### Scenario: Producer without per-subagent stop
- **WHEN** the subagent's details do not carry `stoppable: true`
- **THEN** the chat row stop keeps its previous behaviour (session abort) and its label says it ends the whole turn
- **AND** the dock row offers no Stop

#### Scenario: Card has no stop control of its own
- **WHEN** C094 is queued or running with `stoppable: true`
- **THEN** its card shows no stop button; its chat row and its dock row are its stop controls

#### Scenario: Stop a background subagent from the dock
- **GIVEN** background subagent docs-writer is running and its chat row is already complete (no chat stop control)
- **WHEN** the user activates Stop on docs-writer's dock row
- **THEN** a stop for docs-writer only is requested and no session abort is sent

#### Scenario: Dock row of a subagent that cannot be stopped
- **WHEN** a subagent's details do not carry `stoppable: true`
- **THEN** its dock row SHALL offer no Stop, so the dock never sends a session abort

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

After a stop is requested from the row, the card SHALL show that stopping is in progress until the subagent's terminal update arrives or the session answers that it does not run the subagent. If the session answers `phase: "unknown"`, the subagent SHALL end as untracked (`subagent-liveness-reconcile`) and the pending notice SHALL clear. If the session answers `phase: "terminal"`, the pending notice SHALL clear and the card SHALL show the final state. If the request is refused, the card SHALL show the reason and the row stop SHALL be usable again. If neither a terminal update nor an answer arrives within 10 seconds, the card SHALL show that the stop was not confirmed and the row stop SHALL be usable again. With no stop requested, the card SHALL show no stop feedback. A failed stop SHALL NOT fall back to a session abort.

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
- **WHEN** the stop request succeeds but neither a terminal update nor a session answer for C094 arrives within 10 seconds
- **THEN** the card shows that the stop was not confirmed and the row stop is usable again

#### Scenario: Session does not run the subagent
- **GIVEN** C094's card shows "stopping…"
- **WHEN** the session answers `subagent_stop_result { agentId: C094, phase: "unknown" }`
- **THEN** C094 ends as untracked, its card shows no stop notice and its row offers no stop

### Requirement: Stopped subagent renders as final and neutral

A subagent that ended with status `stopped` SHALL render neutral and final on the card, chat row, dock and detail view: no spinner, no success check, no error colour. With `stopReason: "queued"` it SHALL read "removed from queue · never started", and with `stopReason: "running"` "stopped by you" with its run time. A background started card is not a view of the subagent's state and keeps its started look. A later progress frame SHALL NOT reopen it, and it SHALL stay stopped whichever arrives first, the subagent's terminal event or the tool's end.

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

#### Scenario: Stopped background subagent
- **WHEN** background subagent docs-writer ends `stopped` with `stopReason: "running"`
- **THEN** its full-screen view shows the neutral stopped presentation, its dock row leaves the lane, and its chat card still shows the started state

### Requirement: Dock stop feedback

After Stop on a subagent's dock row, the row SHALL read `Stopping…` with Stop disabled until the subagent's terminal update arrives or the session answers that it does not run the subagent; in both cases the row SHALL then leave the lane. If the request is refused the row SHALL read `Stop failed` and Stop SHALL be usable again. If neither a terminal update nor an answer arrives within 10 seconds the row SHALL read `Still running` and Stop SHALL be usable again; a later answer or terminal update SHALL still remove the row.

#### Scenario: Stopping then gone
- **WHEN** the user activates Stop on docs-writer's dock row and the stopped frame arrives
- **THEN** the row reads `Stopping…` with Stop disabled until the frame arrives
- **AND** then the row leaves the Processes lane

#### Scenario: Refused stop
- **WHEN** the stop request for docs-writer is refused
- **THEN** its dock row reads `Stop failed` and Stop is usable again, and no session abort is sent

#### Scenario: Unconfirmed stop
- **WHEN** the stop request succeeds but neither a terminal update nor a session answer for docs-writer arrives within 10 seconds
- **THEN** its dock row reads `Still running` and Stop is usable again

#### Scenario: Ghost row leaves on the session's answer
- **GIVEN** docs-writer's dock row shows it running but the session's pi process restarted since
- **WHEN** the user activates Stop and the session answers `phase: "unknown"`
- **THEN** the row leaves the Processes lane within one answer round-trip, with no `Still running` notice

#### Scenario: Late answer after Still running
- **GIVEN** docs-writer's row reads `Still running` after a timed-out stop
- **WHEN** the session's `phase: "unknown"` answer arrives
- **THEN** the row leaves the Processes lane

### Requirement: One stop state per subagent across surfaces

The dock row, the chat row and the card SHALL show one shared stop state per subagent, so a stop requested on one surface shows on the others and a second request is not sent while the first is pending. A background started card SHALL show no stop feedback; for a background subagent the dock row is the only feedback surface.

#### Scenario: One stop state for row, card and dock
- **WHEN** the user stops foreground subagent C094 from its dock row
- **THEN** C094's card shows "stopping…" and its chat row stop is not offered a second request while the first is pending

#### Scenario: Background stop feedback lives on the dock row
- **WHEN** the user stops background subagent docs-writer from its dock row
- **THEN** the dock row shows the stop state and the started card in the chat shows none
