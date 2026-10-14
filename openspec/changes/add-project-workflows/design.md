## Context

- Built-in OpenSpec actions: `deriveOpenSpecActions` (pure, `openspec-actions.ts`)
  + handler maps in `SessionOpenSpecActions.tsx` and the composer strip.
- Change data: server OpenSpec poller (history of event-loop starvation —
  `[openspec-poll] slow tick`); per-change artifacts/tasks already on the wire.
- Trust precedent: `worktreeInit` TOFU (`configRoot + sha256(canonical)`,
  `session`/`project` scope, `~/.pi/dashboard/worktree-init-trust.json`).
- Plugin seams: `spawnSession` (+ `worktree` block from
  `add-plugin-spawn-worktree`, `scope.excludeTools`, `initialPrompt`),
  `sendToSession`, `emitEventToSession`, `onEvent`, `onSessionEnded`,
  `provide`/`consume`/`consumeAll`.
- Automation engine `startRunFor(automation: DiscoveredAutomation, ctx)` already
  takes a definition object; goal plugin has a store + supervisor with
  `spawnDriver`.

## Goals / Non-Goals

**Goals:** committed, per-project, stage-aware actions; one-click composites;
executors reused, not reimplemented; zero change for projects without the
directory.

**Non-Goals:** auto-advance across stages (`add-workflow-auto-advance`);
subjects other than `openspec-change` (`folder`, `session` reserved); local
untracked overrides (`.pi/workflows.local/`) — follow-up; an `agent:` executor
spawning subagents directly (skills/flows own subagent fan-out; nesting is one
level); editing workflows in the UI.

## Decisions

**D1 — New first-party plugin `workflows-plugin`.** Server engine + routes +
executors live in the plugin; core client only renders *descriptors*.
*Alternative:* core server module — rejected: executors already live in plugins,
and plugins get `spawnSession` trust for free. *Alternative:* extend automation —
rejected: its unit (trigger → one disposable run) inverts the workflow's
(one change → many, long-lived, attended sessions).

**D2 — Descriptor-driven client.** Server computes per (session, attached
change) a list `WorkflowActionDescriptor { workflow, id, label, icon, enabled,
reason?, primaryCandidate, confirm? }` plus `builtinVisibility`. The client
merges them into `deriveOpenSpecActions` (new optional ctx input) — the pure
function stays pure and testable. Invocation goes through a browser message
(`workflow_invoke`) mirroring the REST route.

**D3 — Facts ride the poll tick.** Facts are computed from the poller's change
record + git info the server already caches; `file` facts are one `stat` per
declared path per tick, only for changes attached to a live session. Bash gates
evaluate lazily on render/invoke with TTL cache (30 s) and a global concurrency
cap (2).

**D4 — Trust = whole file hash, shared store shape.** Reuse the worktree-init
trust store implementation with a distinct namespace
(`workflow-trust.json`), so session/project semantics and key derivation are
identical. Declarative evaluation needs no trust (pure data).

**D5 — Executors are consumed services.** `automation.runInline`,
`goal.create` provided by those plugins; `flows` via the existing `flow:run`
event; `prompt`/`spawn` via host seams. Missing service → descriptor disabled
with reason.

**D6 — `attended: false` → `scope.excludeTools: ["ask_user"]`.** Skills
(`ship-it`, `plan-proposal`) already branch on `ask_user` availability.
`automation` steps are always unattended (validation) because automation's
max-age reaper would kill a session waiting on a human.

**D7 — Step completion is minimal in this change.** Only intra-action ordering
(spawn registered; prompt delivered or turn ended when chained). Cross-action
completion tracking is the auto-advance change's job.

**D8 — Validation library.** Reuse the YAML parser already used by
`automation-schema.ts`; hand-written validator with precise error paths (no new
schema dependency).

### Example (this repo)

```yaml
version: 1
subject: openspec-change
gates:
  onDevelop: { all: [ { checkout: primary }, { branch: develop } ] }
  planned:   { all: [ { artifact: tasks, status: done }, { file: test-plan.md } ] }
  blocked:   { file: SHIP_IT_BLOCKED.md }
stages:
  - { id: blocked,  when: blocked }
  - { id: building, when: { worktree: "os/{change}" } }
  - { id: planned,  when: planned }
  - { id: drafting, when: { state: [PLANNING, READY, IMPLEMENTING] } }
actions:
  plan:
    label: Plan proposal
    stages: [drafting]
    requires: onDevelop
    steps: [ { prompt: "/skill:plan-proposal {change}", in: attached } ]
  build:
    label: Worktree + ship-it
    stages: [planned]
    requires: onDevelop
    confirm: "Create worktree os/{change} and start ship-it?"
    steps:
      - { id: wt, spawn: { mode: worktree, branch: "os/{change}", ifExists: reuse, attach: true } }
      - { prompt: "/skill:ship-it {change}", in: spawned:wt }
  unblock:
    label: Resolve block
    stages: [blocked]
    requires: onDevelop
    steps: [ { prompt: "/skill:plan-proposal {change}", in: attached } ]
builtins:
  apply: { hideWhen: onDevelop }
```

## Risks / Trade-offs

- **Repo-declared code execution** (bash gates, agent steps with
  `full-access`). Mitigated by whole-file TOFU; edits re-prompt.
- **Gate duplication with skills.** Gates only decide *offering*; skills remain
  the hard gates (plan-proposal fold gate, ship-it entry gate).
- **Poll cost.** D3 bounds work to attached changes; measured in tasks.
- **Format lock-in.** `version: 1`, unknown keys rejected, so v2 can evolve.
- **Rollback:** disable the plugin → descriptors absent → built-in bars only.
  Workflow files are inert without the plugin.
