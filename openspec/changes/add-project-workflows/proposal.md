## Why

The OpenSpec lifecycle buttons are a hardcoded table
(`packages/client/src/components/openspec/openspec-actions.ts`: `CANDIDATES` per
`ChangeState`, one `/skill:openspec-*` prompt per button, gated only by the
global profile `wf()` and "session working"). A project cannot express its own
pipeline. This repo's real pipeline is:

- on `develop`: explore → ff/continue → **plan-proposal** → commit;
- in a worktree: **ship-it** (→ ship-change).

None of that is offered as a button. "Apply" is even wrong on `develop`, where
implementation should not happen. Spawning the worktree, attaching the change and
starting ship-it are three manual steps. Other projects have other pipelines
(release cut, nightly verify), so the fix is not another hardcoded button but a
**project-owned, committed workflow definition**.

The definition must be the only place where workflows are authored. Automation,
goal and pi-flows become **executors** the workflow calls; their own screens stay
for monitoring and are never needed to define a workflow.

## What Changes

- **NEW `.pi/workflows/<id>.yaml`** (committed, one file per workflow), read from
  the session's own checkout (a worktree reads its own copy).
- **Facts → gates → stages → actions:**
  - *Facts* derived cheaply from data the dashboard already has: change state,
    artifact status, task completion, files in the change folder, checkout kind
    (primary/worktree), branch, worktree existence for a branch.
  - *Gates*: named predicates over facts composed with `all`/`any`/`not`, plus
    optional **bash gates** (trust-on-first-use, cached, time-limited, fail closed).
  - *Stages*: ordered, first match wins; the change's project-defined stage.
  - *Actions*: offered for stages, enabled by `requires` gates (disabled with the
    gate's reason otherwise), optional confirmation, one or more ordered steps.
- **Executors (step kinds):** `prompt` (into the attached session, a spawned
  session, or a new one), `spawn` (local or worktree via
  `add-plugin-spawn-worktree`), `automation` (headless, disposable, via a new
  inline-run service of the automation plugin), `goal` (via a new programmatic
  create service of the goal plugin), `flow` (pi-flows run in a session).
- **`attended`** per step: `false` removes `ask_user` from a spawned session so
  skills take their headless branches; `true` keeps it — questions from hidden
  attended sessions surface in the question stack (`add-pending-question-stack`).
- **Built-in buttons:** per-key `keep` / `hide` / `hideWhen: <gate>` so a project
  can hide e.g. Apply on `develop`.
- **Trust:** the whole workflow file is trust-gated (hash of its canonical form,
  session or project scope, same semantics as `worktreeInit`) before any bash gate
  is evaluated or any step runs. Editing the file requires re-confirmation.
- **REST:** list workflows/validation/trust, list actions for a change, invoke an
  action.
- `autoAdvance` is reserved in the schema and implemented by
  `add-workflow-auto-advance`.
- Example `.pi/workflows/openspec.yaml` for this repo (plan-proposal on develop;
  "Worktree + ship-it"; "Resolve block" on `SHIP_IT_BLOCKED.md`).

## Capabilities

### New Capabilities

- `project-workflows`: workflow file format and discovery, facts, gates (incl.
  trusted bash gates), stage resolution, action offering/gating, executors,
  `attended`, trust, interpolation, REST surface.

### Modified Capabilities

- `openspec-frontend-actions`: session-card/composer OpenSpec bars render
  project workflow actions and honour per-project built-in visibility.
- `automation-run-lifecycle`: a trusted plugin can start an inline (definition
  object, no `automation.yaml`) run, tagged with its origin.
- `goal-supervisor`: a trusted plugin can create and start a goal
  programmatically and observe its terminal status.

## Discipline Skills

- `security-hardening`: repo-declared bash gates and agent steps (untrusted
  input from a pulled commit), interpolation of user-controlled change names into
  shell, new `operate`-tier invoke route.
- `doubt-driven-review`: the workflow file format becomes a public, committed
  contract other projects will author.
- `performance-optimization`: facts must ride the existing OpenSpec poll tick
  (history of `[openspec-poll] slow tick` starvation); bash gates cached.
- `observability-instrumentation`: gate evaluation, action invocations, executor
  failures.
- `review-code`: before commit.

## Impact

- **New first-party plugin** `packages/workflows-plugin` (server: loader,
  validator, fact/gate/stage engine, executors, trust, routes; client: settings
  surface for trust + validation errors). Registration per the
  add-new-plugin checklist.
- `packages/shared`: workflow action descriptors on the OpenSpec change wire data.
- `packages/client/src/components/openspec/openspec-actions.ts` +
  `SessionOpenSpecActions.tsx` / composer strip: render descriptor-driven actions,
  built-in visibility.
- `packages/automation-plugin`: publish an inline-run service.
- `packages/goal-plugin`: publish a create-goal service.
- Depends on `add-plugin-spawn-worktree` (worktree spawn) and
  `add-pending-question-stack` (attended hidden steps).
- No data migration. Projects without `.pi/workflows/` see no change.
