## Why

The dashboard compensates for a gap in OpenSpec's built-in `spec-driven` workflow with duplicated heuristics. `spec-driven` requires `design.md` while telling authors to skip it, and 12 of 102 active changes did skip it. To cope, the design R1/R2/R3 promote rules exist twice: in TypeScript (`openspec-design-evidence.ts`) and in bash (`.pi/skills/openspec-shared/scripts/effective-status.sh`), backed by a lint ban and a parity test.

OpenSpec supports project-local workflow schemas (`openspec/schemas/<name>/`). A dashboard-managed schema can turn the guess into an explicit, CLI-tracked declaration. It is also the vehicle for new workflow artifacts; the first consumer is `add-openspec-change-dependencies`.

A spike in a scratch copy confirmed that fork → patch → `schema validate` → `new change` → `status`/`instructions`/`validate`/`archive` all work. It also surfaced two traps this change must handle:
- changes without `.openspec.yaml` silently follow a switched default;
- a missing schema makes `openspec new change` fail outright.

## What Changes

- **Generated schema.** New dashboard-managed project schema `pi-spec-driven`, generated and never hand-maintained:
  1. in a scratch root with an empty `XDG_DATA_HOME`: `openspec schema which spec-driven --json` must report `source: "package"` with no shadows;
  2. `fork --force`;
  3. a comment-preserving YAML patch;
  4. the stamp `x-pi-dashboard: { derivedFrom: "spec-driven@<CLI version>", patch: <n>, previousDefault }`;
  5. `schema validate`;
  6. a staged swap into `<root>/openspec/schemas/`, using OpenSpec's own `.fork-staging-*` / `*.fork-backup-*` transient names, with rollback and Windows retry.

  Teammates whose dashboards resolve the same OpenSpec CLI version generate identical files.
- **Patch v1.** The `design` instruction tells authors to write a one-line `design.md` (`Not needed: <reason>`) when no design criterion applies. That is an explicit, tracked skip.
- **Enable flow** (REST + Settings → OpenSpec toggle). Refused unless `config.yaml` exists and the status-call root is the cwd itself (`root.source: "nearest"`). Steps:
  1. record `previousDefault`;
  2. generate the schema, governed by the stamp rules;
  3. create `.openspec.yaml` with `schema: <previousDefault>` for every change that has none. Measured at ~15 ms for 104 changes; idempotent. Existing files are never modified;
  4. switch `config.yaml` to `pi-spec-driven`;
  5. return the written paths. The dashboard never commits.
- **Disable** restores `previousDefault`. `remove` is refused while the schema is still referenced.
- **Stamp rules** are component-wise: `current` / `outdated` (Update) / `newer` (never touched) / `conflict` (reported, never regenerated) / `unmanaged` (explicit Adopt only). Teammates can therefore never downgrade each other's schema.
- **Schema status outside readiness.** It is reported as `OpenSpecData.workflowSchema` (`configured`, `generated`, `missing`, `unpinnedChanges`), separately from readiness. Readiness and every readiness-gated control are unchanged. Notices appear in Settings → OpenSpec and as a non-blocking chip in the folder section.
- **Global default for new projects.** Setting `openspec.workflowSchema.defaultForNewProjects` runs enable only after a dashboard-performed init of a directory that had no `openspec/` (project-init `offer`, or REST init of a fresh dir). It never runs on repair or overwrite.
- **R1/R2/R3 scope.** These promote rules are skipped only for changes whose `schemaName` is `pi-spec-driven`, in both the dashboard and `effective-status.sh`; every other schema keeps them.
- **Settings section.** A new "OpenSpec Workflow Schema" section holds the `defaultForNewProjects` switch (saved via the Save Bar) and the per-cwd Enable / Disable / Update / Adopt / Pin / Remove actions, each confirmed with the list of paths to write. The folder-section chip only links there.

## Capabilities

### New Capabilities

- `openspec-workflow-schema`: generation and swap, stamp rules, enable/disable/pin/adopt/remove, schema status, REST endpoint with gates/containment/lock, new-project default.

### Modified Capabilities

- `openspec-local-artifact-evidence`: design evidence and its reconciliation are skipped for `pi-spec-driven` changes.
- `settings-panel`: new "OpenSpec Workflow Schema" section.
- `openspec-detection`: the dashboard and `effective-status.sh` both gate R1/R2/R3 on `schemaName`, so they keep agreeing; the design-evidence requirement is scoped the same way.
- `server-openspec-polling`: the `status --all` poll skips the design override for `pi-spec-driven` changes.
- `project-init-skill`: applies the workflow schema after init in `offer` mode only, when the global default is on, disclosed in its preview.

## Dependencies

- Blocked by: `use-openspec-status-all`. The hardcoded four-artifact derivation mis-reports schema-declared artifacts, and this change relies on its per-change `error`, its watcher on `openspec/schemas/` and `config.yaml`, and its tracked `.openspec.yaml`.
- Blocks: `add-openspec-change-dependencies`.

## Impact

- **Server.**
  - New `packages/server/src/openspec/workflow-schema.ts`: generate/stamp/swap/enable/disable/pin/adopt/remove/status.
  - Route in `packages/server/src/routes/openspec-routes.ts` (`networkGuard`, sharing the init endpoint's per-cwd lock), plus a `control`-tier entry in `packages/shared/src/route-tiers.ts`.
  - Poll integration: the `workflowSchema` status is attached in the worker build.
- **Shared.**
  - `packages/shared/src/config.ts` (`openspec.workflowSchema`).
  - `packages/shared/src/types.ts` (`OpenSpecData.workflowSchema`).
  - `packages/shared/src/openspec-poller.ts` (R-rule scoping).
- **Skills.**
  - `.pi/skills/openspec-shared/scripts/effective-status.sh` (schema gate).
  - `packages/extension/.pi/skills/project-init/SKILL.md` (post-init step).
- **Client.** Settings → OpenSpec section (`OpenSpecProfileSection.tsx` area) and the folder-section notice chip.
- **Writes into user repos**, only on explicit actions:
  - `openspec/schemas/pi-spec-driven/**`
  - `openspec/config.yaml`
  - `openspec/changes/*/.openspec.yaml`
- **Non-goals.**
  - Enabling it on this repository (a separate rollout decision).
  - Removing `effective-status.sh`, which can go once no `spec-driven` changes remain.
  - Stepper segments.
  - User-level schemas.

## Discipline Skills

- `doubt-driven-review`: the enable flow rewrites `config.yaml` and creates metadata across many changes of a shared repo. The ordering (record → generate → pin → switch), the stamp rules and rollback have to stand before implementation.
- `security-hardening`: a new REST endpoint writes files under a client-supplied cwd. It gets admission gates, realpath containment, a symlink skip, root-source checks, a per-cwd lock and no shell interpolation.
- `observability-instrumentation`: log each action with the cwd, the written paths and the stamp before and after.
