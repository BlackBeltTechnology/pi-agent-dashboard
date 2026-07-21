## ADDED Requirements

### Requirement: ROW_CAP counts inline detail rows, not sidecar-pointer rows
The `over-threshold` row check SHALL count only **inline** DOX rows and SHALL exclude **sidecar-pointer** rows. A sidecar-pointer row is a row whose purpose carries the `→ see `<File>.AGENTS.md`` marker written when a heavy row (over the 200-char inline cap) is promoted to its per-file sidecar. Because a pointer row is pull-only and carries no inline detail, promoting a row to its sidecar SHALL reduce the counted total. The byte check SHALL remain over total file bytes. `ROW_CAP` and `AGENTS_BYTE_CAP` numeric values SHALL be unchanged.

#### Scenario: Promoted rows do not count toward ROW_CAP
- **WHEN** a directory `AGENTS.md` has more than `ROW_CAP` total rows but enough are sidecar-pointer rows that the inline-row count is at or below `ROW_CAP`, and the file is within `AGENTS_BYTE_CAP`
- **THEN** `kb dox lint` reports no `over-threshold` row-arm issue for that file

#### Scenario: Many short inline rows still trip the cap
- **WHEN** a directory `AGENTS.md` has more than `ROW_CAP` inline rows (short rows that were never promoted to sidecars)
- **THEN** `kb dox lint` reports a row-arm `over-threshold` issue whose count is the inline-row count

#### Scenario: Inline exclusion does not weaken the missing/orphan checks
- **WHEN** a directory `AGENTS.md` contains sidecar-pointer rows and `kb dox lint` runs its `missing` and `orphan` checks
- **THEN** every documented path — inline AND sidecar-pointer — is still counted as covered (no `missing` raised for a file documented only by a sidecar-pointer row, no path silently dropped); the inline exclusion applies solely to the `ROW_CAP` count, and `parseRowPaths` (consumed cross-package by kb-extension) returns the complete path list unchanged

### Requirement: over-threshold lint distinguishes byte-cap from row-cap arm
`kb dox lint` SHALL classify an `over-threshold` issue by which cap it tripped. A directory `AGENTS.md` whose byte size exceeds `AGENTS_BYTE_CAP` SHALL be reported as an **actionable** over-threshold (remedy: file-based sidecar split). A directory `AGENTS.md` whose **inline** row count exceeds `ROW_CAP` but whose byte size is within `AGENTS_BYTE_CAP` SHALL be reported as an **informational** over-threshold (no per-turn injection cost; remedy is optional directory foldering). Each `over-threshold` issue SHALL carry a discriminator identifying its arm. `ROW_CAP` and `AGENTS_BYTE_CAP` numeric values SHALL be unchanged.

#### Scenario: Byte-over is actionable
- **WHEN** a directory `AGENTS.md` exceeds `AGENTS_BYTE_CAP` (30000 bytes)
- **THEN** `kb dox lint` emits an `over-threshold` issue whose arm is `bytes` and whose detail names the byte cap and the sidecar-split remedy

#### Scenario: Row-over-only is informational
- **WHEN** a directory `AGENTS.md` has more than `ROW_CAP` (40) rows but is within `AGENTS_BYTE_CAP`
- **THEN** `kb dox lint` emits an `over-threshold` issue whose arm is `rows` and whose detail marks it informational (advisory; no per-turn injection cost)

#### Scenario: Over both caps reports both arms
- **WHEN** a directory `AGENTS.md` exceeds both `ROW_CAP` and `AGENTS_BYTE_CAP`
- **THEN** `kb dox lint` emits a `bytes`-arm issue and a `rows`-arm issue for that file

### Requirement: No AGENTS.md rolls up files from an un-scaffolded subdirectory
A directory `AGENTS.md` SHALL document only the files in its own directory. Files that live in a subdirectory SHALL be documented in that subdirectory's own `AGENTS.md`. A rollup — where a parent `AGENTS.md` carries rows for files under a subdirectory that has no `AGENTS.md` of its own — SHALL be decomposed by scaffolding the subdirectory `AGENTS.md` and moving the affected rows down, preserving each row's purpose and `See change:` history verbatim.

#### Scenario: qa/ rollup decomposed
- **WHEN** `qa/AGENTS.md` documents files under `qa/packer/`, `qa/tests/`, `qa/fixtures/`, and `qa/scripts/`
- **THEN** each of those subdirectories has its own `AGENTS.md` owning its files' rows, `qa/AGENTS.md` retains only the files at `qa/` root, and `kb dox lint` reports no `missing` or `orphan` for the moved rows

#### Scenario: docker/ rollup decomposed
- **WHEN** `docker/AGENTS.md` documents files under `docker/fixtures/`
- **THEN** `docker/fixtures/AGENTS.md` owns those rows and `docker/AGENTS.md` is no longer over-threshold on the row arm

### Requirement: Oversized flat source directories foldered into cohesive subfolders
The oversized root-level source directories `packages/client/src/components/`, `packages/server/src/`, and `packages/client/src/lib/` SHALL be reorganized so their root-level files are grouped into cohesive per-domain subfolders. A root-level file SHALL be absorbed into an existing subfolder when one already fits its domain (e.g. `components/preview/`); a new subfolder SHALL be created only for a domain with no existing home and SHALL NOT collide with an existing subfolder name. Each new subfolder SHALL have its own `AGENTS.md` with one row per file whose purpose is migrated verbatim from the file's prior row (with its `See change:` history) or, for a file no prior row covered, authored as a caveman-style summary — never an empty-purpose row. Moved files are owned by their subfolder's `AGENTS.md` (the tree is walked, not rolled up); the parent SHALL NOT gain per-subfolder pointer rows, and its inline row count SHALL drop as files leave. Each new subfolder's `AGENTS.md` SHALL land at or under `ROW_CAP`; a cohesive domain that itself exceeds `ROW_CAP` SHALL nest a further subfolder level rather than fragment, or be accepted as an informational row-over when no cohesive nesting exists. Foldering SHALL be behavior-preserving: files moved with history, ALL references updated — both ESM import specifiers (preserving the `.js`-on-`.tsx` convention) and string-literal path references (e.g. `packages/shared/src/__tests__/no-*.test.ts` allowlists) — no new re-export barrels, and the package's `tsc --noEmit` and full test suite SHALL pass unchanged.

#### Scenario: components/ foldered, behavior unchanged
- **WHEN** the foldering increment for `packages/client/src/components/` completes
- **THEN** the root-level files are grouped into cohesive subfolders — absorbed into an existing subfolder (`preview/`, `chat/`, `split/`, …) where one fits, else a new non-colliding subfolder — each subfolder has its own `AGENTS.md`, `components/AGENTS.md` and every new/affected subfolder `AGENTS.md` have an inline row count ≤ `ROW_CAP`, every ESM specifier AND string-literal path reference resolves to the new path, and `tsc --noEmit` + `npm test` + `npm run build` pass

#### Scenario: server/src/ foldered, server still boots
- **WHEN** the foldering increment for `packages/server/src/` completes
- **THEN** `server/src/AGENTS.md` and each new subfolder `AGENTS.md` are ≤ `ROW_CAP`, `tsc --noEmit` + `npm test` pass, and the server boots with `/api/health` returning 200

#### Scenario: lib/ foldered, imports rewritten
- **WHEN** the foldering increment for `packages/client/src/lib/` completes
- **THEN** `lib/AGENTS.md` and each new subfolder `AGENTS.md` are ≤ `ROW_CAP`, every repo-wide importer of `lib/*` resolves to the new path, and `tsc --noEmit` + `npm test` + `npm run build` pass

### Requirement: Marginal row-over directories accepted as informational
Directories whose `AGENTS.md` exceeds `ROW_CAP` (on the inline count) only marginally and for which no cohesive subfolder grouping is warranted SHALL be accepted as informational over-threshold rather than foldered. This covers `packages/client/src/hooks/`, `packages/extension/src/`, `packages/shared/src/`, and `tests/e2e/`. As of this change none of these is over the byte cap, so each carries the `rows` arm only and this change does NOT reorganize them. This is a current-state classification, not a permanent guarantee: `extension/src/AGENTS.md` sits near the byte cap, and if any of these directories later crosses `AGENTS_BYTE_CAP` it SHALL then carry the actionable `bytes` arm and its sidecar-split remedy applies — the acceptance holds only while the directory stays within the byte cap.

#### Scenario: Marginal dir left un-foldered while within the byte cap
- **WHEN** `kb dox lint` runs after all foldering increments AND each marginal directory's `AGENTS.md` is within `AGENTS_BYTE_CAP`
- **THEN** `packages/client/src/hooks/AGENTS.md`, `packages/extension/src/AGENTS.md`, `packages/shared/src/AGENTS.md`, and `tests/e2e/AGENTS.md` report only the informational `rows` arm, and no source files in them were moved by this change
