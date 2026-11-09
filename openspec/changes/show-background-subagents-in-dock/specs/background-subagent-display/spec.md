# Spec Delta

## Purpose

Defines how the dashboard presents subagents that the producer runs in the background (`Agent` with `run_in_background: true`): a not-running "started" card in the chat, and the run listed with its own group in the composer dock's Processes lane.

## ADDED Requirements

### Requirement: The subagent state SHALL record a background run

When a `subagent_created` or `subagent_started` frame carries `details.background: true`, the subagent's state SHALL be marked as a background run. The mark SHALL persist for the rest of the run and SHALL NOT be cleared by a later frame or state write that omits the field. A subagent whose frames never carry the field SHALL stay a foreground run.

#### Scenario: Background frame marks the subagent
- **WHEN** a `subagent_started` frame for agent A carries `details.background: true`
- **THEN** agent A's state SHALL be marked as a background run

#### Scenario: Later frame without the field keeps the mark
- **GIVEN** agent A was marked as a background run by its `subagent_created` frame
- **WHEN** its `subagent_started` frame, its step frames and its terminal frame arrive without `details.background`
- **THEN** agent A SHALL still be marked as a background run until it leaves the session map

#### Scenario: Older producer
- **WHEN** no frame for agent B carries `details.background`
- **THEN** agent B SHALL be treated as a foreground run, as today

### Requirement: A background Agent call SHALL render as a started card

When an `Agent` tool row's details carry `background: true`, its card SHALL render in a neutral, not-running state: the subagent name, the description, a "Started in background" label, the `bg-` id from the details, and a pointer to the Processes lane. The card SHALL show no spinner, no live activity, no live stats, no stop control and no detail affordance, and SHALL NOT change while the background run progresses, stops or ends.

#### Scenario: Started card after the call returns
- **WHEN** an `Agent` call returns details `{ background: true, id: "bg-7a3f", status: "running" }` without an `agentId`
- **THEN** its card SHALL show "Started in background" and `bg-7a3f`
- **AND** it SHALL show no running spinner and no activity line

#### Scenario: Card stays the same when the run ends
- **GIVEN** the started card for `bg-7a3f`
- **WHEN** the background subagent later completes, fails or is stopped
- **THEN** the card SHALL still show the started state

#### Scenario: Foreground Agent card unchanged
- **WHEN** an `Agent` row's details do not carry `background: true`
- **THEN** its card SHALL render as today (queued, running, completed, failed or stopped)

### Requirement: Background subagents SHALL be listed in their own Processes group

The subagents plugin SHALL contribute background subagents to the Processes lane as a group separate from foreground subagents, reported with the noun `background subagent` (one) or `background subagents` (several). A queued or running subagent SHALL appear in exactly one of the two groups. Each group SHALL report its own count, and a group with no rows SHALL report none.

#### Scenario: Both groups present
- **WHEN** one foreground subagent and one background subagent are running
- **THEN** the Processes lane SHALL show a `Subagent` group with the foreground row and a `Background subagent` group with the background row
- **AND** the lane header SHALL read `2 running` with `1 subagent · 1 background subagent`

#### Scenario: Only background subagents
- **WHEN** two background subagents are running and nothing else
- **THEN** the Processes lane header SHALL name `2 background subagents` and the body SHALL show no group headings

#### Scenario: A finished background run leaves the lane
- **WHEN** a background subagent completes, fails or is stopped
- **THEN** its row SHALL leave the Processes lane, like a foreground subagent's row

#### Scenario: Session ends while a background subagent runs
- **GIVEN** background subagent docs-writer is running and no terminal frame for it has arrived
- **WHEN** the session ends and the server's synthesized `subagent_failed` with `healedBy: "session_ended"` arrives (`session-end-orphan-heal`)
- **THEN** docs-writer SHALL still be marked as a background run, its row SHALL leave the Processes lane, its full-screen view SHALL show it ended with "parent session ended", and its chat card SHALL still show the started state

### Requirement: Background subagent rows SHALL keep the subagent row content

A background subagent row SHALL show the same content as a foreground subagent row: name, task, `type · N steps` (or `pending` / queue position while waiting), elapsed time once started, Stop (when stoppable) and Open. It SHALL show no message stream, live tail or timeline lines.

#### Scenario: Running background row
- **WHEN** background subagent docs-writer has run 5 steps for 3 minutes
- **THEN** its row SHALL show `docs-writer`, its task, `docs-writer · 5 steps`, the elapsed time, Stop and Open
- **AND** it SHALL show no step or reasoning text

#### Scenario: Open watches the background run
- **WHEN** the user activates Open on a background subagent row
- **THEN** the full-screen subagent view for that subagent SHALL open, showing its live timeline
