# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Dock stop feedback

After Stop on a subagent's dock row, the row SHALL read `Stopping…` with Stop disabled until the subagent's terminal update arrives, then the row SHALL leave the lane. If the request is refused the row SHALL read `Stop failed` and Stop SHALL be usable again. If no terminal update arrives within 10 seconds the row SHALL read `Still running` and Stop SHALL be usable again.

#### Scenario: Stopping then gone
- **WHEN** the user activates Stop on docs-writer's dock row and the stopped frame arrives
- **THEN** the row reads `Stopping…` with Stop disabled until the frame arrives
- **AND** then the row leaves the Processes lane

#### Scenario: Refused stop
- **WHEN** the stop request for docs-writer is refused
- **THEN** its dock row reads `Stop failed` and Stop is usable again, and no session abort is sent

#### Scenario: Unconfirmed stop
- **WHEN** the stop request succeeds but no terminal update for docs-writer arrives within 10 seconds
- **THEN** its dock row reads `Still running` and Stop is usable again

### Requirement: One stop state per subagent across surfaces

The dock row, the chat row and the card SHALL show one shared stop state per subagent, so a stop requested on one surface shows on the others and a second request is not sent while the first is pending. A background started card SHALL show no stop feedback; for a background subagent the dock row is the only feedback surface.

#### Scenario: One stop state for row, card and dock
- **WHEN** the user stops foreground subagent C094 from its dock row
- **THEN** C094's card shows "stopping…" and its chat row stop is not offered a second request while the first is pending

#### Scenario: Background stop feedback lives on the dock row
- **WHEN** the user stops background subagent docs-writer from its dock row
- **THEN** the dock row shows the stop state and the started card in the chat shows none
