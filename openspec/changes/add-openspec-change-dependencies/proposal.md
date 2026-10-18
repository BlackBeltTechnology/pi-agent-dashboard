## Why

OpenSpec has no change-to-change dependency concept, so execution order lives only in proposal prose ("Depends on `x`", "Follow-up: `y`"). Across this repo's 87 active changes, labelled dependency lines alone name 9 open and 11 satisfied blockers, and prose mentions another 80 times. The relation is invisible on the board and unchecked at ship time. Teams need to see what blocks what, and in what order to execute, without hand-maintaining a list that drifts.

## What Changes

- Per-change `dependencies.yaml` (`blocked_by: [{change, reason?}]`, `not_blocked_by: [name]`, `related: [name]`): the committed, per-change source of truth. One file per change, so parallel edits to different changes never conflict.
- Workflow schema patch v2 (on top of `add-pi-spec-driven-schema`): `pi-spec-driven` gains a `dependencies` artifact (`generates: dependencies.yaml`, template `templates/dependencies.yaml`, `requires: [proposal, specs]`), and `tasks` requires it. Its instruction tells the authoring agent to check other active changes and declare edges, writing empty lists when there are none. On `spec-driven` changes the file is optional and honoured when present.
- Dependency graph computed in the poll worker from repository content only, deterministic and never written back to disk:
  - **declared** edges from `dependencies.yaml`;
  - **L1** labelled proposal lines (`Blocked by` / `Depends on` / `Builds on` / `Blocks`, best kept in `## Dependencies`); other backticked change names in prose become non-blocking `related`;
  - **L2** capability birth (sole birther A of an unborn capability blocks every other change touching it; several birthers → `duplicate-capability` warning);
  - **L3** shared-capability overlap (undirected, never blocking).
  - `not_blocked_by` suppresses an edge for the blocked change; archived blockers (exact `<date>-<name>`) count as satisfied; anything else is unknown. Not computed on the old-CLI fallback path.
- Validator: invalid file, self-reference and fully declared cycles are errors; cycles through an inferred edge, downstream-of-cycle and unknown names are warnings.
- Execution waves via topological sort; cycle members and their dependents get no wave.
- `OpenSpecChange.dependencies` carries `blockedBy`/`blocks` (computed inverse)/`related`/`overlaps`/`wave`/`issues`.
- Board: blocked-by / blocks / overlap chips, an "Execution order" view sorting each column by wave (column moves allowed, within-column reorder off), and a per-change dialog to add, remove or reject dependencies (writes that change's `dependencies.yaml`). Shown when the default schema is `pi-spec-driven` or any change has a `dependencies.yaml`.
- Board: a "Declare dependencies" hint explains why a change with an undeclared `dependencies` artifact stays in planning; `dependencies` renders as letter `L`.
- Delivery (MODIFIED generator and settings section): patch v2 adds the artifact and its template; existing projects see `generated: outdated` and apply it by an explicit Update, whose confirmation counts the affected changes that will need a declaration and return to planning.
- Polling: `dependencies.yaml`, `changes/archive/` and main-spec existence for touched capabilities join the watcher/gate tracked set.
- REST: `GET` / `PUT /api/openspec/dependencies` with route-tier, MCP-manifest and road-classification entries, the workflow-schema write guard and lock, and an mtime precondition against concurrent edits.
- ship-it: a gate script (`scripts/openspec-deps-gate.ts`) queries the dashboard for its own cwd (5 s timeout, bounded retry), falls back to the shared parser offline, and counts blockers archived on `origin/develop` as satisfied; errors block, open blockers warn.
- plan-proposal: commits `dependencies.yaml` with the planning artifacts.

## Capabilities

### New Capabilities

- `openspec-change-dependencies`: file format, schema patch v2, inference layers, name resolution, validator, waves, cost budget, REST endpoints.

### Modified Capabilities

- `openspec-board`: dependency chips, execution-order view, dependency editor dialog, planning-reason hint, distinct artifact letter; drag rule scoped for the execution-order view; proposal-card contents include the chips.
- `server-openspec-polling`: change-detection gate, watcher and TOCTOU stamp track `dependencies.yaml`, `changes/archive/` and main-spec existence (the TOCTOU stamp list also names the already-tracked `config.yml`); TOCTOU-kept entries still get a recomputed `dependencies` field.
- `openspec-workflow-schema`: generator patch v2 (dependencies artifact and template); `workflowSchema.undeclaredChanges`.
- `settings-panel`: Update confirmation states the patch-2 impact.
- `plan-proposal-orchestrator`: `dependencies.yaml` is committed at the worktree boundary.
- `ship-it-orchestrator`: dependency gate at entry.

## Dependencies

- Blocked by: `add-pi-spec-driven-schema` (schema patch v2 extends its generator and stamp), and transitively `use-openspec-status-all` (schema-declared artifacts and the `.yaml` tracked paths come from `openspec status --all`).
- Builds on: `move-workflow-schema-status-to-poll-worker` (archives first). Both changes write full MODIFIED copies of "Cwd-level change-detection gate for the status-all poll" (`server-openspec-polling`) and "Workflow schema status is reported separately from readiness" (`openspec-workflow-schema`). This change rebases both copies onto the text archived by that change before its own archive, and computes `undeclaredChanges` in that change's worker-safe `packages/server/src/openspec/workflow-schema-status.ts` (the per-tick `schemaStatus` worker request), not in `workflow-schema.ts`.
- Blocks: none.

## Impact

- New `packages/shared/src/openspec-dependencies.ts` (parse, validate, infer, graph, waves; pure), worker integration with a per-file parse cache in `packages/server/src/openspec/openspec-poll-worker.ts`, tracked paths in the gate/watcher, in-process derivation parity.
- `packages/server/src/openspec/workflow-schema.ts` patch v2; new dependencies routes in `packages/server/src/routes/openspec-routes.ts`, rows in `packages/shared/src/route-tiers.ts`, MCP manifest, road classification.
- `packages/shared/src/types.ts` (`OpenSpecChange.dependencies`).
- Client: board card chips, execution-order toggle in the filter bar, dependency dialog (`packages/client/src/components/openspec/`).
- `.pi/skills/ship-it/SKILL.md` entry gate and new `scripts/openspec-deps-gate.ts`; `.pi/skills/plan-proposal/SKILL.md` commit list.
- Writes into user repos: `openspec/changes/<name>/dependencies.yaml`, only via the editor or the authoring agent.

## Discipline Skills

- `security-hardening` — `PUT` endpoint writes into a client-named change dir; untrusted YAML (size cap, safe parse, no anchors/aliases expansion bombs), OpenSpec change-id grammar, admission gates, workflow-schema write guard, realpath containment with symlink refusal, YAML-serializer output, shared per-cwd lock.
- `performance-optimization` — graph and inference run on every gated poll; per-file parse cache; warm budget < 20 ms for 100 changes in the worker; cold cost measured on macOS and Windows.
- `observability-instrumentation` — per-tick debug line with edge counts by source and validator issue counts.
