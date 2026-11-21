## ADDED Requirements

### Requirement: Engine fingerprint covers only row-producing sources
The kb engine fingerprint recorded per source and compared by the staleness gate and the worktree seed gate SHALL be `rowsHash` of `engine-fingerprint.json`: a digest of the row-producing source files (chunkers, indexer, frontmatter extraction, gitignore filter). Other files under `packages/kb/src/` SHALL NOT affect it. `srcHash`, `tsconfigHash` and `distHash` SHALL remain for the build-freshness gate.

#### Scenario: Non-row edit does not force a reindex
- **GIVEN** a docs database whose source `docs` records the running engine fingerprint
- **WHEN** a file outside the row-producing set (for example `render.ts`) is edited, the fingerprint regenerated, and a pass runs
- **THEN** `rowsHash` is unchanged and `docs` is not forced; unchanged files are not re-chunked

#### Scenario: Row-producing edit forces a reindex
- **WHEN** `chunker.ts` (or any other row-producing file) is edited and the fingerprint regenerated
- **THEN** `rowsHash` changes and the next pass forces every source once

#### Scenario: New row-producing import is caught
- **WHEN** `indexer.ts` (transitively) imports a module that is neither in the row-producing set nor in the declared non-row list
- **THEN** the guard test fails

#### Scenario: Store DDL edit without a schema bump is caught
- **WHEN** the `sqlite-store.ts` table definitions change while `SCHEMA_VERSION` is unchanged
- **THEN** the golden test pinning `{SCHEMA_VERSION, digest of the definitions}` fails and tells the author to bump `SCHEMA_VERSION`

#### Scenario: Missing rowsHash disables engine gating
- **WHEN** `engine-fingerprint.json` lacks `rowsHash`
- **THEN** the running engine is `null` and no engine record is kept or required

### Requirement: Batch commits are time-bounded
The indexer SHALL commit the open batch and yield to the event loop when either the batch file-count threshold is reached or a fixed wall-clock budget (`INDEX_BATCH_MAX_MS`, 50 ms) has elapsed since the last yield, whichever comes first. The budget SHALL NOT change which files are indexed or the resulting rows.

#### Scenario: Slow files trigger a time yield
- **WHEN** files are processed slowly enough that the budget elapses before the count threshold
- **THEN** the transaction is committed and control yields to the event loop at that point

#### Scenario: Yield cadence is bounded by the budget
- **WHEN** a forced pass indexes a synthetic multi-thousand-file corpus under a controlled clock
- **THEN** the span between consecutive commit-and-yield points never exceeds the budget plus one file's processing time
- **AND** the resulting rows are identical to a pass without the time budget

### Requirement: Index passes are cancellable and report progress
`indexSource` SHALL accept an optional `AbortSignal` and an optional progress callback. An aborted signal SHALL stop the pass at the next file or batch boundary by throwing an abort error that rolls back the open batch. The callback SHALL be invoked once per committed batch with the source root and files done/total. Both options SHALL be additive: omitting them changes nothing.

#### Scenario: Abort stops the pass at the next boundary
- **GIVEN** a pass over many files with an abortable signal
- **WHEN** the signal is aborted mid-pass
- **THEN** the pass throws the abort error, the open batch is rolled back, and batches already committed remain

#### Scenario: Progress per committed batch
- **WHEN** a pass commits a batch
- **THEN** the progress callback receives the source root, files done so far and the walked total

#### Scenario: Options omitted
- **WHEN** neither option is supplied
- **THEN** rows and batching are identical to a pass without them

