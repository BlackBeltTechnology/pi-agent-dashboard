## ADDED Requirements

### Requirement: Engine fingerprint covers only row-producing sources
The kb engine fingerprint recorded per source and compared by the staleness gate SHALL be `rowsHash` of `engine-fingerprint.json`: a digest of the LF-normalized contents of the row-producing source files (the chunkers, the indexer, frontmatter/property extraction and the gitignore walk filter). An edit to any other file under `packages/kb/src/` SHALL NOT change it. `srcHash`, `tsconfigHash` and `distHash` SHALL remain in the file for the build-freshness gate.

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

#### Scenario: Missing rowsHash disables engine gating
- **WHEN** `engine-fingerprint.json` lacks `rowsHash`
- **THEN** the running engine is `null` and no engine record is kept or required

### Requirement: Batch commits are time-bounded
The indexer SHALL commit the open batch and yield to the event loop when either the batch file-count threshold is reached or a fixed wall-clock budget (`INDEX_BATCH_MAX_MS`, 50 ms) has elapsed since the last yield, whichever comes first. The budget SHALL NOT change which files are indexed or the resulting rows.

#### Scenario: Slow files trigger a time yield
- **WHEN** files are processed slowly enough that the budget elapses before the count threshold
- **THEN** the transaction is committed and control yields to the event loop at that point

#### Scenario: Forced pass keeps the loop responsive
- **WHEN** a forced pass indexes a synthetic multi-thousand-file corpus
- **THEN** the maximum observed event-loop delay does not exceed 250 ms
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

