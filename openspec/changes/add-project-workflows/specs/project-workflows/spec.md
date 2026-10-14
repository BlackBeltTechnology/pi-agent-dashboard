## Purpose

Let a project define, in committed files, its own stage-aware workflow buttons and composite actions for OpenSpec changes — gated by declarative facts and trusted bash gates, and executed through prompts, spawns, automation runs, goals or flows.

## ADDED Requirements

### Requirement: Workflows are discovered from committed project files

The dashboard SHALL discover workflow definitions from `.pi/workflows/*.yaml`
in the checkout of the session being rendered (a worktree reads its own
checkout). Each file defines one workflow identified by its file name. A file
that fails validation SHALL be reported with its errors and SHALL NOT affect other
workflow files or the built-in buttons. A project without the directory SHALL
behave exactly as before.

The schema SHALL accept the top-level keys `version` (must be `1`), `subject`
(only `openspec-change` in this version), `label`, `gates`, `stages`, `actions`,
`builtins` and `autoAdvance`. Any other top-level key SHALL fail validation.

#### Scenario: No workflow directory

- **WHEN** a project has no `.pi/workflows/` directory
- **THEN** the OpenSpec buttons SHALL be exactly the built-in set

#### Scenario: One invalid file isolated

- **GIVEN** `.pi/workflows/a.yaml` is valid and `.pi/workflows/b.yaml` declares `subject: folder`
- **THEN** `b` SHALL be reported invalid naming the unsupported subject
- **AND** `a`'s actions SHALL still be offered

#### Scenario: Worktree reads its own definitions

- **GIVEN** a worktree whose branch modified `.pi/workflows/openspec.yaml`
- **WHEN** a session in that worktree is rendered
- **THEN** the worktree's version of the file SHALL be used

### Requirement: Declarative gates evaluate facts without running code

A gate SHALL be one of: a fact predicate, `all: [..]`, `any: [..]`, `not: ..`,
or a reference to a named gate. Fact predicates SHALL be limited to:

- `state`: the change state (one value or a list);
- `artifact` + `status`: an artifact's status (`done`, `ready`, `blocked`, `skipped`);
- `tasks`: `present` | `complete` | `incomplete`;
- `file`: a path relative to the change folder exists (paths escaping the change folder SHALL fail validation);
- `checkout`: `primary` | `worktree` for the rendering session's cwd;
- `branch`: the rendering session's current branch equals a value;
- `worktree`: a worktree for the given branch exists in the repository.

Fact evaluation SHALL use data already gathered by the dashboard's OpenSpec and
git polling and SHALL NOT start additional OpenSpec CLI processes. A reference to
an undefined gate, or a gate reference cycle, SHALL fail validation.

#### Scenario: Composite gate

- **GIVEN** gate `planned: { all: [ { artifact: tasks, status: done }, { file: test-plan.md } ] }`
- **WHEN** the change's tasks artifact is done and `test-plan.md` exists in the change folder
- **THEN** `planned` SHALL evaluate true

#### Scenario: Path escape rejected

- **WHEN** a gate declares `file: ../../secrets.env`
- **THEN** the workflow SHALL fail validation

#### Scenario: Same change, different checkouts

- **GIVEN** gate `onDevelop: { all: [ { checkout: primary }, { branch: develop } ] }`
- **WHEN** the change is rendered in a develop session and in a worktree session
- **THEN** the gate SHALL be true for the develop session and false for the worktree session

### Requirement: Bash gates run only when trusted, bounded and fail closed

A gate MAY be `bash: "<command>"`, true when the command exits 0 in the
rendering checkout's root. A bash gate SHALL NOT be evaluated until the workflow
file is trusted. Evaluation SHALL be time-limited (default 5 s); timeout, spawn
error or non-zero exit SHALL evaluate false and timeouts and errors SHALL be
logged. Results SHALL be cached per (checkout, change, gate) for a short TTL.
Interpolated values inside a bash gate SHALL be shell-quoted.

#### Scenario: Untrusted file

- **WHEN** a workflow with a bash gate is rendered before its trust is granted
- **THEN** the gate SHALL NOT run, SHALL count as false
- **AND** actions requiring it SHALL show a "workflow not trusted" reason

#### Scenario: Timeout fails closed

- **WHEN** a trusted bash gate runs longer than its time limit
- **THEN** it SHALL be terminated and evaluate false

#### Scenario: Hostile change name

- **GIVEN** a change named `x; rm -rf ~` (or any name with shell metacharacters)
- **WHEN** a bash gate interpolates `{change}`
- **THEN** the value SHALL reach the command as a single quoted word and SHALL NOT be executed

### Requirement: The change's stage is the first matching stage

A workflow SHALL resolve the stage of a change for the rendering session as the
first entry in `stages` whose `when` gate is true. When none matches, the
workflow SHALL offer no actions for that change.

#### Scenario: Ordered resolution

- **GIVEN** stages `blocked` (file `SHIP_IT_BLOCKED.md`) then `planned`
- **WHEN** both gates are true
- **THEN** the stage SHALL be `blocked`

### Requirement: Actions are offered by stage and enabled by gates

An action SHALL be offered when the change's stage is in the action's `stages`.
An offered action whose `requires` gate is false SHALL render disabled with a
reason naming the gate (its `label` when given, else its name). An action SHALL
also be blocked while the target session is working, as built-in actions are.
When the workflow is untrusted, actions SHALL render disabled with a trust
reason and an affordance to review and trust the file.

When several valid workflows offer actions for the same change, the primary
button SHALL be the first enabled action of the first workflow in file-name
order; all other offered actions SHALL appear in the overflow menu.

#### Scenario: Required gate false

- **GIVEN** action `plan` with `requires: onDevelop`
- **WHEN** the change is rendered in a worktree session
- **THEN** `plan` SHALL render disabled with the reason "onDevelop"

#### Scenario: Two workflows compete

- **GIVEN** `a.yaml` and `b.yaml` both offer an enabled action for the current stage
- **THEN** `a`'s first enabled action SHALL be the primary button and `b`'s action SHALL be in the overflow menu

### Requirement: Steps run in order through named executors

An action SHALL declare one or more steps, each with exactly one executor:

- `prompt`: send text to a session selected by `in` (`attached` — the session
  where the action was invoked; `spawned:<stepId>` — a session created by an
  earlier step of the same action; `new` — a new local session);
- `spawn`: start a session `local` or in a `worktree` (branch, ifExists,
  attach), optionally with an initial prompt;
- `automation`: start a headless, disposable automation run from an inline
  definition (skill or prompt, model, sandbox, visibility);
- `goal`: create and start a goal (objective, criteria, budget);
- `flow`: run a named pi-flow in a session selected by `in`.

Steps SHALL run in declared order. A `spawn` step completes when its session
registers. A `prompt` step completes when the prompt is delivered, except that
when a later step targets the same session it SHALL wait for that session's turn
to end. `automation` and `goal` steps complete when started. A failed step SHALL
stop the action and surface the error; earlier steps are not rolled back.

When an executor's plugin is not installed or not enabled, actions using it
SHALL render disabled with a reason naming the missing executor.

#### Scenario: Worktree + ship-it in one click

- **GIVEN** action `build` with steps `spawn { mode: worktree, branch: "os/{change}", attach: true }` (id `wt`) and `prompt "/skill:ship-it {change}" in spawned:wt`
- **WHEN** the user confirms the action for change `add-x`
- **THEN** a worktree session for `os/add-x` attached to `add-x` SHALL start
- **AND** it SHALL receive `/skill:ship-it add-x`

#### Scenario: Missing executor

- **GIVEN** an action with a `goal` step and the goal plugin disabled
- **THEN** the action SHALL render disabled naming the goal executor

#### Scenario: Failing step stops the action

- **WHEN** a `spawn` step fails with `not_git`
- **THEN** later steps SHALL NOT run and the error SHALL be shown on the change

### Requirement: Attended controls whether a spawned session can ask the user

A step that spawns a session SHALL accept `attended` (default `true`). When
`attended` is `false`, the spawned session SHALL be started without the
`ask_user` tool. When `true`, the session SHALL keep `ask_user`, and when it is
also hidden its questions SHALL be answerable through the question stack. An
`automation` step SHALL always be unattended; declaring `attended: true` on it
SHALL fail validation.

#### Scenario: Unattended ship-it

- **WHEN** a step spawns `/skill:ship-it {change}` with `attended: false`
- **THEN** the session SHALL not have the `ask_user` tool

#### Scenario: Attended automation rejected

- **WHEN** an `automation` step declares `attended: true`
- **THEN** the workflow SHALL fail validation

### Requirement: Interpolation uses a closed variable set

Strings in steps and bash gates MAY reference `{change}`, `{cwd}`, `{repoRoot}`
and `{branch}`. Any other `{name}` reference SHALL fail validation.

#### Scenario: Unknown variable

- **WHEN** a step uses `{user}`
- **THEN** the workflow SHALL fail validation naming `{user}`

### Requirement: Workflow files are trusted before code or agents run

Before any bash gate is evaluated or any action step runs, the user SHALL trust
the workflow file. Trust SHALL be keyed by the checkout's config root and a hash
of the file's canonical content, with `session` (memory only) or `project`
(persisted) scope, matching the worktree-init trust semantics. Any edit to the
file SHALL invalidate trust. Declarative gates and stages SHALL be evaluated
without trust.

#### Scenario: First action on an untrusted file

- **WHEN** the user invokes an action of an untrusted workflow
- **THEN** a trust dialog SHALL show the file's gates and steps
- **AND** nothing SHALL run unless the user grants trust

#### Scenario: Edited file

- **GIVEN** a trusted workflow file
- **WHEN** a pull changes one of its steps
- **THEN** the workflow SHALL be untrusted until re-confirmed

### Requirement: Actions may require confirmation

An action MAY declare `confirm: "<text>"` (interpolated). Invoking it SHALL show
the text and run only on confirmation.

#### Scenario: Cancelled confirmation

- **WHEN** the user cancels the confirmation of action `build`
- **THEN** no step SHALL run

### Requirement: Workflows are available over REST

The server SHALL expose:

- `GET /api/workflows?cwd=` — workflows for the checkout with validation errors and trust state (`observe`);
- `GET /api/workflows/actions?cwd=&change=` — the resolved stage and offered actions with enabled state and reasons (`observe`);
- `POST /api/workflows/invoke` — body `{ cwd, change, workflow, action, sessionId? }`; runs the action with the same gating and trust rules as the button; the call itself counts as the confirmation (`operate`).

Invoking an action that is not offered, disabled, or untrusted SHALL return an
error naming the reason and SHALL run nothing.

#### Scenario: Invoke a disabled action

- **WHEN** `POST /api/workflows/invoke` targets an action whose `requires` gate is false
- **THEN** the server SHALL return an error naming the gate and run nothing
