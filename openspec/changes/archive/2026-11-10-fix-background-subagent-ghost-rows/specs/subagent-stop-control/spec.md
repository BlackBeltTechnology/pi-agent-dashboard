# Spec Delta

## MODIFIED Requirements

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
