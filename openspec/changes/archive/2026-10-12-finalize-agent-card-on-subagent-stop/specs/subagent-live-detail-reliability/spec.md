## ADDED Requirements

### Requirement: A subagent's own terminal event finalizes its Agent card

The client SHALL finalize a top-level `Agent` tool row as soon as it knows the row's subagent has stopped. The parent's `tool_execution_end` for the call need not arrive first. A row is eligible only while both the row and its tracked tool-call state are running. Rows that are elided, have no tracked state, or are already terminal SHALL NOT be changed.

Finalization SHALL happen in two cases:
1. When a `subagent_completed` or `subagent_failed` event is applied for the agent id the row's tool details carry.
2. When a progress update gives a running row an agent id whose subagent the client already knows has completed or failed.

Finalizing SHALL:
- set the row and its tracked tool-call state to complete on completion, or error on failure;
- set the row's subagent details status to `completed` or `error`;
- show the subagent's result, or its error text on failure. A non-empty fallback text SHALL be used when that is empty, so a stale progress line is never shown;
- compute any duration from the triggering event's timestamp;
- mark the row as healed. The marker SHALL be the triggering event's own heal marker when it carries one, else a subagent-stop marker.

A later real `tool_execution_end` for the call SHALL overwrite the healed row and clear the heal marker. A heal-marked subagent terminal event that the client ignores because the subagent is already terminal SHALL NOT finalize a row. Finalizing one row SHALL NOT change any other row.

#### Scenario: Dropped tool end, subagent completion still finalizes the card

- **GIVEN** three parallel `Agent` rows A, B, C are running, each row's tool details carrying its agent id
- **AND** the parent `tool_execution_end` for A never arrives
- **WHEN** `subagent_completed` for A's agent id is applied with result `"done A"`
- **THEN** A's row is complete and its card shows `"done A"` without a spinner
- **AND** B and C remain running

#### Scenario: Subagent failure finalizes as error with its message

- **GIVEN** a running `Agent` row for agent id X
- **WHEN** `subagent_failed` for X is applied with error `"boom"`
- **THEN** the row is in error and its card shows `"boom"`, not a spinner and not a stale progress line

#### Scenario: Completion with an empty result

- **GIVEN** a running `Agent` row for agent id X whose last progress text is `"X working"`
- **WHEN** `subagent_completed` for X is applied with no result
- **THEN** the row is complete and does not show `"X working"`

#### Scenario: Agent id learned after the subagent finished

- **GIVEN** `subagent_completed` for agent id X was applied while the running row for X had no agent id yet
- **WHEN** a progress update gives that row agent id X
- **THEN** the row is complete and shows X's result

#### Scenario: Normal ordering, real end follows the heal

- **GIVEN** a running `Agent` row for agent id X
- **WHEN** `subagent_completed` for X, then a trailing progress update with status `running`, then the real `tool_execution_end` for the call are applied
- **THEN** the row never shows running after the `subagent_completed`
- **AND** it ends with the real end's result and no heal marker

#### Scenario: Server session-end heal keeps its marker

- **GIVEN** a running `Agent` row for agent id X whose subagent is still running
- **WHEN** a `subagent_failed` for X carrying the session-ended heal marker is applied
- **THEN** the row is in error and carries the session-ended marker

#### Scenario: Terminal row is never touched

- **GIVEN** an `Agent` row already in error from its real end
- **WHEN** `subagent_completed` for its agent id is applied
- **THEN** the row stays in error with its original result

#### Scenario: No matching row is a no-op

- **WHEN** `subagent_completed` arrives for an agent id that no running `Agent` row carries
- **THEN** no tool row changes; the subagent state is updated as before

### Requirement: The parent run's settle finalizes any Agent card still running

When the client applies `agent_settled`, it SHALL finalize every eligible top-level `Agent` tool row (eligibility as above).

- **Subagent known to have finished:** if the row carries an agent id whose subagent the client knows has completed or failed, the row SHALL take that terminal status and that result or error, without a recovered indicator.
- **Otherwise:** the row SHALL become complete with a neutral body stating that the subagent stopped and its result was not received. It SHALL show a recovered indicator, SHALL NOT record the subagent as completed, and SHALL stay eligible for the existing authoritative tool-result recovery. A recovered result SHALL replace the neutral body and remove the recovered indicator.

Every row finalized here SHALL be marked as healed by the turn settle. The overwrite rule and the sibling rule of the subagent-stop finalization SHALL apply. `agent_end` alone SHALL NOT trigger this finalization.

#### Scenario: Both ends dropped, settle stops the spinner

- **GIVEN** an `Agent` row is running and neither its `tool_execution_end` nor its `subagent_completed` arrived
- **WHEN** `agent_settled` is applied
- **THEN** the row is no longer running
- **AND** its card shows the "stopped — result not received" body with the recovered indicator
- **AND** the subagent state for its agent id is not changed to completed

#### Scenario: Recovered result replaces the neutral body

- **GIVEN** an `Agent` row finalized by the settle with the "result not received" body
- **AND** the server holds the call's recorded result `"done C"`
- **WHEN** the existing stale tool-result recovery runs for the call
- **THEN** the card shows `"done C"` with no recovered indicator and no heal marker

#### Scenario: A tick after the settle does not reopen the card

- **GIVEN** an `Agent` row finalized by the settle
- **WHEN** a late progress update for the call arrives with status `running`
- **THEN** the card still shows the finalized state, without a spinner

#### Scenario: agent_end does not finalize

- **GIVEN** an `Agent` row is running
- **WHEN** `agent_end` is applied without `agent_settled`
- **THEN** the row is still running

#### Scenario: Non-Agent and elided rows are untouched by settle

- **GIVEN** a running `bash` row and an elided `Agent` row
- **WHEN** `agent_settled` is applied
- **THEN** neither row is changed by this requirement

### Requirement: A finished subagent's card is not reopened by a late progress tick

When a `tool_execution_update` targets an `Agent` row that is no longer running, and either the client knows that row's subagent has completed or failed or the row was finalized by the turn settle, the update SHALL NOT change the row's terminal status, heal marker, error, missing-result flag or shown result. Its other details SHALL apply as usual. Otherwise the update SHALL apply as before, which includes a replayed session-end orphan close of a still-running call.

A later real `tool_execution_end` SHALL also clear any missing-result flag and any heal-sourced error, together with the heal marker.

#### Scenario: Tick after a subagent-stop heal

- **GIVEN** an `Agent` row finalized by `subagent_completed`
- **WHEN** a late progress update for the call arrives with status `running`
- **THEN** the card still shows the completed state and result, without a spinner

#### Scenario: Tick after a real end of a finished subagent

- **GIVEN** an `Agent` row completed by its real `tool_execution_end`, and its subagent recorded as completed
- **WHEN** a late progress update for the call arrives with status `running`
- **THEN** the card still shows the completed state and the real result

#### Scenario: Real end clears heal-only flags

- **GIVEN** an `Agent` row finalized by the turn settle with the missing-result flag
- **WHEN** the real `tool_execution_end` for the call is applied
- **THEN** the row carries neither the missing-result flag nor the heal marker, and shows no recovered indicator

#### Scenario: Orphan-closed but still running

- **GIVEN** an `Agent` row closed by a replayed session-end orphan close, and its subagent not known to be finished
- **WHEN** a live progress update for the call arrives with status `running`
- **THEN** the card shows running again
