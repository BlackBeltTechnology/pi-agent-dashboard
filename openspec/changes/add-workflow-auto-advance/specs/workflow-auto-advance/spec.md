## Purpose

Advance an OpenSpec change through a project workflow's stages automatically — running each stage's primary action until a target stage, a checkpoint, a stop stage, a question, or a lack of progress — with durable, resumable run state.

## ADDED Requirements

### Requirement: Workflows declare auto-advance policy

A workflow MAY declare `autoAdvance` with `targets` (stage ids, required,
non-empty), `checkpoints` (stage ids), `stopAt` (stage ids), `maxSteps`
(positive integer, default 8) and `noProgress` (only `stop` in this version).
Every referenced stage id SHALL exist in `stages`; otherwise the workflow SHALL
fail validation.

#### Scenario: Unknown stage referenced

- **WHEN** `autoAdvance.targets` lists `shipped` and no stage has that id
- **THEN** the workflow SHALL fail validation naming `shipped`

### Requirement: The user starts a run to a declared target

For a change whose workflow declares `autoAdvance`, the dashboard SHALL offer
"Run to <target>" for each target not already reached. Starting a run SHALL
require a trusted workflow and an explicit confirmation showing the target,
checkpoints, stop stages and step cap. At most one run SHALL be active per change;
starting a second SHALL be refused while one is active.

#### Scenario: Start a run

- **WHEN** the user confirms "Run to merged" for change `add-x`
- **THEN** a run record for `add-x` SHALL be created in state `running`

#### Scenario: Second run refused

- **GIVEN** an active run for `add-x`
- **WHEN** another run for `add-x` is requested
- **THEN** it SHALL be refused naming the active run

### Requirement: The run reconciles stage by stage

While `running`, the engine SHALL repeatedly compute the change's stage and:

1. stage is the target → `done`;
2. stage is in `stopAt` → `stopped` with the stage as reason;
3. stage is in `checkpoints` and not yet approved for this run → `paused-checkpoint`;
4. otherwise run the stage's primary enabled action and wait for it to complete;
   no enabled action → `stopped` with "no runnable action".

An action completes when every step completed and, for steps that started agent
work, that work finished: the step session's turn ended, the automation run
finalized, or the goal reached a terminal status. After completion the engine
SHALL recompute the stage without using cached bash-gate results. When the stage
is unchanged, the run SHALL become `stopped` with "no progress". When the number
of executed actions reaches `maxSteps`, the run SHALL become `stopped` with
"step limit".

#### Scenario: Two stages to the target

- **GIVEN** stages drafting → planned → building → merged and a run to `merged`
- **WHEN** each action moves the change one stage forward
- **THEN** the engine SHALL run plan, build, and stop as `done` when `merged` is reached

#### Scenario: No progress

- **WHEN** an action completes and the recomputed stage equals the previous stage
- **THEN** the run SHALL become `stopped` with "no progress" and SHALL NOT run the action again

#### Scenario: Stop stage reached

- **WHEN** the recomputed stage is `blocked` and `blocked` is in `stopAt`
- **THEN** the run SHALL become `stopped` with reason `blocked`

### Requirement: Checkpoints pause until approved

When the run reaches a checkpoint stage it SHALL pause in `paused-checkpoint`
and notify the user. Approving SHALL resume reconciliation from that stage; the
approval SHALL apply only to that stage in that run. Cancelling SHALL end the run.

#### Scenario: Approve the planned checkpoint

- **GIVEN** a run paused at checkpoint `planned`
- **WHEN** the user approves
- **THEN** the engine SHALL run the `planned` stage's primary action

### Requirement: Questions pause the run without a timeout

When a session running the current step has a pending question, the run SHALL
be in `awaiting-input` and SHALL return to `running` when the question is
answered. The run SHALL wait indefinitely; the question SHALL be answerable
through the question stack and SHALL trigger the usual waiting-for-input push.

#### Scenario: ship-it asks

- **WHEN** the ship-it session asks "Resume or hand back?"
- **THEN** the run SHALL show `awaiting-input` with a link to the question
- **AND** SHALL continue after the user answers

### Requirement: Run state is durable and resumable

The run record SHALL be persisted before each step is launched and on every
state change. On dashboard server start, runs found in `running` or
`awaiting-input` whose step session is not live SHALL become `interrupted`; runs
whose step session is live SHALL be re-attached and continue. An `interrupted`
or `stopped` run SHALL offer "Resume", which re-reconciles from the current
stage with the step count preserved.

#### Scenario: Restart mid-step with live session

- **GIVEN** a run waiting on a headless ship-it session that survives the server restart
- **WHEN** the server starts
- **THEN** the run SHALL re-attach to that session and keep waiting for its completion

#### Scenario: Restart with dead session

- **GIVEN** a run whose step session died while the server was down
- **WHEN** the server starts
- **THEN** the run SHALL become `interrupted` and offer Resume

### Requirement: Session death re-evaluates progress

When the current step's session ends before its work completed, the engine SHALL
recompute the stage. A changed stage SHALL count as progress and reconciliation
SHALL continue; an unchanged stage SHALL stop the run with "session ended".

#### Scenario: Crash without progress

- **WHEN** the step session crashes and the stage is unchanged
- **THEN** the run SHALL become `stopped` with "session ended"

### Requirement: Users can cancel a run

Cancelling SHALL stop advancing immediately and set `cancelled`. The user SHALL
choose whether to also abort the current step's session; by default it keeps
running unattended by the run.

#### Scenario: Cancel and abort

- **WHEN** the user cancels and chooses to abort the session
- **THEN** the run SHALL be `cancelled` and the step session SHALL be aborted

### Requirement: Run state is visible and available over REST

The change row SHALL show the active run's state, target, current stage, step
count and stop reason, with Approve / Resume / Cancel where applicable. The
server SHALL expose `GET /api/workflows/runs?cwd=` (`observe`),
`POST /api/workflows/runs` to start (`operate`), and
`POST /api/workflows/runs/:id/{approve,resume,cancel}` (`operate`).

#### Scenario: Start over REST

- **WHEN** a client with the `operate` tier starts a run for a trusted workflow
- **THEN** the run SHALL start without an interactive confirmation and appear on the change row
