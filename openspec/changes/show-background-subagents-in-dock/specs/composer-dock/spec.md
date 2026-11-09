# Spec Delta

## MODIFIED Requirements

### Requirement: Process rows act on their own kind only

A background-process row SHALL offer Kill, which terminates that process group through the existing PGID kill path (`kill_process`). A command row SHALL offer Show, which scrolls the transcript to that tool call. A subagent row SHALL offer Open, which opens that subagent's detail, and, when the subagent can be stopped, Stop, which requests a stop for that subagent only. No row SHALL abort the turn; the composer's Stop remains the only turn abort.

#### Scenario: Kill targets the process group
- **WHEN** the user activates Kill on the row for process group 60105
- **THEN** the client SHALL send `kill_process` for process group 60105
- **AND** the session's turn SHALL NOT be aborted

#### Scenario: Show scrolls to the tool call
- **WHEN** the user activates Show on a running command row
- **THEN** the transcript SHALL scroll to that command's tool call

#### Scenario: Kill and Stop are worded differently
- **WHEN** a background-process row and the composer's stop affordance are both visible
- **THEN** the background-process row's action SHALL be labelled Kill and the composer's SHALL be labelled Stop

#### Scenario: Subagent Stop stops that subagent only
- **WHEN** the user activates Stop on the dock row of running subagent docs-writer
- **THEN** a stop for docs-writer only SHALL be requested
- **AND** the session's turn SHALL NOT be aborted
- **AND** the control SHALL read `Stop` and its accessible name SHALL be `Stop subagent docs-writer`

#### Scenario: Stop on a queued subagent row
- **WHEN** subagent docs-writer is queued or not yet started
- **THEN** its dock row control SHALL read `Stop` and its accessible name SHALL be `Remove subagent docs-writer from queue`

### Requirement: Subagent rows come from plugin contributions

Subagent rows SHALL come only from `composer-dock-process-group` slot contributions; the dock SHALL read no subagent state itself. The dock SHALL accept more than one group from the same plugin; each group SHALL report its own count and noun, and SHALL render under its own heading when two or more groups have rows. While a session is bound, the dock SHALL keep each contribution mounted in `"summary"` mode, which renders no DOM, so its count reaches the header and chip. It SHALL mount `"rows"` mode only while the lane body is shown. Background rows keep their existing kinds, including the link from a sub-session process to its session.

#### Scenario: Plugin group renders in the lane
- **WHEN** the subagents plugin contributes a group reporting 3 running subagents
- **THEN** the Processes lane SHALL show that group and count 3 subagents in its header

#### Scenario: Two groups from one plugin
- **WHEN** the subagents plugin contributes a group reporting 1 subagent and a second group reporting 1 background subagent
- **THEN** the Processes lane header SHALL read `2 running` with `1 subagent · 1 background subagent`
- **AND** the body SHALL show each group under its own heading

#### Scenario: Not-yet-started subagent is marked
- **WHEN** a contributed subagent has status `created` (not started yet)
- **THEN** its row SHALL show `pending` instead of an elapsed time

#### Scenario: Sub-session process links to its session
- **WHEN** a background process is classified as a sub-session with a session reference
- **THEN** its row SHALL link to that session, as the session card's process list does

#### Scenario: Plugin-only lane appears while collapsed
- **WHEN** the subagents contribution reports 2 running subagents and the session has no other dock content
- **THEN** the dock SHALL render a collapsed Processes lane whose header names 2 subagents

#### Scenario: Plugin disabled
- **WHEN** no plugin claims `composer-dock-process-group`
- **THEN** the Processes lane SHALL list commands and background processes only, and SHALL render no subagent group
