## MODIFIED Requirements

### Requirement: Workflow schema status is reported separately from readiness

Every successful-poll payload whose readiness is READY or STALE SHALL carry `OpenSpecData.workflowSchema`, unless that tick's status computation failed (below); the cached state served on demand SHALL equal the last broadcast payload, including that omission. The fields are:
- `configured: string | null`;
- `generated: "none" | "current" | "outdated" | "newer" | "incompatible" | "conflict" | "unmanaged"`;
- `missing: boolean` — the config file the CLI reads (`config.yaml`, else `config.yml`) names a schema that resolves in none of the project, user or package schema directories;
- `unpinnedChanges: string[]` — the active changes (as enumerated by enable) without `.openspec.yaml`, detected by `stat` only, and computed only when `configured === "pi-spec-driven"`;
- `affectedChanges: string[]` — the active changes (as enumerated by enable) that resolve to `pi-spec-driven` from files alone: their `.openspec.yaml` names it, or they have no `.openspec.yaml` and `configured === "pi-spec-driven"`. It is computed from files, not from the CLI's per-change `schemaName`, because a change whose schema cannot be loaded is reported without one. Sorted by name; the Update confirmation counts them.
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
