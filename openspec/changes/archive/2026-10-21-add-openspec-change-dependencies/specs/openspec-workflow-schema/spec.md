## MODIFIED Requirements

### Requirement: Workflow schema is generated from the package base, stamped and validated

The server SHALL generate the schema in a fresh scratch directory, never inside the repository. Every CLI call of generation (`--version`, `schema which`, `schema fork`, `schema validate`) SHALL run with the scratch root as cwd and `XDG_DATA_HOME` set to an empty scratch directory, so no project or user schema can shadow the package base:

1. Run `openspec schema which spec-driven --json`. Abort unless it reports `source: "package"` and an empty `shadows` list.
2. Run `openspec schema fork spec-driven pi-spec-driven --force` there.
3. Apply the current patch set to the scratch `schema.yaml` with a comment-preserving YAML edit, and write the template files the patch set adds into the scratch `templates/`. If a patch's anchor text is not found, generation SHALL abort (a stamp never claims a patch that was not applied).
4. Write the stamp `x-pi-dashboard: { derivedFrom: "spec-driven@<version>", patch: <CURRENT_PATCH>, previousDefault: <name> }`:
   - `<version>` is the `openspec --version` of the CLI that ran;
   - `<name>` is the value supplied by the calling action (see "Schema names are validated before use"): enable passes the default it recorded; Update passes the request's `previousDefault` when given, else the existing stamp's; Adopt and an Update without a stamp (`generated: none`) require the request's `previousDefault` (the UI preselects `spec-driven`).
5. Run `openspec schema validate pi-spec-driven` there.

Only after validation SHALL the result be copied to the sibling `<root>/openspec/schemas/.fork-staging-<rand>/` (a failed copy removes the staging directory and aborts) and swapped in:

1. If `pi-spec-driven/` exists, re-check that its whole-directory fingerprint (every file's relative path and content hash, as OpenSpec's own fork does) is unchanged since its status was read; otherwise abort.
2. If it exists, rename it to `pi-spec-driven.fork-backup-<pid>-<ts>`.
3. Rename the staging directory to `pi-spec-driven/`.
4. Delete the backup, if one was made.

On Windows, every rename (including a restore) failing with `EPERM` / `EBUSY` / `EACCES` SHALL be retried up to 5 times within 2 s. A failure in step 1 or 2 SHALL remove the staging directory and leave the previous schema untouched. A failure in step 3 SHALL rename the backup back (when one exists) and remove the staging directory, leaving the previous schema byte-identical; if that restore itself fails after retries, the backup directory SHALL be left in place (OpenSpec discovery ignores it) and named in the error. A failure in step 4 SHALL NOT roll back: the backup is left and a warning returned. The scratch directory SHALL be removed in every case.

Patch v1 SHALL replace, in the `design` artifact instruction, the line `When to include design.md (create only if any apply):` with `When a full design.md is warranted (otherwise still create design.md containing one line "Not needed: <reason>"):`. This is author guidance only; the CLI only checks that the file exists.

CURRENT_PATCH SHALL be 2. Patch v2 SHALL, after v1:
- insert an artifact `{ id: dependencies, generates: dependencies.yaml, template: dependencies.yaml, requires: [proposal, specs] }` before `tasks`, with an instruction to inspect the other active changes and declare `blocked_by` / `not_blocked_by` / `related` (format per `openspec-change-dependencies`), writing empty lists when there are none;
- write `templates/dependencies.yaml` containing the three keys with empty lists and one explaining comment per key;
- set `tasks.requires` to `[specs, design, dependencies]`.

Its anchors are the `tasks` artifact entry and its `requires` with the exact value `[specs, design]`; a missing anchor or any other value aborts generation, so a changed base is never silently overwritten. `openspec schema validate` checks that every `template` file exists, so step 5 covers the template.

#### Scenario: Fresh generation

- **GIVEN** a project without `openspec/schemas/pi-spec-driven/`
- **WHEN** generation runs
- **THEN** the directory SHALL contain `schema.yaml` (with the `x-pi-dashboard` stamp) and the forked templates
- **AND** `openspec schema validate pi-spec-driven` SHALL report valid in that project

#### Scenario: User-level shadow is ignored

- **GIVEN** a user-level schema named `spec-driven` exists in the real `XDG_DATA_HOME`
- **WHEN** generation runs
- **THEN** the package `spec-driven` SHALL be forked, because the scratch `XDG_DATA_HOME` is empty

#### Scenario: Non-package base aborts

- **WHEN** `schema which spec-driven --json` in the scratch root reports a `source` other than `package`, or non-empty `shadows`
- **THEN** generation SHALL abort and the repository SHALL be untouched

#### Scenario: Validation or swap failure keeps the previous schema

- **GIVEN** an existing generated schema
- **WHEN** validation fails, or the final rename fails after retries and the restore succeeds
- **THEN** `openspec/schemas/pi-spec-driven/` SHALL be byte-identical to before
- **AND** no `.fork-staging-*` or `*.fork-backup-*` directory SHALL remain

#### Scenario: Update preserves the previous default

- **GIVEN** a stamp with `previousDefault: team-flow` and `config.yaml` naming `pi-spec-driven`
- **WHEN** the schema is regenerated by Update
- **THEN** the new stamp SHALL keep `previousDefault: team-flow`

#### Scenario: Design skip declaration counts as done

- **GIVEN** a change on `pi-spec-driven` whose `design.md` contains only `Not needed: single-file fix`
- **WHEN** `openspec status --all` runs
- **THEN** the `design` artifact SHALL be `done` from the CLI verdict alone

#### Scenario: Patch v2 adds the dependencies artifact

- **WHEN** generation runs
- **THEN** `schema.yaml` SHALL list `dependencies` before `tasks`, `tasks.requires` SHALL be `[specs, design, dependencies]`, the stamp SHALL carry `patch: 2`, and `templates/dependencies.yaml` SHALL exist

#### Scenario: New change requires the declaration

- **GIVEN** a project on `pi-spec-driven` patch 2
- **WHEN** a new change has proposal, specs and design but no `dependencies.yaml`
- **THEN** `openspec status` SHALL report `dependencies: ready` and `tasks: blocked`

#### Scenario: Patch 1 schema is outdated, not auto-upgraded

- **GIVEN** a generated schema stamped with patch 1
- **WHEN** a dashboard whose CURRENT_PATCH is 2 polls, or the user runs Enable
- **THEN** the status SHALL be `outdated` and the schema SHALL be unchanged

### Requirement: Workflow schema status is reported separately from readiness

Every successful-poll payload whose readiness is READY or STALE SHALL carry `OpenSpecData.workflowSchema`, unless that tick's status computation failed (below); the cached state served on demand SHALL equal the last broadcast payload, including that omission. The fields are:
- `configured: string | null`;
- `generated: "none" | "current" | "outdated" | "newer" | "incompatible" | "conflict" | "unmanaged"`;
- `missing: boolean` — the config file the CLI reads (`config.yaml`, else `config.yml`) names a schema that resolves in none of the project, user or package schema directories;
- `unpinnedChanges: string[]` — the active changes (as enumerated by enable) without `.openspec.yaml`, detected by `stat` only, and computed only when `configured === "pi-spec-driven"`;
- `affectedChanges: string[]` — the active changes (as enumerated by enable) that resolve to `pi-spec-driven` from files alone: their `.openspec.yaml` names it, or they have no `.openspec.yaml` and `configured === "pi-spec-driven"`. It is computed from files, not from the CLI's per-change `schemaName`, because a change whose schema cannot be loaded is reported without one. Sorted by name; the Update confirmation counts them;
- `undeclaredChanges: string[]` — the members of `affectedChanges` without a regular `dependencies.yaml` file (`lstat` only), sorted by name; the Update to patch 2 counts them.
- `projectSchemas: string[]` — the schema names under `<root>/openspec/schemas/` (directories that are not symlinks, not dot or transient `.fork-*` names, excluding `pi-spec-driven`), sorted. It feeds the previous-default selector in Settings, so the client never offers a user-level-only schema.

Failure, disabled, opted-out and global-off payloads SHALL omit it. It SHALL be recomputed on every poll tick, cache-gate hits included, as specified by `server-openspec-polling` ("Workflow-schema status is computed in the poll worker on every poll tick"); a tick whose computation fails SHALL omit it for that tick and SHALL NOT fall back to a previous tick's value. The `generated` comparison SHALL be decided from the stamp alone; a readable stamp SHALL NOT become `unmanaged` because the directory's content fingerprint could not be computed (the fingerprint is needed only for `newer` / `conflict`, where its failure yields `unmanaged`). The filesystem part is computed in the poll worker; the only CLI call it needs (`schema validate` when the stamp comparison is `newer` or `conflict`) runs on the main thread through the spawn semaphore, memoized.

This status SHALL NOT alter `OpenSpecData.readiness` or any readiness-gated control. In particular, per-change errors caused by a missing schema ("Unknown schema …") SHALL NOT turn a successful status call into a readiness failure.

The actions are offered in Settings (see `settings-panel` "OpenSpec Workflow Schema section"). The OpenSpec folder section SHALL show a non-blocking notice chip whenever any of these holds: `missing`, `outdated`, `newer`, `incompatible`, `conflict`, `unmanaged`, or a non-empty `unpinnedChanges`. The chip is a navigation link that opens that Settings section for the cwd; it performs no action itself. It is a severity pill (the severity and the label of the Settings card pill in lower case, prefixed "Workflow schema:" — e.g. "Workflow schema: update available", "Workflow schema: 3 changes not pinned"; counts only, never change names), with an icon, text of at least 12 px and the contract's tap-target size.

#### Scenario: Outdated schema does not disable session controls

- **GIVEN** a READY project whose generated schema is `outdated`
- **WHEN** the session card renders
- **THEN** readiness SHALL remain `READY` and every OpenSpec control SHALL behave as before
- **AND** the folder section SHALL show the notice chip linking to the Settings section

#### Scenario: Unpinned change arrives by merge

- **GIVEN** an enabled project and a merged change `bar` without `.openspec.yaml`
- **WHEN** the poll completes
- **THEN** `workflowSchema.unpinnedChanges` SHALL be `["bar"]`
- **AND** a `pin` with `pinTo: spec-driven` (the stamp's `previousDefault`) SHALL create `bar/.openspec.yaml` with `schema: spec-driven`

#### Scenario: Missing schema keeps readiness READY

- **GIVEN** a READY project whose `config.yaml` names `pi-spec-driven`, the schema directory absent, and two changes pinned to it
- **WHEN** a poll's status call succeeds with per-change "Unknown schema" errors for those two
- **THEN** readiness SHALL remain `READY`, `workflowSchema.missing` SHALL be `true`, and the other changes SHALL render normally

#### Scenario: Failure payload carries no schema status

- **WHEN** a poll ends in a whole-call failure
- **THEN** the payload SHALL NOT contain `workflowSchema` and SHALL otherwise equal the failure shape defined by `server-openspec-polling`

#### Scenario: Status computation failure omits the status for that tick only

- **GIVEN** a READY project whose previous tick carried `workflowSchema`
- **WHEN** a successful poll tick's status computation fails
- **THEN** that tick's payload SHALL NOT contain `workflowSchema` and readiness SHALL be unchanged
- **AND** an on-demand read of the cached state before the next tick SHALL NOT contain it either
- **AND** the next tick whose computation succeeds SHALL carry it again

#### Scenario: Unreadable schema content does not hide a current stamp

- **GIVEN** a `pi-spec-driven/schema.yaml` with a stamp that compares `current`, and a file under the directory that cannot be read
- **WHEN** a poll tick computes the status
- **THEN** `generated` SHALL be `current`

#### Scenario: Undeclared changes are listed

- **GIVEN** `affectedChanges` is `[a, b, c]`, only `b` has a regular `dependencies.yaml`, and `c`'s is a symlink
- **THEN** `undeclaredChanges` SHALL be `[a, c]`

#### Scenario: Missing schema still counts affected changes

- **GIVEN** `config.yaml` names `pi-spec-driven`, its directory is missing, and changes `a` (unpinned) and `b` (pinned to it) fail to load in the CLI
- **THEN** `affectedChanges` SHALL be `[a, b]`