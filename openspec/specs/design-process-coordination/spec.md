## ADDED Requirements

### Requirement: Checkpoint file for turn-based state machine
The design process SHALL use a checkpoint file at `$HOME/.pi/dashboard/design-review-state.json` to persist state between agent turns.

#### Scenario: Checkpoint file is created when design process starts
- **WHEN** the apply-change agent starts the design review phase
- **THEN** the agent SHALL write a checkpoint file with `phase: "awaiting-designer"`, `designerRunId`, `changeDir`, and `reviewRound: 0`
- **AND** the file SHALL be valid JSON

#### Scenario: Agent resumes from checkpoint on next turn
- **WHEN** a new agent turn starts and the checkpoint file exists
- **THEN** the agent SHALL read the checkpoint file
- **AND** the agent SHALL identify the current phase and continue from that phase
- **AND** the agent SHALL NOT restart the process from scratch

#### Scenario: Checkpoint is updated on phase transition
- **WHEN** the agent transitions from one phase to another (e.g., "awaiting-designer" → "implementing")
- **THEN** the agent SHALL update the checkpoint file with the new phase
- **AND** the agent SHALL preserve all context fields (designerRunId, changeDir, etc.)

#### Scenario: Checkpoint is deleted when design process completes
- **WHEN** the design review loop reaches NO_ISSUES and user approves
- **THEN** the agent SHALL delete the checkpoint file

### Requirement: Turn-based design process phases
The design process SHALL be structured as a finite state machine with explicit phases.

#### Scenario: Valid phase transitions
- **WHEN** the design process is active
- **THEN** valid phases SHALL be: `init`, `awaiting-designer`, `showing-mockup`, `implementing`, `awaiting-review`, `showing-review`, `approved`, `done`
- **AND** phase `init` SHALL transition to `awaiting-designer` after sandbox-designer subagent is launched
- **AND** phase `awaiting-designer` SHALL transition to `showing-mockup` when designer completes (intercom trigger)
- **AND** phase `showing-mockup` SHALL transition to `implementing` after user approval
- **AND** phase `implementing` SHALL transition to `awaiting-review` after code changes are built and designer is re-invoked
- **AND** phase `awaiting-review` SHALL transition to `implementing` (more fixes needed) or `showing-review` (NO_ISSUES from designer)
- **AND** phase `showing-review` SHALL transition to `approved` after user confirm
- **AND** phase `approved` SHALL transition to `done` after checkpoint cleanup

#### Scenario: Agent completes turn at every phase transition
- **WHEN** the agent transitions to a phase that requires external input (awaiting-designer, showing-mockup, awaiting-review, showing-review)
- **THEN** the agent SHALL complete its current turn
- **AND** the agent SHALL NOT poll or sleep-wait for the external event

### Requirement: Intercom as turn trigger
New agent turns in the design process SHALL be triggered by intercom messages, not by polling.

#### Scenario: Designer completion triggers new turn
- **WHEN** the sandbox-designer subagent completes (async)
- **THEN** pi-subagents SHALL emit `emitForegroundResultIntercom` to the supervisor
- **AND** the intercom message SHALL trigger a new agent turn
- **AND** the agent SHALL read the checkpoint file and continue from `awaiting-designer` phase

#### Scenario: Designer progress update triggers new turn
- **WHEN** the sandbox-designer subagent sends `contact_supervisor({ reason: "progress_update" })`
- **THEN** the supervisor agent SHALL receive the message via intercom
- **AND** the intercom message SHALL trigger a new agent turn
- **AND** the agent SHALL read the checkpoint, see phase `awaiting-review`, and process the designer's findings

#### Scenario: Designer decision request triggers new turn
- **WHEN** the sandbox-designer subagent sends `contact_supervisor({ reason: "need_decision" })`
- **THEN** the supervisor agent SHALL receive the message via intercom
- **AND** the agent SHALL forward the decision request to the user
- **AND** the agent SHALL reply to the designer with the user's answer

### Requirement: User-in-the-loop at every review round
The user SHALL receive intermediate results at every review round, not only at the end.

#### Scenario: User receives screenshots after each review round
- **WHEN** the agent receives designer review results (phase `awaiting-review`)
- **THEN** the agent SHALL send the AFTER screenshots to the user via intercom
- **AND** the agent SHALL include the designer's findings summary
- **AND** the agent SHALL ask the user: "Approve these fixes? Any additional changes?"

#### Scenario: User can provide feedback mid-process
- **WHEN** the user replies to an intercom review message
- **THEN** the agent SHALL incorporate the user's feedback into the next round of fixes
- **AND** the agent SHALL distinguish between user feedback and designer feedback
- **AND** if user says "fix this differently than designer suggests", user intent SHALL take priority

#### Scenario: User can abort or skip
- **WHEN** the user replies "skip" or "continue" to a review round
- **THEN** the agent SHALL skip the current round of fixes and proceed to the next task
- **WHEN** the user replies "abort" 
- **THEN** the agent SHALL stop the design process and clean up

### Requirement: Async subagent only for designer
The sandbox-designer subagent SHALL always be invoked with `async: true` to avoid blocking the supervisor turn.

#### Scenario: Designer launched async
- **WHEN** the agent invokes the sandbox-designer subagent
- **THEN** the invocation SHALL use `subagent({ agent: "sandbox-designer", async: true, ... })`
- **AND** the invocation SHALL NOT use `async: false`

#### Scenario: Designer resume preserves async mode
- **WHEN** the agent resumes a sandbox-designer subagent
- **THEN** the invocation SHALL use `subagent({ action: "resume", id: "<runId>", ... })`
- **AND** the resumed agent SHALL continue in async mode
