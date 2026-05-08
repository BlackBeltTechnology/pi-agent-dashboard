## ADDED Requirements

### Requirement: Apply-change skill structured as state machine
The `openspec-apply-change` skill's UI design section SHALL be restructured as a turn-based state machine instead of a linear 7-step procedure.

#### Scenario: Skill reads state on startup
- **WHEN** the apply-change agent reaches the UI design phase
- **THEN** the agent SHALL first scan its own conversation history backwards for the last `[STATE: ...]` line
- **AND** if a state line with `source=apply` is found, the agent SHALL resume from the recorded phase
- **AND** if no state line is found, the agent SHALL start from phase `init`

#### Scenario: Phase init — launch sandbox and designer
- **WHEN** the agent is in phase `init`
- **THEN** the agent SHALL: build sandbox, capture BEFORE screenshots, invoke sandbox-designer with `async: true`
- **AND** the agent SHALL write checkpoint: `phase: "awaiting-designer"`, `designerRunId: "<id>"`
- **AND** the agent SHALL complete its turn

#### Scenario: Phase awaiting-designer — process mockup
- **WHEN** the agent receives intercom trigger from designer completion
- **THEN** the agent SHALL validate mockup.html (state count, no raw colors)
- **AND** the agent SHALL capture mockup screenshot via sandbox
- **AND** the agent SHALL show BEFORE screenshots + mockup screenshot to user
- **AND** the agent SHALL list all visual states from mockup.html
- **AND** the agent SHALL ask user for approval via intercom or ask_user
- **AND** the agent SHALL update checkpoint: `phase: "showing-mockup"`

#### Scenario: Phase showing-mockup — user approves mockup
- **WHEN** user approves the mockup
- **THEN** the agent SHALL update checkpoint: `phase: "implementing"`, `tasksRemaining: [...]`
- **AND** the agent SHALL proceed to implementation

#### Scenario: Phase showing-mockup — user requests changes
- **WHEN** user requests changes to mockup
- **THEN** the agent SHALL resume the sandbox-designer with feedback: `subagent({ action: "resume", id: "<runId>", message: "<feedback>" })`
- **AND** the agent SHALL update checkpoint: `phase: "awaiting-designer"` (loop back)
- **AND** the agent SHALL complete its turn

#### Scenario: Phase implementing — build and re-invoke designer
- **WHEN** the agent completes code changes for a task
- **THEN** the agent SHALL build sandbox with `--build`
- **AND** the agent SHALL capture AFTER screenshots via `capture-screenshots.sh`
- **AND** the agent SHALL resume the SAME sandbox-designer via `subagent({ action: "resume", id: "<runId>", message: "Compare AFTER vs MOCKUP..." })`
- **AND** the agent SHALL update checkpoint: `phase: "awaiting-review"`, `currentTask: N`
- **AND** the agent SHALL complete its turn

#### Scenario: Phase awaiting-review — process designer findings
- **WHEN** the agent receives designer findings via intercom
- **THEN** if findings contain "NO_ISSUES": agent SHALL show final screenshots to user, update checkpoint to `phase: "showing-review"`
- **AND** if findings contain issues: agent SHALL send findings to user via intercom, ask for feedback
- **AND** if user approves or provides additional feedback: agent SHALL fix issues, update checkpoint to `phase: "implementing"`, loop
- **AND** after showing findings to user, agent SHALL complete its turn

#### Scenario: Phase showing-review — user final approval
- **WHEN** all tasks are complete and designer reports NO_ISSUES
- **THEN** the agent SHALL show final BEFORE + AFTER + MOCKUP screenshots to user
- **AND** the agent SHALL ask for final approval
- **AND** if approved: agent SHALL proceed to non-UI tasks without writing a new state line
- **AND** if not approved: agent SHALL return to `phase: "implementing"`

### Requirement: All designer subagent invocations use async:true
The apply-change skill SHALL never invoke the sandbox-designer with `async: false`.

#### Scenario: Designer launched async
- **WHEN** the agent invokes sandbox-designer for mockup generation or review
- **THEN** the agent SHALL use `subagent({ agent: "sandbox-designer", async: true, task: "..." })`

#### Scenario: Designer resumed async
- **WHEN** the agent resumes a sandbox-designer
- **THEN** the agent SHALL use `subagent({ action: "resume", id: "<runId>", async: true, message: "..." })`

### Requirement: Subagent task prompts include coordination instructions
Every `task` string passed to the sandbox-designer SHALL include explicit intercom coordination instructions.

#### Scenario: Initial designer invocation task prompt
- **WHEN** the agent invokes sandbox-designer for the first time
- **THEN** the task SHALL include: runId, file paths to all inputs (screenshots, proposal, specs), list of required visual states, CSS constraints
- **AND** the task SHALL include: "After review, use contact_supervisor({ reason: 'progress_update', message: '[designer:<runId>] Found N issues: ...' })"
- **AND** the task SHALL include: "If unsure about a finding, use contact_supervisor({ reason: 'need_decision', message: '...' })"

#### Scenario: Resume designer invocation task prompt
- **WHEN** the agent resumes sandbox-designer for re-review
- **THEN** the task SHALL include: runId, paths to updated AFTER screenshots, list of fixes applied
- **AND** the task SHALL include: "Use contact_supervisor to report. If NO differences found, message: 'NO_ISSUES: implementation matches mockup'"

### Requirement: Screenshot capture always via Docker sandbox with --build
The apply-change skill SHALL capture ALL AFTER screenshots using Docker sandbox with forced rebuild.

#### Scenario: AFTER screenshots captured via sandbox
- **WHEN** the agent needs AFTER screenshots
- **THEN** the agent SHALL run: `docker compose -f sandbox/docker-compose.yml up -d --build --wait dashboard`
- **AND** then: `sandbox/scripts/capture-screenshots.sh <scenario> <output-dir>`
- **AND** the capture script SHALL include `--build` in its `docker compose up` command

#### Scenario: Agent never uses local agent-browser for AFTER screenshots
- **WHEN** the agent needs AFTER screenshots
- **THEN** the agent SHALL NOT use local `agent-browser` pointing at `http://localhost:8000`
- **AND** the agent SHALL NOT use any local browser for screenshot capture
