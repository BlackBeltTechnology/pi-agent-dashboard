## Why

OpenSpec has no change-to-change dependency concept, so execution order lives only in proposal prose ("Depends on `x`", "Follow-up: `y`"). Across this repo's 102 active changes, dependency wording names 22 active and 34 archived changes. The relation is invisible on the board and unchecked at ship time. Teams need to see what blocks what, and in what order to execute, without hand-maintaining a list that drifts.

## What Changes

- Per-change `dependencies.yaml` (`blocked_by: [{change, reason?}]`, `not_blocked_by: [name]`, `related: [name]`): the committed, per-change source of truth. One file per change, so parallel edits to different changes never conflict.
- Workflow schema patch v2 (on top of `add-pi-spec-driven-schema`): `pi-spec-driven` gains a `dependencies` artifact (`generates: dependencies.yaml`, `requires: [proposal, specs]`), and `tasks` requires it. Its instruction tells the authoring agent to check other active changes and declare edges, writing empty lists when there are none. On `spec-driven` changes the file is optional and honoured when present.
- Dependency graph computed during the poll, deterministic and never written back to disk:
  - **declared** edges from `dependencies.yaml`;
  - **L1** inferred from proposal wording (only backticked names that resolve to real changes; direction from keywords);
  - **L2** capability birth (A adds a capability that B modifies → A blocks B);
  - **L3** shared-capability overlap (undirected warning, never blocking).
  - `not_blocked_by` suppresses an edge; archived blockers count as satisfied; names active only in another worktree of the same repo are `external`.
- Validator: invalid YAML or shape, self-reference and cycles are errors; unknown names are warnings.
- Execution waves via topological sort; nodes in a cycle get no wave.
- `OpenSpecChange.dependencies` carries `blockedBy`/`blocks` (computed inverse)/`related`/`overlaps`/`wave`/`issues`.
- Board: blocked-by / blocks / overlap chips on cards, an "Execution order" view sorting each column by wave, and a card dialog to add or remove dependencies (writes `dependencies.yaml`). Shown when the project's default schema is `pi-spec-driven` or any change has a `dependencies.yaml`.
- REST: `GET /api/openspec/dependencies?cwd=&change=` and `PUT /api/openspec/dependencies`.
- ship-it: validator errors block; open (unarchived) blockers warn.

## Capabilities

### New Capabilities

- `openspec-change-dependencies`: file format, schema patch v2, inference layers, graph and waves, validator, REST endpoints, tracked-path rule.

### Modified Capabilities

- `openspec-board`: dependency chips, execution-order view, dependency editor dialog.
- `ship-it-orchestrator`: dependency gate at entry.

## Dependencies

- Blocked by: `add-pi-spec-driven-schema` (schema patch v2 extends its generator and stamp), and transitively `use-openspec-status-all` (schema-declared artifacts and the `.yaml` tracked paths come from `openspec status --all`).
- Blocks: none.

## Impact

- New `packages/shared/src/openspec-dependencies.ts` (parse, validate, infer, graph, waves; pure), worker integration in `packages/server/src/openspec/openspec-poll-worker.ts`, cross-worktree resolution in `directory-service.ts`.
- `packages/server/src/openspec/workflow-schema.ts` patch v2; new dependencies routes in `packages/server/src/routes/openspec-routes.ts`.
- `packages/shared/src/types.ts` (`OpenSpecChange.dependencies`).
- Client: board card chips, execution-order toggle in the filter bar, dependency dialog (`packages/client/src/components/openspec/`).
- `.pi/skills/ship-it/SKILL.md` entry gate.
- Writes into user repos: `openspec/changes/<name>/dependencies.yaml`, only via the editor or the authoring agent.

## Discipline Skills

- `security-hardening` — `PUT` endpoint writes into a client-named change dir; untrusted YAML (size cap, safe parse, no anchors/aliases expansion bombs), change-name slug validation, admission gates, path containment.
- `performance-optimization` — graph and inference run on every gated poll; budget < 20 ms for 100 changes in the worker, measured.
- `observability-instrumentation` — per-tick debug line with edge counts by source and validator issue counts.
