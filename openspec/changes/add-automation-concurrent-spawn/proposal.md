## Why

An automation fire today spawns exactly ONE session running ONE action. Flow-driven work is inherently fan-out: after a schedule fires we want N independent sessions, each carrying its own flow or skill, running concurrently and reported as one logical occurrence. Today that requires N duplicated `automation.yaml` files with N duplicated cron lines that drift apart and cannot share a fire.

## What Changes

- `automation.yaml` gains an optional `actions:` list (fan-out) alongside the existing single `action:` block. Each entry is a full action spec (`kind` + `prompt`/`skill`/`payload`), so entry 1 can be `flows.run` of flow A and entry 2 a `core.skill` of skill B.
- Each entry gains an optional `count` (default `1`) so the same action can be spawned X times in parallel. `count` is honored on the single `action:` block too; `action:` without `count` stays one child.
- One trigger fire → one parent run that spawns N child sessions concurrently. Children are tracked as child runs of the parent occurrence; the parent finalizes when all children finalize (or are stopped/reaped).
- Existing `concurrency` (skip|queue|parallel) keeps applying to the FIRE (the parent occurrence), not to individual children; children within one fire always run concurrently.
- A `maxConcurrentSpawns` bound (per-automation, with a settings default) caps how many child sessions a single fire may start.
- Stopping the parent run stops every live child; a child dying finalizes only that child.
- Results: each child writes its own `result.md` under the parent run dir; the parent aggregates child statuses and findings counts.
- Automation view + board surface the parent run with its child list (per-child action label, status, session link).
- NOT breaking: a file with a single `action:` and no `count` behaves exactly as today (one child).
- Two spawn-path races that fan-out turns from rare into routine are fixed in scope: a stop landing inside the spawn→register window is honored on token arrival instead of dropped, and retention pruning no longer deletes a still-running occurrence.

## Capabilities

### New Capabilities
- `automation-fanout-spawn`: declaring multiple actions (and per-action counts) on one automation, the bound on concurrent child spawns, and how one trigger fire expands into N concurrent child sessions.

### Modified Capabilities
- `automation-run-lifecycle`: a run becomes a parent occurrence with child runs — spawn, dispatch, result capture, stop, session-death reaping, and finalization are specified per child plus a parent aggregate rule.

## Discipline Skills

`review-code` (non-trivial diff before commit), `performance-optimization` (concurrent spawn width / resource bound), `observability-instrumentation` (per-child spawn + finalize visibility).

## Impact

- `packages/automation-plugin/src/shared/automation-types.ts` — `AutomationConfig.actions?`, per-entry `count`, `RunRecord` parent/child fields.
- `packages/automation-plugin/src/server/` — `automation-schema.ts` (validate `actions`/`count`/bound), `engine.ts` (`startRunFor` fan-out, per-child dispatch/capture/finalize, parent aggregate, `completeRun` moved to parent finalization, `stopRun` cascade + spawn-window guard, child-aware reaper), `runner.ts` (fire-level policy unchanged, parent keyed), `run-store.ts` (child-aware run-id resolver, child records under the parent run dir, live-occurrence prune guard), `routes.ts` (child data in list/result/stop, `actions:` entry validation on create/update), `automation-writer.ts` (serialize `actions:`/`count`), `configSchema.json` (`maxConcurrentSpawns` default).
- `packages/automation-plugin/src/client/` — `CreateAutomationDialog` multi-action editor, `AutomationBoard`/`AutomationRunMonitor` parent+children rendering.
- Docs: `docs/architecture.md` automation section; package `README.md`; directory `AGENTS.md` rows.
- No new runtime dependencies. Existing single-action automations unaffected.
