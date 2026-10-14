## Why

`add-project-workflows` gives each stage a one-click action, but the user still
presses the next button after every stage: plan-proposal finishes → press
"Worktree + ship-it" → ship-it hands back → press "Resolve block" … For a change
that is well understood, the user wants to say "run this to *merged*" (or to
*planned*) and be interrupted only at checkpoints, on questions, or on failure.

The orchestrator skills are idempotent and re-check filesystem reality
(ship-it gates on files; plan-proposal re-runs safely), so the engine does not
need a fragile step pointer. It can **reconcile**: compute the stage, run that
stage's primary action, wait for it to finish, recompute — until the target,
a checkpoint, a stop stage, or no progress. The goal plugin's supervisor already
proves the durability pattern (persist before launch, reconcile on boot,
progress-gated continuation, budgets).

## What Changes

- **NEW `autoAdvance` block** in workflow files:
  `targets`, `checkpoints`, `stopAt`, `maxSteps`, `noProgress: stop`.
- **"Run to …" control** on a change (and REST) for a declared target; explicit
  confirmation per run showing target, checkpoints and step cap; requires the
  workflow to be trusted.
- **Durable run record per change** (one active run per change), persisted
  before each step launches; states `running`, `awaiting-input`,
  `paused-checkpoint`, `done`, `stopped`, `failed`, `interrupted`, `cancelled`.
- **Reconcile loop:** target reached → done; `stopAt` stage → stopped; checkpoint
  stage → paused until the user approves; otherwise run the stage's primary
  enabled action and wait for completion (turn end of the step's session,
  automation run finalization, goal terminal status); stage unchanged after a
  completed action → stopped (no progress); `maxSteps` reached → stopped.
- **Questions:** a pending question in the step's session sets
  `awaiting-input`; the run waits indefinitely and the question surfaces in the
  question stack and as a push.
- **Session death** mid-step → re-evaluate stage; progress → continue, otherwise
  stop with the reason. **Server restart** → active runs become `interrupted`
  with a "Resume" action that re-reconciles.
- **Cancel** stops advancing and optionally aborts the current step's session.
- Run state on the change row and over REST.

## Capabilities

### New Capabilities

- `workflow-auto-advance`: `autoAdvance` schema, run-to control, durable run
  record and states, reconcile loop, checkpoints, no-progress and step caps,
  question waiting, death/restart handling, cancel, REST.

### Modified Capabilities

<!-- none: builds on project-workflows without changing its requirements -->

## Discipline Skills

- `doubt-driven-review`: unattended chains reach irreversible steps
  (squash-merge, worktree removal via ship-change).
- `security-hardening`: an unattended loop spawning `full-access` agents from
  repo-declared definitions; per-run confirmation and trust.
- `observability-instrumentation`: run transitions, stop reasons, step
  durations.
- `systematic-debugging`: expected while validating restart/resume semantics.
- `review-code`: before commit.

## Impact

- `packages/workflows-plugin`: run store (`~/.pi/dashboard/workflow-runs/`),
  reconciler, completion tracking via `onEvent` / `onSessionEnded` / executor
  callbacks, boot reconcile, routes.
- `packages/client`: Run-to control, run status on the change row,
  checkpoint approval, cancel/resume.
- Depends on `add-project-workflows` and `add-pending-question-stack`.
