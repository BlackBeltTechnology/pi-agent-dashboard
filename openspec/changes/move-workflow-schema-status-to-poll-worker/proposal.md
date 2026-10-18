## Why

`add-pi-spec-driven-schema` specifies that the filesystem part of `OpenSpecData.workflowSchema` is computed in the poll worker. Its implementation (`packages/server/src/directory-service.ts`, `workflowSchemaStatusFor` + `finalizeOpenSpecData`) computes it on the main thread, and the ship-it run of that change was handed back for it (`SHIP_IT_BLOCKED.md`, design D5).

The deviation has a real cause, but not the one it first appears to have. The status-all mtime gate already tracks `openspec/config.yaml` and everything under `openspec/schemas/` (`probeTrackedPaths`, `packages/server/src/openspec/openspec-poll-fs-helpers.ts:185-192`), so an enable, disable, update or a teammate's pull normally causes a gate miss and a rebuild. What the gate does not track, and what the status depends on:
- the resolved CLI version (the stamp comparison is relative to it; a CLI upgrade is a gate hit);
- `openspec/config.yml` (the CLI reads it when `config.yaml` is absent; the probe stats only `config.yaml`);
- the user-level and package schema directories (`missing` resolves through them);
- the old-CLI fallback `list` path, which has its own build and never sees the status-all gate.

A compute "when the poll rebuilds data" (the original spec wording) therefore leaves the status stale on gate hits for those inputs, and needs a second path for the fallback. The original spec adds "and whenever the resolved CLI version changes" but names no mechanism for it and does not cover `config.yml` or the user/package schema directories. The code took the shortest path that is fresh: the main thread, every tick. So spec and code diverged.

This change fixes the gap without widening the gate: the status is computed in the poll worker on **every** poll tick, gate hit or not, through one dedicated worker request, with a single in-process fallback. It also closes a smaller gap from the same ship-it run: the REST route validates through a private semaphore instead of the one that bounds every other `openspec` spawn.

## What Changes

- New worker request kind `schemaStatus` on the poll worker pool, next to `probe` / `build`. It runs the filesystem-only status computation (config read, stamp parse, schema resolution, change enumeration, `.openspec.yaml` stats) and returns the status plus, for a `newer` / `conflict` stamp, the whole-directory fingerprint that needs a CLI validate. Same pool fallbacks as `probe` / `build` (worker disabled, crash, timeout → bounded async in-process run). Both dispatch sites (worker message handler, in-process `runAsyncInProcess`) become exhaustive over the request kind, so an unknown kind fails instead of silently running another request's body.
- `DirectoryService` replaces its main-thread compute with that request, started concurrently with the poll as today and attached at `finalizeOpenSpecData` on every success path (gate hit, status-all build, fallback list, force). On the main thread only the `newer` / `conflict` `schema validate` remains, through the shared spawn semaphore, memoized by (cwd, fingerprint, CLI version), mapping to `incompatible` on failure.
- The filesystem-only computation moves into a worker-safe module (no CLI, no semaphore, no `directory-service` imports) that `workflow-schema.ts` re-uses, so the module the worker loads stays small.
- The REST route and the poll share one spawn semaphore: `DirectoryService` exposes its semaphore and `server.ts` passes it to the route instead of creating a second pool.
- No wire-format change: `OpenSpecData.workflowSchema` is identical, only where and when it is computed changes.
- The dependency's `openspec-workflow-schema` requirement is reconciled with a MODIFIED delta:
  - "recomputed on every poll tick" replaces "whenever the poll rebuilds data / the CLI version changes";
  - the carrying rule is narrowed to READY/STALE payloads, which is what the code already does (`hasWorkflowSchemaStatus`);
  - a computation failure omits the key, and the cached state served on demand is the last broadcast payload, including that omission;
  - the validate trigger reads `newer` or `conflict`, as the code does.
- The stamp comparison is decided from the stamp alone. A readable `current` / `outdated` stamp no longer turns `unmanaged` when the whole-directory fingerprint fails. That matches the spec's definition of `unmanaged` (a symlink or no parseable stamp); the old behaviour was code-only.
- `DirectoryService` gains test seams for the poll worker pool and a status-computation fault, needed by the worker-error and enqueue-order tests.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `server-openspec-polling`: adds the requirement that the workflow-schema status is computed in the poll worker on every tick, including gate-hit ticks, with one in-process fallback and a main-thread-only validate.
- `openspec-workflow-schema` (introduced by `add-pi-spec-driven-schema`): "Workflow schema status is reported separately from readiness" — recompute trigger, failure omission and validate trigger aligned with the above. Applies at archive after the dependency's delta (blocked-by order).

## Dependencies

- Blocked by: `add-pi-spec-driven-schema` (defines `OpenSpecData.workflowSchema`, `computeWorkflowSchemaStatus`, the `newer` / `conflict` validate and the REST route this change relocates and re-wires).
- Blocks: `add-openspec-change-dependencies`. Both changes write full MODIFIED copies of "Cwd-level change-detection gate for the status-all poll" (`server-openspec-polling`) and "Workflow schema status is reported separately from readiness" (`openspec-workflow-schema`). Archive order: this change first. The sibling then rebases both copies onto the text archived here, and adds `undeclaredChanges` to the worker-safe `workflow-schema-status.ts` instead of `workflow-schema.ts`. A matching note is recorded in that change's proposal and tasks.
- Sequencing: implementation starts only after `add-pi-spec-driven-schema` has merged into `develop`. Until then every file this change edits, and exemplars such as `packages/server/src/__tests__/workflow-schema-actions.test.ts`, exist only in that change's worktree (`.worktrees/os-add-pi-spec-driven-schema`).

## Impact

- **Server.**
  - `packages/server/src/openspec/openspec-poll-worker.ts` (new request kind, worker body).
  - `packages/server/src/openspec/openspec-poll-worker-pool.ts` (`schemaStatus` method, fallback).
  - `packages/server/src/directory-service.ts` (replace `workflowSchemaStatusFor`, expose the semaphore).
  - `packages/server/src/server.ts` (pass the shared semaphore to the route).
  - `packages/server/src/openspec/workflow-schema.ts` (filesystem-only status moved to the new worker-safe module).
- **Specs.** `server-openspec-polling` (MODIFIED + ADDED), `openspec-workflow-schema` (MODIFIED).
- **Shared / client / config.** None.
- **Rollback.** Revert the commit; the previous main-thread compute is the behaviour of `add-pi-spec-driven-schema` as first shipped.
- **Non-goals.**
  - A server endpoint listing project schemas for the previous-default selector (the client offers `spec-driven` plus the configured schema; the server still enforces resolvability).
  - Exposing the stamp's `previousDefault` in the status payload for the Pin target selector.
  - Changing the change-detection gate signature, and tracking `config.yml` in the probe: a pre-existing gap of `use-openspec-status-all` for the CLI's own status, out of scope here (see design D1); `add-openspec-change-dependencies` adds `config.yml` to the tracked set.
  - Push refresh for `config.yml` or user/package schema-directory edits: the change watcher does not watch them, so the status picks them up on the next periodic tick, not by push.
  - Pre-existing behaviours kept as-is: the main-thread finalize re-serializes the payload on every success path (the serialize-once scenario of "Periodic poll derivation runs off the main event loop" was already not met after `add-openspec-init-affordances`), and a `schema validate` that fails to spawn is memoized like a failing one.

## Discipline Skills

- `performance-optimization`: the status runs on every tick including gate hits, in the hot poll path; the event-loop turn budget (`directory-service-eventloop-turns`, 150 ms) and a cold 100+-change directory are the measured constraints.
- `observability-instrumentation`: none beyond the existing poll-turn instrumentation; a worker `schemaStatus` failure is logged once per cwd with the fallback taken, so a silently missing `workflowSchema` is diagnosable.
